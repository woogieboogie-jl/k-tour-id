// Read-only feasibility diagnostic. It never activates a profile or writes Redis.
// CLI has no URL/token/key arguments; fixed account, project and keys only.
import { openSync, readFileSync, fstatSync, closeSync, constants } from "node:fs"
import { fileURLToPath } from "node:url"

export const AUDIT_SCOPE = Object.freeze({
  project: "prj_w5rckTz9B1DO55fvVRXjQRy9L5RM", team: "team_6kJAloQ9WlswvMtbbCmGI7Er", account: "jaewook-9643",
  source: "ktour:sui-hosted:20260928:v1", target: "ktour:integration-preview:autonomous-20260928:v1",
  control: "ktour:integration-cutover:hosted-20260928:v1", branch: "deploy/sui-main-20260928",
  cxBranch: "feat/hackathon-readiness-preview-20260925", maxEnd: Date.parse("2026-09-30T14:59:59Z"),
  retentionMs: 3 * 24 * 60 * 60 * 1000, maxOperations: 10, maxBytes: 2 * 1024 * 1024,
})
const fail = code => { throw new Error(`cutover_audit_${code}`) }
const object = x => x !== null && typeof x === "object" && !Array.isArray(x)
const safeIso = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null
const isoMs = value => Number.isSafeInteger(value) && value > 0 ? new Date(value).toISOString() : null
const targets = row => Array.isArray(row?.target) ? row.target : []
const statuses = new Set(["pending", "succeeded", "failed", "cancelled", "expired"])
const phases = new Set(["identity", "credential", "presentation", "proposal", "delegation", "agent", "fulfillment", "done", "cancelled", "expired", "failed"])

/** Safe summary only: no session IDs, identity data, holders, keys, signatures,
 * transaction bytes, secret material or untrusted provider strings survive. */
export function summarizeHostedLedger(raw, { now = Date.now(), earliestHostedBindingAt = null } = {}) {
  if (raw === null) return { exists: false, activationAuthorized: false }
  if (typeof raw !== "string" || Buffer.byteLength(raw) > AUDIT_SCOPE.maxBytes || !Number.isFinite(now)) fail("ledger_shape")
  let db
  try { db = JSON.parse(raw) } catch { fail("ledger_shape") }
  if (!object(db) || db.version !== 1 || ["sessions", "operations", "redemptions", "outbox", "idempotency", "nonces"].some(k => !object(db[k]))) fail("ledger_shape")
  const rows = Object.entries(db.operations)
  if (rows.length > 1000) fail("ledger_bound")
  const operations = rows.map(([id, op]) => {
    if (!/^op_[A-Za-z0-9_-]{8,64}$/.test(id) || !object(op) || op.operationId !== id) fail("operation_shape")
    const s = object(op.secrets) ? op.secrets : {}, claimStates = []
    if (s.cxStartClaim) claimStates.push("cx-start")
    if (s.delegationPreparation) {
      const stage = s.delegationPreparation.stage
      claimStates.push(["issuing", "building", "ready", "unknown"].includes(stage) ? `issuance-${stage}` : "issuance-unrecognized")
    }
    if (op.agent && ["queued", "unknown"].includes(op.agent.status)) claimStates.push(`agent-${op.agent.status}`)
    if (op.delegation && ["prepared", "unknown"].includes(op.delegation.status)) claimStates.push(`delegation-${op.delegation.status}`)
    return { operationId: id, status: statuses.has(op.status) ? op.status : "unrecognized", phase: phases.has(op.phase) ? op.phase : "unrecognized",
      createdAt: safeIso(op.createdAt), updatedAt: safeIso(op.updatedAt), expiresAt: safeIso(op.expiresAt),
      expiredNow: Number.isFinite(Date.parse(op.expiresAt)) && Date.parse(op.expiresAt) <= now,
      claimStates, signedDelegationPresent: Boolean(s.lastTxBytesB64 || s.sponsorSignature),
      issuedTransactionPresent: Boolean(op.delegation?.entitlement?.txDigest || s.delegationPreparation?.issueTxDigest),
      delegatedTransactionPresent: Boolean(op.delegation?.userTxDigest), agentTransactionPresent: Boolean(op.agent?.txDigest) }
  })
  const outbox = Object.values(db.outbox)
  if (outbox.some(r => !object(r))) fail("ledger_shape")
  const invalidDates = operations.some(r => !r.createdAt || !r.updatedAt || !r.expiresAt)
  const minCreated = operations.length && !invalidDates ? Math.min(...operations.map(r => Date.parse(r.createdAt))) : null
  const staleRowsNow = operations.filter(r => r.updatedAt && Date.parse(r.updatedAt) < now - AUDIT_SCOPE.retentionMs).length
  const oldestSurvivesHardExpiry = !invalidDates && operations.every(r => Date.parse(r.updatedAt) + AUDIT_SCOPE.retentionMs >= AUDIT_SCOPE.maxEnd)
  const binding = safeIso(earliestHostedBindingAt)
  return { exists: true, activationAuthorized: false, operationCount: operations.length,
    remainingCountedSlots: Math.max(0, AUDIT_SCOPE.maxOperations - operations.length), withinTenSlotLimit: operations.length <= AUDIT_SCOPE.maxOperations,
    operations, earliestOperationCreatedAt: minCreated === null ? null : isoMs(minCreated), staleRowsNow,
    currentRowsSurviveHardExpiry: oldestSurvivesHardExpiry,
    configuredWindowFitsRetention: binding === null ? null : Date.parse(binding) <= now && Date.parse(binding) + AUDIT_SCOPE.retentionMs >= AUDIT_SCOPE.maxEnd,
    earliestHostedBindingAt: binding, completeLifetimeHistoryProved: false,
    unresolvedClaimOperations: operations.filter(r => r.claimStates.some(s => s !== "issuance-ready")).length,
    outboxCount: outbox.length, pendingOutboxCount: outbox.filter(r => r.processingClaim || ["pending", "submitted", "unknown"].includes(r.status)).length,
    hasCutoverMarker: db.integrationCutover !== undefined, hasSeparateBudget: db.integrationSuiBudget !== undefined,
    note: "Current rows and timestamps are observations, not an activation, revocation or complete-history attestation." }
}

