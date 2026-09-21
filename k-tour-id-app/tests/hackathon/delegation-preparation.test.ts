import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { prepareDelegationOnce, type PreparationServices } from "../../lib/hackathon/delegation-preparation"
import { readStore, withStore, type OperationRecord } from "../../lib/hackathon/store"
import { HkError, nowIso, plusMs, randomId } from "../../lib/hackathon/util"

// These are orchestration fixtures, never Sui success or live transaction evidence.
const dataDir = mkdtempSync(join(tmpdir(), "harvey-prepare-claim-"))
const saved = { isolated: process.env.HK_ISOLATED_MOCK, dir: process.env.HK_DATA_DIR }
const fetchBefore = globalThis.fetch
let networkAttempts = 0
before(() => {
  process.env.HK_ISOLATED_MOCK = "1"; process.env.HK_DATA_DIR = dataDir
  globalThis.fetch = async () => { networkAttempts += 1; throw new Error("network forbidden in preparation fixtures") }
})
after(() => {
  globalThis.fetch = fetchBefore
  if (saved.isolated === undefined) delete process.env.HK_ISOLATED_MOCK; else process.env.HK_ISOLATED_MOCK = saved.isolated
  if (saved.dir === undefined) delete process.env.HK_DATA_DIR; else process.env.HK_DATA_DIR = saved.dir
  rmSync(dataDir, { recursive: true, force: true })
  assert.equal(networkAttempts, 0)
})
const code = (expected: string) => (error: unknown) => error instanceof HkError && error.code === expected
const hex = (char: string) => "0x" + char.repeat(64)
const issuedFixture = { txDigest: "fixture-issuer-digest", entitlement: { objectId: hex("a"), version: "1", digest: "fixture-object-digest" } }
const builtFixture = { txBytesB64: "fixture-not-a-chain-transaction", txBytesDigest: "fixture-ui-hash", sponsorSignature: "fixture-no-signature" }
function gate() { let release!: () => void; const promise = new Promise<void>((resolve) => { release = resolve }); return { promise, release } }
async function seed() {
  const sessionId = randomId("ses"), operationId = randomId("op"), now = nowIso()
  const op: OperationRecord = {
    operationId, sessionId, kind: "demo_entitlement", venueId: "fixture-venue", campaignId: "fixture-campaign", policyVersion: 1,
    status: "pending", phase: "delegation", revision: 1, createdAt: now, updatedAt: now, expiresAt: plusMs(60_000), execution: "sample",
    safeNextAction: "wait", allowedActions: [], returnContext: null, consent: null, identity: null, credential: null, presentation: null,
    proposal: null, delegation: null, agent: null, fulfillment: null, chain: null, error: null, secrets: {}, audit: [],
  }
  await withStore((db) => { db.operations[operationId] = op })
  return { sessionId, operationId, expectedRevision: 1, scope: { intentRef: hex("1"), actionCommitment: hex("2"), consentCommitment: hex("3"), userAddress: hex("4"), signer: "demo" as const, recipient: hex("4"), expiresAtMs: Date.now() + 50_000 } }
}

test("durable claim precedes issuer I/O; concurrent prepare mints once and persists entitlement before PTB build", async () => {
  const input = await seed(), entered = gate(), release = gate()
  let issueCalls = 0, buildCalls = 0
  const services: PreparationServices = {
    issue: async ({ beforeBroadcast }) => {
      issueCalls += 1
      const disk = JSON.parse(readFileSync(join(dataDir, "journey.json"), "utf8"))
      assert.equal(disk.operations[input.operationId].secrets.delegationPreparation.stage, "issuing")
      assert.equal(disk.operations[input.operationId].delegation.entitlement, null)
      await beforeBroadcast(issuedFixture.txDigest)
      assert.equal((await readStore((db) => db.operations[input.operationId])).secrets.delegationPreparation?.issueTxDigest, issuedFixture.txDigest)
      entered.release(); await release.promise
      return issuedFixture
    },
    build: async () => {
      buildCalls += 1
      const disk = JSON.parse(readFileSync(join(dataDir, "journey.json"), "utf8"))
      assert.equal(disk.operations[input.operationId].delegation.entitlement.txDigest, issuedFixture.txDigest)
      assert.equal(disk.operations[input.operationId].secrets.delegationPreparation.stage, "building")
      return builtFixture
    },
  }
  const first = prepareDelegationOnce(input, services)
  await entered.promise
  try { await assert.rejects(prepareDelegationOnce(input, services), code("delegation_pending")) }
  finally { release.release() }
  const ready = await first
  assert.equal(issueCalls, 1); assert.equal(buildCalls, 1)
  assert.equal(ready.delegation?.status, "awaiting_signature")
  assert.equal(ready.secrets.lastTxBytesB64, builtFixture.txBytesB64)
  assert.equal(ready.secrets.delegationPreparation?.stage, "ready")
})

