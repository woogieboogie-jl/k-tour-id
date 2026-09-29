import assert from "node:assert/strict"
import test from "node:test"
import { CUTOVER_SCOPE as P, CUTOVER_PREPARE_LUA, CUTOVER_COMMIT_LUA, verifyWriterFence, observeHostedLedger,
  prepareCutover, provisionCutover, assertCommittedCutover, assertIntegrationCutoverMonotonic, nextCutoverControl,
  unavailableCutoverAuthority, cutoverDigest, type AuthenticatedCutoverReadPort, type HostedLedgerReadPort, type CutoverAtomicPort,
  type CutoverDb, type IntegrationCutoverControl } from "../../lib/hackathon/integration-cutover"
import { assertIntegrationSuiActivation, claimIntegrationSuiOperation, INTEGRATION_SUI_LIMITS as LIMIT } from "../../lib/hackathon/integration-sui-limits"

const NOW = Date.parse("2026-09-29T04:00:00Z"), disabledAt = new Date(NOW - 3600_000).toISOString()
const digest = (n: string) => "0x" + n.repeat(64)
const initialIds = ["op_cancelledprior1", "op_failedprior001", "op_pendingprior01", "op_prunedprior001"]
function source() {
  return { version: 1, sessions: {}, operations: {
    [initialIds[0]]: { operationId: initialIds[0], status: "cancelled", secrets: {} },
    [initialIds[1]]: { operationId: initialIds[1], status: "failed", secrets: {} },
    [initialIds[2]]: { operationId: initialIds[2], status: "pending", phase: "identity", secrets: {} },
  }, redemptions: {}, outbox: {}, idempotency: {}, nonces: {} }
}
function authority(): AuthenticatedCutoverReadPort {
  const project = P.project, team = P.team
  return {
    async principal() { return { account: P.account, project, team } },
    async deployments(cursor) { return { project, team, snapshotId: "snapshot_version01", total: 2,
      ids: [cursor ? "dpl_immutable0002" : "dpl_immutable0001"], next: cursor ? null : "page_2" } },
    async disabled(deploymentId) { return { project, team, deploymentId, disabledAt, invocationBoundMs: 60_000,
      mechanism: "immutable-execution-revoked", controlReceiptDigest: digest("a") } },
    async futureWriters() { return { project, team, mechanism: "legacy-writer-creation-denied", policyEpoch: "policy_epoch_01",
      enforcedAt: disabledAt, controlReceiptDigest: digest("b") } },
  }
}
function harness() {
  let now = NOW
  const values = new Map<string, string>([[P.sourceKey, JSON.stringify(source())]])
  const reads: HostedLedgerReadPort = {
    async readSource() { return { key: P.sourceKey, raw: values.get(P.sourceKey)!, locked: values.has(`${P.sourceKey}:lock`) } },
    async readLifetimeAllocation() { return { key: P.sourceKey, operationIds: [...initialIds], auditDigest: digest("d") } },
  }
  let writes = 0, loseCommitResponse = false
  // Synthetic atomic Redis transport. All side effects stay in this Map. These
  // tests verify protocol behavior, not a claim that real Redis EVAL was run.
  const atomic: CutoverAtomicPort = {
    async eval(script, keys, args) {
      assert.deepEqual(keys, [P.sourceKey, `${P.sourceKey}:lock`, P.targetKey, `${P.targetKey}:lock`, P.controlKey])
      if (values.get(keys[0]) !== args[0] || values.has(keys[1]) || values.has(keys[3])) return "source_changed"
      const c = values.get(keys[4]), t = values.get(keys[2])
      if (script === CUTOVER_PREPARE_LUA) {
        if (c) return c === args[1] ? "already_prepared" : "control_exists"
        if (t !== undefined) return "target_exists"
        values.set(keys[4], args[1]); writes++; return "prepared"
      }
      assert.equal(script, CUTOVER_COMMIT_LUA)
      if (c === args[3] && t === args[2]) return "already_committed"
      if (c !== args[1]) return "control_changed"
      if (t !== undefined) return "target_exists"
      values.set(keys[2], args[2]); values.set(keys[4], args[3]); writes++
      if (loseCommitResponse) throw new Error("synthetic response lost")
      return "committed"
    },
  }
  return { values, reads, atomic, clock: () => now, advance: (ms: number) => { now += ms },
    loseCommit: () => { loseCommitResponse = true }, writes: () => writes,
    async plan() {
      const fence = await verifyWriterFence(authority(), () => now), first = await observeHostedLedger(reads, fence, () => now)
      now += P.observationGapMs
      const second = await observeHostedLedger(reads, fence, () => now)
      return prepareCutover(fence, first, second, now)
    },
    db: () => JSON.parse(values.get(P.targetKey)!) as CutoverDb,
    control: () => JSON.parse(values.get(P.controlKey)!) as IntegrationCutoverControl,
  }
}
const refused = (code = "integration_cutover_unverified") => ({ code })

