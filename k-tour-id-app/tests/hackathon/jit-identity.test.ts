import assert from "node:assert/strict"
import { test } from "node:test"
import { createJitIdentityService } from "../../lib/hackathon/jit-identity"
import { JIT_IDENTITY_CONSENT, type JitIdentityContext } from "../../lib/hackathon/jit-identity-contract"
import { assertJitIdentityLedger, assertJitIdentityMonotonic, pruneJitIdentitySecrets, jitImportBindings, assertJitImportBindings } from "../../lib/hackathon/jit-identity-integrity"
import { importJitIdentity, refreshJitImportedIdentity } from "../../lib/hackathon/jit-identity-import"
import { validateJitContext, type JitRuntimePolicy } from "../../lib/hackathon/jit-identity-policy"
import { jitIdentityRouteAllowed, assertJitIdentityBody } from "../../lib/hackathon/jit-identity-routes"
import { hostedSuiRouteAllowed, assertHostedSuiBody, PIN } from "../../lib/hackathon/hosted-sui-profile"
import { parseStoredJourney } from "../../lib/hackathon/store-integrity"
import { HkError, digestOf } from "../../lib/hackathon/util"
import type { Db, OperationRecord } from "../../lib/hackathon/store"
import type { IdentityEvidence } from "../../lib/hackathon/types"
import { CX_AGE19_POLICY } from "../../lib/hackathon/cx-age-policy"

const T = Date.parse("2026-09-29T00:00:00Z"), iso = (offset = 0) => new Date(T + offset).toISOString()
const SESSION = "session_fixture_01", VENUE = "mois-0021cd596bc5b2a922ad", HASH = "0x" + "a".repeat(64)
const policy = (): JitRuntimePolicy => ({ enabled: true, digest: HASH, provider: "comdl", expiresAt: iso(86400000), campaignVenueId: VENUE })
const context = (n = 0, patch: Partial<JitIdentityContext> = {}): JitIdentityContext => ({ action: "pass_setup", purpose: "person", venueId: null, tableId: null, contextDigest: digestOf({ intent: n }), ...patch })
const body = (n = 0, patch: Partial<JitIdentityContext> = {}) => ({ ...context(n, patch), consentVersion: JIT_IDENTITY_CONSENT })
const code = (name: string) => (e: unknown) => e instanceof HkError && e.code === name
const deferred = <T>() => { let resolve!: (v: T) => void; const promise = new Promise<T>(r => resolve = r); return { resolve, promise } }
const tick = async (check: () => boolean) => { for (let i = 0; i < 100 && !check(); i++) await new Promise(r => setImmediate(r)); assert(check()) }
function evidence(patch: Partial<IdentityEvidence> = {}): IdentityEvidence {
  return { evidenceId: "evidence_fixture_01", subjectRef: "subj_fixture_01", source: "cx_mobile_id", mode: "cx", provider: "comdl", personVerified: true,
    adultVerified: true, verifiedAt: iso(), expiresAt: iso(3600000), providerTransactionRef: "fixture-cx-tx", providerPolicyDigest: HASH, ...patch }
}
function setup() {
  let now = T, p = policy(), queue = Promise.resolve(), locked = false
  let db: Db = { version: 1, sessions: { [SESSION]: { sessionId: SESSION, createdAt: iso(), lastSeenAt: iso(), subjectRef: null } }, operations: {}, redemptions: {}, outbox: {}, idempotency: {}, nonces: {} }
  const calls = { start: 0, complete: 0, read: 0, mutate: 0 }, result = { evidence: evidence() }
  const mutate = <R>(fn: (d: Db) => R | Promise<R>): Promise<R> => {
    const run = queue.then(async () => { calls.mutate++; const copy = structuredClone(db), old = copy.jitIdentity ? structuredClone(copy.jitIdentity) : undefined; locked = true
      try { const r = await fn(copy); assertJitIdentityMonotonic(old, copy); db = copy; return structuredClone(r) } finally { locked = false } })
    queue = run.then(() => undefined, () => undefined); return run
  }
  const ports = { now: () => now, policy: () => p, mutate, read: async <R>(fn: (d: Db) => R | Promise<R>) => { calls.read++; return fn(structuredClone(db)) },
    reserve(d: Db, op: OperationRecord) { assert(Object.keys(d.operations).length < 10, "approved original ten slots"); d.operations[op.operationId] = op },
    async start() { assert(!locked); calls.start++; return { token: "private-token", txId: "fixture-cx-tx", cxId: "fixture-cx-id", handoff: { kind: "app" as const, iosLink: "mobileid://fixture", cxId: "fixture-cx-id", expiresAt: iso(300000) } } },
    async complete() { assert(!locked); calls.complete++; return structuredClone(result) },
  }
  const api = createJitIdentityService(ports)
  const verified = async (patch: Partial<JitIdentityContext> = {}) => { const r = await api.create(SESSION, body(0, patch)); await api.start(SESSION, r.requestId, true); return api.complete(SESSION, r.requestId) }
  return { api, ports, calls, result, verified, mutate, db: () => db, p: () => p, drift: () => p = { ...p, digest: digestOf("changed") }, advance: (ms: number) => now += ms, now: () => now }
}