/** Concrete compatibility feasibility, NOT a permit or a reservation writer.
 * A target operation remains separate. Source receives only an unowned slot.
 * Existing legacy create counts every operations entry under its existing lock. */
export function reservationAuditFixture(operationId, now) {
  if (!/^op_[A-Za-z0-9_-]{8,64}$/.test(operationId) || !Number.isFinite(now) || now >= AUDIT_SCOPE.maxEnd) fail("reservation_fixture")
  return { operationId, kind: "integration_budget_reservation", status: "reserved", phase: "reserved",
    createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), expiresAt: new Date(AUDIT_SCOPE.maxEnd).toISOString() }
}

function privateJson(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try { const s = fstatSync(fd); if (!s.isFile() || s.uid !== process.getuid() || (s.mode & 0o077) || s.size > 1_048_576) fail("private_file"); return JSON.parse(readFileSync(fd, "utf8")) }
  finally { closeSync(fd) }
}
const exactEnv = (row, key, target, branch) => object(row) && row.key === key && /^[A-Za-z0-9_-]{1,128}$/.test(row.id ?? "") &&
  targets(row).length === 1 && targets(row)[0] === target && (branch ? row.gitBranch === branch : !row.gitBranch)

/** Dependency injection is for offline tests. No exported generic Redis client.
 * Vercel port is GET-only; Redis port receives exactly one fixed MGET tuple. */
