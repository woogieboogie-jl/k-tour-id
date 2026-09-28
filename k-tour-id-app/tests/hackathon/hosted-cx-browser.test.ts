import assert from "node:assert/strict"
import test from "node:test"
import { PIN } from "../../scripts/hackathon-hosted-sui-browser.mjs"
import { createCxRequestGuard, classifyIdentityResult, validateHandoff, validateCxConfig, run, LIMITS } from "../../scripts/hackathon-hosted-cx-browser.mjs"

const origin = "https://ondo-fixture.vercel.app", api = origin + "/api/hackathon/v1/", id = "op_fixture12345678"
const code = "synthetic_" + "x".repeat(32), consentVersion = "hk-consent-2026-09-14"
const createBody = { venueId: PIN.venueId, consentVersion, locale: "en" }
const initial = { operationId: id, venueId: PIN.venueId, phase: "identity", status: "pending", identity: null, credential: null, presentation: null, proposal: null, delegation: null, agent: null, fulfillment: null, chain: null, error: null }
function pending(kind = "qr") { return { ...initial, identity: { mode: "cx", personVerified: false, handoff: { kind, qrBase64: "iVBORw0KGgo=", androidLink: "vendor-native://fixture", expiresAt: "2026-09-29T00:10:00.000Z", cxId: "SENSITIVE_SYNTHETIC_CX_ID" } } } }
function config() { return { hostedSui: true, isolatedMock: false, cxPreview: false, previewReadOnly: false, modes: { cx: "cx", opendid: "mock", ai: "rule", sui: "testnet", omnione: "unconfigured", zklogin: "demo-signer" }, campaign: { venueId: PIN.venueId }, sui: { network: "testnet", packageId: PIN.packageId, campaignId: String(PIN.campaignId), googleClientId: "" }, consentVersion, capabilities: { chainExecutionEnabled: true, redemptionEnabled: false, opendidProviderReady: false } } }
function prefix(mobile = false) {
  const g = createCxRequestGuard(origin, mobile)
  assert.equal(g.check("POST", api + "hosted/access", JSON.stringify({ accessCode: code })), true)
  assert.equal(g.check("POST", api + "sessions", "{}"), true)
  g.permit("operations"); assert.equal(g.check("POST", api + "operations", JSON.stringify(createBody)), true)
  g.bindOperation(id); return g
}
function start(g: ReturnType<typeof createCxRequestGuard>, mobile = false) { g.permit("identity/start"); return g.check("POST", api + `operations/${id}/identity/start`, JSON.stringify({ mobile })) }

test("hosted CX config requires exact frozen modes and public package/campaign pins", () => {
  assert.equal(validateCxConfig(config()), true)
  for (const mutate of [
    (c: ReturnType<typeof config>) => { c.modes.cx = "mock" },
    (c: ReturnType<typeof config>) => { c.modes.opendid = "opendid" },
    (c: ReturnType<typeof config>) => { c.modes.zklogin = "google" },
    (c: ReturnType<typeof config>) => { c.sui.network = "mainnet" },
    (c: ReturnType<typeof config>) => { c.sui.campaignId = "foreign" },
    (c: ReturnType<typeof config>) => { c.sui.googleClientId = "synthetic" },
    (c: ReturnType<typeof config>) => { c.capabilities.redemptionEnabled = true },
    (c: ReturnType<typeof config>) => { c.cxPreview = true },
  ]) { const c = config(); mutate(c); assert.throws(() => validateCxConfig(c), /configuration_mismatch/) }
})