test("no attestor, client JSON, env flags or budget-only JSON can activate or mint a plan", async () => {
  assert.throws(unavailableCutoverAuthority, refused("integration_cutover_authority_unavailable"))
  assert.throws(() => assertIntegrationSuiActivation(), { code: "integration_sui_migration_required" })
  await assert.rejects(verifyWriterFence({ authenticated: true } as never, () => NOW), refused())
  assert.throws(() => prepareCutover({ authenticated: true } as never, {} as never, {} as never, NOW), refused())
  const h = harness(), plan = await h.plan()
  await assert.rejects(provisionCutover(JSON.parse(JSON.stringify(plan)), "prepare", h.atomic, h.clock()), refused())
  assert.equal(h.writes(), 0)
})

test("exhaustive authenticated inventory and future-creation policy are both required", async () => {
  const mutations: Array<(a: AuthenticatedCutoverReadPort) => void> = [
    a => { a.principal = async () => ({ account: "other", project: P.project, team: P.team }) },
    a => { const fn = a.deployments; a.deployments = async (...args) => ({ ...await fn(...args), total: 3 }) },
    a => { const fn = a.deployments; a.deployments = async (...args) => ({ ...await fn(...args), ids: ["dpl_immutable0001"] }) },
    a => { const fn = a.deployments; a.deployments = async (...args) => ({ ...await fn(...args), next: "forever" }) },
    a => { const fn = a.disabled; a.disabled = async (...args) => ({ ...await fn(...args), mechanism: "alias-removed" as never }) },
    a => { const fn = a.disabled; a.disabled = async (...args) => ({ ...await fn(...args), invocationBoundMs: 0 }) },
    a => { const fn = a.disabled; a.disabled = async (...args) => ({ ...await fn(...args), invocationBoundMs: P.maxInvocationMs + 1 }) },
    a => { const fn = a.futureWriters; a.futureWriters = async (...args) => ({ ...await fn(...args), mechanism: "env-disabled" as never }) },
  ]
  for (const mutate of mutations) { const a = authority(); mutate(a); await assert.rejects(verifyWriterFence(a, () => NOW), refused()) }
})

test("inventory drift, policy drift, future timestamps and unfinished invocation drain fail", async () => {
  const inventory = authority(); let lists = 0; const get = inventory.deployments
  inventory.deployments = async (...args) => { const r = await get(...args); if (++lists > 2) r.ids = [r.ids[0] + "new"]; return r }
  await assert.rejects(verifyWriterFence(inventory, () => NOW), refused())
  const policy = authority(); let policyReads = 0; const future = policy.futureWriters
  policy.futureWriters = async (...args) => ({ ...await future(...args), policyEpoch: ++policyReads === 1 ? "policy_epoch_01" : "policy_epoch_02" })
  await assert.rejects(verifyWriterFence(policy, () => NOW), refused())
  for (const at of [NOW + 1, NOW - 1000]) {
    const a = authority(), fn = a.disabled
    a.disabled = async (...args) => ({ ...await fn(...args), disabledAt: new Date(at).toISOString() })
    await assert.rejects(verifyWriterFence(a, () => NOW), refused())
  }
})

test("lifetime accounting preserves cancelled, failed, pending AND pruned slots", async () => {
  const h = harness(), plan = await h.plan(), beforeSource = h.values.get(P.sourceKey)
  assert.deepEqual(plan.marker.priorHostedOperationIds, [...initialIds].sort())
  await provisionCutover(plan, "prepare", h.atomic, h.clock())
  assert.equal(h.values.has(P.targetKey), false, "prepare does not open/create the destination")
  assert.throws(() => assertCommittedCutover({ operations: {} }, h.control(), h.clock()), refused())
  await provisionCutover(plan, "commit", h.atomic, h.clock())
  assert.equal(h.values.get(P.sourceKey), beforeSource, "never poison/delete/rewrite old history")
  const db = h.db(); assertIntegrationSuiActivation(db, h.control(), h.clock())
  for (let i = 0; i < 6; i++) claimIntegrationSuiOperation(db, `op_newoperation00${i}`)
  assert.throws(() => claimIntegrationSuiOperation(db, "op_eleventhtotal1"), { code: "integration_sui_limit" })
  assert.equal(db.integrationSuiBudget!.maxOperations, 10)
  assert.equal(db.integrationSuiBudget!.gasBudgetMIST, 10_000_000)
  assert.equal(LIMIT.maxTotalGasMIST, 300_000_000)
})

