// Real store.ts and integrity parser with a synthetic Redis transport only.
import assert from "node:assert/strict"
import { before, beforeEach, after, test } from "node:test"
import { CUTOVER_SCOPE as P, cutoverDigest, type IntegrationCutoverMarker, type IntegrationCutoverControl } from "../../lib/hackathon/integration-cutover"
import { integrationSuiBudgetTemplate, claimIntegrationSuiOperation, INTEGRATION_SUI_LIMITS } from "../../lib/hackathon/integration-sui-limits"
import { withStore, readStore, readIntegrationSuiActivation, type Db, type OperationRecord } from "../../lib/hackathon/store"
import { GUIDE_SAVE_V2 } from "../../lib/hackathon/guide-contract"
import { guideCollectionKey, type GuideCollectionRecord } from "../../lib/hackathon/guide-collection"
import { createHash } from "node:crypto"

const savedEnv = { ...process.env }, savedFetch = globalThis.fetch
const sourceRaw = '{"fixture":"source-history"}'
const marker: IntegrationCutoverMarker = { version: 1, migrationId: "cutover_" + "a".repeat(64), evidenceDigest: "0x" + "b".repeat(64),
  sourceLedgerSha256: "0x" + createHash("sha256").update(sourceRaw).digest("hex"), priorHostedOperationIds: ["op_priorcancelled1", "op_priorfailed001"],
  hostedWritesDisabledAt: "2026-09-28T00:00:00.000Z", expiresAt: INTEGRATION_SUI_LIMITS.maxExpiresAt }
function base(): Db {
  return { version: 1, sessions: {}, operations: {}, redemptions: {}, outbox: {}, idempotency: {}, nonces: {},
    integrationCutover: structuredClone(marker), integrationSuiBudget: integrationSuiBudgetTemplate({
      priorHostedOperationIds: marker.priorHostedOperationIds, hostedLedgerSha256: marker.sourceLedgerSha256, hostedWritesDisabledAt: marker.hostedWritesDisabledAt }) }
}
let target: string | null, control: string | null, lock: string | null, writes = 0, unexpected = 0
let retainedSource = sourceRaw
let beforeCommit: (() => void) | undefined
function seed(db: Db = base()) {
  target = JSON.stringify(db)
  control = JSON.stringify({ version: 1, phase: "committed", marker: db.integrationCutover!, targetDigest: cutoverDigest(db),
    operationIds: [...db.integrationSuiBudget!.operationIds], sequence: 0 } satisfies IntegrationCutoverControl)
  lock = null; writes = 0; beforeCommit = undefined; retainedSource = sourceRaw
}
before(() => {
  for (const key of Object.keys(process.env)) delete process.env[key]
  Object.assign(process.env, { NODE_ENV: "test", HK_ISOLATED_MOCK: "0", NEXT_PUBLIC_HK_INTEGRATION_PREVIEW: "1", HK_INTEGRATION_SUI_TARGET: "selfhosted-testnet",
    UPSTASH_REDIS_REST_URL: "https://fixture-cutover.invalid", UPSTASH_REDIS_REST_TOKEN: "offline-fixture", HK_STORE_KEY: P.targetKey })
  globalThis.fetch = async (input, init) => {
    if (String(input) !== "https://fixture-cutover.invalid") { unexpected++; throw new Error("unexpected_network") }
    const cmd = JSON.parse(String(init?.body)) as Array<string | number>
    let result: unknown
    if (cmd[0] === "SET" && cmd[3] === "NX") { lock = String(cmd[2]); result = "OK" }
    else if (cmd[0] === "MGET") { assert.deepEqual(cmd.slice(1), [P.targetKey, P.controlKey, P.sourceKey]); result = [target, control, retainedSource] }
    else if (cmd[0] === "GET") { assert.equal(cmd[1], P.targetKey); result = target }
    else if (cmd[0] === "EVAL" && cmd[2] === 4 && String(cmd[1]).includes("ktour-cutover-runtime-commit-v1")) {
      assert.deepEqual(cmd.slice(3, 7), [`${P.targetKey}:lock`, P.targetKey, P.controlKey, P.sourceKey])
      beforeCommit?.(); beforeCommit = undefined
      result = lock === cmd[7] && target === cmd[8] && control === cmd[9] && retainedSource === cmd[12] ? 1 : 0
      if (result === 1) { target = String(cmd[10]); control = String(cmd[11]); writes++ }
    } else if (cmd[0] === "EVAL" && cmd[2] === 1) { result = lock === cmd[4] ? 1 : 0; if (result === 1) lock = null }
    else { unexpected++; throw new Error("unexpected_redis_command") }
    return Response.json({ result })
  }
})
beforeEach(() => seed())
after(() => { globalThis.fetch = savedFetch; for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, savedEnv); assert.equal(unexpected, 0) })

