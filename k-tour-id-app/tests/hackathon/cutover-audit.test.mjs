import assert from "node:assert/strict"
import test from "node:test"
import { execFileSync } from "node:child_process"
import { AUDIT_SCOPE as S, summarizeHostedLedger, reservationAuditFixture, inspectHostedLedgerReadOnly } from "../../scripts/hackathon-cutover-audit.mjs"

const NOW = Date.parse("2026-09-29T04:00:00Z"), START = Date.parse("2026-09-28T15:00:00Z")
const opId = "op_readonlyaudit001"
const empty = () => ({ version: 1, sessions: {}, operations: {}, redemptions: {}, outbox: {}, idempotency: {}, nonces: {} })
function ledger() {
  const db = empty()
  db.sessions.SECRET_SESSION = { subjectRef: "PRIVATE_SUBJECT" }
  db.operations[opId] = { operationId: opId, sessionId: "SECRET_SESSION", status: "pending", phase: "agent", createdAt: new Date(START).toISOString(), updatedAt: new Date(NOW).toISOString(), expiresAt: new Date(NOW + 60000).toISOString(),
    secrets: { cxToken: "PRIVATE_CX_TOKEN", vcDocument: { name: "PRIVATE_PERSON" }, lastTxBytesB64: "PRIVATE_SIGNED_BYTES", sponsorSignature: "PRIVATE_SIGNATURE", delegationPreparation: { stage: "ready", issueTxDigest: "PUBLIC_TX" } },
    identity: { subjectRef: "PRIVATE_SUBJECT" }, agent: { status: "unknown", txDigest: "PUBLIC_TX" }, delegation: { status: "delegated", userTxDigest: "PUBLIC_TX" } }
  return db
}
function fixture() {
  const envs = [], values = {}, requests = [], reads = []
  const journal = { schema: "ktour-hosted-sui-release/v1", project: S.project, team: S.team, branch: S.branch, targets: {} }
  const add = (key, target, branch, value, comment) => {
    const row = { id: `fixture_${envs.length}`, key, target: [target], ...(branch ? { gitBranch: branch } : {}), value, decrypted: true, createdAt: START, updatedAt: START, comment }
    envs.push(row); values[row.id] = row; return row
  }
  for (const target of ["preview", "production"]) {
    const nonce = target + "_nonce"
    const row = add("HK_STORE_KEY", target, target === "preview" ? S.branch : null, S.source, `ktour-hosted-sui/v1:${nonce}:HK_STORE_KEY`)
    journal.targets[target] = { complete: true, nonce, entries: { HK_STORE_KEY: { id: row.id, createdAt: START, updatedAt: START } } }
  }
  add("KV_REST_API_URL", "production", null, "https://fixture-audit.upstash.io")
  add("KV_REST_API_URL", "preview", S.cxBranch, "https://fixture-audit.upstash.io")
  add("KV_REST_API_TOKEN", "preview", S.cxBranch, "PRIVATE_CONNECTION_TOKEN")
  const io = {
    now: () => NOW, journal: () => structuredClone(journal),
    get: async path => {
      requests.push(path)
      if (path === "/v2/user") return { user: { username: S.account } }
      if (path === `/v9/projects/${S.project}`) return { id: S.project, accountId: S.team, name: "ondo", rootDirectory: "k-tour-id-app", link: { org: "woogieboogie-jl", repo: "k-tour-id" } }
      if (path === `/v10/projects/${S.project}/env`) return { envs: structuredClone(envs) }
      const id = path.split("/").at(-1)
      if (!values[id]) assert.fail("unexpected GET")
      return structuredClone(values[id])
    },
    mget: async (connection, cmd) => {
      assert.deepEqual(connection, { url: "https://fixture-audit.upstash.io", token: "PRIVATE_CONNECTION_TOKEN" })
      assert.deepEqual(cmd, ["MGET", S.source, `${S.source}:lock`, S.target, S.control]); reads.push(cmd)
      return [JSON.stringify(ledger()), null, null, null]
    },
  }
  return { io, envs, values, journal, requests, reads }
}

