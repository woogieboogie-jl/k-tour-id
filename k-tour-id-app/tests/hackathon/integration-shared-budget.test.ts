import assert from "node:assert/strict"
import test from "node:test"
import { SHARED_BUDGET_SCOPE as S, initialSharedBudgetState, parseSharedBudgetSource, assertSharedBudgetState, claimSharedOperation, nextSharedBudgetState,
  assertSharedBudgetMonotonic, SHARED_BUDGET_COMMIT_LUA, SHARED_BUDGET_INITIALIZE_LUA } from "../../lib/hackathon/integration-shared-budget"
import { INTEGRATION_SUI_LIMITS, claimIntegrationSuiOperation, assertIntegrationSuiOperation } from "../../lib/hackathon/integration-sui-limits"
import { parseStoredJourney } from "../../lib/hackathon/store-integrity"

const NOW = Date.parse("2026-09-29T04:00:00Z"), createdAt = "2026-09-28T15:20:00Z", opId = "op_sharedfixture01"
function source(count = 5) {
  return JSON.stringify({ version: 1, sessions: { old: { subjectRef: "PRIVATE_OLD_PERSON" } }, operations: Object.fromEntries(Array.from({ length: count }, (_, i) => {
    const id = `op_oldhosted000${i}`
    return [id, { operationId: id, sessionId: "old", status: ["cancelled", "failed", "expired", "pending"][i % 4], phase: "fulfillment", createdAt, updatedAt: createdAt,
      expiresAt: "2026-09-28T16:20:00Z", secrets: { vcDocument: "PRIVATE_OLD_VC" } }]
  })), redemptions: {}, outbox: {}, idempotency: {}, nonces: {} })
}
function newOperation(id = opId) { return { operationId: id, sessionId: "PRIVATE_NEW_SESSION", status: "pending", phase: "identity", createdAt: new Date(NOW).toISOString(), expiresAt: S.expiresAt, secrets: { vcDocument: "PRIVATE_NEW_VC" } } }
test("compatible initialization copies no private source records and spends no slot", () => {
  const raw = source(), state = initialSharedBudgetState(raw, NOW)
  assert.equal(S.expiresAt, INTEGRATION_SUI_LIMITS.maxExpiresAt)
  assert.equal(S.targetKey, INTEGRATION_SUI_LIMITS.storeKey)
  assert.equal(S.maxOperations, INTEGRATION_SUI_LIMITS.maxOperations)
  assert.equal(S.gasBudgetMIST, INTEGRATION_SUI_LIMITS.gasBudgetMIST)
  assert.equal(state.control.sourceOperationIds.length, 5); assert.equal(state.control.operationIds.length, 0)
  assert.equal(JSON.stringify(state).includes("PRIVATE_"), false); assert.equal(Object.keys(state.db.operations).length, 0)
  assertSharedBudgetState(state.db, state.control, raw, NOW)
  assert.doesNotThrow(() => parseStoredJourney(JSON.stringify(state.db)))
})
test("old and new operations share the exact same ten slots, including failed/cancelled", () => {
  let raw = source(), state = initialSharedBudgetState(raw, NOW)
  for (let i = 0; i < 5; i++) {
    const next = structuredClone(state.db), id = `op_newshared000${i}`
    claimIntegrationSuiOperation(next, id); (next.operations as Record<string, unknown>)[id] = newOperation(id)
    const made = nextSharedBudgetState(state.db, state.control, raw, next, NOW + i)
    raw = made.sourceRaw; state = { db: next, control: made.control }
    assertIntegrationSuiOperation(next, id)
  }
  assert.equal(Object.keys(JSON.parse(raw).operations).length, 10)
  const overflow = structuredClone(state.db); claimSharedOperation(overflow, "op_overflowshared"); (overflow.operations as Record<string, unknown>).op_overflowshared = newOperation("op_overflowshared")
  assert.throws(() => nextSharedBudgetState(state.db, state.control, raw, overflow, NOW + 10), { code: "integration_sui_limit" })
})
test("reservation is inaccessible to a legacy session and survives legacy prune until expiry", () => {
  const raw = source(), state = initialSharedBudgetState(raw, NOW), next = structuredClone(state.db)
  claimSharedOperation(next, opId); (next.operations as Record<string, unknown>)[opId] = newOperation()
  const result = nextSharedBudgetState(state.db, state.control, raw, next, NOW), row = JSON.parse(result.sourceRaw).operations[opId]
  assert.equal(row.sessionId, undefined); assert.equal(row.secrets, undefined); assert.equal(row.identity, undefined); assert.equal(row.status, "reserved")
  for (const session of ["old", "PRIVATE_NEW_SESSION", "", "budget_reservation_unowned"]) assert.equal(row.sessionId === session, false)
  assert.equal(row.status === "pending", false)
  assert.equal(Date.parse(row.updatedAt) < Date.parse(S.expiresAt) - S.retentionMs, false)
  assert.equal(result.sourceRaw.includes("PRIVATE_NEW_"), false)
  assert.equal(JSON.parse(result.sourceRaw).sessions.PRIVATE_NEW_SESSION, undefined)
  assert.deepEqual(JSON.parse(result.sourceRaw).operations.op_oldhosted0000, JSON.parse(raw).operations.op_oldhosted0000)
})
test("a legitimate legacy allocation between guide requests is allowed and charged", () => {
  const raw = source(9), state = initialSharedBudgetState(raw, NOW), legacy = JSON.parse(raw)
  legacy.operations.op_legacynew0001 = { ...legacy.operations.op_oldhosted0000, operationId: "op_legacynew0001" }
  const changed = JSON.stringify(legacy)
  assertSharedBudgetState(state.db, state.control, changed, NOW)
  const next = structuredClone(state.db); claimSharedOperation(next, opId); (next.operations as Record<string, unknown>)[opId] = newOperation()
  assert.throws(() => nextSharedBudgetState(state.db, state.control, changed, next, NOW), { code: "integration_sui_limit" })
})
test("missing source, corrupt dates, premature pruning, over-budget and foreign migration refuse", () => {
  for (const raw of [null, "{}", source(0), source(11)]) assert.throws(() => parseSharedBudgetSource(raw, NOW))
  for (const patch of [{ createdAt: "2026-09-20T00:00:00Z" }, { updatedAt: "2026-09-20T00:00:00Z" }, { updatedAt: "2099-01-01T00:00:00Z" }, { journey: { kind: "guide" } }]) {
    const db = JSON.parse(source()); Object.assign(db.operations.op_oldhosted0000, patch)
    assert.throws(() => parseSharedBudgetSource(JSON.stringify(db), NOW))
  }
  const db = JSON.parse(source()); db.integrationCutover = {}
  assert.throws(() => parseSharedBudgetSource(JSON.stringify(db), NOW))
  assert.throws(() => initialSharedBudgetState(source(), Date.parse(S.expiresAt)))
})
test("source row deletion or orphan reservation is a hard error, never a refund", () => {
  const raw = source(), state = initialSharedBudgetState(raw, NOW), next = structuredClone(state.db)
  claimSharedOperation(next, opId); (next.operations as Record<string, unknown>)[opId] = newOperation()
  const made = nextSharedBudgetState(state.db, state.control, raw, next, NOW)
  const broken = JSON.parse(made.sourceRaw); delete broken.operations.op_oldhosted0000
  assert.throws(() => assertSharedBudgetState(next, made.control, JSON.stringify(broken), NOW))
  assert.throws(() => initialSharedBudgetState(made.sourceRaw, NOW))
  assert.throws(() => assertSharedBudgetState(state.db, state.control, made.sourceRaw, NOW))
})
test("target rollback/deletion, metadata changes, copied markers and source ID collisions refuse", () => {
  const raw = source(), state = initialSharedBudgetState(raw, NOW), next = structuredClone(state.db)
  claimSharedOperation(next, opId); (next.operations as Record<string, unknown>)[opId] = newOperation()
  const made = nextSharedBudgetState(state.db, state.control, raw, next, NOW)
  assert.throws(() => assertSharedBudgetState(state.db, made.control, made.sourceRaw, NOW))
  const reset = structuredClone(next); reset.integrationSharedBudget.operationIds = []
  assert.throws(() => assertSharedBudgetMonotonic(next.integrationSharedBudget, reset))
  const tampered = structuredClone(next); (tampered.integrationSharedBudget as { expiresAt: string }).expiresAt = "2099-01-01T00:00:00Z"
  assert.throws(() => assertSharedBudgetMonotonic(next.integrationSharedBudget, tampered))
  assert.throws(() => assertSharedBudgetMonotonic(undefined, state.db))
  const collision = structuredClone(state.db); claimSharedOperation(collision, "op_oldhosted0000"); (collision.operations as Record<string, unknown>).op_oldhosted0000 = newOperation("op_oldhosted0000")
  assert.throws(() => nextSharedBudgetState(state.db, state.control, raw, collision, NOW))
})
test("existing target updates preserve source bytes exactly; no re-reservation or extra slot", () => {
  const raw = source(), state = initialSharedBudgetState(raw, NOW), next = structuredClone(state.db)
  claimSharedOperation(next, opId); (next.operations as Record<string, unknown>)[opId] = newOperation()
  const made = nextSharedBudgetState(state.db, state.control, raw, next, NOW), changed = structuredClone(next)
  ;(changed.operations as Record<string, ReturnType<typeof newOperation>>)[opId].status = "cancelled"
  const updated = nextSharedBudgetState(next, made.control, made.sourceRaw, changed, NOW + 1)
  assert.equal(updated.sourceRaw, made.sourceRaw); assert.equal(updated.control.operationIds.length, 1)
  assert.equal(updated.control.sequence, 2)
})
test("fixed Lua only CAS-initializes empty target/control and never clears source or counters", () => {
  assert.match(SHARED_BUDGET_COMMIT_LUA, /KEYS\[4\].*ARGV\[2\]/)
  assert.match(SHARED_BUDGET_COMMIT_LUA, /KEYS\[5\].*ARGV\[5\]/)
  assert.match(SHARED_BUDGET_INITIALIZE_LUA, /EXISTS.*KEYS\[2\]/)
  assert.equal(SHARED_BUDGET_INITIALIZE_LUA.includes("SET',KEYS[5]"), false)
  for (const lua of [SHARED_BUDGET_COMMIT_LUA, SHARED_BUDGET_INITIALIZE_LUA]) assert.doesNotMatch(lua, /DEL|UNLINK|FLUSH|EXPIRE/)
})