test("protected read is a verified atomic target/control snapshot; runtime cannot initialize missing state", async () => {
  const activation = await readIntegrationSuiActivation()
  assert.equal(activation.control.phase, "committed")
  assert.deepEqual(await readStore(db => db.integrationSuiBudget!.operationIds), [])
  assert.equal(writes, 0)
  for (const missing of ["target", "control", "both"]) {
    seed(); if (missing !== "control") target = null; if (missing !== "target") control = null
    let ran = false
    await assert.rejects(withStore(() => { ran = true }), { code: "integration_sui_migration_required" })
    assert.equal(ran, false); assert.equal(writes, 0)
  }
})

test("retained cancelled/pruned operation counts and independent high watermark advance atomically", async () => {
  for (let i = 0; i < 8; i++) await withStore(db => {
    const id = `op_cutoverfailed0${i}`
    claimIntegrationSuiOperation(db, id)
    db.operations[id] = { operationId: id, status: "cancelled", updatedAt: "2000-01-01T00:00:00Z", expiresAt: "2000-01-01T00:00:00Z", secrets: {} } as OperationRecord
  })
  const saved = JSON.parse(target!), c = JSON.parse(control!)
  assert.deepEqual(saved.operations, {})
  assert.equal(saved.integrationSuiBudget.operationIds.length, 8)
  assert.equal(c.sequence, 8); assert.deepEqual(c.operationIds, saved.integrationSuiBudget.operationIds)
  assert.equal(c.targetDigest, cutoverDigest(saved)); assert.equal(writes, 8)
  await assert.rejects(withStore(db => claimIntegrationSuiOperation(db, "op_overlimit00001")), { code: "integration_sui_limit" })
  assert.equal(writes, 8)
})

test("partial/corrupt control, ledger rollback and removed profile cannot downgrade CAS", async () => {
  const baseline = target
  await withStore(db => claimIntegrationSuiOperation(db, "op_newretained001"))
  target = baseline
  await assert.rejects(readStore(() => true), { code: "integration_cutover_unverified" })
  seed(); control = "bad-json"
  await assert.rejects(readStore(() => true), { code: "store_corrupt" })
  seed(); const c = JSON.parse(control!); c.phase = "prepared"; c.targetDigest = null; control = JSON.stringify(c)
  await assert.rejects(withStore(() => undefined), { code: "integration_cutover_unverified" })
  seed(); delete process.env.NEXT_PUBLIC_HK_INTEGRATION_PREVIEW
  try { await assert.rejects(readStore(() => true), { code: "store_configuration" }) }
  finally { process.env.NEXT_PUBLIC_HK_INTEGRATION_PREVIEW = "1" }
})

test("competing control update/late source or target write/expired lease prevent both replacement writes", async () => {
  for (const interference of [() => { control += " " }, () => { target += " " }, () => { lock = "new-owner" }, () => { retainedSource += " " }]) {
    seed(); beforeCommit = interference
    await assert.rejects(withStore(db => claimIntegrationSuiOperation(db, "op_conflicting001")), { code: "store_lease_lost" })
    assert.equal(writes, 0)
    assert.equal(JSON.parse(target!).integrationSuiBudget.operationIds.length, 0)
  }
  seed(); retainedSource += " "
  await assert.rejects(readStore(() => true), { code: "integration_cutover_source_changed" })
})

test("ordinary writes cannot remove/reassign the migration marker or decrease retained budget", async () => {
  for (const mutation of [
    (db: Db) => { delete db.integrationCutover },
    db => { db.integrationCutover!.sourceLedgerSha256 = "0x" + "f".repeat(64) },
    db => { delete db.integrationSuiBudget },
    db => { db.integrationSuiBudget!.priorHostedOperationIds = [] },
  ] satisfies Array<(db: Db) => void>) {
    seed(); const t = target, c = control
    await assert.rejects(withStore(mutation))
    assert.equal(target, t); assert.equal(control, c); assert.equal(writes, 0)
  }
})

test("guide collection survives pruning; ordinary deletion/reassignment fails but chain progress persists", async () => {
  const row: GuideCollectionRecord = { guideId: GUIDE_SAVE_V2.guideId, venueId: GUIDE_SAVE_V2.venueId, campaignId: GUIDE_SAVE_V2.campaignId,
    operationId: "op_savedguide0001", subjectRef: "fixture-subject", redemptionRef: "rdm_fixture", outboxId: "obx_fixture",
    savedAt: "2026-09-28T00:00:00Z", chain: { status: "pending", txHash: null, confirmedAt: null } }
  const db = base(), key = guideCollectionKey(row.subjectRef); db.guideCollection = { [key]: row }; seed(db)
  await assert.rejects(withStore(d => { delete d.guideCollection }), { code: "guide_collection_invalid" })
  await assert.rejects(withStore(d => { d.guideCollection![key].operationId = "op_reassigned001" }), { code: "guide_collection_invalid" })
  await withStore(d => { d.guideCollection![key].chain = { status: "submitted", txHash: "0x" + "1".repeat(64), confirmedAt: null } })
  assert.equal(await readStore(d => d.guideCollection![key].chain.status), "submitted")
  assert.equal(JSON.parse(control!).targetDigest, cutoverDigest(JSON.parse(target!)))
})