test("safe summary preserves charged rows and claims but excludes every private field", () => {
  const out = summarizeHostedLedger(JSON.stringify(ledger()), { now: NOW, earliestHostedBindingAt: new Date(START).toISOString() })
  assert.equal(out.operationCount, 1); assert.equal(out.remainingCountedSlots, 9)
  assert.equal(out.unresolvedClaimOperations, 1); assert.equal(out.currentRowsSurviveHardExpiry, true)
  assert.equal(out.configuredWindowFitsRetention, true); assert.equal(out.completeLifetimeHistoryProved, false); assert.equal(out.activationAuthorized, false)
  const json = JSON.stringify(out)
  for (const value of ["SECRET_SESSION", "PRIVATE_SUBJECT", "PRIVATE_CX_TOKEN", "PRIVATE_PERSON", "PRIVATE_SIGNED_BYTES", "PRIVATE_SIGNATURE", "PUBLIC_TX"]) assert.equal(json.includes(value), false)
})
test("missing or corrupt stores never become a zero-slot permission", () => {
  assert.deepEqual(summarizeHostedLedger(null), { exists: false, activationAuthorized: false })
  for (const raw of ["", "{}", "[]", "not-json", JSON.stringify({ ...empty(), operations: [] }), "x".repeat(S.maxBytes + 1)]) assert.throws(() => summarizeHostedLedger(raw), /cutover_audit_ledger/)
  const db = ledger(); db.operations[opId].operationId = "op_wrong0000"
  assert.throws(() => summarizeHostedLedger(JSON.stringify(db)), /operation_shape/)
})
test("failed/cancelled/expired rows remain counted; invalid dates do not prove retention", () => {
  const db = empty()
  for (let i = 0; i < 11; i++) {
    const id = `op_auditrow000${i}`
    db.operations[id] = { ...ledger().operations[opId], operationId: id, status: ["failed", "cancelled", "expired"][i % 3] }
  }
  let out = summarizeHostedLedger(JSON.stringify(db), { now: NOW })
  assert.equal(out.operationCount, 11); assert.equal(out.withinTenSlotLimit, false); assert.equal(out.remainingCountedSlots, 0)
  db.operations.op_auditrow0000.updatedAt = "PRIVATE_ARBITRARY_TEXT"
  out = summarizeHostedLedger(JSON.stringify(db), { now: NOW })
  assert.equal(out.currentRowsSurviveHardExpiry, false); assert.equal(JSON.stringify(out).includes("PRIVATE_ARBITRARY_TEXT"), false)
})
test("old retention windows and an in-flight claim are accurately reported", () => {
  const db = ledger(); db.operations[opId].updatedAt = "2026-09-20T00:00:00Z"
  db.operations[opId].secrets.cxStartClaim = { id: "PRIVATE_CLAIM" }
  db.outbox.PRIVATE_OUTBOX = { status: "unknown", processingClaim: { id: "PRIVATE_CLAIM" } }
  const out = summarizeHostedLedger(JSON.stringify(db), { now: NOW, earliestHostedBindingAt: "2026-09-20T00:00:00Z" })
  assert.equal(out.staleRowsNow, 1); assert.equal(out.currentRowsSurviveHardExpiry, false); assert.equal(out.configuredWindowFitsRetention, false)
  assert.equal(out.pendingOutboxCount, 1); assert.equal(out.operations[0].claimStates.includes("cx-start"), true)
  assert.equal(JSON.stringify(out).includes("PRIVATE_CLAIM"), false)
})
test("reservation fixture is unowned, nonpending, counts as one legacy row and survives the fixed window", () => {
  const row = reservationAuditFixture("op_reservation001", NOW)
  assert.equal(row.sessionId, undefined); assert.equal(row.secrets, undefined); assert.equal(row.status, "reserved")
  assert.equal(row.phase, "reserved"); assert.equal(Object.keys(row).some(k => /identity|holder|signature|subject/.test(k)), false)
  const db = { ...empty(), operations: { [row.operationId]: row } }
  assert.equal(Object.keys(db.operations).length, 1)
  assert.equal(Object.values(db.operations).filter(o => o.status === "pending").length, 0)
  assert.equal(Date.parse(row.updatedAt) < S.maxEnd - S.retentionMs, false)
  assert.throws(() => reservationAuditFixture("op_reservation001", S.maxEnd), /reservation_fixture/)
})
test("authenticated audit uses only fixed metadata GETs and a single fixed Redis MGET", async () => {
  const f = fixture(), out = await inspectHostedLedgerReadOnly(f.io)
  assert.equal(f.reads.length, 1); assert.equal(out.mutation, false); assert.equal(out.sourceLockPresent, false)
  assert.equal(out.ledger.configuredWindowFitsRetention, true); assert.equal(out.integrationTargetPresent, false)
  assert.equal(JSON.stringify(out).includes("PRIVATE_"), false); assert.equal(JSON.stringify(out).includes("upstash.io"), false)
  assert.equal(f.requests.every(p => p.startsWith("/v")), true)
})
test("wrong account or journal scope cannot reach Redis", async () => {
  const f = fixture(), get = f.io.get
  f.io.get = p => p === "/v2/user" ? Promise.resolve({ user: { username: "other" } }) : get(p)
  await assert.rejects(inspectHostedLedgerReadOnly(f.io), /scope/); assert.equal(f.reads.length, 0)
  f.io.get = get; f.journal.team = "other"
  await assert.rejects(inspectHostedLedgerReadOnly(f.io), /journal_scope/); assert.equal(f.reads.length, 0)
})
test("connection mismatch, metadata drift and duplicate scopes refuse before Redis", async () => {
  for (const change of [
    f => { f.values.fixture_2.value = "https://another.upstash.io" },
    f => { f.values.fixture_3.value = "https://fixture-audit.upstash.io/?token=PRIVATE_TOKEN" },
    f => { f.envs[0].updatedAt++ },
    f => { f.envs.push({ ...f.envs[0], id: "duplicate" }) },
    f => { f.values.fixture_4.decrypted = false },
  ]) {
    const f = fixture(); change(f)
    await assert.rejects(inspectHostedLedgerReadOnly(f.io), /cutover_audit_/); assert.equal(f.reads.length, 0)
  }
})
test("partial destination/control and source lock are observations, never repaired", async () => {
  const f = fixture()
  f.io.mget = async () => [JSON.stringify(ledger()), "PRIVATE_LOCK", null, "PRIVATE_CONTROL"]
  const out = await inspectHostedLedgerReadOnly(f.io)
  assert.equal(out.sourceLockPresent, true); assert.equal(out.integrationControlPresent, true)
  assert.equal(out.integrationTargetPresent, false); assert.equal(JSON.stringify(out).includes("PRIVATE_LOCK"), false)
})
test("CLI rejects mutation/scope/credential arguments before any connection", () => {
  for (const args of [[], ["--apply"], ["--read-hosted-ledger", "--url", "PRIVATE"]]) {
    try { execFileSync(process.execPath, ["scripts/hackathon-cutover-audit.mjs", ...args], { cwd: process.cwd(), stdio: "pipe" }); assert.fail("must reject") }
    catch (e) { assert.equal(e.status, 1); assert.match(e.stderr.toString(), /cutover_audit_arguments/); assert.equal(e.stderr.toString().includes("PRIVATE"), false) }
  }
})
