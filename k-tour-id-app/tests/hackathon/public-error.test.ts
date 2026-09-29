import assert from "node:assert/strict"
import { after, mock, test } from "node:test"
import { safeHkError } from "../../lib/hackathon/public-error"
import { HkError } from "../../lib/hackathon/util"

const PRIVATE = "fixture-only-private-token-DO-NOT-OUTPUT"
const providerText = `https://provider.invalid/?token=${PRIVATE} Bearer ${PRIVATE} signature=${PRIVATE}`

test("unknown SDK/provider messages, causes, and enumerable payloads never become public", () => {
  for (const error of [new Error(providerText, { cause: { jwt: PRIVATE } }), providerText, { message: PRIVATE, token: PRIVATE }, null, undefined]) {
    const result = safeHkError(error)
    assert.equal(result.status, 500)
    assert.equal(result.error.code, "internal")
    assert.equal(JSON.stringify(result).includes(PRIVATE), false)
  }
})

test("known errors preserve code/status/retry semantics but never their message", () => {
  for (const [code, status, retryable] of [["wallet_proof", 400, false], ["sui_execute_failed", 502, false], ["sui_delegate", 502, true], ["omnione_evidence_unavailable", 503, true], ["cx_preview_access_denied", 401, false]] as const) {
    const result = safeHkError(new HkError(code, providerText, status, retryable))
    assert.equal(result.error.code, code)
    assert.equal(result.status, status)
    assert.equal(result.error.retryable, retryable)
    assert.equal(JSON.stringify(result).includes(PRIVATE), false)
  }
})

test("unrecognized codes and invalid statuses cannot inject response data or success statuses", () => {
  for (const error of [new HkError(PRIVATE, PRIVATE, 400), new HkError("unknown_provider_code", PRIVATE, 503), new HkError("wallet_proof", PRIVATE, 200)]) {
    const result = safeHkError(error)
    assert.equal(result.status, 500)
    assert.equal(result.error.code, "internal")
    assert.equal(JSON.stringify(result).includes(PRIVATE), false)
  }
})

test("shared-budget and cutover refusal remains a non-retryable unavailable response with fixed copy", () => {
  for (const code of ["integration_shared_budget", "integration_cutover_unverified", "integration_cutover_source_changed", "integration_cutover_authority_unavailable", "integration_cutover_operator_configuration", "integration_cutover_outcome_unknown", "integration_cutover_conflict"]) {
    const result = safeHkError(new HkError(code, providerText, 503))
    assert.equal(result.status, 503)
    assert.equal(result.error.code, code)
    assert.equal(result.error.retryable, false)
    assert.equal(JSON.stringify(result).includes(PRIVATE), false)
  }
})

test("hostile getters and proxy values fail closed without inspection or logging", () => {
  const error = new HkError("wallet_proof", PRIVATE)
  Object.defineProperty(error, "code", { get() { throw new Error(PRIVATE) } })
  assert.equal(safeHkError(error).error.code, "internal")
  const proxy = new Proxy({}, { getPrototypeOf() { throw new Error(PRIVATE) } })
  assert.equal(safeHkError(proxy).error.code, "internal")
  const noMessage = new HkError("wallet_proof", PRIVATE)
  Object.defineProperty(noMessage, "message", { get() { throw new Error("message must not be inspected") } })
  assert.equal(safeHkError(noMessage).error.code, "wallet_proof")
})

test("CX-only fallback remains unavailable and expiration messages are fixed", () => {
  const result = safeHkError(new Error(PRIVATE), { cxPreview: true })
  assert.equal(result.status, 503)
  assert.equal(result.error.code, "cx_preview_unavailable")
  assert.match(safeHkError(new HkError("evidence_expired", PRIVATE)).error.message, /expired/)
  const isolated = safeHkError(new HkError("isolated_mock_external_disabled", providerText, 503))
  assert.equal(isolated.error.message, "External services are disabled in isolated mock mode.")
  assert.equal(JSON.stringify(isolated).includes(PRIVATE), false)
})

test("stateful error accessors cannot change validated code/status/retry fields", () => {
  for (const name of ["code", "status", "retryable"] as const) {
    const error = new HkError("wallet_proof", providerText, 400, false)
    let reads = 0
    Object.defineProperty(error, name, { get() { reads++; return reads === 1 ? ({ code: "wallet_proof", status: 400, retryable: false })[name] : PRIVATE } })
    const result = safeHkError(error)
    assert.equal(reads, 0)
    assert.equal(result.error.code, "internal")
    assert.equal(result.status, 500)
    assert.equal(JSON.stringify(result).includes(PRIVATE), false)
  }
})

const env = { ...process.env }, originalFetch = globalThis.fetch
after(() => {
  for (const key of Object.keys(process.env)) delete process.env[key]
  Object.assign(process.env, env)
  globalThis.fetch = originalFetch
  mock.restoreAll()
})

test("actual API error response and logs do not disclose a failed session's provider error", async () => {
  // No real request/session/store/provider: the Next request-scope read fails
  // before any I/O, exercising the actual route's catch and response boundary.
  Object.assign(process.env, { HK_API_ENABLED: "1", NEXT_PUBLIC_HK_ENABLED: "1", NEXT_PUBLIC_HK_CX_PREVIEW: "0", NEXT_PUBLIC_HK_PREVIEW_READ_ONLY: "0", HK_ISOLATED_MOCK: "1" })
  let networkCalls = 0, logCalls = 0
  globalThis.fetch = async () => { networkCalls++; throw new Error("network forbidden") }
  const log = mock.method(console, "error", () => { logCalls++ })
  const { workAsyncStorage } = await import("next/dist/server/app-render/work-async-storage.external")
  const scope = mock.method(workAsyncStorage, "getStore", () => { throw new Error(providerText) })
  try {
    const { GET } = await import("../../app/api/hackathon/v1/[...path]/route")
    const response = await GET(new Request("http://localhost/api/hackathon/v1/me"), { params: Promise.resolve({ path: ["me"] }) })
    assert.equal(response.status, 500)
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.equal(response.headers.get("set-cookie"), null)
    const body = await response.text()
    assert.equal(body.includes(PRIVATE), false)
    assert.equal(JSON.parse(body).error.code, "internal")
    assert.equal(networkCalls, 0)
    assert.equal(logCalls, 0)
  } finally { scope.mock.restore(); log.mock.restore() }
})
