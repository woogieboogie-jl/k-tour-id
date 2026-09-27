import { test } from "node:test"
import assert from "node:assert/strict"
import { createHmac, randomUUID } from "node:crypto"
import {
  approvedSumsubProbeConnection, fenceSumsubProbeCommand, runSumsubRedisLiveProbe,
  SUMSUB_PROBE_CLAIM, SUMSUB_PROBE_SET, SUMSUB_PROBE_CAS, SUMSUB_PROBE_CLEANUP,
} from "../../scripts/kyc/probe-sumsub-redis"

type Command = (string | number)[]
const approvedOrigin = "https://fixture.upstash.io"
const connection = { url: approvedOrigin, token: "fixture-only-do-not-print" }
const STORE_CAS = "-- ktour-sumsub-cas\nif redis.call('GET',KEYS[1]) == ARGV[1] then redis.call('SET',KEYS[1],ARGV[2],'KEEPTTL'); return 1 end return 0"

/** Deliberately fixture-only. The child executes the actual Redis store path,
 * but this parent simulates Redis; none of these tests certify a live server. */
function fixture() {
  const rows = new Map<string, { raw: string; expiresAt: number }>([
    ["ktour:cx-preview:keep", { raw: "protected-cx", expiresAt: Infinity }],
    ["ktour:sumsub:sandbox:existing:keep", { raw: "protected-sumsub", expiresAt: Infinity }],
  ])
  const commands: Command[] = []
  let collisions = 0
  const read = (key: unknown) => {
    const k = String(key), value = rows.get(k)
    if (value && value.expiresAt <= Date.now()) { rows.delete(k); return undefined }
    return value
  }
  const command = async (c: Command): Promise<unknown> => {
    commands.push(c)
    if (c[0] === "GET" && c.length === 2) return read(c[1])?.raw ?? null
    if (c[0] === "PTTL" && c.length === 2) return read(c[1]) ? read(c[1])!.expiresAt - Date.now() : -2
    if (c[0] === "EXISTS" && c.length === 4) return c.slice(1).filter(k => read(k)).length
    assert.equal(c[0], "EVAL", "Raw writes and unbounded Redis commands are forbidden")
    if (c[1] === SUMSUB_PROBE_CLAIM) {
      assert.equal(c.length, 8); assert.equal(c[2], 3); assert.equal(c[7], 120000)
      if (c.slice(3, 6).some(k => read(k))) return 0
      rows.set(String(c[3]), { raw: String(c[6]), expiresAt: Date.now() + Number(c[7]) })
      return 1
    }
    if (c[1] === SUMSUB_PROBE_SET) {
      assert.equal(c.length, 8); assert.equal(c[2], 2)
      const owner = read(c[4])
      if (!owner || owner.raw !== c[5] || owner.expiresAt <= Date.now() || read(c[3])) return null
      rows.set(String(c[3]), { raw: String(c[6]), expiresAt: Math.min(owner.expiresAt, Date.now() + Number(c[7])) })
      return "OK"
    }
    if (c[1] === SUMSUB_PROBE_CAS) {
      assert.equal(c.length, 8); assert.equal(c[2], 2)
      const owner = read(c[4]), row = read(c[3])
      if (!owner || owner.raw !== c[7] || !row) return -1
      if (row.raw !== c[5]) { collisions++; return 0 }
      rows.set(String(c[3]), { raw: String(c[6]), expiresAt: row.expiresAt })
      return 1
    }
    if (c[1] === SUMSUB_PROBE_CLEANUP) {
      assert.equal(c.length, 7); assert.equal(c[2], 3)
      if (read(c[3])?.raw !== c[6]) return 0
      for (const key of c.slice(3, 6)) rows.delete(String(key))
      return 1
    }
    assert.fail("Unexpected Lua program")
  }
  return { rows, commands, read, command, collisions: () => collisions }
}
function scopeFixture() {
  const uuid = randomUUID(), namespace = `ktour:sumsub:sandbox:qa-${uuid}`, secret = "a".repeat(64)
  const id = `ktour-sbx-${randomUUID()}`, expiryId = `ktour-sbx-${randomUUID()}`, ownerKey = `${namespace}:owner`
  const scope = { uuid, namespace, secret, id, expiryId, ownerKey, owner: "b".repeat(64), sessionId: randomUUID(), expiresAt: Date.now() + 60000,
    keys: [ownerKey, ...[id, expiryId].map(value => `${namespace}:${createHmac("sha256", secret).update(value).digest("hex")}`)] }
  const raw = JSON.stringify({ version: 1, revision: 0, externalUserId: id, applicantId: "qa_synthetic_applicant", levelName: "qa_synthetic_level", status: "pending",
    expiresAt: scope.expiresAt, activeSessionId: scope.sessionId, activeExpiresAt: scope.expiresAt, updatedAt: Date.now(), lastEventAt: 0 })
  return { scope, raw }
}