test("pending QR/app or explicit provider rejection never becomes approval", () => {
  for (const kind of ["qr", "app"]) assert.equal(classifyIdentityResult(pending(kind), id, kind), "pending")
  for (const code of ["identity_failed", "identity_cancelled", "identity_expired"]) assert.equal(classifyIdentityResult({ ...initial, error: { code, retryable: true, message: "SENSITIVE_UPSTREAM" } }, id), "rejected")
  for (const body of [
    { ...pending(), phase: "issuance" }, { ...pending(), status: "succeeded" },
    { ...pending(), operationId: "op_foreign12345678" }, { ...pending(), identity: { ...pending().identity, personVerified: true } },
    { ...pending(), identity: { ...pending().identity, mode: "mock" } },
    { ...pending(), chain: {} }, { ...pending(), delegation: {} }, { ...pending(), credential: {} },
    { ...pending(), chain: undefined }, { ...initial, error: { code: "arbitrary-secret", retryable: true } },
    { ...initial, error: { code: "identity_failed", retryable: false } },
  ]) assert.throws(() => classifyIdentityResult(body, id), /operation_contract|identity_result_contract/)
})

test("handoff validates expiry and passive links without returning QR/CI/URLs", () => {
  const now = Date.parse("2026-09-29T00:00:00.000Z")
  assert.equal(validateHandoff(pending(), id, "qr", now), "qr")
  assert.equal(validateHandoff(pending("app"), id, "app", now), "app")
  assert.throws(() => validateHandoff(pending(), id, "qr", now + 600001), /handoff_expiry/)
  for (const androidLink of ["javascript:alert(1)", "intent://fixture#Intent;S.browser_fallback_url=javascript%3Aalert(1);end", "http://unsafe.invalid", "https://user:secret@example.invalid"]) {
    const b = pending("app"); b.identity.handoff.androidLink = androidLink
    assert.throws(() => validateHandoff(b, id, "app", now), /handoff_contract/)
  }
  assert.equal(JSON.stringify([classifyIdentityResult(pending(), id), validateHandoff(pending(), id, "qr", now)]).includes("SENSITIVE"), false)
})

test("one consented run forwards exactly six single-use POSTs including cleanup", () => {
  const g = prefix(); assert.equal(start(g), true)
  g.permit("identity/complete"); assert.equal(g.check("POST", api + `operations/${id}/identity/complete`, "{}"), true)
  g.permit("cancel"); assert.equal(g.check("POST", api + `operations/${id}/cancel`, "{}"), true)
  assert.deepEqual(g.summary().mutations, { "hosted/access": 1, sessions: 1, operations: 1, "identity/start": 1, "identity/complete": 1, cancel: 1 })
  assert.equal(g.summary().cancelled, true); assert.equal(g.summary().blocked, false)
  assert.equal(g.canCancel(), false)
  g.permit("cancel"); assert.equal(g.check("POST", api + `operations/${id}/cancel`, "{}"), false)
})

test("no start before consent, no unarmed click, wrong operation, sample, mobile mismatch or replay", () => {
  const fresh = createCxRequestGuard(origin)
  assert.equal(fresh.check("POST", api + `operations/${id}/identity/start`, "{}"), false)
  assert.throws(() => fresh.bindOperation(id), /operation_mismatch/)
  const unarmed = prefix(); assert.equal(unarmed.check("POST", api + `operations/${id}/identity/start`, '{"mobile":false}'), false)
  const wrong = prefix(); wrong.permit("identity/start"); assert.equal(wrong.check("POST", api + "operations/op_foreign12345678/identity/start", '{"mobile":false}'), false)
  const wrongMobile = prefix(true); assert.equal(start(wrongMobile, false), false)
  const duplicate = prefix(); assert.equal(start(duplicate), true); assert.equal(start(duplicate), false)
  const sample = prefix(); assert.equal(start(sample), true); sample.permit("identity/complete")
  assert.equal(sample.check("POST", api + `operations/${id}/identity/complete`, '{"sample":{"outcome":"verified","subjectSeed":"synthetic"}}'), false)
})

