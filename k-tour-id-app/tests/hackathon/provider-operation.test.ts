import assert from "node:assert/strict"
import { test } from "node:test"
import { createProviderOperationService, providerCredentialReason, providerPresentationReason, assertProviderPermissionForOperation, providerIntegrationAvailable } from "../../lib/hackathon/provider-operation"
import type { Db, OperationRecord } from "../../lib/hackathon/store"
import type { OpenDidBridgeClient, OpenDidIssuance, OpenDidPresentation } from "../../lib/hackathon/adapters/opendid-provider"
import { guideJourney } from "../../lib/hackathon/guide-contract"
import { HkError } from "../../lib/hackathon/util"

const T = Date.parse("2026-09-29T00:00:00.000Z"), iso = (ms = 0) => new Date(T + ms).toISOString()
const SESSION = "session_fixture_01", OP = "op_fixture_01"
const code = (expected: string) => (e: unknown) => e instanceof HkError && e.code === expected
const issue = (): OpenDidIssuance => ({ issuanceId: "issuance_fixture_01", operationId: OP, state: "issued", revision: 2, offer: null,
  credential: { vcId: "private-native-vc-fixture", issuerDid: "did:omn:issuer-fixture", schemaId: "https://schema.invalid/pass", validFrom: iso(-1000), validUntil: iso(3600000), holderBinding: "0x" + "b".repeat(64) }, error: null, expiresAt: iso(600000) })
const issueOffer = (): OpenDidIssuance => ({ ...issue(), state: "offered", revision: 1, credential: null, offer: { qrPayload: "sensitive-issuance-qr" } })
const pres = (): OpenDidPresentation => ({ presentationId: "presentation_fixture_01", operationId: OP, state: "allowed", revision: 2, offer: null,
  decision: { decisionRef: "decision_fixture_01", decisionExpiresAt: iso(240000) }, denyReason: null, expiresAt: iso(300000) })
const presOffer = (): OpenDidPresentation => ({ ...pres(), state: "offered", revision: 1, decision: null, offer: { qrPayload: "sensitive-presentation-qr" } })
function operation(): OperationRecord {
  return { operationId: OP, sessionId: SESSION, kind: "demo_entitlement", venueId: "fixture-venue", campaignId: "fixture-campaign", policyVersion: 1,
    status: "pending", phase: "issuance", revision: 1, createdAt: iso(), updatedAt: iso(), expiresAt: iso(3600000), execution: "provider", safeNextAction: "wait", allowedActions: [], returnContext: null,
    consent: { version: "consent-fixture", digest: "digest-fixture", acceptedAt: iso() }, identity: { evidenceId: "evidence_fixture_01", subjectRef: "cx-subject-private-fixture", source: "cx_mobile_id", mode: "cx", provider: "comdl", personVerified: true, adultVerified: true, verifiedAt: iso(), expiresAt: iso(3600000), providerTransactionRef: "cx-transaction-private-fixture", handoff: null },
    credential: null, presentation: null, proposal: null, delegation: null, agent: null, fulfillment: null, chain: null, error: null, secrets: {}, audit: [] }
}
function setup(options: { mapping?: boolean; bridge?: Partial<OpenDidBridgeClient> } = {}) {
  let clock = T, locked = false, identityChanged = false
  let db: Db = { version: 1, sessions: {}, operations: { [OP]: operation() }, redemptions: {}, outbox: {}, idempotency: {}, nonces: {} }
  let queue = Promise.resolve()
  const atomic = <R>(fn: (db: Db) => R | Promise<R>): Promise<R> => {
    const run = queue.then(async () => { assert(!locked); locked = true; const copy = structuredClone(db); try { const result = await fn(copy); db = copy; return structuredClone(result) } finally { locked = false } })
    queue = run.then(() => undefined, () => undefined)
    return run
  }
  const counts = { issue: 0, present: 0, status: 0, cancel: 0, deny: 0 }
  const outsideLock = () => assert.equal(locked, false, "provider I/O must never run inside durable store lock")
  const bridge: OpenDidBridgeClient = {
    ownerBinding: b => `owner-${b.sessionId}-${b.operationId}`,
    async issuanceStart() { outsideLock(); counts.issue++; return issueOffer() },
    async issuanceRefresh() { outsideLock(); return issue() },
    async issuanceCancel() { outsideLock(); counts.cancel++; return { ...issueOffer(), state: "cancelled", offer: null } },
    async presentationStart() { outsideLock(); counts.present++; return presOffer() },
    async presentationRefresh() { outsideLock(); return pres() },
    async presentationDeny() { outsideLock(); counts.deny++; return { ...presOffer(), state: "cancelled", offer: null } },
    async credentialStatus() { outsideLock(); counts.status++; return { issuanceId: "issuance_fixture_01", active: true, reason: null, checkedAt: new Date(clock).toISOString() } },
    ...options.bridge,
  }
  const service = createProviderOperationService({ atomic, bridge, now: () => clock, identityChanged: () => identityChanged,
    resolveCxMapping: options.mapping === false ? undefined : async e => ({ evidenceRef: e.evidenceRef, kycRef: "a".repeat(64), mappingVersion: "cx-cas-v1" }) })
  const action = (a: Parameters<typeof service.action>[2]) => service.action(SESSION, OP, a)
  const ready = async () => { await action("issuance/start"); await action("issuance/refresh"); await action("presentation/start"); await action("presentation/refresh") }
  return { service, action, ready, counts, bridge, row: () => db.operations[OP], mutate: (fn: (op: OperationRecord) => void) => atomic(d => fn(d.operations[OP])), advance: (ms: number) => clock += ms, setIdentityChanged: () => identityChanged = true }
}
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { resolve, promise } }
const waitFor = async (fn: () => boolean) => { for (let i = 0; i < 100 && !fn(); i++) await new Promise(r => setImmediate(r)); assert(fn()) }

