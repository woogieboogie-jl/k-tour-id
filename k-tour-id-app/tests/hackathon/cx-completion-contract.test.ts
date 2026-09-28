import assert from "node:assert/strict"
import { after, beforeEach, test } from "node:test"
import { cxComplete, cxStart } from "../../lib/hackathon/adapters/cx"
import { HkError } from "../../lib/hackathon/util"

// Synthetic shapes from the supplied manual (SHA-256 bd4d948e...b3), sections
// 2.3.3/2.3.4 and 2.4. No real claims, tokens, signatures or provider calls.
const fixtureEnv = {
  HK_ISOLATED_MOCK: "0", HK_MODE_CX: "cx", NEXT_PUBLIC_HK_CX_PREVIEW: "0",
  HK_CX_PROVIDER: "comdl", HK_CX_BASE_URL: "https://cx.invalid", HK_CX_API_KEY: "",
  HK_CX_ZKP_TYPE: "AdultVerify", HK_ISSUER_SIGNING_SEED: "fixture-only-cx-completion-seed",
}
const previousEnv = Object.fromEntries(Object.keys(fixtureEnv).map(key => [key, process.env[key]]))
const previousFetch = globalThis.fetch
const input = { operationId: "op-fixture", token: "request-token-fixture", txId: "tx-fixture", cxId: "cx-fixture", mobile: false }
const calls: Array<{ path: string; body: Record<string, unknown> }> = []
let responses: unknown[] = []
const completion = (patch: Record<string, unknown> = {}) => ({ resultCode: "200", oacxStatus: "AFTER_RESULT",
  txId: input.txId, reqTxId: input.txId, cxId: input.cxId, token: "completion-token-fixture", data: { verified: true }, ...patch })
const decoded = (patch: Record<string, unknown> = {}) => ({ resultCode: "200", data: {
  ci: "synthetic-stable-subject", jti: "unrelated-jwt-identifier", sub: "AFTER_RESULT", provider: "comdl", ...patch,
} })
const code = (...codes: string[]) => (error: unknown) => error instanceof HkError && codes.includes(error.code)