test("unknown issuer response keeps digest and claim; retries and changed recipients never re-mint", async () => {
  const input = await seed()
  let issues = 0
  const services: PreparationServices = {
    issue: async ({ beforeBroadcast }) => { issues += 1; await beforeBroadcast(issuedFixture.txDigest); throw new Error("fixture timeout after possible acceptance") },
    build: async () => { throw new Error("must not build without issued evidence") },
  }
  await assert.rejects(prepareDelegationOnce(input, services), code("delegation_preparation_unknown"))
  const unknown = await readStore((db) => db.operations[input.operationId])
  assert.equal(unknown.delegation?.status, "unknown")
  assert.equal(unknown.secrets.delegationPreparation?.issueTxDigest, issuedFixture.txDigest)
  for (const retry of [input, { ...input, expectedRevision: unknown.revision, scope: { ...input.scope, recipient: hex("5") } }]) {
    await assert.rejects(prepareDelegationOnce(retry, services), code("delegation_pending"))
  }
  assert.equal(issues, 1)
})

test("PTB build failure retains issued entitlement and cannot trigger another mint", async () => {
  const input = await seed()
  let issues = 0
  const services: PreparationServices = {
    issue: async ({ beforeBroadcast }) => { issues += 1; await beforeBroadcast(issuedFixture.txDigest); return issuedFixture },
    build: async () => { throw new Error("fixture RPC failure during PTB build") },
  }
  await assert.rejects(prepareDelegationOnce(input, services), code("delegation_preparation_unknown"))
  const unknown = await readStore((db) => db.operations[input.operationId])
  assert.deepEqual(unknown.delegation?.entitlement, { ...issuedFixture.entitlement, txDigest: issuedFixture.txDigest })
  assert.equal(unknown.delegation?.status, "unknown")
  await assert.rejects(prepareDelegationOnce({ ...input, expectedRevision: unknown.revision }, services), code("delegation_pending"))
  assert.equal(issues, 1)
})

test("cancellation after issuer dispatch preserves issued evidence but stops PTB preparation", async () => {
  const input = await seed()
  let builds = 0
  const services: PreparationServices = {
    issue: async ({ beforeBroadcast }) => {
      await beforeBroadcast(issuedFixture.txDigest)
      await withStore((db) => { const op = db.operations[input.operationId]; op.status = "cancelled"; op.phase = "cancelled"; op.revision += 1 })
      return issuedFixture
    },
    build: async () => { builds += 1; return builtFixture },
  }
  await assert.rejects(prepareDelegationOnce(input, services), code("phase"))
  const stopped = await readStore((db) => db.operations[input.operationId])
  assert.equal(stopped.status, "cancelled")
  assert.equal(stopped.delegation?.entitlement?.txDigest, issuedFixture.txDigest)
  assert.equal(builds, 0)
})

test("stale approval or a different session fails before any issuer call", async () => {
  const input = await seed()
  let issues = 0
  const services: PreparationServices = { issue: async () => { issues += 1; return issuedFixture }, build: async () => builtFixture }
  await assert.rejects(prepareDelegationOnce({ ...input, expectedRevision: 0 }, services), code("operation_changed"))
  await assert.rejects(prepareDelegationOnce({ ...input, sessionId: "different-session" }, services), code("not_found"))
  assert.equal(issues, 0)
  assert.equal((await readStore((db) => db.operations[input.operationId])).delegation, null)
})

test("mismatched issuer transaction cannot replace the journaled digest or proceed to build", async () => {
  const input = await seed()
  let builds = 0
  const services: PreparationServices = {
    issue: async ({ beforeBroadcast }) => { await beforeBroadcast("different-fixture-digest"); return issuedFixture },
    build: async () => { builds += 1; return builtFixture },
  }
  await assert.rejects(prepareDelegationOnce(input, services), code("sui_evidence_mismatch"))
  assert.equal(builds, 0)
  assert.equal((await readStore((db) => db.operations[input.operationId])).delegation?.entitlement, null)
})

test("approval expiring during issuer preparation blocks the actual broadcast callback", async () => {
  const input = await seed(), originalNow = Date.now
  let broadcasts = 0, builds = 0
  const services: PreparationServices = {
    issue: async ({ beforeBroadcast }) => {
      Date.now = () => input.scope.expiresAtMs + 1
      await beforeBroadcast(issuedFixture.txDigest)
      broadcasts += 1
      return issuedFixture
    },
    build: async () => { builds += 1; return builtFixture },
  }
  try { await assert.rejects(prepareDelegationOnce(input, services), code("phase")) }
  finally { Date.now = originalNow }
  assert.equal(broadcasts, 0); assert.equal(builds, 0)
  const stopped = await readStore((db) => db.operations[input.operationId])
  assert.equal(stopped.delegation?.status, "unknown")
  assert.equal(stopped.secrets.delegationPreparation?.issueTxDigest, null)
})