test("missing/changed allocation history, corrupt source and unresolved claims fail without writes", async () => {
  for (const mutate of [
    (h: ReturnType<typeof harness>) => { h.reads.readLifetimeAllocation = async () => ({ key: P.sourceKey, operationIds: initialIds.slice(1), auditDigest: digest("d") }) },
    h => { h.values.set(P.sourceKey, "broken JSON") },
    h => { h.values.set(`${P.sourceKey}:lock`, "another-owner") },
    h => { const s = source(); s.operations[initialIds[2]].secrets = { delegationPreparation: { stage: "unknown" } } as never; h.values.set(P.sourceKey, JSON.stringify(s)) },
    h => { const s = source(); Object.assign(s.operations[initialIds[2]], { agent: { status: "queued" } }); h.values.set(P.sourceKey, JSON.stringify(s)) },
    h => { const s = source(); Object.assign(s.operations[initialIds[2]], { delegation: { status: "prepared" } }); h.values.set(P.sourceKey, JSON.stringify(s)) },
    h => { const s = source(); s.outbox = { unresolved: { status: "submitted" } }; h.values.set(P.sourceKey, JSON.stringify(s)) },
  ] satisfies Array<(h: ReturnType<typeof harness>) => void>) {
    const h = harness(); mutate(h); await assert.rejects(h.plan(), refused()); assert.equal(h.writes(), 0)
  }
})

test("two observations must be stable, separated and from trusted reads", async () => {
  const h = harness(), fence = await verifyWriterFence(authority(), h.clock)
  const first = await observeHostedLedger(h.reads, fence, h.clock)
  assert.throws(() => prepareCutover(fence, first, first, h.clock()), refused())
  h.advance(P.observationGapMs)
  h.values.set(P.sourceKey, h.values.get(P.sourceKey)! + " ")
  const second = await observeHostedLedger(h.reads, fence, h.clock)
  assert.throws(() => prepareCutover(fence, first, second, h.clock()), refused())
  assert.throws(() => prepareCutover(fence, first, JSON.parse(JSON.stringify(second)), h.clock()), refused())
})

test("CAS rejects late source writes, held locks, occupied target and conflicting prepared state", async () => {
  for (const mutate of [
    (h: ReturnType<typeof harness>) => { h.values.set(P.sourceKey, h.values.get(P.sourceKey)! + " ") },
    h => { h.values.set(`${P.sourceKey}:lock`, "owner") },
    h => { h.values.set(`${P.targetKey}:lock`, "owner") },
    h => { h.values.set(P.targetKey, "occupied-do-not-overwrite") },
    h => { h.values.set(P.controlKey, "existing-do-not-reset") },
  ] satisfies Array<(h: ReturnType<typeof harness>) => void>) {
    const h = harness(), plan = await h.plan(); mutate(h)
    const before = [...h.values]; await assert.rejects(provisionCutover(plan, "prepare", h.atomic, h.clock()), refused("integration_cutover_conflict"))
    assert.deepEqual([...h.values], before)
  }
  const h = harness(), plan = await h.plan(); await provisionCutover(plan, "prepare", h.atomic, h.clock())
  h.values.set(P.sourceKey, h.values.get(P.sourceKey)! + " ")
  await assert.rejects(provisionCutover(plan, "commit", h.atomic, h.clock()), refused("integration_cutover_conflict"))
  assert.equal(h.values.has(P.targetKey), false)
  assert.equal(h.control().phase, "prepared")
})

test("competing operators have only one preparation and one commit; exact replay is idempotent", async () => {
  const h = harness(), plan = await h.plan()
  assert.deepEqual((await Promise.all([provisionCutover(plan, "prepare", h.atomic, h.clock()), provisionCutover(plan, "prepare", h.atomic, h.clock())])).map(r => r.status).sort(), ["already_prepared", "prepared"])
  assert.deepEqual((await Promise.all([provisionCutover(plan, "commit", h.atomic, h.clock()), provisionCutover(plan, "commit", h.atomic, h.clock())])).map(r => r.status).sort(), ["already_committed", "committed"])
  assert.equal(h.writes(), 2)
})