test("eligibility is read-only and anonymous checks do not create a session or provider transaction", async () => {
  const h = setup(); const before = structuredClone(h.db()); assert.equal((await h.api.eligibility(null)).person.state, "proof_required")
  assert.equal((await h.api.eligibility(SESSION)).paymentKyc.state, "unsupported"); assert.deepEqual(h.db(), before)
  assert.equal(h.calls.mutate, 0); assert.equal(h.calls.start, 0)
})
test("fresh provider check claims exactly one original budget row, never a Sui journey, and projects no secrets", async () => {
  const h = setup(), r = await h.verified(); assert.equal(r.status, "authorized"); assert.equal(h.calls.start, 1); assert.equal(h.calls.complete, 1)
  const op = Object.values(h.db().operations)[0]; assert.equal(op.kind, "identity_check"); assert.equal(op.campaignId, "ktour-purpose-identity-v1"); assert.equal(op.delegation, null)
  assert.equal(op.status, "succeeded"); assert.equal((await h.api.eligibility(SESSION)).person.state, "verified")
  for (const secret of ["private-token", "fixture-cx-tx", "subj_fixture"]) assert(!JSON.stringify(r).includes(secret))
  assert.equal(h.db().jitIdentity!.requests[r.requestId].cxToken, undefined)
  assertJitIdentityLedger(h.db().jitIdentity); assert.deepEqual(parseStoredJourney(JSON.stringify(h.db())), h.db())
})
test("same-session proof is reused only for a new explicit purpose/context, without another provider request", async () => {
  const h = setup(); await h.verified(); const r = await h.api.create(SESSION, body(1, { action: "local_moment", venueId: VENUE }))
  assert.equal(r.status, "authorized"); assert.equal(h.calls.start, 1); assert.equal(Object.keys(h.db().operations).length, 1)
  const receipt = await h.api.consume(SESSION, r.authorizationRef!, r.context)
  assert.equal(receipt.personVerified, true); assert.equal(receipt.paymentKycVerified, false)
  assert.deepEqual(await h.api.consume(SESSION, r.authorizationRef!, r.context), receipt)
  assert.deepEqual(await h.api.receipt(SESSION, r.requestId), receipt)
  await assert.rejects(h.api.cancel(SESSION, r.requestId), code("cannot_cancel"))
})
test("action receipt rejects a different intent/place/purpose/session and does not unlock by status alone", async () => {
  const h = setup(), r = await h.verified()
  await assert.rejects(h.api.receipt(SESSION, r.requestId), code("not_found"))
  await assert.rejects(h.api.consume(SESSION, r.authorizationRef!, context(99)), code("jit_identity_scope"))
  await assert.rejects(h.api.consume("other", r.authorizationRef!, r.context), code("jit_identity_scope"))
  await assert.rejects(h.api.get("other", r.requestId), code("not_found"))
  assert.equal(h.db().jitIdentity!.authorizations[r.authorizationRef!].receipt, null)
})
test("mock/client claims, wrong subject/provider/provenance and mismatched provider transaction never mint authorization", async () => {
  for (const patch of [{ mode: "mock" as const }, { personVerified: false }, { provider: "other" }, { providerPolicyDigest: undefined }, { providerTransactionRef: "other" }, { expiresAt: iso() }]) {
    const h = setup(); Object.assign(h.result.evidence, patch); await assert.rejects(h.verified()); assert.equal(Object.keys(h.db().jitIdentity!.authorizations).length, 0)
  }
  const h = setup(); await h.mutate(d => d.sessions[SESSION].subjectRef = "subj_other"); await assert.rejects(h.verified(), code("jit_identity_proof"))
})
test("adult requires affirmative provider claim; person never becomes age19 or payment KYC", async () => {
  for (const adultVerified of [false, null]) {
    const h = setup(); h.result.evidence.adultVerified = adultVerified; const r = await h.verified({ purpose: "adult" })
    assert.equal(r.status, "denied"); assert.equal(r.reason, "adult_claim_missing"); assert.equal((await h.api.eligibility(SESSION)).adult.state, "not_verified")
    assert.equal((await h.api.create(SESSION, body(1))).status, "authorized")
  }
  const h = setup(), table = body(1, { action: "table_request", venueId: VENUE, tableId: "table-seoul-night-bites", purpose: "age19" })
  const r = await h.api.create(SESSION, table); assert.equal(r.status, "awaiting_identity"); assert.equal(h.calls.start, 0); assert.equal(Object.keys(h.db().operations).length, 0)
  await h.api.start(SESSION, r.requestId, true); const checked = await h.api.complete(SESSION, r.requestId)
  assert.equal(checked.status, "denied"); assert.equal(checked.reason, "age19_not_verified")
  await assert.rejects(h.api.create(SESSION, { ...body(), purpose: "payment_kyc" }))
})
test("current birth-derived age19 proof authorizes an exact purpose once; no raw birth or adult elevation", async () => {
  const h = setup(); h.result.evidence = evidence({ adultVerified: null, age19Verified: true, age19Policy: CX_AGE19_POLICY })
  const r = await h.verified({ action: "after19_access", purpose: "age19" })
  assert.equal(r.status, "authorized"); assert.equal((await h.api.eligibility(SESSION)).age19.state, "verified")
  const receipt = await h.api.consume(SESSION, r.authorizationRef!, r.context)
  assert.equal(receipt.age19Verified, true); assert.equal(receipt.age19Policy, CX_AGE19_POLICY); assert.equal(receipt.adultVerified, false)
  assert.equal(receipt.paymentKycVerified, false); assert.equal(JSON.stringify(h.db()).includes('"birth"'), false)
  assert.deepEqual(await h.api.receipt(SESSION, r.requestId), receipt)
  const table = await h.api.create(SESSION, body(2, { action: "table_request", purpose: "age19", venueId: VENUE, tableId: "table-seoul-night-bites" }))
  assert.equal(table.status, "authorized"); assert.equal(h.calls.start, 1); assert.equal(Object.keys(h.db().operations).length, 1)
  await assert.rejects(h.api.consume(SESSION, table.authorizationRef!, r.context), code("jit_identity_scope"))
  await h.mutate(db => { Object.values(db.operations)[0].status = "cancelled" })
  await assert.rejects(h.api.consume(SESSION, table.authorizationRef!, table.context), code("jit_identity_proof"))
  assert.equal((await h.api.eligibility(SESSION)).age19.state, "proof_required")
})
test("age19 missing/false/old policy cannot authorize or consume; no inherited adult claim", async () => {
  for (const patch of [{ age19Verified: true }, { age19Verified: true, age19Policy: "old" }, { age19Verified: false, age19Policy: CX_AGE19_POLICY }, { age19Verified: null }]) {
    const h = setup(); Object.assign(h.result.evidence, patch)
    const r = await h.verified({ action: "after19_access", purpose: "age19" })
    assert.equal(r.status, "denied"); assert.equal(r.authorizationRef, null)
  }
})
test("only consumed After19 receipt GET outlives the two-minute grant; original authority remains current", async () => {
  const h = setup(); h.result.evidence = evidence({ age19Verified: true, age19Policy: CX_AGE19_POLICY })
  const r = await h.verified({ action: "after19_access", purpose: "age19" })
  const view = await h.api.consume(SESSION, r.authorizationRef!, r.context)
  assert.equal(view.expiresAt, h.result.evidence.expiresAt)
  h.advance(121000)
  assert.deepEqual(await h.api.receipt(SESSION, r.requestId), view)
  await assert.rejects(h.api.consume(SESSION, r.authorizationRef!, r.context), code("jit_identity_expired"))
  await assert.rejects(h.api.receipt("another-session", r.requestId), code("not_found"))
  await h.mutate(db => { db.sessions[SESSION].subjectRef = "subj_replaced" })
  await assert.rejects(h.api.receipt(SESSION, r.requestId), code("jit_identity_proof"))
})
test("expired unconsumed age grant, changed policy and revoked evidence cannot extend After19", async () => {
  for (const change of ["unconsumed", "policy", "revoked", "evidence-expired"]) {
    const h = setup(); h.result.evidence = evidence({ age19Verified: true, age19Policy: CX_AGE19_POLICY })
    const r = await h.verified({ action: "after19_access", purpose: "age19" })
    if (change !== "unconsumed") await h.api.consume(SESSION, r.authorizationRef!, r.context)
    h.advance(change === "evidence-expired" ? 3600001 : 121000)
    if (change === "policy") h.drift()
    if (change === "revoked") await h.mutate(db => { Object.values(db.operations)[0].status = "cancelled" })
    await assert.rejects(h.api.receipt(SESSION, r.requestId))
    await assert.rejects(h.api.consume(SESSION, r.authorizationRef!, r.context))
  }
})
test("canonical table policy prevents venue swaps and lowering a hard19 action to generic adult/person", () => {
  for (const purpose of ["adult", "person"] as const) assert.throws(() => validateJitContext(context(0, { action: "table_request", tableId: "table-seoul-night-bites", venueId: VENUE, purpose }), policy()))
  for (const patch of [{ venueId: "not-a-place", action: "local_moment" as const }, { action: "table_request" as const, tableId: "unknown", venueId: VENUE }, { action: "table_request" as const, tableId: "table-busan-gijang-dinner", venueId: VENUE }]) assert.throws(() => validateJitContext(context(0, patch), policy()))
  assert.doesNotThrow(() => validateJitContext(context(0, { action: "table_request", venueId: "mois-03041681b54ea5399763", tableId: "table-busan-gijang-dinner" }), policy()))
})
test("concurrent starts have one durable claim and one provider call; old generic identity routes cannot use consent phase", async () => {
  const h = setup(), wait = deferred<Awaited<ReturnType<typeof h.ports.start>>>(), original = h.ports.start
  h.ports.start = async () => { const r = await original(); await wait.promise; return r }
  const r = await h.api.create(SESSION, body()), pending = h.api.start(SESSION, r.requestId, true); await tick(() => h.calls.start === 1)
  const op = Object.values(h.db().operations)[0]; assert.equal(op.phase, "consent"); assert.equal(op.secrets.cxToken, undefined)
  await assert.rejects(h.api.start(SESSION, r.requestId, true), code("jit_identity_start_used")); wait.resolve(undefined as never); await pending
  assert.equal(h.calls.start, 1); assert.equal(Object.keys(h.db().operations).length, 1)
})
test("cancel during provider completion wins; late result cannot set session subject or authorization", async () => {
  const h = setup(), d = deferred<typeof h.result>(); h.ports.complete = async () => { h.calls.complete++; return d.promise }
  const r = await h.api.create(SESSION, body()); await h.api.start(SESSION, r.requestId, true)
  const pending = h.api.complete(SESSION, r.requestId); await tick(() => h.calls.complete === 1); await h.api.cancel(SESSION, r.requestId); d.resolve(h.result)
  await assert.rejects(pending); assert.equal(h.db().sessions[SESSION].subjectRef, null); assert.equal(Object.keys(h.db().jitIdentity!.authorizations).length, 0)
  assert.equal(Object.values(h.db().operations)[0].status, "cancelled")
})
test("unknown start never returns the slot or automatically starts another transaction", async () => {
  const h = setup(); h.ports.start = async () => { h.calls.start++; throw new Error("synthetic lost response") }
  const r = await h.api.create(SESSION, body()); await assert.rejects(h.api.start(SESSION, r.requestId, true))
  assert.equal((await h.api.get(SESSION, r.requestId)).status, "unknown"); await assert.rejects(h.api.start(SESSION, r.requestId, true)); assert.equal(h.calls.start, 1)
  assert.equal(Object.keys(h.db().operations).length, 1); assert.equal(h.db().jitIdentity!.requests[r.requestId].cxToken, undefined)
})
test("proof cancellation, provider drift and grant exact expiry invalidate consume and read-only receipt", async () => {
  for (const change of ["cancel", "policy", "expire"] as const) {
    const h = setup(), source = await h.verified(), r = await h.api.create(SESSION, body(1)); await h.api.consume(SESSION, r.authorizationRef!, r.context)
    if (change === "cancel") await h.api.cancel(SESSION, source.requestId)
    if (change === "policy") h.drift()
    if (change === "expire") h.advance(120000)
    await assert.rejects(h.api.consume(SESSION, r.authorizationRef!, r.context)); await assert.rejects(h.api.receipt(SESSION, r.requestId))
  }
})
test("lifetime original pool keeps cancelled rows, caps concurrent new CX requests at ten", async () => {
  const h = setup()
  const requests = await Promise.all(Array.from({ length: 11 }, (_, i) => h.api.create(SESSION, body(i))))
  const results = await Promise.allSettled(requests.map(r => h.api.start(SESSION, r.requestId, true)))
  assert.equal(results.filter(r => r.status === "fulfilled").length, 10); assert.equal(h.calls.start, 10)
  for (const r of requests.slice(0, 10)) await h.api.cancel(SESSION, r.requestId)
  await assert.rejects(h.api.start(SESSION, requests[10].requestId, true)); assert.equal(Object.keys(h.db().operations).length, 10)
})
test("consumed designated-perk grant binds once; original proof remains live authority throughout imported operation", async () => {
  const h = setup(), source = await h.verified(), r = await h.api.create(SESSION, body(1, { action: "designated_perk", venueId: VENUE }))
  await h.api.consume(SESSION, r.authorizationRef!, r.context)
  const op = { ...structuredClone(Object.values(h.db().operations)[0]), operationId: "op_imported_perk", kind: "demo_entitlement" as const, venueId: VENUE, status: "pending" as const, phase: "identity" as const, secrets: {}, identity: null }
  await h.mutate(db => { importJitIdentity(db, op, r.authorizationRef!, r.context.contextDigest, h.now(), h.p()); db.operations[op.operationId] = op })
  assert.equal(op.phase, "issuance"); assert.equal(h.calls.start, 1)
  const second = { ...structuredClone(op), operationId: "op_second_perk", secrets: {} }
  await assert.rejects(h.mutate(db => importJitIdentity(db, second, r.authorizationRef!, r.context.contextDigest, h.now(), h.p())))
  h.advance(120001); assert.equal(refreshJitImportedIdentity(h.db(), h.db().operations[op.operationId], h.p(), h.now()), true, "grant must be used in two minutes; imported operation follows original proof lifetime")
  await h.api.cancel(SESSION, source.requestId); assert.equal(refreshJitImportedIdentity(h.db(), h.db().operations[op.operationId], h.p(), h.now()), false)
  assert.equal(h.db().operations[op.operationId].identity!.sourceCurrent, false)
})
test("storage rejects altered consent, missing authority, reset history, receipt reassignment and removed import provenance", async () => {
  const h = setup(), r = await h.verified(); await h.api.consume(SESSION, r.authorizationRef!, r.context)
  for (const corrupt of [(d: Db) => { d.jitIdentity!.requests[r.requestId].context.contextDigest = digestOf("tamper") }, (d: Db) => { delete d.jitIdentity!.authorizations[r.authorizationRef!] }, (d: Db) => { d.jitIdentity!.authorizations[r.authorizationRef!].receipt!.paymentKycVerified = true as false }]) {
    const db = structuredClone(h.db()); corrupt(db); assert.throws(() => parseStoredJourney(JSON.stringify(db)), code("store_corrupt"))
  }
  const old = structuredClone(h.db().jitIdentity!); assert.throws(() => assertJitIdentityMonotonic(old, { ...h.db(), jitIdentity: undefined }))
  const db = structuredClone(h.db()); db.jitIdentity!.authorizations[r.authorizationRef!].receipt!.receiptId = "idr_abcdefghijklmnop"; assert.throws(() => assertJitIdentityMonotonic(old, db))
  const row = Object.values(db.operations)[0]; row.secrets.identityImport = { sourceOperationId: "op_source", evidenceId: "e", authorizationRef: r.authorizationRef!, contextDigest: HASH, importedAt: iso() }
  const bindings = jitImportBindings(db); delete row.secrets.identityImport; assert.throws(() => assertJitImportBindings(bindings, db))
})
test("expired request secrets are cleared without deleting request, claim tombstone or paid budget allocation", async () => {
  const h = setup(), r = await h.api.create(SESSION, body()); await h.api.start(SESSION, r.requestId, true)
  assert(h.db().jitIdentity!.requests[r.requestId].cxToken); pruneJitIdentitySecrets(h.db(), T + 600001)
  assert.equal(h.db().jitIdentity!.requests[r.requestId].cxToken, undefined); assert.equal(Object.keys(h.db().operations).length, 1); assert(h.db().jitIdentity!.requests[r.requestId])
})
test("new route allowlist and exact bodies never expose provider callbacks, samples or arbitrary IDs", () => {
  const id = "idn_abcdefghijklmnop", auth = "ida_abcdefghijklmnop"
  for (const [method, p] of [["GET", ["identity", "eligibility"]], ["GET", ["identity", "requests", id]], ["GET", ["identity", "requests", id, "receipt"]], ["POST", ["identity", "requests"]], ["POST", ["identity", "requests", id, "complete"]], ["POST", ["identity", "authorizations", auth, "consume"]]] as const) {
    assert(jitIdentityRouteAllowed(method, [...p])); assert(hostedSuiRouteAllowed(method, [...p]))
  }
  for (const p of [["identity", "requests", "idn_short"], ["identity", "callback"], ["identity", "requests", id, "complete", "extra"]]) assert.equal(jitIdentityRouteAllowed("POST", p), false)
  assertJitIdentityBody(["identity", "requests"], body()); assertJitIdentityBody(["identity", "requests", id, "complete"], {})
  for (const b of [{ sample: { outcome: "verified" } }, { personVerified: true }]) assert.throws(() => assertJitIdentityBody(["identity", "requests", id, "complete"], b))
  assert.throws(() => assertJitIdentityBody(["identity", "requests"], { ...body(), claims: true }))
  assert.doesNotThrow(() => assertHostedSuiBody(["operations"], { venueId: VENUE, consentVersion: PIN.consentVersion, identityAuthorizationRef: auth, identityContextDigest: HASH }, {}))
  assert.throws(() => assertHostedSuiBody(["operations"], { identityAuthorizationRef: auth }, {}))
})
