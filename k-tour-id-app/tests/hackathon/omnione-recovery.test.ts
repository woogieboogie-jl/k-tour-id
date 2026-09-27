import assert from "node:assert/strict"
import { test } from "node:test"
import type { Db, OutboxRecord, OperationRecord } from "../../lib/hackathon/store"
import { OMNIONE_STAGE, omnioneReadAbi as abi } from "../../lib/hackathon/omnione-evidence"
import { recoverOmnioneOutbox, type RecoveryRepository } from "../../lib/hackathon/omnione-recovery"
import { recoveryArguments, recoveryConfiguration, redisRecoveryRepository, runOmnioneRecovery } from "../../scripts/hackathon-omnione-recover"

const hash = "0x" + "a".repeat(64), eventKey = "0x" + "b".repeat(64), commitment = "0x" + "c".repeat(64)
const key = "ktour:integration-preview:fixture:journey"
function row(id = "outbox-1", status: OutboxRecord["status"] = "submitted"): OutboxRecord {
  return { outboxId: id, operationId: "operation-1", eventKey, payloadCommitment: commitment, payload: {}, status, txHash: hash, blockNumber: null,
    attempts: 1, lastError: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), confirmedAt: null, ...(status === "confirmed" ? { receiptEvidenceVersion: 1 as const } : {}) }
}
function empty(): Db { return { version: 1, sessions: {}, operations: {}, outbox: {}, redemptions: {}, idempotency: {}, nonces: {} } }
function memory(rows: OutboxRecord[]) {
  let db = empty(); db.outbox = Object.fromEntries(rows.map(value => [value.outboxId, value]))
  const repository: RecoveryRepository = {
    async read() { return structuredClone(db) },
    async mutate(work) { const next = structuredClone(db); const result = work(next); db = next; return result },
  }
  return { repository, read: () => structuredClone(db) }
}
function rpcValue(method: string, params: unknown[]) {
  if (method === "eth_chainId") return "0x" + OMNIONE_STAGE.chainId.toString(16)
  if (method === "eth_getTransactionReceipt") {
    assert.equal(params[0], hash)
    return { transactionHash: hash, to: OMNIONE_STAGE.registry, from: OMNIONE_STAGE.recorder, status: "0x1", blockHash: "0x" + "d".repeat(64), blockNumber: "0x7b",
      logs: [{ address: OMNIONE_STAGE.registry, ...abi.encodeEventLog(abi.getEvent("DemoEntitlementRedeemed")!, [eventKey, commitment, 10n, OMNIONE_STAGE.recorder]) }] }
  }
  assert.equal(method, "eth_call")
  const data = (params[0] as { data: string }).data
  return data.startsWith(abi.getFunction("recorders")!.selector) ? abi.encodeFunctionResult("recorders", [true]) : abi.encodeFunctionResult("getRedemption", [true, commitment, 10n, OMNIONE_STAGE.recorder])
}
function rpc(hook?: (method: string) => Promise<void>) {
  const calls: string[] = []
  return { calls, async call(method: "eth_chainId" | "eth_call" | "eth_getCode" | "eth_getTransactionReceipt", params: unknown[]) {
    calls.push(method); await hook?.(method); return rpcValue(method, params)
  } }
}

test("saved submitted/unknown hashes recover without changing attempts or signing; other rows are untouched", async () => {
  const m = memory([row("known", "unknown"), row("pending", "pending"), row("done", "confirmed"), row("failed", "failed")]), reader = rpc()
  const result = await recoverOmnioneOutbox({ repository: m.repository, rpc: reader })
  assert.equal(result.ok, true); assert.equal(result.confirmed, 1); assert.equal(result.checked, 1)
  assert.equal(result.signatures, 0); assert.equal(result.broadcasts, 0)
  assert.deepEqual(reader.calls, ["eth_chainId", "eth_getTransactionReceipt", "eth_call", "eth_call"])
  const saved = m.read().outbox
  assert.equal(saved.known.status, "confirmed"); assert.equal(saved.known.attempts, 1); assert.equal(saved.known.txHash, hash)
  assert.equal(saved.known.receiptEvidenceVersion, 1)
  assert.equal(saved.known.processingClaim, undefined); assert.equal(saved.pending.status, "pending")
})

