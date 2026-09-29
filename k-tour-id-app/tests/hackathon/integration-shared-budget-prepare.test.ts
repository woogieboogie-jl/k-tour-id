// Offline operator port fixtures. No credentials, providers or remote writes.
import assert from "node:assert/strict"
import test from "node:test"
import { spawnSync } from "node:child_process"
import { prepareSharedBudget } from "../../scripts/hackathon-shared-budget-prepare"
import { SHARED_BUDGET_SCOPE as S, SHARED_BUDGET_INITIALIZE_LUA } from "../../lib/hackathon/integration-shared-budget"

const NOW = Date.parse("2026-09-29T04:00:00Z")
const TOKEN = "shared_" + "a".repeat(32)
function fixture() {
  const source = JSON.stringify({ version: 1, sessions: {}, operations: Object.fromEntries(Array.from({ length: 5 }, (_, i) => {
    const operationId = `op_operatorlegacy${i}`
    return [operationId, { operationId, sessionId: "PRIVATE_LEGACY_SESSION", status: "cancelled", phase: "cancelled", createdAt: "2026-09-28T15:30:00Z", updatedAt: "2026-09-28T15:30:00Z", expiresAt: "2026-09-28T16:30:00Z", secrets: { token: "PRIVATE_LEGACY_TOKEN" } }]
  })), redemptions: {}, outbox: {}, idempotency: {}, nonces: {} })
  const kv = new Map<string, string>([[S.sourceKey, source]])
  let now = NOW, audited = false, writes = 0, lost = false, beforeInit: (() => void) | undefined
  const calls: (string | number)[][] = []
  const io = {
    audit: async () => { audited = true }, now: () => now, token: () => TOKEN,
    command: async (cmd: (string | number)[]): Promise<unknown> => {
      assert.equal(audited, true); calls.push(cmd)
      if (cmd[0] === "SET") {
        assert.deepEqual(cmd.slice(3), ["NX", "PX", 5000])
        assert.ok([`${S.targetKey}:lock`, `${S.sourceKey}:lock`].includes(String(cmd[1])))
        if (kv.has(String(cmd[1]))) return null
        kv.set(String(cmd[1]), String(cmd[2])); return "OK"
      }
      if (cmd[0] === "MGET") { assert.deepEqual(cmd.slice(1), [S.targetKey, S.controlKey, S.sourceKey]); return cmd.slice(1).map(k => kv.get(String(k)) ?? null) }
      assert.equal(cmd[0], "EVAL")
      if (cmd[1] === SHARED_BUDGET_INITIALIZE_LUA) {
        assert.equal(cmd[2], 5)
        assert.deepEqual(cmd.slice(3, 8), [`${S.targetKey}:lock`, S.targetKey, S.controlKey, `${S.sourceKey}:lock`, S.sourceKey])
        beforeInit?.()
        if (kv.get(String(cmd[3])) !== cmd[8] || kv.get(String(cmd[6])) !== cmd[9] || kv.get(S.sourceKey) !== cmd[10] || kv.has(S.targetKey) || kv.has(S.controlKey)) return 0
        kv.set(S.targetKey, String(cmd[11])); kv.set(S.controlKey, String(cmd[12])); writes++
        if (lost) { lost = false; throw Error("synthetic response loss") }
        return 1
      }
      assert.equal(cmd[2], 1)
      assert.equal(cmd[1], "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0")
      const key = String(cmd[3]); if (kv.get(key) !== cmd[4]) return 0
      kv.delete(key); return 1
    },
  }
  return { kv, source, calls, io, writes: () => writes, setNow: (value: number) => { now = value }, loseResponse: () => { lost = true }, beforeInit: (fn: () => void) => { beforeInit = fn } }
}
test("empty preparation uses authenticated fixed ports, allocates zero slots and copies no secrets", async () => {
  const f = fixture(), result = await prepareSharedBudget(f.io)
  assert.deepEqual(result, { prepared: true, replayed: false, allocatedNewSlots: 0, sourceOperationCount: 5, guideOperationCount: 0, runtimeConfigurationChanged: false, mode: "shared-reservation" })
  assert.equal(f.kv.get(S.sourceKey), f.source); assert.equal(f.writes(), 1)
  assert.equal(Object.keys(JSON.parse(f.kv.get(S.targetKey)!).operations).length, 0)
  for (const value of [JSON.stringify(result), f.kv.get(S.targetKey)!, f.kv.get(S.controlKey)!]) assert.doesNotMatch(value, /PRIVATE_LEGACY/)
  assert.equal(f.kv.has(`${S.targetKey}:lock`), false); assert.equal(f.kv.has(`${S.sourceKey}:lock`), false)
})
test("authenticated inventory failure permits no command", async () => {
  const f = fixture(); f.io.audit = async () => { throw Error("authentication refused") }
  await assert.rejects(prepareSharedBudget(f.io)); assert.equal(f.calls.length, 0)
})
test("existing prepared state replays without resetting or mutating source", async () => {
  const f = fixture(); await prepareSharedBudget(f.io); const target = f.kv.get(S.targetKey), control = f.kv.get(S.controlKey)
  assert.equal((await prepareSharedBudget(f.io)).replayed, true); assert.equal(f.writes(), 1)
  assert.equal(f.kv.get(S.targetKey), target); assert.equal(f.kv.get(S.controlKey), control); assert.equal(f.kv.get(S.sourceKey), f.source)
})
test("lost apply response reports unknown and the next invocation recognizes committed state", async () => {
  const f = fixture(); f.loseResponse()
  await assert.rejects(prepareSharedBudget(f.io), /outcome_unknown/); assert.equal(f.writes(), 1)
  assert.equal((await prepareSharedBudget(f.io)).replayed, true); assert.equal(f.writes(), 1); assert.equal(f.kv.get(S.sourceKey), f.source)
})
test("lost or corrupt confirmation never reports a definitely unsaved outcome", async () => {
  for (const kind of ["transport", "json", "state"]) {
    const f = fixture(), command = f.io.command
    let interrupted = false
    f.io.command = async cmd => {
      const result = await command(cmd)
      if (cmd[0] === "MGET" && f.writes() === 1 && !interrupted) {
        interrupted = true
        if (kind === "transport") throw Error("synthetic connection failure")
        if (kind === "json") return [f.kv.get(S.targetKey), "not JSON", f.source]
        return [null, f.kv.get(S.controlKey), f.source]
      }
      return result
    }
    await assert.rejects(prepareSharedBudget(f.io), /confirmation_unknown/)
    assert.equal(f.writes(), 1); assert.equal(f.kv.get(S.sourceKey), f.source)
    assert.equal((await prepareSharedBudget(f.io)).replayed, true); assert.equal(f.writes(), 1)
  }
})
test("partial target/control and corrupt source refuse without any repair", async () => {
  for (const kind of ["target", "control", "source"]) {
    const f = fixture(); f.kv.set(kind === "target" ? S.targetKey : kind === "control" ? S.controlKey : S.sourceKey, "{}")
    await assert.rejects(prepareSharedBudget(f.io)); assert.equal(f.writes(), 0)
  }
})
test("busy existing target/source lease remains owned by its original holder", async () => {
  for (const key of [`${S.targetKey}:lock`, `${S.sourceKey}:lock`]) {
    const f = fixture(); f.kv.set(key, "another-owner")
    await assert.rejects(prepareSharedBudget(f.io), /busy/); assert.equal(f.writes(), 0); assert.equal(f.kv.get(key), "another-owner")
  }
})
test("source drift or either lease loss before atomic initialization creates nothing", async () => {
  for (const kind of ["source", "target-lock", "source-lock"]) {
    const f = fixture(); f.beforeInit(() => {
      if (kind === "source") f.kv.set(S.sourceKey, f.source + " ")
      else f.kv.set(`${kind === "target-lock" ? S.targetKey : S.sourceKey}:lock`, "new-owner")
    })
    await assert.rejects(prepareSharedBudget(f.io), /conflict/); assert.equal(f.writes(), 0)
    assert.equal(f.kv.has(S.targetKey), false); assert.equal(f.kv.has(S.controlKey), false)
  }
})
test("hard expiry before preparation takes no Redis lock", async () => {
  const f = fixture(); f.setNow(Date.parse(S.expiresAt))
  await assert.rejects(prepareSharedBudget(f.io), /expired/); assert.equal(f.calls.length, 0)
})
test("CLI refuses arbitrary target/credential/apply arguments before any connection", () => {
  for (const args of [[], ["--target", "https://evil.invalid"], ["--initialize-empty-target", "--token", "DO_NOT_LOG"]]) {
    const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/hackathon-shared-budget-prepare.ts", ...args], { cwd: process.cwd(), encoding: "utf8" })
    assert.equal(r.status, 1); assert.match(r.stderr, /shared_budget_prepare_arguments/); assert.doesNotMatch(r.stdout + r.stderr, /DO_NOT_LOG|evil\.invalid/)
  }
})