test("provider integration availability cannot be fabricated by environment flags", () => {
  assert.equal(providerIntegrationAvailable({ NODE_ENV: "test", HK_MODE_OPENDID: "opendid", HK_OPENDID_CX_MAPPING: "verified-evidence-v1", HK_OPENDID_BRIDGE_URL: "https://fixture.invalid" }), false)
})
test("main lifecycle stores no QR and projects only operation-local native aliases", async () => {
  const h = setup(); const offered = await h.action("issuance/start")
  assert.equal(offered.provider.offer?.qrPayload, "sensitive-issuance-qr")
  assert(!JSON.stringify(h.row()).includes("qrPayload"))
  await h.action("issuance/refresh")
  assert.equal(h.row().phase, "presentation"); assert.equal(providerCredentialReason(h.row(), T), null)
  assert.equal(providerPresentationReason(h.row(), T), "opendid_permission_required")
  await h.action("presentation/start"); await h.action("presentation/refresh")
  assert.equal(h.row().phase, "proposal"); assert.equal(providerPresentationReason(h.row(), T), null)
  assert.throws(() => assertProviderPermissionForOperation(h.row(), undefined, T), code("opendid_status_required"))
  const permission = await h.service.refreshPermission(SESSION, OP)
  assertProviderPermissionForOperation(h.row(), permission.revision, T)
  assert.equal(permission.binding, h.row().secrets.openDidProvider?.operationBinding)
  await h.service.refreshPermission(SESSION, OP); assert.equal(h.counts.status, 2)
  assert.throws(() => assertProviderPermissionForOperation(h.row(), permission.revision, T), code("operation_changed"))
  const publicSummaries = JSON.stringify({ credential: h.row().credential, presentation: h.row().presentation })
  for (const privateValue of [issue().credential!.vcId, issue().credential!.holderBinding, pres().decision!.decisionRef, pres().presentationId, "a".repeat(64), "sensitive-issuance-qr", "owner-session"]) assert(!publicSummaries.includes(privateValue))
  assert(!JSON.stringify(h.row().audit).includes("private"))
})
test("missing real CX mapping stops before durable state or network work", async () => {
  const h = setup({ mapping: false })
  await assert.rejects(h.action("issuance/start"), code("opendid_cx_mapping_unavailable"))
  assert.equal(h.row().secrets.openDidProvider, undefined); assert.equal(h.counts.issue, 0)
})
test("guide V2 cannot borrow native bridge V1 redemption authority", async () => {
  const h = setup(); await h.mutate(op => { op.journey = guideJourney() })
  await assert.rejects(h.action("issuance/start"), code("opendid_policy_unsupported")); assert.equal(h.counts.issue, 0)
})
test("wrong session, sample identity, missing consent, wrong phase and expired operation cannot start", async () => {
  const h = setup(); await assert.rejects(h.service.action("wrong_session", OP, "issuance/start"), code("not_found"))
  for (const mutate of [(op: OperationRecord) => { op.identity!.mode = "mock" }, (op: OperationRecord) => { op.consent = null }, (op: OperationRecord) => { op.phase = "identity" }, (op: OperationRecord) => { op.expiresAt = iso() }]) {
    const f = setup(); await f.mutate(mutate); await assert.rejects(f.action("issuance/start")); assert.equal(f.counts.issue, 0)
  }
})
test("outer operation cancellation wins an in-flight native issuance result", async () => {
  const d = deferred<OpenDidIssuance>(); let began = false
  const h = setup({ bridge: { async issuanceStart() { began = true; return d.promise } } })
  const pending = h.action("issuance/start"); await waitFor(() => began)
  await h.mutate(op => { op.status = "cancelled"; op.phase = "cancelled"; op.revision++ })
  d.resolve(issue()); const result = await pending
  assert.equal(result.record.status, "cancelled"); assert.equal(result.record.credential, null); assert.equal(result.provider.offer, null)
  assert.equal(result.record.secrets.openDidProvider?.phase, "cancelled"); assert.equal(h.counts.cancel, 1)
})
test("immutable venue/consent/evidence drift blocks late native success", async () => {
  for (const mutate of [(op: OperationRecord) => { op.venueId = "other-venue" }, (op: OperationRecord) => { op.consent!.digest = "changed" }, (op: OperationRecord) => { op.identity!.evidenceId = "evidence_other_01" }]) {
    const d = deferred<OpenDidIssuance>(); let began = false
    const h = setup({ bridge: { async issuanceStart() { began = true; return d.promise } } })
    const pending = h.action("issuance/start"); await waitFor(() => began); await h.mutate(mutate); d.resolve(issue())
    const result = await pending; assert.equal(result.record.status, "failed"); assert.equal(result.record.credential, null); assert.equal(h.counts.cancel, 1)
  }
})
test("outer exact expiry blocks pending VP and suppresses its QR/decision", async () => {
  const d = deferred<OpenDidPresentation>(); let began = false
  const h = setup({ bridge: { async presentationRefresh() { began = true; return d.promise } } })
  await h.action("issuance/start"); await h.action("issuance/refresh"); await h.action("presentation/start")
  const pending = h.action("presentation/refresh"); await waitFor(() => began); h.advance(3600000); d.resolve(pres())
  const result = await pending; assert.equal(result.record.status, "expired"); assert.equal(result.record.presentation?.decision, "expired"); assert.equal(result.record.presentation?.decisionRef, null); assert.equal(h.counts.deny, 1)
})
test("duplicate main issuance actions share one durable provider claim", async () => {
  const d = deferred<OpenDidIssuance>(); let calls = 0
  const h = setup({ bridge: { async issuanceStart() { calls++; return d.promise } } })
  const first = h.action("issuance/start"); await waitFor(() => calls === 1)
  const second = await h.action("issuance/start"); assert.equal(second.provider.offer, null); assert.equal(calls, 1)
  d.resolve(issueOffer()); await first
})
test("durable provider cancel completes locally even when cleanup is unavailable", async () => {
  const h = setup({ bridge: { async issuanceCancel() { throw new Error("synthetic outage") } } })
  await h.action("issuance/start"); const result = await h.action("cancel")
  assert.equal(result.record.status, "cancelled"); assert.equal(result.record.secrets.openDidProvider?.cleanupPending, true)
  await assert.rejects(h.service.refreshPermission(SESSION, OP), code("opendid_operation_inactive"))
})
test("provider cancel refuses already signed or consequential chain phases", async () => {
  for (const phase of ["delegation", "agent", "fulfillment", "done"] as const) {
    const h = setup(); await h.action("issuance/start"); await h.mutate(op => { op.phase = phase })
    await assert.rejects(h.action("cancel"), code("opendid_cancel_after_execution")); assert.equal(h.counts.cancel, 0)
  }
})
test("revocation and changed identity policy stop permission and later authority", async () => {
  const h = setup(); await h.ready()
  h.bridge.credentialStatus = async () => ({ issuanceId: "issuance_fixture_01", active: false, reason: "status_suspended", checkedAt: iso() })
  await assert.rejects(h.service.refreshPermission(SESSION, OP), code("opendid_status_required"))
  assert.equal(h.row().credential?.status, "suspended"); assert.equal(providerCredentialReason(h.row(), T), "opendid_credential_inactive")
  h.setIdentityChanged(); await assert.rejects(h.service.refreshPermission(SESSION, OP), code("opendid_identity_required"))
})
test("tampered public credential/presentation summaries never become provider evidence", async () => {
  const h = setup(); await h.ready(); await h.service.refreshPermission(SESSION, OP)
  await h.mutate(op => { op.credential!.holderBinding = "tampered" })
  assert.equal(providerCredentialReason(h.row(), T), "opendid_credential_binding")
  const other = setup(); await other.ready(); await other.service.refreshPermission(SESSION, OP)
  await other.mutate(op => { op.presentation!.decisionRef = "tampered" })
  assert.equal(providerPresentationReason(other.row(), T), "opendid_presentation_binding")
})
test("used decision cannot be reused even after another provider status refresh", async () => {
  const h = setup(); await h.ready(); await h.service.refreshPermission(SESSION, OP)
  await h.mutate(op => { op.presentation!.decisionConsumedAt = iso() })
  await assert.rejects(h.service.refreshPermission(SESSION, OP), code("decision_consumed"))
  assert.equal(h.row().presentation?.decisionConsumedAt, iso())
})
test("refresh status does not reset a downstream operation phase", async () => {
  const h = setup(); await h.ready(); await h.mutate(op => { op.phase = "delegation" })
  await h.service.refreshPermission(SESSION, OP)
  assert.equal(h.row().phase, "delegation")
})
