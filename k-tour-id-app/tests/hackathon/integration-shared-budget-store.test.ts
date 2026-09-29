// Real store + fixed Lua protocol against an in-memory Redis transport only.
import assert from "node:assert/strict"
import test, { before, beforeEach, after } from "node:test"
import { withStore, readIntegrationSuiActivation, initializeIntegrationSharedBudget, withIntegrationSuiAuthorization, assertIntegrationSuiAuthorized, type OperationRecord } from "../../lib/hackathon/store"
import { SHARED_BUDGET_SCOPE as S } from "../../lib/hackathon/integration-shared-budget"
import { INTEGRATION_SUI_LIMITS as L, claimIntegrationSuiOperation } from "../../lib/hackathon/integration-sui-limits"
import { INTEGRATION_SUI_TARGETS } from "../../lib/hackathon/integration-sui-targets"

const savedEnv = { ...process.env }, savedFetch = globalThis.fetch, savedNow = Date.now
const NOW = Date.parse("2026-09-29T04:00:00Z"), owner = { operationId: "op_sharedstore001", sessionId: "fixture-guide-session" }
let now = NOW, lostInitResponse = false, beforeCommit: (() => void) | null = null, writes = 0
const kv = new Map<string, string>()
function legacy(count = 5) {
  return JSON.stringify({ version: 1, sessions: {}, operations: Object.fromEntries(Array.from({ length: count }, (_, i) => {
    const id = `op_legacybudget0${i}`
    return [id, { operationId: id, sessionId: "old-session", status: "cancelled", phase: "cancelled", createdAt: "2026-09-28T15:30:00Z", updatedAt: "2026-09-28T15:30:00Z", expiresAt: "2026-09-28T16:30:00Z", secrets: { cxToken: "PRIVATE_OLD_TOKEN" } }]
  })), redemptions: {}, outbox: {}, idempotency: {}, nonces: {} })
}
function env() {
  const t = INTEGRATION_SUI_TARGETS["selfhosted-testnet"]
  return { NODE_ENV: "test", HK_ISOLATED_MOCK: "0", NEXT_PUBLIC_HK_INTEGRATION_PREVIEW: "1", HK_INTEGRATION_SUI_TARGET: "selfhosted-testnet",
    HK_INTEGRATION_PREVIEW_ENABLED: "1", HK_INTEGRATION_PREVIEW_EXPIRES_AT: L.maxExpiresAt, NEXT_PUBLIC_HK_HOSTED_SUI: "0", HK_HOSTED_SUI_ENABLED: "0", NEXT_PUBLIC_HK_CX_PREVIEW: "0", NEXT_PUBLIC_HK_PREVIEW_READ_ONLY: "0", HK_MODE_CX: "cx", HK_MODE_OPENDID: "opendid",
    HK_SUI_NETWORK: t.network, HK_SUI_GRPC_URL: t.rpcUrls[0], HK_SUI_PACKAGE_ID: t.packageId, HK_SUI_CAMPAIGN_ID: t.campaignId, HK_SUI_CAMPAIGN_INITIAL_VERSION: t.campaignInitialVersion, HK_SUI_CHAIN_IDENTIFIER: t.chainIdentifier,
    HK_SUI_ISSUER_SECRET_KEY: "fixture_" + "a".repeat(64), HK_SUI_AGENT_SECRET_KEY: "fixture_" + "b".repeat(64),
    UPSTASH_REDIS_REST_URL: "https://fixture-shared-store.upstash.io", UPSTASH_REDIS_REST_TOKEN: "offline-fixture", HK_STORE_KEY: S.targetKey }
}
before(() => {
  Date.now = () => now
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://fixture-shared-store.upstash.io")
    const cmd = JSON.parse(String(init?.body))
    let result: unknown
    if (cmd[0] === "MGET") result = cmd.slice(1).map((k: string) => kv.get(k) ?? null)
    else if (cmd[0] === "SET") { assert.deepEqual(cmd.slice(3), ["NX", "PX", 5000]); result = kv.has(cmd[1]) ? null : "OK"; if (result) kv.set(cmd[1], cmd[2]) }
    else if (cmd[0] === "EVAL") {
      const lua = cmd[1], count = Number(cmd[2]), keys = cmd.slice(3, 3 + count), args = cmd.slice(3 + count)
      if (lua.includes("shared-reservation-initialize")) {
        assert.equal(count, 5)
        result = kv.get(keys[0]) === args[0] && kv.get(keys[3]) === args[1] && kv.get(keys[4]) === args[2] && !kv.has(keys[1]) && !kv.has(keys[2]) ? 1 : 0
        if (result) { kv.set(keys[1], args[3]); kv.set(keys[2], args[4]); writes++; if (lostInitResponse) { lostInitResponse = false; throw new Error("synthetic_lost_response") } }
      } else if (lua.includes("shared-reservation-commit")) {
        assert.equal(count, 5); const hook = beforeCommit; beforeCommit = null; hook?.()
        result = kv.get(keys[0]) === args[0] && kv.get(keys[3]) === args[1] && kv.get(keys[1]) === args[2] && kv.get(keys[2]) === args[3] && kv.get(keys[4]) === args[4] ? 1 : 0
        if (result) { kv.set(keys[1], args[5]); kv.set(keys[2], args[6]); if (args[4] !== args[7]) kv.set(keys[4], args[7]); writes++ }
      } else {
        assert.equal(count, 1); assert.match(lua, /redis.call\('DEL'/)
        result = kv.get(keys[0]) === args[0] ? 1 : 0; if (result) kv.delete(keys[0])
      }
    } else assert.fail("unexpected command")
    return Response.json({ result })
  }
})
beforeEach(() => { for (const k of Object.keys(process.env)) delete process.env[k]; Object.assign(process.env, env()); now = NOW; lostInitResponse = false; beforeCommit = null; writes = 0; kv.clear(); kv.set(S.sourceKey, legacy()) })
after(() => { globalThis.fetch = savedFetch; Date.now = savedNow; for (const k of Object.keys(process.env)) delete process.env[k]; Object.assign(process.env, savedEnv) })
async function add(id = owner.operationId) {
  return withStore(db => {
    claimIntegrationSuiOperation(db, id)
    db.operations[id] = { ...owner, operationId: id, status: "pending", phase: "delegation", createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), expiresAt: L.maxExpiresAt, secrets: {}, audit: [], revision: 1 } as unknown as OperationRecord
    return id
  })
}
test("explicit initialization preserves all source bytes/slots and is idempotent", async () => {
  const before = kv.get(S.sourceKey)
  assert.deepEqual(await initializeIntegrationSharedBudget(), { initialized: true, replayed: false, mode: "shared-reservation" })
  assert.equal(kv.get(S.sourceKey), before); assert.equal(writes, 1)
  assert.equal((await initializeIntegrationSharedBudget()).replayed, true); assert.equal(writes, 1)
  assert.equal((await readIntegrationSuiActivation()).control.version, 2)
  assert.equal(kv.get(S.targetKey)?.includes("PRIVATE_OLD_TOKEN"), false)
})
test("lost initialization response recovers existing state without resetting counters", async () => {
  lostInitResponse = true
  await assert.rejects(initializeIntegrationSharedBudget())
  assert.equal(writes, 1); assert.equal((await initializeIntegrationSharedBudget()).replayed, true)
  await add(); const saved = kv.get(S.targetKey), source = kv.get(S.sourceKey)
  assert.equal((await initializeIntegrationSharedBudget()).replayed, true)
  assert.equal(kv.get(S.targetKey), saved); assert.equal(kv.get(S.sourceKey), source); assert.equal(writes, 2)
})
test("real store reserves source and target atomically; scoped signing reads the reservation", async () => {
  await initializeIntegrationSharedBudget(); await add()
  const source = JSON.parse(kv.get(S.sourceKey)!), target = JSON.parse(kv.get(S.targetKey)!)
  assert.equal(Object.keys(source.operations).length, 6); assert.equal(Object.keys(target.operations).length, 1)
  assert.equal(source.operations[owner.operationId].sessionId, undefined); assert.equal(source.operations[owner.operationId].status, "reserved")
  await withIntegrationSuiAuthorization(owner, () => assertIntegrationSuiAuthorized(owner))
  await assert.rejects(withIntegrationSuiAuthorization({ ...owner, sessionId: "old-session" }, () => assert.fail("wrong owner")))
})
test("concurrent last-slot reservations yield one winner and never exceed combined ten", async () => {
  kv.set(S.sourceKey, legacy(9)); await initializeIntegrationSharedBudget()
  const results = await Promise.allSettled([add("op_lastslotfirst"), add("op_lastslotother")])
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1)
  assert.equal(Object.keys(JSON.parse(kv.get(S.sourceKey)!).operations).length, 10)
  assert.equal(Object.keys(JSON.parse(kv.get(S.targetKey)!).operations).length, 1)
})
test("late legacy write or either lease loss prevents BOTH reservation and target commit", async () => {
  for (const conflict of ["source", "source-lease", "target-lease"]) {
    kv.clear(); kv.set(S.sourceKey, legacy()); await initializeIntegrationSharedBudget()
    const target = kv.get(S.targetKey), control = kv.get(S.controlKey)
    beforeCommit = () => {
      if (conflict === "source") { const db = JSON.parse(kv.get(S.sourceKey)!); db.operations.op_legacylate001 = { ...db.operations.op_legacybudget00, operationId: "op_legacylate001" }; kv.set(S.sourceKey, JSON.stringify(db)) }
      else kv.set(`${conflict === "source-lease" ? S.sourceKey : S.targetKey}:lock`, "new-owner")
    }
    await assert.rejects(add(), { code: "store_lease_lost" })
    assert.equal(kv.get(S.targetKey), target); assert.equal(kv.get(S.controlKey), control)
    assert.equal(JSON.parse(kv.get(S.sourceKey)!).operations[owner.operationId], undefined)
  }
})
test("partial state/missing source and source history deletion refuse without repair", async () => {
  kv.set(S.controlKey, "{}"); await assert.rejects(initializeIntegrationSharedBudget()); assert.equal(writes, 0)
  kv.delete(S.controlKey); kv.delete(S.sourceKey); await assert.rejects(initializeIntegrationSharedBudget()); assert.equal(writes, 0)
  kv.set(S.sourceKey, legacy()); await initializeIntegrationSharedBudget()
  const source = JSON.parse(kv.get(S.sourceKey)!); delete source.operations.op_legacybudget00; kv.set(S.sourceKey, JSON.stringify(source))
  await assert.rejects(readIntegrationSuiActivation(), { code: "integration_shared_budget" }); await assert.rejects(initializeIntegrationSharedBudget())
  assert.equal(writes, 1)
})
test("callback cannot replace shared metadata, expire scope or remove a charged operation ID", async () => {
  await initializeIntegrationSharedBudget(); await add(); const target = kv.get(S.targetKey), source = kv.get(S.sourceKey)
  await assert.rejects(withStore(db => { db.integrationSharedBudget!.operationIds = [] }))
  await assert.rejects(withStore(db => { delete db.integrationSharedBudget }))
  await assert.rejects(withStore(() => { now = L.maxEnd }), { code: "integration_sui_scope" })
  assert.equal(kv.get(S.targetKey), target); assert.equal(kv.get(S.sourceKey), source)
})