test("unknown/no-hash and malformed bindings cannot be counted as successful recovery", async () => {
  const missing = row("missing", "unknown"); missing.txHash = null
  const m = memory([missing]), reader = rpc()
  const result = await recoverOmnioneOutbox({ repository: m.repository, rpc: reader })
  assert.equal(result.ok, false); assert.equal(result.unresolvedWithoutHash, 1); assert.equal(result.confirmed, 0)
  assert.equal(reader.calls.length, 0); assert.deepEqual(m.read().outbox.missing, missing)
  const invalid = memory([{ ...row(), eventKey: "invalid" }])
  const rejected = await recoverOmnioneOutbox({ repository: invalid.repository, rpc: reader })
  assert.equal(rejected.ok, false); assert.ok(rejected.issues.includes("recovery_row_invalid")); assert.equal(reader.calls.length, 0)
  const legacy = row("legacy", "confirmed"); delete legacy.receiptEvidenceVersion
  const legacyResult = await recoverOmnioneOutbox({ repository: memory([legacy]).repository, rpc: reader })
  assert.equal(legacyResult.ok, false); assert.equal(legacyResult.legacyUnverified, 1); assert.equal(reader.calls.length, 0)
})

test("live/invalid claims, count caps, pending and absent receipt do not claim completion", async () => {
  const locked = row(); locked.processingClaim = { id: "other", expiresAt: new Date(Date.now() + 60000).toISOString() }
  const reader = rpc(), m = memory([locked])
  const result = await recoverOmnioneOutbox({ repository: m.repository, rpc: reader })
  assert.equal(result.skipped, 1); assert.equal(result.ok, false); assert.equal(reader.calls.length, 0)
  assert.equal(m.read().outbox[locked.outboxId].processingClaim?.id, "other")
  const many = memory([row("one"), row("two")])
  const limited = await recoverOmnioneOutbox({ repository: many.repository, rpc: rpc(), limit: 1 })
  assert.equal(limited.confirmed, 1); assert.equal(limited.deferred, 1); assert.equal(limited.ok, false)
  assert.equal(many.read().outbox.two.status, "submitted")
  const pending = memory([row()])
  const pendingResult = await recoverOmnioneOutbox({ repository: pending.repository, rpc: { call: async (method, params) => method === "eth_getTransactionReceipt" ? null : rpcValue(method, params) } })
  assert.equal(pendingResult.pending, 1); assert.equal(pendingResult.ok, false); assert.equal(pending.read().outbox[locked.outboxId].confirmedAt, null)
})

test("late receipt cannot overwrite replacement owner, changed scope, or expired lease", async () => {
  for (const change of ["owner", "scope", "lease"] as const) {
    const m = memory([row()])
    const result = await recoverOmnioneOutbox({ repository: m.repository, rpc: rpc(async method => {
      if (method !== "eth_getTransactionReceipt") return
      await m.repository.mutate(db => {
        const current = db.outbox["outbox-1"]
        if (change === "owner") current.processingClaim = { id: "replacement", expiresAt: new Date(Date.now() + 60000).toISOString() }
        if (change === "scope") current.payloadCommitment = "0x" + "e".repeat(64)
        if (change === "lease") current.processingClaim!.expiresAt = new Date(Date.now() - 1).toISOString()
      })
    }) })
    assert.equal(result.confirmed, 0); assert.equal(result.ok, false); assert.equal(result.skipped, 1)
    assert.equal(m.read().outbox["outbox-1"].status, "submitted")
    if (change === "owner") assert.equal(m.read().outbox["outbox-1"].processingClaim?.id, "replacement")
  }
})

test("claim persistence ambiguity releases only the owned claim and does not perform a chain read", async () => {
  const m = memory([row()]), reader = rpc(); let first = true
  const repository: RecoveryRepository = { read: m.repository.read, async mutate(work) {
    const value = await m.repository.mutate(work)
    if (first) { first = false; throw new Error("fixture lost response") }
    return value
  } }
  const result = await recoverOmnioneOutbox({ repository, rpc: reader })
  assert.equal(result.ok, false); assert.equal(result.cleanupComplete, true); assert.equal(reader.calls.length, 0)
  assert.equal(m.read().outbox["outbox-1"].processingClaim, undefined)
})

test("outbox recovery never replaces a newer operation chain record or service fulfillment", async () => {
  const m = memory([row()])
  await m.repository.mutate(db => { db.operations["operation-1"] = { chain: { ...row("new-outbox"), payloadCommitment: "new-binding" }, revision: 9, updatedAt: "unchanged", audit: [], fulfillment: { status: "redeemed" } } as unknown as OperationRecord })
  const before = structuredClone(m.read().operations["operation-1"])
  await recoverOmnioneOutbox({ repository: m.repository, rpc: rpc() })
  assert.deepEqual(m.read().operations["operation-1"], before)
  assert.equal(m.read().outbox["outbox-1"].status, "confirmed")
})