test("default is offline, and live mode cannot be mixed with fixture IO or missing credentials", async () => {
  let requests = 0
  const fixtureCommand = async () => { requests++; throw new Error("PRIVATE") }
  const result = await runSumsubRedisLiveProbe({ fixtureCommand })
  assert.equal(result.ok, true); assert.equal(result.executed, false); assert.equal(result.liveRedisVerified, false)
  for (const options of [{ mode: "live" as const }, { mode: "live" as const, connection, approvedOrigin, fixtureCommand }, { mode: "fixture" as const, connection, approvedOrigin }]) {
    const rejected = await runSumsubRedisLiveProbe(options)
    assert.equal(rejected.ok, false); assert.equal(rejected.executed, false)
  }
  assert.equal(requests, 0)
})

test("approved Redis origin is explicit/exact and never accepts query tokens, redirects or alternate hosts", () => {
  assert.deepEqual(approvedSumsubProbeConnection(connection, approvedOrigin), connection)
  for (const url of ["http://fixture.upstash.io", "https://other.upstash.io", approvedOrigin + "?token=PRIVATE", approvedOrigin + "/command", approvedOrigin + ":443", "https://user:PRIVATE@fixture.upstash.io", "https://fixture.upstash.io.evil.test"]) {
    assert.throws(() => approvedSumsubProbeConnection({ ...connection, url }, approvedOrigin))
  }
  assert.throws(() => approvedSumsubProbeConnection(connection, "https://example.test"))
  assert.throws(() => approvedSumsubProbeConnection({ ...connection, token: " token\n" }, approvedOrigin))
})

test("transport fence accepts only exact synthetic keys, short TTLs, and the real store CAS source", () => {
  const { scope, raw } = scopeFixture()
  const set: Command = ["SET", scope.keys[1], raw, "NX", "PX", 60000]
  const fenced = fenceSumsubProbeCommand(set, scope)
  assert.deepEqual(fenced, ["EVAL", SUMSUB_PROBE_SET, 2, scope.keys[1], scope.ownerKey, scope.owner, raw, 60000])
  assert.equal(fenceSumsubProbeCommand(["EVAL", STORE_CAS, 1, scope.keys[1], raw, raw], scope)[1], SUMSUB_PROBE_CAS)
  for (const command of [
    ["FLUSHDB"], ["SCAN", 0], ["KEYS", "*"], ["DEL", scope.keys[1]], ["GET", "ktour:cx-preview:keep"],
    ["SET", scope.keys[1], raw, "NX", "PX", 120001], ["SET", scope.keys[1], raw, "NX", "EX", 60],
    ["SET", "ktour:sumsub:sandbox:existing:keep", raw, "NX", "PX", 1000],
    ["EVAL", STORE_CAS + " ", 1, scope.keys[1], raw, raw],
    ["SET", scope.keys[1], JSON.stringify({ ...JSON.parse(raw), passport: "PRIVATE" }), "NX", "PX", 1000],
    ["SET", scope.keys[1], JSON.stringify({ ...JSON.parse(raw), applicantId: "real_applicant" }), "NX", "PX", 1000],
    ["SET", scope.keys[1], JSON.stringify({ ...JSON.parse(raw), status: "approved" }), "NX", "PX", 1000],
  ]) assert.throws(() => fenceSumsubProbeCommand(command, scope))
  assert.throws(() => fenceSumsubProbeCommand(set, { ...scope, namespace: "ktour:sumsub:sandbox:existing" }))
})

