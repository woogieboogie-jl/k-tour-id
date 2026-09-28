// Actual durable store, synthetic Redis protocol only; no remote credentials/I/O.
import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { integrationSuiBudgetTemplate, claimIntegrationSuiOperation } from "../../lib/hackathon/integration-sui-limits"
import { withStore, readStore, type OperationRecord } from "../../lib/hackathon/store"

const originalEnv = { ...process.env }, originalFetch = globalThis.fetch
const initialBudget = integrationSuiBudgetTemplate({ priorHostedOperationIds: ["op_hostedbaseline1", "op_hostedbaseline2"], hostedLedgerSha256: "0x" + "a".repeat(64), hostedWritesDisabledAt: "2026-09-28T12:00:00Z" })
let stored = JSON.stringify({ version: 1, sessions: {}, operations: {}, redemptions: {}, outbox: {}, idempotency: {}, nonces: {}, integrationSuiBudget: initialBudget })
let lock: string | null = null, writes = 0, unexpected = 0
before(() => {
  for (const key of Object.keys(process.env)) delete process.env[key]
  // Generic fixture backend exercises journal persistence, not activation.
  Object.assign(process.env, { NODE_ENV: "test", HK_ISOLATED_MOCK: "0", UPSTASH_REDIS_REST_URL: "https://fixture-redis.invalid", UPSTASH_REDIS_REST_TOKEN: "offline-fixture", HK_STORE_KEY: "offline-fixture" })
  globalThis.fetch = async (input, init) => {
    if (String(input) !== "https://fixture-redis.invalid") { unexpected++; throw new Error("unexpected_network") }
    const cmd = JSON.parse(String(init?.body)) as Array<string | number>
    let result: unknown
    if (cmd[0] === "SET" && cmd[3] === "NX") { lock = String(cmd[2]); result = "OK" }
    else if (cmd[0] === "GET") result = stored
    else if (cmd[0] === "EVAL" && cmd[2] === 2) { result = lock === cmd[5] ? 1 : 0; if (result === 1) { stored = String(cmd[6]); writes++ } }
    else if (cmd[0] === "EVAL" && cmd[2] === 1) { result = lock === cmd[4] ? 1 : 0; if (result === 1) lock = null }
    else { unexpected++; throw new Error("unexpected_redis_command") }
    return Response.json({ result })
  }
})
after(() => { globalThis.fetch = originalFetch; for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, originalEnv); assert.equal(unexpected, 0) })

test("durable budget survives operation pruning and reload; eight remaining slots exhaust the shared ten", async () => {
  for (let i = 0; i < 8; i++) await withStore(db => {
    const id = `op_integrationfixture${i}`
    claimIntegrationSuiOperation(db, id)
    db.operations[id] = { operationId: id, status: "cancelled", updatedAt: "2000-01-01T00:00:00Z", expiresAt: "2000-01-01T00:00:00Z", secrets: {} } as OperationRecord
  })
  const saved = JSON.parse(stored)
  assert.deepEqual(saved.operations, {})
  assert.equal(saved.integrationSuiBudget.operationIds.length, 8)
  assert.deepEqual(saved.integrationSuiBudget.priorHostedOperationIds, initialBudget.priorHostedOperationIds)
  assert.equal(await readStore(db => db.integrationSuiBudget!.operationIds.length), 8)
  const before = stored, beforeWrites = writes
  await assert.rejects(withStore(db => claimIntegrationSuiOperation(db, "op_excessoperation1")), { code: "integration_sui_limit" })
  assert.equal(stored, before); assert.equal(writes, beforeWrites)
})

test("deleting the budget, removing consumed IDs or changing baseline cannot commit or leak into cache", async () => {
  for (const mutate of [
    (db: Parameters<Parameters<typeof withStore>[0]>[0]) => { delete db.integrationSuiBudget },
    (db: Parameters<Parameters<typeof withStore>[0]>[0]) => { db.integrationSuiBudget!.operationIds = [] },
    (db: Parameters<Parameters<typeof withStore>[0]>[0]) => { db.integrationSuiBudget!.priorHostedOperationIds.pop() },
    (db: Parameters<Parameters<typeof withStore>[0]>[0]) => { db.integrationSuiBudget!.hostedLedgerSha256 = "0x" + "b".repeat(64) },
  ]) {
    const before = stored, beforeWrites = writes
    await assert.rejects(withStore(mutate), { code: "integration_sui_budget" })
    assert.equal(stored, before); assert.equal(writes, beforeWrites)
    assert.equal(await readStore(db => db.integrationSuiBudget!.operationIds.length), 8)
  }
})