const envFixture = () => ({ HK_STORE_KEY: key, HK_OMNIONE_RECOVERY_ENABLED: "1", HK_OMNIONE_RECOVERY_UNTIL: new Date(Date.now() + 60000).toISOString(),
  KV_REST_API_URL: "https://fixture.upstash.io", KV_REST_API_TOKEN: "fixture-redis-secret",
  HK_OMNIONE_RPC_URL: `${OMNIONE_STAGE.rpcOrigin}/?token=fixture-rpc-secret`, HK_OMNIONE_REGISTRY_ADDRESS: OMNIONE_STAGE.registry })
const args = ["--read-only", "--store-key", key, "--limit=1"]
test("operator gate rejects default/CX ledgers, alias mixing, remote/production, stale approvals and arbitrary RPCs", async () => {
  assert.deepEqual(recoveryArguments(args), { key, limit: 1 })
  for (const value of [[], ["--read-only"], [...args, "--broadcast"], ["--read-only", "--store-key", "ondo:hackathon:journey:v1", "--limit=1"], [...args.slice(0, 3), "--limit=4"]]) assert.throws(() => recoveryArguments(value))
  for (const patch of [{ HK_STORE_KEY: "ktour:cx-preview:fixture" }, { HK_OMNIONE_RECOVERY_ENABLED: "0" }, { NODE_ENV: "production" }, { VERCEL: "1" },
    { HK_OMNIONE_RECOVERY_UNTIL: "invalid" }, { HK_OMNIONE_RECOVERY_UNTIL: new Date(Date.now() - 1).toISOString() },
    { HK_OMNIONE_RECOVERY_UNTIL: new Date(Date.now() + 3600000).toISOString() }, { UPSTASH_REDIS_REST_URL: "https://fixture.upstash.io" },
    { KV_REST_API_TOKEN: "" }, { KV_REST_API_URL: "https://evil.invalid" }, { HK_OMNIONE_RPC_URL: "https://evil.invalid" },
    { HK_OMNIONE_RECORDER_ADDRESS: "0x" + "1".repeat(40) }, { HK_OMNIONE_CHAIN_ID: "1" }]) {
    const result = await runOmnioneRecovery(args, { env: { ...envFixture(), ...patch }, fetchImpl: async () => assert.fail("unapproved I/O") })
    assert.equal(result.ok, false)
  }
  const reads: string[] = [], env = envFixture()
  recoveryConfiguration(new Proxy(env, { get(target, name) { reads.push(String(name)); assert.doesNotMatch(String(name), /PRIVATE_KEY|SIGNING_SEED|SUI_|CX_/); return target[name as keyof typeof target] } }), key)
  assert.ok(reads.includes("KV_REST_API_TOKEN"))
})

function redisFixture(initial: Db, options: { replaceLock?: boolean; loseClaimReply?: boolean } = {}) {
  const values = new Map<string, string>([[key, JSON.stringify(initial)]])
  const commands: unknown[][] = []; let lost = false
  const fetchImpl: typeof fetch = async (url, init) => {
    assert.equal(String(url), "https://fixture.upstash.io"); assert.equal(init?.redirect, "error")
    const command = JSON.parse(String(init?.body)) as (string | number)[]; commands.push(command)
    let result: unknown
    if (command[0] === "GET") result = values.get(String(command[1])) ?? null
    else if (command[0] === "SET") {
      assert.equal(command[1], `${key}:lock`); assert.deepEqual(command.slice(3), ["NX", "PX", 5000])
      result = values.has(`${key}:lock`) ? null : "OK"
      if (result === "OK") values.set(`${key}:lock`, String(command[2]))
    } else {
      assert.equal(command[0], "EVAL")
      const script = String(command[1])
      if (script.startsWith("-- ktour-omnione-recovery-cas")) {
        assert.equal(command[2], 2); assert.equal(command[3], `${key}:lock`); assert.equal(command[4], key); assert.match(script, /KEEPTTL/)
        if (options.replaceLock) values.set(`${key}:lock`, "replacement")
        result = values.get(`${key}:lock`) === command[5] && values.get(key) === command[6] ? 1 : 0
        if (result === 1) values.set(key, String(command[7]))
        if (options.loseClaimReply && !lost && String(command[7]).includes("processingClaim")) { lost = true; throw new Error("fixture secret lost response") }
      } else {
        assert.match(script, /^-- ktour-omnione-recovery-unlock/); assert.equal(command[2], 1); assert.equal(command[3], `${key}:lock`)
        result = values.get(`${key}:lock`) === command[4] ? 1 : 0
        if (result === 1) values.delete(`${key}:lock`)
      }
    }
    return Response.json({ result })
  }
  return { values, commands, fetchImpl }
}

