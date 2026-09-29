import assert from "node:assert/strict"
import test from "node:test"
import { deriveSalt, proveZkLogin } from "../../lib/hackathon/adapters/zklogin"
import { HkError } from "../../lib/hackathon/util"

const SECRET = "zklogin-secret-sentinel"
const LEAK = "https://provider.invalid/?token=private-sentinel"
const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")
// Unsigned fixtures only: these tests do NOT verify a JWT, ZK proof or live login.
const jwt = `${part({ alg: "RS256", typ: "JWT" })}.${part({ iss: "https://accounts.google.com", aud: "fixture-client", sub: "fixture-user", exp: 4102444800 })}.fixture`
const opts = { jwt, extendedEphemeralPublicKey: "fixture-key", maxEpoch: 9, jwtRandomness: "123" }
const proof = { proofPoints: { a: ["1", "2", "3"], b: [["1", "2"], ["3", "4"], ["5", "6"]], c: ["1", "2", "3"] }, issBase64Details: { value: "fixture", indexMod4: 0 }, headerBase64: "fixture", addressSeed: "123" }

function setup(enoki = true) {
  const previous = new Map<string, string | undefined>()
  const values: Record<string, string | undefined> = {
    HK_ISOLATED_MOCK: "0", NEXT_PUBLIC_HK_PREVIEW_READ_ONLY: "0", NEXT_PUBLIC_HK_CX_PREVIEW: "0",
    HK_ZKLOGIN_SALT_SEED: SECRET, NEXT_PUBLIC_GOOGLE_CLIENT_ID: "fixture-client",
    ENOKI_API_KEY: enoki ? SECRET : undefined, HK_SUI_NETWORK: "testnet",
    ENOKI_API_URL: undefined, HK_ZKLOGIN_PROVER_URL: "https://fixture-prover.invalid/v1",
  }
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key])
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  const fetch = globalThis.fetch
  return () => {
    globalThis.fetch = fetch
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

function safeError(code: string, status = 502) {
  return (error: unknown) => {
    assert.ok(error instanceof HkError)
    assert.equal(error.code, code)
    assert.equal(error.status, status)
    for (const secret of [SECRET, LEAK, jwt]) {
      assert.equal(String(error).includes(secret), false)
      assert.equal(JSON.stringify(error).includes(secret), false)
      assert.equal(error.stack?.includes(secret), false)
    }
    return true
  }
}

for (const managed of [true, false]) {
  const code = managed ? "zklogin_enoki" : "zklogin_prover"
  test(`${code}: provider HTTP/transport/JSON/oversize errors are bounded and sanitized`, async () => {
    const restore = setup(managed)
    try {
      let cancelled = false
      globalThis.fetch = async (_url, init) => {
        assert.equal(init?.redirect, "error")
        assert.equal(init?.cache, "no-store")
        assert.ok(init?.signal)
        return new Response(new ReadableStream({ cancel() { cancelled = true } }), { status: 403 })
      }
      await assert.rejects(proveZkLogin(opts), safeError(code))
      assert.equal(cancelled, true)
      globalThis.fetch = async () => { throw new Error(`${LEAK} ${SECRET} ${jwt}`) }
      await assert.rejects(proveZkLogin(opts), safeError(code))
      for (const body of [LEAK, "null", "[]", "x".repeat(128 * 1024 + 1)]) {
        globalThis.fetch = async () => new Response(body)
        await assert.rejects(proveZkLogin(opts), safeError(code))
      }
    } finally { restore() }
  })
}

test("Enoki salt/address and proof success protocol remains unchanged", async () => {
  const restore = setup()
  try {
    const calls: string[] = []
    const who = { address: "0x" + "a".repeat(64), salt: "123", publicKey: "fixture" }
    globalThis.fetch = async (url, init) => {
      const path = new URL(String(url)).pathname
      calls.push(path)
      const headers = new Headers(init?.headers)
      assert.equal(headers.get("authorization"), `Bearer ${SECRET}`)
      assert.equal(headers.get("zklogin-jwt"), jwt)
      if (path.endsWith("/zkp")) {
        assert.equal(init?.method, "POST")
        assert.deepEqual(JSON.parse(String(init?.body)), { network: "testnet", ephemeralPublicKey: opts.extendedEphemeralPublicKey, maxEpoch: 9, randomness: "123" })
        return Response.json({ data: proof })
      }
      assert.equal(init?.method, "GET")
      return Response.json({ data: who })
    }
    assert.deepEqual(await proveZkLogin(opts), { address: who.address, salt: who.salt, inputs: proof, sub: "fixture-user", aud: "fixture-client" })
    assert.deepEqual(calls, ["/v1/zklogin", "/v1/zklogin/zkp"])
  } finally { restore() }
})

test("Enoki rejects an absent data envelope and sanitizes proof-stage failures", async () => {
  const restore = setup()
  try {
    globalThis.fetch = async () => Response.json({ error: LEAK })
    await assert.rejects(proveZkLogin(opts), safeError("zklogin_enoki"))
    let calls = 0
    globalThis.fetch = async () => ++calls === 1
      ? Response.json({ data: { salt: "123", address: "0x" + "a".repeat(64), publicKey: "fixture" } })
      : new Response(`${LEAK} ${jwt}`, { status: 500 })
    await assert.rejects(proveZkLogin(opts), safeError("zklogin_enoki"))
    assert.equal(calls, 2)
  } finally { restore() }
})

test("self-managed proof success still derives the same salt, address and address seed", async () => {
  const restore = setup(false)
  try {
    const { addressSeed: _unused, ...providerProof } = proof
    globalThis.fetch = async (_url, init) => {
      const payload = JSON.parse(String(init?.body)) as { salt: string; jwt: string }
      assert.equal(payload.salt, deriveSalt(jwt).toString())
      assert.equal(payload.jwt, jwt)
      return Response.json(providerProof)
    }
    const result = await proveZkLogin(opts)
    assert.equal(result.salt, deriveSalt(jwt).toString())
    assert.match(result.address, /^0x[0-9a-f]{64}$/)
    assert.match(result.inputs.addressSeed, /^\d+$/)
    assert.deepEqual(result.inputs.proofPoints, providerProof.proofPoints)
  } finally { restore() }
})

test("invalid JWTs and isolated previews cannot reach any provider", async () => {
  const restore = setup()
  let calls = 0
  try {
    globalThis.fetch = async () => { calls++; throw new Error("unexpected request") }
    const broken = `header.${part({ secret: LEAK })}.signature`
    await assert.rejects(proveZkLogin({ ...opts, jwt: broken }), safeError("zklogin_jwt", 400))
    assert.throws(() => deriveSalt(broken), safeError("zklogin_jwt", 400))
    process.env.NEXT_PUBLIC_HK_CX_PREVIEW = "1"
    await assert.rejects(proveZkLogin(opts), safeError("cx_preview_scope", 503))
    process.env.NEXT_PUBLIC_HK_CX_PREVIEW = "0"
    process.env.HK_ISOLATED_MOCK = "1"
    await assert.rejects(proveZkLogin(opts), safeError("isolated_mock_external_disabled", 503))
    assert.equal(calls, 0)
  } finally { restore() }
})