export async function inspectHostedLedgerReadOnly(io) {
  const { project, team, account, branch, cxBranch, source, target, control } = AUDIT_SCOPE
  const [u, p] = await Promise.all([io.get("/v2/user"), io.get(`/v9/projects/${project}`)])
  if (u?.user?.username !== account || p?.id !== project || p.accountId !== team || p.name !== "ondo" || p.rootDirectory !== "k-tour-id-app" || p.link?.org !== "woogieboogie-jl" || p.link?.repo !== "k-tour-id") fail("scope")
  const listed = await io.get(`/v10/projects/${project}/env`)
  if (!Array.isArray(listed?.envs)) fail("environment_shape")
  const journal = io.journal()
  if (journal?.schema !== "ktour-hosted-sui-release/v1" || journal.project !== project || journal.team !== team || journal.branch !== branch) fail("journal_scope")
  const bindings = []
  for (const t of ["preview", "production"]) {
    const state = journal.targets?.[t], entry = state?.entries?.HK_STORE_KEY
    if (state?.complete !== true || !entry?.id) fail("journal_scope")
    const matches = listed.envs.filter(r => exactEnv(r, "HK_STORE_KEY", t, t === "preview" ? branch : null))
    if (matches.length !== 1) fail("environment_scope")
    const row = matches[0]
    if (row.id !== entry.id || row.createdAt !== entry.createdAt || row.updatedAt !== entry.updatedAt || row.comment !== `ktour-hosted-sui/v1:${state.nonce}:HK_STORE_KEY`) fail("environment_drift")
    const value = await io.get(`/v1/projects/${project}/env/${row.id}`)
    if (!exactEnv(value, "HK_STORE_KEY", t, t === "preview" ? branch : null) || value.decrypted !== true || value.value !== source || !isoMs(row.createdAt)) fail("environment_scope")
    bindings.push({ target: t, createdAt: isoMs(row.createdAt), updatedAt: isoMs(row.updatedAt) })
  }
  const selected = (key, t, b) => {
    const rows = listed.envs.filter(r => exactEnv(r, key, t, b))
    if (rows.length !== 1) fail("connection_scope")
    return rows[0]
  }
  const rows = [selected("KV_REST_API_URL", "production", null), selected("KV_REST_API_URL", "preview", cxBranch), selected("KV_REST_API_TOKEN", "preview", cxBranch)]
  const values = await Promise.all(rows.map(async row => {
    const item = await io.get(`/v1/projects/${project}/env/${row.id}`)
    if (!exactEnv(item, row.key, targets(row)[0], row.gitBranch || null) || item.decrypted !== true || typeof item.value !== "string" || !item.value) fail("connection_scope")
    return item.value
  }))
  const [productionUrl, url, token] = values
  let parsed
  try { parsed = new URL(url) } catch { fail("connection_scope") }
  if (productionUrl !== url || url !== url.trim() || parsed.protocol !== "https:" || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.upstash\.io$/.test(parsed.hostname) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/" || (parsed.port && parsed.port !== "443") || /[\x00-\x20\x7f]/.test(token)) fail("connection_scope")
  const cmd = ["MGET", source, `${source}:lock`, target, control]
  const result = await io.mget({ url, token }, cmd)
  if (!Array.isArray(result) || result.length !== 4 || result.some(v => v !== null && typeof v !== "string")) fail("redis_shape")
  const now = io.now?.() ?? Date.now(), earliestHostedBindingAt = bindings.map(r => r.createdAt).sort()[0]
  return { schema: "ktour-readonly-shared-budget-audit/v1", observedAt: new Date(now).toISOString(), mutation: false,
    configuredBindings: bindings, ledger: summarizeHostedLedger(result[0], { now, earliestHostedBindingAt }),
    sourceLockPresent: result[1] !== null, integrationTargetPresent: result[2] !== null, integrationControlPresent: result[3] !== null,
    limitation: "No old-writer disablement, credential revocation, provider verification, activation or Redis write was performed." }
}

export function createReadOnlyAuditIO() {
  const auth = privateJson("/Users/woogieboogie/.config/vercel-accounts/jaewook/auth.json"), deadline = Date.now() + 45_000
  const journalPath = "/Users/woogieboogie/.local/share/ktour-sui-e2e/run-20260928-pukp3X/hosted-sui-release.json"
  if (typeof auth.token !== "string" || !auth.token) fail("authentication")
  async function readJson(url, init) {
    if (Date.now() >= deadline) fail("deadline")
    const r = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(Math.max(1, Math.min(10000, deadline - Date.now()))) })
    if (!r.ok) fail("read_failed")
    const raw = await r.text()
    if (raw.length > 8_000_000) fail("response_bound")
    try { return JSON.parse(raw) } catch { fail("response_shape") }
  }
  return {
    get: path => {
      if (!/^\/v(?:2\/user|9\/projects\/prj_w5rckTz9B1DO55fvVRXjQRy9L5RM|10\/projects\/prj_w5rckTz9B1DO55fvVRXjQRy9L5RM\/env|1\/projects\/prj_w5rckTz9B1DO55fvVRXjQRy9L5RM\/env\/[A-Za-z0-9_-]{1,128})$/.test(path)) fail("path_scope")
      const url = new URL(path, "https://api.vercel.com"); url.searchParams.set("teamId", AUDIT_SCOPE.team)
      return readJson(url, { method: "GET", headers: { authorization: `Bearer ${auth.token}` } })
    },
    journal: () => privateJson(journalPath),
    mget: async (connection, cmd) => {
      if (JSON.stringify(cmd) !== JSON.stringify(["MGET", AUDIT_SCOPE.source, `${AUDIT_SCOPE.source}:lock`, AUDIT_SCOPE.target, AUDIT_SCOPE.control])) fail("redis_scope")
      const reply = await readJson(connection.url, { method: "POST", headers: { authorization: `Bearer ${connection.token}`, "content-type": "application/json" }, body: JSON.stringify(cmd) })
      if (reply.error) fail("redis_read")
      return reply.result
    },
  }
}
export async function runReadOnlyAudit() { return inspectHostedLedgerReadOnly(createReadOnlyAuditIO()) }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== "--read-hosted-ledger") fail("arguments")
    console.log(JSON.stringify(await runReadOnlyAudit()))
  } catch (error) {
    console.error(JSON.stringify({ mutation: false, error: /^cutover_audit_[a-z_]+$/.test(error?.message ?? "") ? error.message : "cutover_audit_unavailable" }))
    process.exitCode = 1
  }
}