test("dedicated Redis mutation uses owned lock, old-value CAS, retained TTL and compare-delete", async () => {
  const db = empty(); db.outbox["outbox-1"] = row()
  const f = redisFixture(db), repo = redisRecoveryRepository({ url: "https://fixture.upstash.io", token: "fixture" }, key, { fetchImpl: f.fetchImpl, deadline: Date.now() + 5000 })
  await repo.repository.mutate(current => { current.outbox["outbox-1"].lastError = "fixture" })
  assert.equal(JSON.parse(f.values.get(key)!).outbox["outbox-1"].lastError, "fixture")
  assert.equal(f.values.has(`${key}:lock`), false)
  assert.equal(f.commands.length, 4)
  const conflict = redisFixture(db, { replaceLock: true })
  const other = redisRecoveryRepository({ url: "https://fixture.upstash.io", token: "fixture" }, key, { fetchImpl: conflict.fetchImpl, deadline: Date.now() + 5000 })
  await assert.rejects(other.repository.mutate(current => { current.outbox["outbox-1"].status = "confirmed" }))
  assert.equal(JSON.parse(conflict.values.get(key)!).outbox["outbox-1"].status, "submitted")
  assert.equal(conflict.values.get(`${key}:lock`), "replacement")
})

test("full operator fixture updates one owned audit with read RPCs and exposes only counts", async () => {
  const db = empty(); db.outbox["outbox-1"] = row()
  const f = redisFixture(db), calls: string[] = []
  const fetchImpl: typeof fetch = async (url, init) => {
    if (String(url) === "https://fixture.upstash.io") return f.fetchImpl(url, init)
    assert.equal(String(url), envFixture().HK_OMNIONE_RPC_URL)
    const body = JSON.parse(String(init?.body)); calls.push(body.method)
    return Response.json({ jsonrpc: "2.0", id: body.id, result: rpcValue(body.method, body.params) })
  }
  const result = await runOmnioneRecovery(args, { env: envFixture(), fetchImpl })
  assert.equal(result.ok, true); assert.equal("confirmed" in result ? result.confirmed : -1, 1)
  assert.equal(JSON.parse(f.values.get(key)!).outbox["outbox-1"].status, "confirmed")
  assert.equal(f.values.has(`${key}:lock`), false)
  assert.deepEqual(calls, ["eth_chainId", "eth_getTransactionReceipt", "eth_call", "eth_call"])
  assert.doesNotMatch(JSON.stringify(result), /fixture-redis-secret|fixture-rpc-secret|transactionHash|payloadCommitment|outbox-1/)
})

test("a lost Redis claim-write response is cleaned conservatively before any chain read", async () => {
  const db = empty(); db.outbox["outbox-1"] = row()
  const f = redisFixture(db, { loseClaimReply: true })
  const result = await runOmnioneRecovery(args, { env: envFixture(), fetchImpl: f.fetchImpl })
  assert.equal(result.ok, false)
  assert.equal("rpcRequests" in result ? result.rpcRequests : -1, 0)
  assert.equal("cleanupComplete" in result ? result.cleanupComplete : false, true)
  assert.equal(JSON.parse(f.values.get(key)!).outbox["outbox-1"].processingClaim, undefined)
  assert.equal(f.values.has(`${key}:lock`), false)
  assert.doesNotMatch(JSON.stringify(result), /fixture secret|fixture-redis-secret|fixture-rpc-secret/)
})

test("already-expired recovery does not inspect a ledger or make a chain read", async () => {
  await assert.rejects(recoverOmnioneOutbox({ deadline: Date.now() - 1, repository: { read: async () => assert.fail("expired read"), mutate: async () => assert.fail("expired write") }, rpc: { call: async () => assert.fail("expired RPC") } }), { message: "recovery_deadline" })
})
