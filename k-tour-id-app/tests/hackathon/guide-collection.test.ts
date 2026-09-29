import test from "node:test"
import assert from "node:assert/strict"
import { GUIDE_SAVE_V2, guideJourney, isGuideJourney } from "../../lib/hackathon/guide-contract"
import { assertGuideCollectionMonotonic, assertGuideCollectionStore, commitGuideCollection, guideCollectionForSession, guideCollectionKey, mirrorGuideCollection, guideSaveConflict } from "../../lib/hackathon/guide-collection"
import { hostedSuiRouteAllowed } from "../../lib/hackathon/hosted-sui-profile"
import { assertIntegrationPreviewBody, integrationPreviewRouteAllowed } from "../../lib/hackathon/integration-preview-access"
import type { Db, OperationRecord, OutboxRecord } from "../../lib/hackathon/store"

function fixture() {
  const now = new Date().toISOString(), operationId = "op_fixture_12345678", subject = "subject-private"
  const op = { operationId, sessionId: "session-a", journey: guideJourney(), venueId: GUIDE_SAVE_V2.venueId, campaignId: GUIDE_SAVE_V2.campaignId, policyVersion: 1,
    identity: { mode: "cx", personVerified: true, subjectRef: subject }, credential: { mode: "opendid", holderAckAt: now },
    presentation: { decision: "allow", decisionConsumedAt: now }, agent: { status: "executed", txDigest: "SuiFixtureDigest", verified: { effectsOk: true, eventOk: true, grantUses: 1 } },
    fulfillment: { status: "redeemed", redemptionRef: "rdm_fixture", redeemedAt: now } } as unknown as OperationRecord
  const outbox = { outboxId: "obx_fixture", operationId, status: "pending", txHash: null, confirmedAt: null } as OutboxRecord
  const db: Db = { version: 1, sessions: { "session-a": { sessionId: "session-a", createdAt: now, lastSeenAt: now, subjectRef: subject } },
    operations: { [operationId]: op }, redemptions: { [`${subject}::${op.campaignId}`]: { redemptionRef: "rdm_fixture", subjectRef: subject, campaignId: op.campaignId, operationId, redeemedAt: now } }, outbox: { [outbox.outboxId]: outbox }, idempotency: {}, nonces: {} }
  return { db, op, outbox, now }
}

test("guide v2 binds version, venue, campaign, action and policy; v1 never upgrades", () => {
  const { op } = fixture()
  assert.equal(isGuideJourney(op), true)
  for (const patch of [{ journey: undefined }, { campaignId: "hk-identity-perk-v1" }, { venueId: "elsewhere" }, { policyVersion: 2 }, { journey: { ...guideJourney(), action: "redeem_demo_entitlement" } }]) {
    assert.equal(isGuideJourney({ ...op, ...patch } as OperationRecord), false)
  }
})

test("completed and cross-session pending guide saves are detected before spending", () => {
  const { db, op } = fixture()
  assert.equal(guideSaveConflict(db, "subject-private"), "guide_already_saved")
  db.redemptions = {}
  op.status = "pending"; op.expiresAt = new Date(Date.now() + 60_000).toISOString()
  assert.equal(guideSaveConflict(db, "subject-private"), "guide_save_in_progress")
  assert.equal(guideSaveConflict(db, "subject-private", op.operationId), null)
  assert.equal(guideSaveConflict(db, "another-person"), null)
  assert.equal(guideSaveConflict(db, null), null)
  op.status = "expired"; op.expiresAt = new Date(0).toISOString()
  op.delegation = { userTxDigest: "unknown-paid-transaction", status: "unknown" } as OperationRecord["delegation"]
  assert.equal(guideSaveConflict(db, "subject-private"), "guide_save_in_progress")
})

test("collection commits one authorized server result and stays idempotent", () => {
  const { db, op, outbox } = fixture()
  const first = commitGuideCollection(db, op, outbox)
  assert.equal(commitGuideCollection(db, op, outbox), first)
  assert.equal(Object.keys(db.guideCollection!).length, 1)
  assertGuideCollectionStore(db.guideCollection)
  assert.equal(guideCollectionForSession(db, "session-a").length, 1)
  assert.deepEqual(guideCollectionForSession(db, "another-session"), [])
})