test("five real-store child processes preserve CAS/revocation and native-expiry fixture semantics without claiming live verification", { timeout: 20000 }, async () => {
  const db = fixture(), before = process.env.SUMSUB_STORE_NAMESPACE
  const result = await runSumsubRedisLiveProbe({ mode: "fixture", connection, approvedOrigin, fixtureCommand: db.command })
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.liveRedisVerified, false)
  assert.equal(result.fixture, true); assert.equal(result.providerIntegrationVerified, false)
  assert.equal(result.checks, 17); assert.equal(result.cleanup, true)
  assert.equal("processes" in result && result.processes, 5); assert.equal("workersClosed" in result && result.workersClosed, true)
  assert.ok(db.collisions() >= 1, "Both writers saw the same old raw value and one retried")
  assert.deepEqual([...db.rows.keys()].sort(), ["ktour:cx-preview:keep", "ktour:sumsub:sandbox:existing:keep"])
  assert.equal(process.env.SUMSUB_STORE_NAMESPACE, before)
  const output = JSON.stringify(result)
  for (const forbidden of [connection.token, approvedOrigin, "qa_synthetic_applicant", "ktour-sbx-", "protected-cx", "protected-sumsub"]) assert.ok(!output.includes(forbidden))
  assert.ok(db.commands.every(c => !["FLUSHDB", "FLUSHALL", "SCAN", "KEYS", "DEL", "SET"].includes(String(c[0]))))
})

test("lost claim response is uncertain even when exact owned keys are subsequently removed", async () => {
  const db = fixture()
  const result = await runSumsubRedisLiveProbe({ mode: "fixture", connection, approvedOrigin, fixtureCommand: async c => {
    const result = await db.command(c)
    if (c[1] === SUMSUB_PROBE_CLAIM) throw new Error("PRIVATE url?token=PRIVATE")
    return result
  } })
  assert.equal(result.ok, false); assert.equal(result.cleanup, false); assert.equal(result.liveRedisVerified, false)
  assert.equal(db.rows.size, 2); assert.ok(!JSON.stringify(result).includes("PRIVATE"))
})

test("cleanup never deletes replaced ownership; late SET/CAS cannot resurrect deleted or expired owner keys", async () => {
  const db = fixture(), { scope, raw } = scopeFixture()
  await db.command(["EVAL", SUMSUB_PROBE_CLAIM, 3, ...scope.keys, scope.owner, 120000])
  const set = fenceSumsubProbeCommand(["SET", scope.keys[1], raw, "NX", "PX", 60000], scope)
  const cas = fenceSumsubProbeCommand(["EVAL", STORE_CAS, 1, scope.keys[1], raw, raw], scope)
  assert.equal(await db.command(set), "OK")
  const owner = db.rows.get(scope.ownerKey)!
  db.rows.set(scope.ownerKey, { ...owner, raw: "another-owner" })
  assert.equal(await db.command(["EVAL", SUMSUB_PROBE_CLEANUP, 3, ...scope.keys, scope.owner]), 0)
  assert.ok(db.rows.has(scope.keys[1])); assert.equal(await db.command(cas), -1)
  db.rows.delete(scope.ownerKey); db.rows.delete(scope.keys[1])
  assert.equal(await db.command(set), null); assert.equal(await db.command(cas), -1)
  db.rows.set(scope.ownerKey, { raw: scope.owner, expiresAt: Date.now() - 1 })
  assert.equal(await db.command(set), null); assert.ok(!db.rows.has(scope.keys[1]))
})

test("worker transport stall is bounded, child is killed/closed before exact cleanup, and raw errors stay private", { timeout: 15000 }, async () => {
  const db = fixture(), started = Date.now()
  const result = await runSumsubRedisLiveProbe({ mode: "fixture", connection, approvedOrigin, fixtureCommand: async c => {
    if (c[0] === "GET") return new Promise(() => {})
    return db.command(c)
  } })
  assert.equal(result.ok, false); assert.equal(result.cleanup, true)
  assert.equal("workersClosed" in result && result.workersClosed, true)
  assert.ok(Date.now() - started < 12000); assert.equal(db.rows.size, 2)
})
