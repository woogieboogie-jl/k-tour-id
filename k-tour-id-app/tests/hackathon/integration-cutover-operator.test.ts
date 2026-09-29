import assert from "node:assert/strict"
import test from "node:test"
import { execFileSync, spawnSync } from "node:child_process"
import { createCutoverRedisOperator } from "../../lib/hackathon/integration-cutover-operator"
import { CUTOVER_SCOPE as S, CUTOVER_PREPARE_LUA, CUTOVER_COMMIT_LUA, verifyWriterFence, observeHostedLedger, prepareCutover } from "../../lib/hackathon/integration-cutover"

const connection = { url: "https://synthetic-cutover.upstash.io", token: "synthetic-only-no-live-credential" }
const audit = async () => ({ key: S.sourceKey, operationIds: ["op_failedhistory1"], auditDigest: "0x" + "1".repeat(64) })
function fixture(values: unknown[] = ["synthetic-source", null]) {
  const requests: Array<{ url: string; command: unknown }> = []
  const fetchImpl: typeof fetch = async (url, options) => {
    requests.push({ url: String(url), command: JSON.parse(String(options?.body)) })
    return new Response(JSON.stringify({ result: values }))
  }
  return { requests, operator: createCutoverRedisOperator({ connection, allocationAudit: audit, fetchImpl }) }
}
test("operator construction is offline and exports no raw commands or connection", () => {
  const f = fixture(); assert.equal(f.requests.length, 0)
  assert.deepEqual(Object.keys(f.operator).sort(), ["inspect", "ledger", "provision"])
  assert.doesNotMatch(JSON.stringify(f.operator), /synthetic-only|upstash/)
  for (const url of ["http://synthetic-cutover.upstash.io", "https://example.com", "https://x.upstash.io.evil.example", "https://x.upstash.io/?token=leak", "https://user:secret@x.upstash.io", "https://x.upstash.io:44", "https://x.upstash.io/path"]) {
    assert.throws(() => createCutoverRedisOperator({ connection: { ...connection, url }, allocationAudit: audit }), { code: "integration_cutover_operator_configuration" })
  }
  assert.throws(() => createCutoverRedisOperator({ connection, allocationAudit: undefined as never }), { code: "integration_cutover_operator_configuration" })
})
test("source read is fixed-key MGET; independent historical audit is retained", async () => {
  const f = fixture(), signal = new AbortController().signal
  assert.deepEqual(await f.operator.ledger.readSource(signal), { key: S.sourceKey, raw: "synthetic-source", locked: false })
  assert.deepEqual(f.requests, [{ url: connection.url, command: ["MGET", S.sourceKey, `${S.sourceKey}:lock`] }])
  assert.deepEqual(await f.operator.ledger.readLifetimeAllocation(signal), await audit())
  assert.equal(f.requests.length, 1)
  assert.equal((await fixture(["synthetic-source", "another-owner"]).operator.ledger.readSource(signal)).locked, true)
})
test("forged plan and invalid source cannot produce Redis mutation", async () => {
  const f = fixture()
  await assert.rejects(f.operator.provision({ marker: {} } as never, "commit"), { code: "integration_cutover_unverified" })
  assert.equal(f.requests.length, 0)
  for (const values of [[null, null], ["raw", 1], ["raw"], ["x".repeat(S.sourceMaxBytes + 1), null]]) {
    await assert.rejects(fixture(values).operator.ledger.readSource(new AbortController().signal), { code: "integration_cutover_operator_configuration" })
  }
})
test("recovery is read-only, rejects partial state, and never repairs keys", async () => {
  const f = fixture(["raw", null, null])
  assert.deepEqual(await f.operator.inspect(new AbortController().signal), { phase: "unprepared" })
  assert.deepEqual(f.requests[0].command, ["MGET", S.sourceKey, S.targetKey, S.controlKey])
  for (const values of [["raw", "target", null], ["raw", null, "bad"], ["raw", null, "{}"]]) {
    const bad = fixture(values)
    await assert.rejects(bad.operator.inspect(new AbortController().signal))
    assert.equal(bad.requests.length, 1)
    assert.equal((bad.requests[0].command as string[])[0], "MGET")
  }
})
test("aborted reads do not send requests and upstream errors never leak responses", async () => {
  const f = fixture(), abort = new AbortController(); abort.abort()
  await assert.rejects(f.operator.ledger.readSource(abort.signal))
  assert.equal(f.requests.length, 0)
  const operator = createCutoverRedisOperator({ connection, allocationAudit: audit,
    fetchImpl: async () => { throw new Error("do-not-log-this-secret") } })
  await assert.rejects(operator.ledger.readSource(new AbortController().signal), error => {
    assert.doesNotMatch(String(error), /do-not-log|synthetic-only/); return true
  })
})
test("offline helper only prints requirements and rejects mutation or JSON proof", () => {
  const script = "scripts/hackathon-integration-cutover.ts"
  const info = JSON.parse(execFileSync(process.execPath, ["--import", "tsx", script, "--requirements"], { encoding: "utf8" }))
  assert.equal(info.runtimeActivated, false); assert.equal(info.sharedLimits.operations, 10)
  assert.equal(info.sharedLimits.totalGasMIST, 300_000_000)
  for (const arg of ["--apply", "--reset", "--commit", '{"authenticated":true}']) {
    const result = spawnSync(process.execPath, ["--import", "tsx", script, arg], { encoding: "utf8" })
    assert.equal(result.status, 2); assert.equal(result.stdout, ""); assert.match(result.stderr, /cannot activate/)
  }
})