test("sample identity/credential, unverified execution and missing outbox cannot save", () => {
  for (const corrupt of [
    (x: ReturnType<typeof fixture>) => { x.op.identity!.mode = "mock" },
    (x: ReturnType<typeof fixture>) => { x.op.credential!.mode = "mock" },
    (x: ReturnType<typeof fixture>) => { x.op.agent!.verified!.eventOk = false },
    (x: ReturnType<typeof fixture>) => { x.op.presentation!.decisionConsumedAt = null },
    (x: ReturnType<typeof fixture>) => { delete x.db.outbox[x.outbox.outboxId] },
    (x: ReturnType<typeof fixture>) => { x.db.sessions["session-a"].subjectRef = "another-person" },
  ]) { const x = fixture(); corrupt(x); assert.throws(() => commitGuideCollection(x.db, x.op, x.outbox)); assert.equal(x.db.guideCollection, undefined) }
})

test("collection is retained when the operation expires or is pruned", () => {
  const { db, op, outbox } = fixture()
  commitGuideCollection(db, op, outbox)
  delete db.operations[op.operationId]
  assert.equal(guideCollectionForSession(db, "session-a")[0].operationId, op.operationId)
})

test("projection excludes secrets and unknown persisted fields", () => {
  const { db, op, outbox } = fixture()
  const row = commitGuideCollection(db, op, outbox)
  Object.assign(row, { providerToken: "must-never-publish" })
  const publicData = JSON.stringify(guideCollectionForSession(db, "session-a"))
  for (const denied of ["subject-private", "redemptionRef", "outboxId", "providerToken", "must-never-publish"]) assert.ok(!publicData.includes(denied))
  assert.throws(() => assertGuideCollectionStore(db.guideCollection))
})

test("chain delay preserves access and only verified receipt marks confirmed", () => {
  const { db, op, outbox, now } = fixture()
  commitGuideCollection(db, op, outbox)
  delete db.operations[op.operationId]
  outbox.status = "unknown"; mirrorGuideCollection(db, outbox)
  assert.equal(guideCollectionForSession(db, "session-a")[0].chain.status, "unknown")
  outbox.status = "confirmed"; outbox.txHash = `0x${"a".repeat(64)}`; outbox.confirmedAt = now
  mirrorGuideCollection(db, outbox)
  assert.equal(guideCollectionForSession(db, "session-a")[0].chain.status, "unknown")
  outbox.receiptEvidenceVersion = 1; mirrorGuideCollection(db, outbox)
  assert.equal(guideCollectionForSession(db, "session-a")[0].chain.status, "confirmed")
})

test("one subject cannot attach a different operation to its saved guide", () => {
  const { db, op, outbox } = fixture()
  commitGuideCollection(db, op, outbox)
  const altered = structuredClone(db)
  altered.guideCollection![guideCollectionKey("subject-private")].operationId = "op_other_12345678"
  assert.throws(() => assertGuideCollectionMonotonic(db.guideCollection, altered))
  delete altered.guideCollection
  assert.throws(() => assertGuideCollectionMonotonic(db.guideCollection, altered))
  assertGuideCollectionMonotonic(db.guideCollection, db)
})

test("invalid pending confirmation or reassigned collection key fails closed", () => {
  const { db, op, outbox, now } = fixture()
  const row = commitGuideCollection(db, op, outbox)
  row.chain.confirmedAt = now
  assert.throws(() => assertGuideCollectionStore(db.guideCollection))
  row.chain.confirmedAt = null
  assert.throws(() => assertGuideCollectionStore({ another: row }))
})

test("production hosted adds only a read-only collection route, not provider writes", () => {
  assert.equal(hostedSuiRouteAllowed("GET", ["guide", "collection"]), true)
  for (const path of [["guide", "operations"], ["operations", "op_fixture_12345678", "provider", "issuance", "start"]]) {
    assert.equal(hostedSuiRouteAllowed("POST", path), false)
  }
})

test("integration provider routes use exact actions and reject injected claims", () => {
  const route = ["operations", "op_fixture_12345678", "provider", "issuance", "start"]
  assert.equal(integrationPreviewRouteAllowed("POST", route), true)
  assert.equal(integrationPreviewRouteAllowed("GET", route), false)
  assert.equal(integrationPreviewRouteAllowed("POST", [...route, "extra"]), false)
  assert.doesNotThrow(() => assertIntegrationPreviewBody(route, {}))
  for (const body of [{ __verifierConfirmed: true }, { subjectRef: "fake" }, { kycRef: "a".repeat(64) }, { holderBinding: "fake" }]) assert.throws(() => assertIntegrationPreviewBody(route, body))
})