test("lost commit response preserves committed state; fresh restart evidence recovers exactly once", async () => {
  const h = harness(), original = await h.plan(); await provisionCutover(original, "prepare", h.atomic, h.clock())
  h.loseCommit(); await assert.rejects(provisionCutover(original, "commit", h.atomic, h.clock()), refused("integration_cutover_outcome_unknown"))
  assert.equal(h.control().phase, "committed")
  // No WeakSet token is serialized/reused. Restart-like planning re-verifies all facts.
  const fresh = await h.plan(); assert.deepEqual(fresh.marker, original.marker)
  assert.equal((await provisionCutover(fresh, "commit", h.atomic, h.clock())).status, "already_committed")
  assert.equal(h.writes(), 2)
  assertCommittedCutover(JSON.parse(JSON.stringify(h.db())), JSON.parse(JSON.stringify(h.control())), h.clock())
})

test("prepared partial state, deletion, reset, rollback and tampered baseline never activate", async () => {
  const h = harness(), plan = await h.plan(); await provisionCutover(plan, "prepare", h.atomic, h.clock()); await provisionCutover(plan, "commit", h.atomic, h.clock())
  const db = h.db(), control = h.control()
  for (const mutate of [
    (d: CutoverDb) => { delete d.integrationCutover },
    d => { delete d.integrationSuiBudget },
    d => { d.integrationSuiBudget!.priorHostedOperationIds.pop() },
    d => { d.integrationCutover!.sourceLedgerSha256 = digest("f") },
    d => { d.integrationSuiBudget!.maxOperations = 11 },
  ] satisfies Array<(d: CutoverDb) => void>) {
    const changed = structuredClone(db); mutate(changed)
    assert.throws(() => assertCommittedCutover(changed, control, h.clock()))
  }
  assert.throws(() => assertCommittedCutover(db, undefined, h.clock()))
  assert.throws(() => assertCommittedCutover(db, { ...control, phase: "prepared" }, h.clock()))
  const changed = structuredClone(db); claimIntegrationSuiOperation(changed, "op_retainedlater01")
  const next = nextCutoverControl(db, control, changed, h.clock()); assertCommittedCutover(changed, next, h.clock())
  assert.throws(() => assertCommittedCutover(db, next, h.clock()), refused(), "ledger-only rollback is refused by independent high watermark")
  assert.throws(() => nextCutoverControl(changed, next, db, h.clock()), refused())
  assert.throws(() => assertIntegrationCutoverMonotonic(undefined, changed), refused(), "ordinary store write cannot create marker")
})

test("expired evidence, mutated plan, deadline and expiry cannot be waived", async () => {
  const h = harness(), plan = await h.plan(); h.advance(P.proofTtlMs + 1)
  await assert.rejects(provisionCutover(plan, "prepare", h.atomic, h.clock()), refused())
  const modified = harness(), another = await modified.plan(); another.marker.priorHostedOperationIds.pop()
  await assert.rejects(provisionCutover(another, "prepare", modified.atomic, modified.clock()), refused())
  const a = authority(); let tick = NOW
  await assert.rejects(verifyWriterFence(a, () => { tick += 5000; return tick }), refused())
  const ready = harness(), good = await ready.plan(); await provisionCutover(good, "prepare", ready.atomic, ready.clock()); await provisionCutover(good, "commit", ready.atomic, ready.clock())
  for (const now of [NaN, LIMIT.maxEnd, LIMIT.maxEnd + 1]) assert.throws(() => assertIntegrationSuiActivation(ready.db(), ready.control(), now))
})

test("JSON persistence omits optional undefined fields without digest drift; source secrets never enter target", async () => {
  assert.equal(cutoverDigest({ a: 1, optional: undefined }), cutoverDigest({ a: 1 }))
  const h = harness(), s = source(); Object.assign(s.operations[initialIds[1]].secrets, { syntheticPrivateMarker: "DO_NOT_COPY" }); h.values.set(P.sourceKey, JSON.stringify(s))
  const plan = await h.plan(); await provisionCutover(plan, "prepare", h.atomic, h.clock()); await provisionCutover(plan, "commit", h.atomic, h.clock())
  assert.equal(h.values.get(P.targetKey)!.includes("DO_NOT_COPY"), false)
  assert.equal(h.values.get(P.controlKey)!.includes("DO_NOT_COPY"), false)
})

test("Lua commands are fixed-key compare-and-write only; no source mutation, deletes or TTL rollback", () => {
  for (const script of [CUTOVER_PREPARE_LUA, CUTOVER_COMMIT_LUA]) {
    assert.doesNotMatch(script, /\bDEL\b|\bEXPIRE\b|\bFLUSH|redis\.call\('SET',KEYS\[1\]/)
    assert.match(script, /redis\.call\('GET',KEYS\[1\]\)~=ARGV\[1\]/)
  }
})
