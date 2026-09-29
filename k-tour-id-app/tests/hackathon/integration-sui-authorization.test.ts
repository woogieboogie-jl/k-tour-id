// Real runtime wrapper + Redis reader, synthetic committed fixture only. No keys,
// provider requests, real activation attestor, Redis writes or chain operations.
import assert from "node:assert/strict"
import test, { before, beforeEach, after } from "node:test"
import { createHash } from "node:crypto"
import { CUTOVER_SCOPE, cutoverDigest, type IntegrationCutoverMarker } from "../../lib/hackathon/integration-cutover"
import { integrationSuiBudgetTemplate, claimIntegrationSuiOperation, INTEGRATION_SUI_LIMITS as L } from "../../lib/hackathon/integration-sui-limits"
import { INTEGRATION_SUI_TARGETS } from "../../lib/hackathon/integration-sui-targets"
import { withIntegrationSuiAuthorization, assertIntegrationSuiAuthorized, refreshIntegrationSuiAuthorization, readIntegrationSuiActivation, type Db, type OperationRecord } from "../../lib/hackathon/store"

const originalEnv = { ...process.env }, originalFetch = globalThis.fetch, originalNow = Date.now
const NOW = Date.parse("2026-09-29T04:00:00Z"), source = '{"synthetic":"retained-history"}'
const owner = { sessionId: "fixture-session-a", operationId: "op_authorized0001" }
const otherOwner = { sessionId: "fixture-session-b", operationId: "op_authorized0002" }
const marker: IntegrationCutoverMarker = { version: 1, migrationId: "cutover_" + "a".repeat(64), evidenceDigest: "0x" + "b".repeat(64),
  sourceLedgerSha256: "0x" + createHash("sha256").update(source).digest("hex"), priorHostedOperationIds: ["op_priorfailed001"],
  hostedWritesDisabledAt: "2026-09-28T00:00:00Z", expiresAt: L.maxExpiresAt }
function env() {
  const t = INTEGRATION_SUI_TARGETS["selfhosted-testnet"]
  return { NODE_ENV: "test", HK_ISOLATED_MOCK: "0", NEXT_PUBLIC_HK_INTEGRATION_PREVIEW: "1", HK_INTEGRATION_SUI_TARGET: "selfhosted-testnet",
    HK_INTEGRATION_PREVIEW_ENABLED: "1", HK_INTEGRATION_PREVIEW_EXPIRES_AT: L.maxExpiresAt,
    NEXT_PUBLIC_HK_HOSTED_SUI: "0", HK_HOSTED_SUI_ENABLED: "0", NEXT_PUBLIC_HK_CX_PREVIEW: "0", NEXT_PUBLIC_HK_PREVIEW_READ_ONLY: "0", HK_MODE_CX: "cx", HK_MODE_OPENDID: "opendid",
    HK_SUI_NETWORK: t.network, HK_SUI_GRPC_URL: t.rpcUrls[0], HK_SUI_PACKAGE_ID: t.packageId, HK_SUI_CAMPAIGN_ID: t.campaignId,
    HK_SUI_CAMPAIGN_INITIAL_VERSION: t.campaignInitialVersion, HK_SUI_CHAIN_IDENTIFIER: t.chainIdentifier,
    HK_SUI_ISSUER_SECRET_KEY: "sui_fixture_" + "a".repeat(64), HK_SUI_AGENT_SECRET_KEY: "sui_fixture_" + "b".repeat(64),
    UPSTASH_REDIS_REST_URL: "https://synthetic-authorization.upstash.io", UPSTASH_REDIS_REST_TOKEN: "offline-fixture", HK_STORE_KEY: CUTOVER_SCOPE.targetKey }
}
let now = NOW, rawTarget: string | null, rawControl: string | null, rawSource = source, reads = 0
let pauseRead: (() => Promise<void>) | null = null
const resetEnv = () => { for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, env()) }
function operation(binding = owner): OperationRecord {
  return { ...binding, status: "pending", phase: "delegation", expiresAt: L.maxExpiresAt, updatedAt: new Date(NOW).toISOString(), revision: 1, secrets: {}, audit: [] } as unknown as OperationRecord
}
function base(): Db {
  const db: Db = { version: 1, sessions: {}, operations: {}, redemptions: {}, outbox: {}, idempotency: {}, nonces: {}, integrationCutover: structuredClone(marker),
    integrationSuiBudget: integrationSuiBudgetTemplate({ priorHostedOperationIds: marker.priorHostedOperationIds, hostedLedgerSha256: marker.sourceLedgerSha256, hostedWritesDisabledAt: marker.hostedWritesDisabledAt }) }
  for (const o of [owner, otherOwner]) { claimIntegrationSuiOperation(db, o.operationId); db.operations[o.operationId] = operation(o) }
  return db
}
function seed(db = base(), sequence = 0) {
  rawTarget = JSON.stringify(db)
  rawControl = JSON.stringify({ version: 1, phase: "committed", marker: db.integrationCutover, operationIds: [...db.integrationSuiBudget!.operationIds], targetDigest: cutoverDigest(db), sequence })
}
before(() => {
  Date.now = () => now
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://synthetic-authorization.upstash.io")
    const cmd = JSON.parse(String(init?.body))
    assert.deepEqual(cmd, ["MGET", CUTOVER_SCOPE.targetKey, CUTOVER_SCOPE.controlKey, CUTOVER_SCOPE.sourceKey], "authorization is read-only")
    reads++
    const result = [rawTarget, rawControl, rawSource]
    if (pauseRead) { const pause = pauseRead; pauseRead = null; await pause() }
    return Response.json({ result })
  }
})
beforeEach(() => { resetEnv(); now = NOW; rawSource = source; reads = 0; pauseRead = null; seed() })
after(() => { Date.now = originalNow; globalThis.fetch = originalFetch; for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, originalEnv) })
const denied = { code: "integration_sui_migration_required" }