test("branded local fixture plan reaches only fixed two-phase EVAL and safe recovery summary", async () => {
  let now = Date.parse("2026-09-29T04:00:00Z")
  const disabledAt = new Date(now - 3600_000).toISOString(), project = S.project, team = S.team
  const fence = await verifyWriterFence({
    async principal() { return { account: S.account, project, team } },
    async deployments() { return { project, team, snapshotId: "snapshot_fixed01", total: 1, ids: ["dpl_synthetic00001"], next: null } },
    async disabled(deploymentId) { return { project, team, deploymentId, disabledAt, invocationBoundMs: 60_000, mechanism: "immutable-execution-revoked", controlReceiptDigest: "0x" + "a".repeat(64) } },
    async futureWriters() { return { project, team, policyEpoch: "policy_fixed01", enforcedAt: disabledAt, mechanism: "legacy-writer-creation-denied", controlReceiptDigest: "0x" + "b".repeat(64) } },
  }, () => now)
  const raw = JSON.stringify({ version: 1, sessions: {}, operations: { op_failedhistory1: { operationId: "op_failedhistory1", status: "failed", secrets: {} } }, redemptions: {}, outbox: {}, nonces: {}, idempotency: {} })
  const values = new Map<string, string>([[S.sourceKey, raw]]), commands: unknown[][] = []
  const operator = createCutoverRedisOperator({ connection, allocationAudit: audit, fetchImpl: async (_url, options) => {
    const cmd = JSON.parse(String(options?.body)) as string[]; commands.push(cmd)
    let result: unknown
    if (cmd[0] === "MGET") result = cmd.slice(1).map(key => values.get(key) ?? null)
    else {
      assert.equal(cmd[0], "EVAL"); assert.equal(Number(cmd[2]), 5)
      const keys = cmd.slice(3, 8), args = cmd.slice(8)
      assert.deepEqual(keys, [S.sourceKey, `${S.sourceKey}:lock`, S.targetKey, `${S.targetKey}:lock`, S.controlKey])
      assert.equal(values.get(S.sourceKey), args[0])
      if (cmd[1] === CUTOVER_PREPARE_LUA) { assert.equal(args.length, 2); values.set(S.controlKey, args[1]); result = "prepared" }
      else { assert.equal(cmd[1], CUTOVER_COMMIT_LUA); assert.equal(args.length, 4); assert.equal(values.get(S.controlKey), args[1]); values.set(S.targetKey, args[2]); values.set(S.controlKey, args[3]); result = "committed" }
    }
    return new Response(JSON.stringify({ result }))
  } })
  const first = await observeHostedLedger(operator.ledger, fence, () => now)
  now += S.observationGapMs
  const second = await observeHostedLedger(operator.ledger, fence, () => now), plan = prepareCutover(fence, first, second, now)
  assert.equal((await operator.provision(plan, "prepare", now)).status, "prepared")
  assert.deepEqual(await operator.inspect(new AbortController().signal, now), { phase: "prepared", migrationId: plan.marker.migrationId })
  assert.equal((await operator.provision(plan, "commit", now)).status, "committed")
  assert.deepEqual(await operator.inspect(new AbortController().signal, now), { phase: "committed", migrationId: plan.marker.migrationId, sequence: 0 })
  assert.equal(commands.filter(cmd => cmd[0] === "EVAL").length, 2)
  assert.equal(values.get(S.sourceKey), raw)
})