test("bootstrap actions require exact paths, never operation-prefixed lookalikes or suffixes", () => {
  for (const action of ["hosted/access", "sessions", "operations"]) {
    for (const target of [`operations/evil/${action}`, action + "/tail", action + "?extra=1"]) {
      const g = createCxRequestGuard(origin)
      if (action !== "hosted/access") assert.equal(g.check("POST", api + "hosted/access", JSON.stringify({ accessCode: code })), true)
      if (action === "operations") { assert.equal(g.check("POST", api + "sessions", "{}"), true); g.permit("operations") }
      const body = action === "hosted/access" ? { accessCode: code } : action === "operations" ? createBody : {}
      assert.equal(g.check("POST", api + target, JSON.stringify(body)), false)
      assert.equal(g.summary().mutations[action], undefined)
    }
  }
})

test("all chain/credential/provider mutations and operation restart are blocked before sending", () => {
  for (const path of ["credential/issue", "credential/holder-ack", "presentation/request", "proposal", "delegation/prepare", "delegation/submit", "agent/run", "redeem", "reconcile"]) {
    const g = prefix(); assert.equal(g.check("POST", api + `operations/${id}/${path}`, "{}"), false)
    assert.equal(g.summary().mutations[path], undefined)
  }
  for (const [method, target] of [["POST", api + "zklogin/prove"], ["POST", api + "operations"], ["PUT", api + "operations"], ["POST", "https://fullnode.testnet.sui.io/"], ["POST", "https://cx.example.invalid/request"]]) {
    const g = prefix(); assert.equal(g.check(method, target, "{}"), false); assert.equal(g.summary().blocked, true)
  }
})

test("exactly one cancel remains allowed after a rejected request or abandoned click permit", () => {
  const g = prefix(); g.permit("identity/start")
  assert.equal(g.check("POST", api + `operations/${id}/credential/issue`, "{}"), false)
  g.permit("cancel"); assert.equal(g.check("POST", api + `operations/${id}/cancel`, "{}"), true)
  assert.equal(g.summary().blocked, true)
  g.permit("cancel"); assert.equal(g.check("POST", api + `operations/${id}/cancel`, "{}"), false)
})

test("read budgets and external assets are bounded without exposing arbitrary URLs", () => {
  const g = prefix()
  assert.equal(g.check("GET", "https://external.invalid/private-qr"), false)
  assert.equal(g.summary().blocked, false); assert.equal(g.summary().blockedExternalAssets, 1)
  for (let i = 0; i < LIMITS.apiReads; i++) assert.equal(g.check("GET", api + "config"), true)
  assert.equal(g.check("GET", api + "config"), false)
  const assets = createCxRequestGuard(origin)
  for (let i = 0; i < LIMITS.reads; i++) assert.equal(assets.check("GET", origin + "/_next/static/fixture.js"), true)
  assert.equal(assets.check("GET", origin + "/_next/static/fixture.js"), false)
  assert.equal(JSON.stringify(g.summary()).includes("private-qr"), false)
  for (const path of ["zklogin/params", "operations/op_foreign12345678", "operations/" + id + "/evidence"]) assert.equal(prefix().check("GET", api + path), false)
})

test("invalid inputs fail before auth/network/browser and reports contain no input secret", async () => {
  const previousFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => { calls++; throw new Error("network-forbidden") }
  try {
    for (const args of [
      { origin: "http://localhost:3000", accessCode: code, expectedRevision: "a".repeat(40) },
      { origin, accessCode: "SENSITIVE_INVALID_ACCESS", expectedRevision: "a".repeat(40) },
      { origin, accessCode: code, expectedRevision: "SENSITIVE_INVALID_SHA" },
    ]) {
      const report = await run(args)
      assert.equal(report.ok, false); assert.equal(report.checkpoint, "input")
      assert.equal(report.requests, null); assert.equal(report.approvalClaimed, false)
      assert.equal(JSON.stringify(report).includes("SENSITIVE"), false)
      assert.equal(JSON.stringify(report).includes(code), false)
    }
    assert.equal(calls, 0)
  } finally { globalThis.fetch = previousFetch }
})
