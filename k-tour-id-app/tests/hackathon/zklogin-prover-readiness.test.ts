import assert from "node:assert/strict"
import { test } from "node:test"
import { runZkLoginProverReadiness } from "../../scripts/hackathon-zklogin-prover-readiness"

const env = { HK_SUI_NETWORK: "testnet", HK_ZKLOGIN_PROVER_URL: "https://prover.mystenlabs.com/v1" }
const rejectedFetch: typeof fetch = async () => { throw new Error("unexpected_network") }
const secret = "never-output-provider-secret"
const response = (body = "pong", status = 200, headers = {}) => new Response(body, { status, headers })

test("offline defaults never touch network, ambient secrets, or success claims", async () => {
  const report = await runZkLoginProverReadiness({ env, fetchImpl: rejectedFetch })
  assert.equal(report.ok, true)
  assert.equal(report.health, "not_requested")
  assert.equal(report.providerVerified, false)
  assert.equal(report.liveExecutionReady, false)
  assert.equal(report.safety.networkCalls, 0)
  const empty = await runZkLoginProverReadiness({ fetchImpl: rejectedFetch })
  assert.equal(empty.ok, false)
  assert.deepEqual(empty.issues, ["explicit_prover_missing"])
})

test("read-only health makes exactly one credential-free GET and never proves integration", async () => {
  const calls: RequestInit[] = []
  const report = await runZkLoginProverReadiness({ mode: "read-only", env, fetchImpl: async (url, init) => {
    assert.equal(url, "https://prover.mystenlabs.com/ping")
    calls.push(init!)
    return response("pong\n")
  } })
  assert.equal(report.ok, true)
  assert.equal(report.health, "reachable")
  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, "GET")
  assert.equal(calls[0].body, undefined)
  assert.equal(calls[0].redirect, "error")
  assert.equal(calls[0].credentials, "omit")
  assert.deepEqual(calls[0].headers, { accept: "text/plain" })
  assert.deepEqual(report.safety, { networkCalls: 1, proofRequests: 0, jwtSent: false, signatures: 0, broadcasts: 0, secretValuesOutput: false })
  assert.equal(report.providerVerified, false)
  assert.equal(report.liveExecutionReady, false)
})

test("Devnet is explicit and cannot be probed as a Testnet-compatible configuration", async () => {
  const url = "https://prover-dev.mystenlabs.com/v1"
  const wrong = await runZkLoginProverReadiness({ mode: "read-only", env: { ...env, HK_ZKLOGIN_PROVER_URL: url }, fetchImpl: rejectedFetch })
  assert.equal(wrong.ok, false)
  assert.equal(wrong.safety.networkCalls, 0)
  const right = await runZkLoginProverReadiness({ mode: "read-only", env: { HK_SUI_NETWORK: "devnet", HK_ZKLOGIN_PROVER_URL: url }, fetchImpl: async url => {
    assert.equal(url, "https://prover-dev.mystenlabs.com/ping")
    return response()
  } })
  assert.equal(right.health, "reachable")
  assert.equal(right.network, "devnet")
  assert.equal(right.providerVerified, false)
})

test("custom, private, credential-bearing and mainnet targets make no requests or echo inputs", async () => {
  for (const value of ["https://127.0.0.1/v1", "https://custom.invalid/v1", "https://user:" + secret + "@prover.mystenlabs.com/v1", "https://prover.mystenlabs.com/v1?token=" + secret, "http://prover.mystenlabs.com/v1", "https://prover.mystenlabs.com/v1#" + secret]) {
    const report = await runZkLoginProverReadiness({ mode: "read-only", env: { ...env, HK_ZKLOGIN_PROVER_URL: value }, fetchImpl: rejectedFetch })
    assert.equal(report.ok, false)
    assert.equal(report.safety.networkCalls, 0)
    assert.equal(JSON.stringify(report).includes(value), false)
    assert.equal(JSON.stringify(report).includes(secret), false)
  }
  const mainnet = await runZkLoginProverReadiness({ mode: "read-only", env: { ...env, HK_SUI_NETWORK: "mainnet" }, fetchImpl: rejectedFetch })
  assert.ok(mainnet.issues.includes("network_not_supported_by_probe"))
  assert.equal(mainnet.safety.networkCalls, 0)
})