test("outside context and plain client JSON never mint signing authority", async () => {
  assert.throws(() => assertIntegrationSuiAuthorized(owner), denied)
  await assert.rejects(refreshIntegrationSuiAuthorization(), denied)
  let ran = false
  await assert.rejects(withIntegrationSuiAuthorization({ authenticated: true } as never, () => { ran = true }), denied)
  assert.equal(ran, false); assert.equal(reads, 0)
})
test("fresh committed state authorizes only owned allocated operation, then closes", async () => {
  await withIntegrationSuiAuthorization(owner, async () => {
    assert.doesNotThrow(() => assertIntegrationSuiAuthorized(owner))
    assert.throws(() => assertIntegrationSuiAuthorized(otherOwner), denied)
    await assert.rejects(withIntegrationSuiAuthorization(otherOwner, () => undefined), denied)
  })
  assert.equal(reads, 1)
  assert.throws(() => assertIntegrationSuiAuthorized(owner), denied)
  for (const wrong of [{ ...owner, sessionId: otherOwner.sessionId }, { ...owner, operationId: "op_unallocated001" }]) {
    let ran = false
    await assert.rejects(withIntegrationSuiAuthorization(wrong, () => { ran = true }))
    assert.equal(ran, false)
  }
})
test("missing or partial control stops callback without initializing any state", async () => {
  for (const missing of ["target", "control"]) {
    seed(); if (missing === "target") rawTarget = null; else rawControl = null
    await assert.rejects(withIntegrationSuiAuthorization(owner, () => assert.fail("must not run")), denied)
  }
  seed(); const c = JSON.parse(rawControl!); c.phase = "prepared"; c.targetDigest = null; c.operationIds = []; rawControl = JSON.stringify(c)
  await assert.rejects(withIntegrationSuiAuthorization(owner, () => assert.fail("must not run")), { code: "integration_cutover_unverified" })
})
test("terminal, expired, mismatched row ID and pre-approval phases cannot enter", async () => {
  for (const patch of [{ status: "cancelled" }, { status: "unknown" }, { phase: "identity" }, { phase: "proposal" }, { expiresAt: new Date(NOW).toISOString() }, { operationId: otherOwner.operationId }]) {
    const db = base(); Object.assign(db.operations[owner.operationId], patch); seed(db)
    await assert.rejects(withIntegrationSuiAuthorization(owner, () => assert.fail("must not run")), denied)
  }
})
test("short-lived capability needs fresh durable read; late source writes invalidate it", async () => {
  await withIntegrationSuiAuthorization(owner, async () => {
    now += 5000
    assert.throws(() => assertIntegrationSuiAuthorized(), denied)
    await refreshIntegrationSuiAuthorization(); assertIntegrationSuiAuthorized(owner)
    rawSource += " "
    await assert.rejects(refreshIntegrationSuiAuthorization(), { code: "integration_cutover_source_changed" })
    rawSource = source
    assert.throws(() => assertIntegrationSuiAuthorized(), denied, "failed refresh must not preserve previous positive capability")
    await refreshIntegrationSuiAuthorization(); assertIntegrationSuiAuthorized(owner)
  })
  assert.equal(reads, 4)
})
test("cancellation, ledger rollback and source drift are checked again before broadcast", async () => {
  await withIntegrationSuiAuthorization(owner, async () => {
    const db = base(); db.operations[owner.operationId].status = "cancelled"; seed(db, 1)
    await assert.rejects(refreshIntegrationSuiAuthorization(), denied)
    seed(); const c = JSON.parse(rawControl!); c.targetDigest = "0x" + "f".repeat(64); rawControl = JSON.stringify(c)
    await assert.rejects(refreshIntegrationSuiAuthorization(), { code: "integration_cutover_unverified" })
    assert.throws(() => assertIntegrationSuiAuthorized(), denied)
  })
})
test("scope and credential changes cannot reuse cached authorization after restoration", async () => {
  await withIntegrationSuiAuthorization(owner, async () => {
    const value = process.env.HK_SUI_ISSUER_SECRET_KEY
    process.env.HK_SUI_ISSUER_SECRET_KEY = "different_valid_shape_" + "c".repeat(64)
    assert.throws(() => assertIntegrationSuiAuthorized(), denied)
    process.env.HK_SUI_ISSUER_SECRET_KEY = value
    assert.throws(() => assertIntegrationSuiAuthorized(), denied)
    await refreshIntegrationSuiAuthorization(); assertIntegrationSuiAuthorized()
    process.env.HK_SUI_NETWORK = "mainnet"
    await assert.rejects(refreshIntegrationSuiAuthorization(), { code: "integration_sui_scope" })
    process.env.HK_SUI_NETWORK = "testnet"
    assert.throws(() => assertIntegrationSuiAuthorized(), denied)
  })
})
test("removing the protected profile cannot revive an earlier capability when restored", async () => {
  await withIntegrationSuiAuthorization(owner, async () => {
    process.env.NEXT_PUBLIC_HK_INTEGRATION_PREVIEW = "0"
    process.env.HK_INTEGRATION_PREVIEW_ENABLED = "0"
    assert.throws(() => assertIntegrationSuiAuthorized(), denied)
    await assert.rejects(withIntegrationSuiAuthorization(otherOwner, () => assert.fail("nested downgrade")), denied)
    process.env.NEXT_PUBLIC_HK_INTEGRATION_PREVIEW = "1"
    process.env.HK_INTEGRATION_PREVIEW_ENABLED = "1"
    assert.throws(() => assertIntegrationSuiAuthorized(), denied)
    await refreshIntegrationSuiAuthorization(); assertIntegrationSuiAuthorized(owner)
  })
})
test("configured and hard expiry are rechecked after asynchronous reads and before use", async () => {
  process.env.HK_INTEGRATION_PREVIEW_EXPIRES_AT = new Date(NOW + 1000).toISOString()
  pauseRead = async () => { now += 1000 }
  await assert.rejects(withIntegrationSuiAuthorization(owner, () => assert.fail("expired during read")), { code: "integration_sui_scope" })
  resetEnv(); now = NOW
  await withIntegrationSuiAuthorization(owner, async () => {
    now = L.maxEnd
    assert.throws(() => assertIntegrationSuiAuthorized(), { code: "integration_sui_scope" })
  })
})
test("parallel requests remain owner-isolated and older overlapping refresh cannot win", async () => {
  await Promise.all([owner, otherOwner].map(o => withIntegrationSuiAuthorization(o, async () => {
    await Promise.resolve(); assertIntegrationSuiAuthorized(o)
    assert.throws(() => assertIntegrationSuiAuthorized(o === owner ? otherOwner : owner), denied)
  })))
  await withIntegrationSuiAuthorization(owner, async () => {
    let release!: () => void
    pauseRead = () => new Promise<void>(resolve => { release = resolve })
    const older = refreshIntegrationSuiAuthorization()
    // The read port pauses synchronously before the first await returns.
    await Promise.resolve()
    const newest = refreshIntegrationSuiAuthorization(); await newest
    release()
    await assert.rejects(older, denied)
    assertIntegrationSuiAuthorized(owner)
  })
})
test("background tasks inherited from a closed scope cannot sign or refresh", async () => {
  let release!: () => void, background!: Promise<void>
  await withIntegrationSuiAuthorization(owner, () => {
    const wait = new Promise<void>(resolve => { release = resolve })
    background = wait.then(async () => { assert.throws(() => assertIntegrationSuiAuthorized(), denied); await assert.rejects(refreshIntegrationSuiAuthorization(), denied) })
  })
  release(); await background
})
test("readiness/create read validates full limits and exposes no reusable signing context", async () => {
  const out = await readIntegrationSuiActivation(); assert.equal(out.control.phase, "committed")
  assert.throws(() => assertIntegrationSuiAuthorized(), denied)
  out.db.integrationSuiBudget!.operationIds.length = 0
  assert.equal((await readIntegrationSuiActivation()).db.integrationSuiBudget!.operationIds.length, 2)
  process.env.HK_INTEGRATION_SUI_MAX_OPERATIONS = "11"
  const priorReads = reads
  await assert.rejects(readIntegrationSuiActivation(), { code: "integration_sui_scope" })
  assert.equal(reads, priorReads)
})
test("guide production uses the same committed budget and cannot downgrade to a new store", async () => {
  Object.assign(process.env, { NEXT_PUBLIC_HK_INTEGRATION_PREVIEW: "0", HK_INTEGRATION_PREVIEW_ENABLED: "0",
    NEXT_PUBLIC_HK_GUIDE_PRODUCTION: "1", HK_GUIDE_PRODUCTION_ENABLED: "1", HK_GUIDE_LOCAL_TEST: "1", HK_GUIDE_EXPIRES_AT: L.maxExpiresAt,
    HK_API_ENABLED: "1", NEXT_PUBLIC_HK_ENABLED: "1", HK_AI_MODE: "gemini", HK_CX_BASE_URL: "https://cx.raonsecure.co.kr:18543", HK_CX_PROVIDER: "comdl", HK_CX_ZKP_TYPE: "AdultVerify",
    HK_ISSUER_SIGNING_SEED: "fixture_" + "z".repeat(64), HK_GUIDE_ACCESS_SECRET: "a".repeat(64), HK_GUIDE_ACCESS_CODE: "fixture_access_" + "b".repeat(32) })
  await withIntegrationSuiAuthorization(owner, async () => {
    assertIntegrationSuiAuthorized(owner)
    process.env.HK_STORE_KEY = "ktour:integration-preview:replacement-budget"
    await assert.rejects(refreshIntegrationSuiAuthorization(), { code: "integration_sui_scope" })
    process.env.HK_STORE_KEY = CUTOVER_SCOPE.targetKey
    assert.throws(() => assertIntegrationSuiAuthorized(), denied)
    await refreshIntegrationSuiAuthorization(); assertIntegrationSuiAuthorized(owner)
  })
  assert.equal(reads, 2)
})