beforeEach(() => {
  Object.assign(process.env, fixtureEnv)
  calls.length = 0; responses = []
  globalThis.fetch = async (target, init) => {
    const url = new URL(String(target))
    assert.equal(url.origin, "https://cx.invalid", "unexpected real provider target")
    assert.equal(init?.method, "POST")
    assert.equal(init.redirect, "error")
    calls.push({ path: url.pathname, body: JSON.parse(String(init.body)) })
    assert.ok(responses.length > 0, "unexpected provider request")
    return Response.json(responses.shift())
  }
})
after(() => {
  globalThis.fetch = previousFetch
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

for (const mobile of [false, true]) {
  test(`manual completion envelope binds ${mobile ? "app" : "QR"} claims without invented txId/cxId`, async () => {
    responses = [completion(), decoded()]
    const result = await cxComplete({ ...input, mobile })
    assert.ok("evidence" in result)
    assert.equal(result.evidence.providerTransactionRef, input.txId)
    assert.equal(result.evidence.personVerified, true)
    assert.equal(result.evidence.adultVerified, null)
    assert.deepEqual(calls, [
      { path: `/oacx/api/v1.0/authen/${mobile ? "app" : "qr"}/result`, body: {
        provider: "comdl_v1.5", token: input.token, txId: input.txId, cxId: input.cxId,
      } },
      { path: "/oacx/api/v1.0/trans/token", body: { token: "completion-token-fixture" } },
    ])
    const publicResult = JSON.stringify(result)
    for (const raw of ["synthetic-stable-subject", "completion-token-fixture", "request-token-fixture", "jti"]) assert.equal(publicResult.includes(raw), false)
  })
}

test("lowercase appendix aliases and reqTxId remain bound, not guessed", async () => {
  for (const patch of [
    { txId: undefined, reqTxId: undefined, txid: input.txId, cxId: undefined, cxid: input.cxId },
    { txId: undefined, reqTxId: input.txId },
  ]) {
    responses = [completion(patch), decoded({ txid: input.txId, cxid: input.cxId })]
    const result = await cxComplete(input)
    assert.ok("evidence" in result)
    assert.equal(result.evidence.providerTransactionRef, input.txId)
  }
})

for (const [name, patch] of Object.entries({
  txId: { txId: "wrong-transaction" }, reqTxId: { reqTxId: "wrong-transaction" },
  hiddenTxAlias: { txid: "wrong-transaction" }, cxId: { cxId: "wrong-correlation" },
  hiddenCxAlias: { cxid: "wrong-correlation" }, nullTx: { txid: null }, nullCx: { cxid: null },
  nestedTx: { data: { verified: true, txId: "wrong-transaction" } },
  nestedRequestedTx: { data: { verified: true, reqTxId: "wrong-transaction" } },
  nestedCx: { data: { verified: true, cxId: "wrong-correlation" } },
})) {
  test(`rejects result correlation conflict ${name} before token parsing`, async () => {
    responses = [completion(patch), decoded()]
    await assert.rejects(cxComplete(input), code("cx_transaction_mismatch"))
    assert.equal(calls.length, 1)
  })
}

for (const patch of [
  { txId: undefined, reqTxId: undefined }, { cxId: undefined },
  { txId: undefined, reqTxId: undefined, cxId: undefined, data: { verified: true, txId: input.txId, cxId: input.cxId } },
]) {
  test(`missing envelope handles fail closed: ${Object.keys(patch).join("/")}`, async () => {
    responses = [completion(patch), decoded()]
    await assert.rejects(cxComplete(input), code("cx_transaction_missing"))
    assert.equal(calls.length, 1)
  })
}

for (const token of [undefined, null, "", input.token, {}, "token\nfixture"]) {
  test(`missing/old/invalid completion token never falls back (${typeof token}:${String(token)})`, async () => {
    responses = [completion({ token }), decoded()]
    await assert.rejects(cxComplete(input), code("cx_response"))
    assert.equal(calls.length, 1)
  })
}

test("all parsed envelope/data echoes are checked, including conflicting aliases", async () => {
  const claims = decoded({ txid: input.txId, cxid: input.cxId })
  for (const response of [
    { ...claims, txId: "wrong-transaction" }, { ...claims, cxId: "wrong-correlation" },
    decoded({ txId: input.txId, txid: "wrong-transaction" }), decoded({ reqTxId: "wrong-transaction" }),
    decoded({ cxId: input.cxId, cxid: "wrong-correlation" }), decoded({ txId: null }),
    decoded({ sub: "AFTER_REQUEST" }), decoded({ sub: true }),
  ]) {
    responses = [completion(), response]
    await assert.rejects(cxComplete(input), code("cx_transaction_mismatch"))
  }
})

test("CI remains necessary; successful ZKP processing cannot create a unique person", async () => {
  for (const ci of [undefined, null, "", "bad\nsubject", "x".repeat(1025)]) {
    responses = [completion({ data: { verified: true, zkp: true } }), decoded({ ci })]
    await assert.rejects(cxComplete(input), code("cx_subject_unavailable"))
  }
})

test("ZKP-mode flag is not an affirmative adult claim", async () => {
  responses = [completion({ data: { verified: true, zkp: true } }), decoded()]
  const result = await cxComplete(input)
  assert.ok("evidence" in result)
  assert.equal(result.evidence.adultVerified, null)
})

test("request reqTxId conflicts cannot create an app or QR handoff", async () => {
  for (const mobile of [false, true]) {
    responses = [{ resultCode: "200", token: "trans-token-fixture", txId: input.txId },
      { resultCode: "200", token: input.token, reqTxId: "wrong-transaction", cxId: input.cxId,
        data: mobile ? { iosLink: "https://mobileid.go.kr/verify.html" } : { qrBase64: Buffer.from("89504e470d0a1a0a00000000", "hex").toString("base64") } }]
    await assert.rejects(cxStart({ operationId: input.operationId, mobile }), code("cx_transaction_mismatch"))
  }
})

test("pending result may rotate a token but cannot carry another transaction", async () => {
  responses = [{ resultCode: "402", token: "next-request-token", reqTxId: input.txId, cxId: input.cxId }]
  assert.deepEqual(await cxComplete(input), { pending: true, token: "next-request-token" })
  responses = [{ resultCode: "402", token: "next-request-token", reqTxId: "wrong-transaction", cxId: input.cxId }]
  await assert.rejects(cxComplete(input), code("cx_transaction_mismatch"))
})