test("accessor configuration is rejected without invoking code or unrelated secret getters", async () => {
  let invoked = 0
  const report = await runZkLoginProverReadiness({ env: { get HK_ZKLOGIN_PROVER_URL(): string { invoked++; throw new Error(secret) } }, fetchImpl: rejectedFetch })
  assert.deepEqual(report.issues, ["configuration_invalid"])
  const input = { ...env, get JWT() { invoked++; throw new Error(secret) } }
  assert.equal((await runZkLoginProverReadiness({ env: input, fetchImpl: rejectedFetch })).ok, true)
  assert.equal(invoked, 0)
})

test("redirect, auth and server errors have bounded fixed codes and no response text", async () => {
  for (const [status, code] of [[302, "prover_health_redirect_rejected"], [401, "prover_health_auth_rejected"], [403, "prover_health_auth_rejected"], [500, "prover_health_http_error"]] as const) {
    const report = await runZkLoginProverReadiness({ mode: "read-only", env, fetchImpl: async () => response(secret, status, { location: "https://other.invalid/" + secret }) })
    assert.deepEqual(report.issues, [code])
    assert.equal(report.safety.networkCalls, 1)
    assert.equal(JSON.stringify(report).includes(secret), false)
  }
})

test("unexpected response URL is refused even if an injected transport followed a redirect", async () => {
  const redirected = response()
  Object.defineProperty(redirected, "url", { value: "https://other.invalid/" + secret })
  const report = await runZkLoginProverReadiness({ mode: "read-only", env, fetchImpl: async () => redirected })
  assert.deepEqual(report.issues, ["prover_health_redirect_rejected"])
  assert.equal(JSON.stringify(report).includes(secret), false)
})

test("oversized declared and streamed bodies are rejected and streams cancelled", async () => {
  for (const fake of [() => response("pong", 200, { "content-length": "65" }), () => response("x".repeat(65))]) {
    const report = await runZkLoginProverReadiness({ mode: "read-only", env, fetchImpl: async () => fake() })
    assert.deepEqual(report.issues, ["prover_health_response_too_large"])
  }
  let cancelled = false
  const report = await runZkLoginProverReadiness({ mode: "read-only", env, fetchImpl: async () => new Response(new ReadableStream({
    start(c) { c.enqueue(new Uint8Array(65)) }, cancel() { cancelled = true },
  })) })
  assert.deepEqual(report.issues, ["prover_health_response_too_large"])
  assert.equal(cancelled, true)
})

test("success HTTP with invalid or undecodable body is not health success", async () => {
  for (const body of [secret, "PONG", "{\"ok\":true}", new Uint8Array([0xff, 0xff])]) {
    const report = await runZkLoginProverReadiness({ mode: "read-only", env, fetchImpl: async () => new Response(body) })
    assert.deepEqual(report.issues, ["prover_health_response_invalid"])
    assert.equal(report.health, "failed")
    assert.equal(JSON.stringify(report).includes(secret), false)
  }
})

test("fetch timeout covers a transport ignoring AbortSignal and late responses are discarded", async () => {
  let signal: AbortSignal | undefined
  let release: ((response: Response) => void) | undefined
  const report = await runZkLoginProverReadiness({ mode: "read-only", env, timeoutMs: 10, fetchImpl: async (_, init) => {
    signal = init?.signal as AbortSignal
    return new Promise(resolve => { release = resolve })
  } })
  assert.deepEqual(report.issues, ["prover_health_timeout"])
  assert.equal(signal?.aborted, true)
  release!(response())
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(report.health, "failed")
})

test("deadline also bounds never-ending response bodies and cancels reader", async () => {
  let cancelled = false
  const report = await runZkLoginProverReadiness({ mode: "read-only", env, timeoutMs: 10, fetchImpl: async () => new Response(new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode("po")) }, cancel() { cancelled = true },
  })) })
  assert.deepEqual(report.issues, ["prover_health_timeout"])
  assert.equal(cancelled, true)
})

test("transport exceptions are redacted, never retried, and invalid mode does not network", async () => {
  let calls = 0
  const report = await runZkLoginProverReadiness({ mode: "read-only", env, fetchImpl: async () => { calls++; throw new Error(secret) } })
  assert.deepEqual(report.issues, ["prover_health_transport_failed"])
  assert.equal(JSON.stringify(report).includes(secret), false)
  assert.equal(calls, 1)
  const invalid = await runZkLoginProverReadiness({ mode: "write" as never, env, fetchImpl: rejectedFetch })
  assert.deepEqual(invalid.issues, ["mode_invalid"])
  assert.equal(invalid.safety.networkCalls, 0)
})
