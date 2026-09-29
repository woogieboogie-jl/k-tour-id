import test from "node:test"
import assert from "node:assert/strict"
import { JIT_IDENTITY_CONSENT, JIT_IDENTITY_VERSION, type JitIdentityContext } from "../../lib/hackathon/jit-identity-contract"
import { consumeJitRequestReceipt, jitAppLink, jitContext, jitIdentityCall, jitQrSource, parseJitEligibility, parseJitReceipt, parseJitRequest } from "../../features/ondo/identity-b/jit-identity-client-b"
import { consumeJitAuthorization, forgetJitAuthorization, hasJitAuthorization, hasJitConsumedReceipt, rememberJitAuthorization } from "../../features/ondo/identity-b/jit-identity-authority-b"

const future = () => new Date(Date.now() + 60_000).toISOString()
const context: JitIdentityContext = { action: "local_moment", purpose: "person", venueId: "mois-0021cd596bc5b2a922ad", tableId: null, contextDigest: `0x${"a".repeat(64)}` }
const request = () => ({ version: JIT_IDENTITY_VERSION, requestId: "idn_abcdefghijklmnop", status: "authorized" as const, context, expiresAt: future(), handoff: null, authorizationRef: "ida_abcdefghijklmnop", authorizationExpiresAt: future(), reason: null })
const receipt = () => ({ version: JIT_IDENTITY_VERSION, receiptId: "idr_abcdefghijklmnop", context, authorizedAt: new Date().toISOString(), expiresAt: future(), evidenceExpiresAt: future(), provider: "omnione_cx" as const, personVerified: true as const, adultVerified: false, paymentKycVerified: false as const })
const eligibility = () => ({ version: JIT_IDENTITY_VERSION, provider: "omnione_cx", execution: "provider", person: { state: "proof_required", expiresAt: null }, adult: { state: "proof_required", expiresAt: null }, age19: { state: "unsupported" }, paymentKyc: { state: "unsupported" }, canStart: true, consentVersion: JIT_IDENTITY_CONSENT })

test("JIT DTO rejects mock, extra claims, wrong intent, wrong operation and expired authorization", () => {
  assert.equal(parseJitRequest(request(), context).status, "authorized")
  for (const invalid of [ { ...request(), handoff: { kind: "mock", label: "ok", expiresAt: future() } }, { ...request(), context: { ...context, contextDigest: `0x${"b".repeat(64)}` } }, { ...request(), authorizationExpiresAt: "2020-01-01T00:00:00.000Z" }, { ...request(), ci: "private" } ]) assert.throws(() => parseJitRequest(invalid, context))
  assert.throws(() => parseJitRequest(request(), context, "idn_otherrequest1234"))
})
test("unavailable provider cannot manufacture eligibility and verified status must be current", () => {
  assert.equal(parseJitEligibility(eligibility()).canStart, true)
  assert.throws(() => parseJitEligibility({ ...eligibility(), execution: "unavailable" }))
  assert.throws(() => parseJitEligibility({ ...eligibility(), person: { state: "verified", expiresAt: null } }))
})
test("receipt never infers 19+, payment KYC, wrong-context consent or expired evidence", () => {
  assert.equal(parseJitReceipt(receipt(), context).personVerified, true)
  assert.throws(() => parseJitReceipt({ ...receipt(), paymentKycVerified: true }, context))
  const ageContext = { ...context, purpose: "age19" as const }
  assert.throws(() => parseJitReceipt({ ...receipt(), context: ageContext, adultVerified: true }, ageContext))
  assert.throws(() => parseJitReceipt({ ...receipt(), expiresAt: "2020-01-01T00:00:00.000Z" }, context))
  assert.throws(() => parseJitReceipt({ ...receipt(), context: { ...context, venueId: "other" } }, context))
})
test("private intent and per-action purpose affect digest without appearing in request context", async () => {
  const input = { action: context.action, purpose: context.purpose, venueId: context.venueId, tableId: null }
  const a = await jitContext(input, "private note A")
  const b = await jitContext(input, "private note B")
  assert.notEqual(a.contextDigest, b.contextDigest)
  assert.equal(JSON.stringify(a).includes("private note"), false)
  assert.equal((await jitContext(input, "private note A")).contextDigest, a.contextDigest)
})
test("browser handoff rejects active images, unsafe URL and nested executable fallback", () => {
  assert.equal(jitQrSource("data:image/svg+xml;base64,PHN2Zw=="), null)
  assert.equal(jitQrSource("https://example.com/pixel"), null)
  for (const url of ["javascript:alert(1)", "data:text/html,bad", "http://example.com", "https://user:pass@example.com", "intent://x#Intent;S.browser_fallback_url=javascript%3Aalert(1);end", "mobileid://x\n"]) assert.equal(jitAppLink(url), null)
  assert.equal(jitAppLink("mobileid://verify?request=public"), "mobileid://verify?request=public")
})
test("same-origin client refuses unsupported paths before network and bounds response", async () => {
  const original = globalThis.fetch; let calls = 0
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ value: "a".repeat(350_000) })) }
  try {
    await assert.rejects(jitIdentityCall("https://evil.example/identity"))
    assert.equal(calls, 0)
    await assert.rejects(jitIdentityCall("identity/eligibility"), /too_large/)
  } finally { globalThis.fetch = original }
})
test("lost consumption response uses exactly one POST then GET receipt, never replays a write", async () => {
  const original = globalThis.fetch; const methods: string[] = []
  globalThis.fetch = async (_url, init) => { methods.push(init?.method ?? "GET"); if (init?.method === "POST") throw new Error("lost response"); return Response.json(receipt()) }
  try { assert.equal((await consumeJitRequestReceipt(request())).receiptId, receipt().receiptId); assert.deepEqual(methods, ["POST", "GET"]) } finally { globalThis.fetch = original }
})
test("missing read-after-write receipt cannot grant authority", async () => {
  const original = globalThis.fetch
  globalThis.fetch = async (_url, init) => { if (init?.method === "POST") throw new Error("lost"); return Response.json({ error: { code: "identity_receipt_missing" } }, { status: 404 }) }
  try { await assert.rejects(consumeJitRequestReceipt(request())) } finally { globalThis.fetch = original }
})
test("authority matches exact pending snapshot and rejects late result after local cancellation", async () => {
  const original = globalThis.fetch; let resolve!: (response: Response) => void
  globalThis.fetch = async () => new Promise<Response>(done => { resolve = done })
  const token = "pending-late"
  try {
    rememberJitAuthorization(token, "snapshot", request())
    assert.equal(hasJitAuthorization(token, "different"), false)
    const consuming = consumeJitAuthorization(token, "snapshot", () => true)
    forgetJitAuthorization(token); resolve(Response.json(receipt()))
    assert.equal(await consuming, false); assert.equal(hasJitConsumedReceipt(token, "snapshot"), false)
  } finally { forgetJitAuthorization(token); globalThis.fetch = original }
})
test("same action consumes once and does not reuse receipt for a changed draft", async () => {
  const original = globalThis.fetch; let calls = 0; const token = "pending-unique"
  globalThis.fetch = async () => { calls++; return Response.json(receipt()) }
  try {
    rememberJitAuthorization(token, "snapshot", request())
    assert.equal(await consumeJitAuthorization(token, "snapshot", () => true), true)
    assert.equal(await consumeJitAuthorization(token, "snapshot", () => true), true)
    assert.equal(await consumeJitAuthorization(token, "changed-draft", () => true), false)
    assert.equal(calls, 1)
  } finally { forgetJitAuthorization(token); globalThis.fetch = original }
})
