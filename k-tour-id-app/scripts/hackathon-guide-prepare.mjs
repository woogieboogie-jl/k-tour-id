// Inactive, public configuration preparation only. Never reads/copies provider
// secrets, deploys, changes Production, enables runtime, or touches any ledger.
import { constants, openSync, fstatSync, readFileSync, writeFileSync, fsyncSync, closeSync, lstatSync, mkdirSync, realpathSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import { GUIDE_BRANCH } from "./hackathon-guide-build.mjs"

export const GUIDE_PREPARATION_SCOPE = Object.freeze({ project: "prj_w5rckTz9B1DO55fvVRXjQRy9L5RM", team: "team_6kJAloQ9WlswvMtbbCmGI7Er", branch: GUIDE_BRANCH })
export const GUIDE_INACTIVE_VALUES = Object.freeze({
  HK_GUIDE_PRODUCTION_ENABLED: "0", NEXT_PUBLIC_HK_GUIDE_PRODUCTION: "1", HK_GUIDE_EXPIRES_AT: "2026-09-30T14:59:59Z",
  HK_API_ENABLED: "1", NEXT_PUBLIC_HK_ENABLED: "1", NEXT_PUBLIC_HK_DEMO_ENTRY: "0",
  NEXT_PUBLIC_HK_HOSTED_SUI: "0", HK_HOSTED_SUI_ENABLED: "0", NEXT_PUBLIC_HK_INTEGRATION_PREVIEW: "0", HK_INTEGRATION_PREVIEW_ENABLED: "0",
  NEXT_PUBLIC_HK_CX_PREVIEW: "0", HK_CX_PREVIEW_ENABLED: "0", NEXT_PUBLIC_HK_PREVIEW_READ_ONLY: "0",
  NEXT_PUBLIC_HK_CX_BROWSER_QR: "0", NEXT_PUBLIC_ONDO_QA_CONTROLS: "0", NEXT_PUBLIC_ONDO_SUMSUB_SANDBOX: "0",
  HK_ISOLATED_MOCK: "0", HK_MODE_CX: "cx", HK_MODE_OPENDID: "opendid", HK_AI_MODE: "gemini",
  HK_CX_BASE_URL: "https://cx.raonsecure.co.kr:18543", HK_CX_PROVIDER: "comdl", HK_CX_ZKP_TYPE: "AdultVerify", HK_CX_SAMPLE_FALLBACK: "0",
  HK_STORE_KEY: "ktour:integration-preview:autonomous-20260928:v1", HK_INTEGRATION_SUI_TARGET: "selfhosted-testnet",
  HK_SUI_NETWORK: "testnet", HK_SUI_CHAIN_IDENTIFIER: "69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD", HK_SUI_GRPC_URL: "https://fullnode.testnet.sui.io:443",
  HK_SUI_PACKAGE_ID: "0x7a28a5e59d87e385f2eb3047ca2bbe76301627343f8d88eeb0f03733d4f2389e",
  HK_SUI_CAMPAIGN_ID: "0xa273ccd96315ae187b16eb3192c822795bc2031e6f79405739daec4a52275afd", HK_SUI_CAMPAIGN_INITIAL_VERSION: "349181963",
  HK_SUI_EXPLORER: "https://suiscan.xyz/testnet", HK_OMNIONE_CHAIN_ID: "201210", HK_OMNIONE_REGISTRY_ADDRESS: "0x696bc4e29c8f8079b6d3cd49d310a09577550e4c",
})
const S = GUIDE_PREPARATION_SCOPE, KEYS = Object.keys(GUIDE_INACTIVE_VALUES), FLAG = "HK_GUIDE_PRODUCTION_ENABLED"
const MARKER = "ktour-guide-preparation/v1:runtime-off", ID = /^[A-Za-z0-9_-]{1,128}$/
const ROOT = "/Users/woogieboogie/github/k-tour-id/.codex-worktrees/main-journey-20260929"
const AUTH = "/Users/woogieboogie/.config/vercel-accounts/jaewook/auth.json"
const RUN = "/Users/woogieboogie/.local/share/ktour-guide-preparation-20260929"
const MAX_END = Date.parse(GUIDE_INACTIVE_VALUES.HK_GUIDE_EXPIRES_AT)
export const GUIDE_PRIVATE_INPUT_NAMES = Object.freeze([
  "HK_GUIDE_ACCESS_SECRET", "HK_GUIDE_ACCESS_CODE", "HK_ISSUER_SIGNING_SEED", "KV_REST_API_URL", "KV_REST_API_TOKEN",
  "HK_SUI_ISSUER_SECRET_KEY", "HK_SUI_AGENT_SECRET_KEY", "HK_SUI_SPONSOR_SECRET_KEY",
  "HK_OMNIONE_RPC_URL", "HK_OMNIONE_PRIVATE_KEY", "NEXT_PUBLIC_GOOGLE_CLIENT_ID", "HK_ZKLOGIN_SALT_SEED",
  "HK_ZKLOGIN_PROVER_URL", "GEMINI_API_KEY", "HK_OPENDID_BRIDGE_URL", "HK_OPENDID_TRUSTED_ORIGIN", "HK_OPENDID_BRIDGE_TOKEN",
  "HK_OPENDID_OWNER_BINDING_SECRET", "HK_OPENDID_ISSUER_DID", "HK_OPENDID_SCHEMA_ID",
])
const fail = code => { throw new Error(`guide_preparation_${code}`) }
const metadata = row => ({ id: row.id, createdAt: row.createdAt, updatedAt: row.updatedAt })
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const HTTP_CODES = new Set(["bad_request", "invalid_request", "invalid_request_body", "invalid_request_parameter", "invalid_git_branch", "git_branch_not_found", "git_ref_not_found", "not_found", "project_not_found", "unauthorized", "forbidden", "conflict", "env_key_already_exists", "environment_variable_already_exists", "too_many_requests", "rate_limited"])
class PreparationHttpError extends Error {
  constructor(status, code, method) {
    super(`guide_preparation_${method === "GET" ? "read_failed" : "unconfirmed_write"}`)
    this.diagnostic = { kind: "http", httpStatus: Number.isInteger(status) && status >= 400 && status <= 599 ? status : null,
      providerCode: HTTP_CODES.has(code) ? code : null,
      outcome: [400, 401, 402, 403, 404, 405, 409, 410, 413, 415, 422].includes(status) ? "rejected" : "unknown" }
  }
}
const writeDiagnostic = error => error instanceof PreparationHttpError ? error.diagnostic : { kind: "unknown", httpStatus: null, providerCode: null, outcome: "unknown" }

/** Read public API responses with an allocation bound, not just a post-read
 * length check. The caller's request deadline also covers these body reads. */
export async function readGuidePreparationResponse(response, method = "GET") {
  const reader = response.body?.getReader()
  let parsed
  try {
    const length = response.headers.get("content-length")
    if (length && (!/^\d+$/.test(length) || Number(length) > 2_000_000)) fail("response")
    if (!reader) fail("response")
    const chunks = []; let size = 0
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > 2_000_000) fail("response")
      chunks.push(chunk.value)
    }
    try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))) }
    catch { fail("response") }
  } catch (error) {
    // Keep only fixed status/code fields. Error body/message/value never escapes.
    if (!response.ok) throw new PreparationHttpError(response.status, null, method)
    throw error
  } finally {
    if (reader) { void reader.cancel().catch(() => undefined); reader.releaseLock() }
  }
  if (!response.ok) throw new PreparationHttpError(response.status, parsed?.error?.code, method)
  return parsed
}

function scoped(rows, key) {
  const relevant = rows.filter(row => row.key === key && (Array.isArray(row.target) ? row.target : [row.target]).includes("preview") && (!row.gitBranch || row.gitBranch === S.branch))
  // Do not change project/global rows or silently rely on shadow precedence.
  if (relevant.length > 1) fail("shadowed_variable")
  const row = relevant[0]
  if (!row) return null
  if (!ID.test(row.id ?? "") || row.gitBranch !== S.branch || row.target?.length !== 1 || row.target[0] !== "preview" ||
    row.type !== "encrypted" || row.comment !== MARKER || (row.customEnvironmentIds?.length ?? 0) !== 0 ||
    !Number.isSafeInteger(row.createdAt) || !Number.isSafeInteger(row.updatedAt) || row.createdAt <= 0 || row.updatedAt < row.createdAt) fail("scope")
  return row
}
function created(response) {
  const rows = Array.isArray(response?.created) ? response.created : response?.created ? [response.created] : []
  if (rows.length !== 1 || (response.failed !== undefined && (!Array.isArray(response.failed) || response.failed.length))) fail("unconfirmed_write")
  return rows[0]
}

/** All executable mutations are fixed PUBLIC literals, one Preview branch.
 * Injected APIs/journal are synthetic-test seams, never CLI parameters. */
export async function prepareGuideConfiguration(io, apply = false) {
  const now = () => io.now?.() ?? Date.now()
  const timeCheck = () => { if (!Number.isFinite(now()) || now() >= MAX_END) fail("expired") }
  timeCheck()
  const [u, p] = await Promise.all([io.api("/v2/user"), io.api(`/v9/projects/${S.project}`)])
  if (u?.user?.username !== "jaewook-9643" || p?.id !== S.project || p.accountId !== S.team || p.name !== "ondo" ||
    p.rootDirectory !== "k-tour-id-app" || p.link?.type !== "github" || p.link.org !== "woogieboogie-jl" || p.link.repo !== "k-tour-id") fail("project")
  const list = async () => { const v = (await io.api(`/v10/projects/${S.project}/env`)).envs; if (!Array.isArray(v) || v.length > 1024) fail("inventory"); return v }
  const checkValue = async row => {
    const v = await io.api(`/v1/projects/${S.project}/env/${row.id}`)
    if (!equal(metadata(scoped([v], row.key) ?? {}), metadata(row)) || v.decrypted !== true || v.value !== GUIDE_INACTIVE_VALUES[row.key]) fail("value_drift")
  }
  const first = await list(), prior = {}, pending = []
  for (const key of KEYS) {
    const row = scoped(first, key)
    if (row) { await checkValue(row); prior[key] = metadata(row) } else pending.push(key)
  }
  const summary = { ...S, target: "preview", runtimeEnabled: false, providerVerified: false, signingAllowed: false,
    wouldCreate: pending, alreadyPrepared: KEYS.length - pending.length, secretsRead: 0, deployments: 0, ledgerWrites: 0,
    // Metadata existence is not validity, provider permission or ownership.
    privateConfiguration: GUIDE_PRIVATE_INPUT_NAMES.map(name => ({ name, branchRowPresent: first.some(row => row.key === name && row.gitBranch === S.branch && row.target?.includes("preview")), validity: "not_verified" })),
    requiredBeforeActivation: ["approved_native_cx_holder_mapping", "guide_specific_native_policy", "shared_lifetime_budget_authority", "validated_provider_inputs", "actual_human_consent_and_provider_evidence"],
    automatedOperatorWork: ["copy_existing_authorized_sui_and_redis_inputs", "generate_guide_access_values", "preserve_zklogin_salt_continuity", "deploy_same_sha_and_verify_main_flow"],
  }
  if (!apply || !pending.length) return { ...summary, mutation: false }
  const branchSha = io.checkBranch?.()
  if (!/^[a-f0-9]{40}$/.test(branchSha ?? "")) fail("branch_not_pushed")
  // The kill switch is always first. No code path ever changes its value to1.
  if (!prior[FLAG] && pending[0] !== FLAG) fail("flag_order")
  const log = { schema: "ktour-guide-preparation/v1", ...S, at: new Date(now()).toISOString(), prior, entries: [], complete: false }
  io.begin(log)
  const fresh = async () => {
    timeCheck()
    const rows = await list()
    for (const key of KEYS) {
      const expected = log.entries.find(e => e.key === key)?.after ?? prior[key], actual = scoped(rows, key)
      if (expected ? !actual || !equal(metadata(actual), expected) : actual) fail("metadata_drift")
      if (actual) await checkValue(actual)
    }
  }
  for (const key of pending) {
    await fresh()
    const entry = { key, intentAt: new Date(now()).toISOString() }; log.entries.push(entry); io.save(log)
    // Revalidate time immediately before the request. Outcome-unknown is NOT retried.
    timeCheck()
    if (io.checkBranch?.() !== branchSha) fail("branch_drift")
    const body = { key, value: GUIDE_INACTIVE_VALUES[key], target: ["preview"], gitBranch: S.branch, type: "encrypted", comment: MARKER }
    let response
    try { response = await io.api(`/v10/projects/${S.project}/env`, "POST", body) }
    catch (error) { entry.failure = { ...writeDiagnostic(error), recordedAt: new Date(now()).toISOString() }; io.save(log); throw error }
    const row = scoped([created(response)], key)
    if (!row) fail("unconfirmed_write")
    await checkValue(row)
    entry.after = metadata(row); io.save(log)
  }
  await fresh(); log.complete = true; io.save(log)
  return { ...summary, mutation: "inactive-guide-preview-public-configuration-only", created: pending }
}

/** Explicit one-off recovery ONLY for a first unknown public kill-switch=0
 * create. Stable absence is not transaction proof; safety comes from this fixed
 * inert value, no upsert, preserved original journal, exclusive second journal,
 * repeated complete inventories and fail-closed duplicate/foreign-row checks.
 * There is no generic retry, delete, overwrite, active flag or secret recovery. */
export async function reconcileGuideFirstWrite(io, original) {
  const old = original?.log, hash = original?.sha256
  if (!old || old.schema !== "ktour-guide-preparation/v1" || old.project !== S.project || old.team !== S.team || old.branch !== S.branch ||
    old.complete !== false || old.recovery || !old.prior || Object.keys(old.prior).length || !Array.isArray(old.entries) || old.entries.length !== 1 ||
    old.entries[0].key !== FLAG || old.entries[0].after || !/^[a-f0-9]{64}$/.test(hash ?? "")) fail("recovery_scope")
  const intentAt = Date.parse(old.entries[0].intentAt), startedAt = Date.parse(old.at)
  const now = () => io.now?.() ?? Date.now()
  if (!Number.isFinite(intentAt) || !Number.isFinite(startedAt) || intentAt < startedAt || !Number.isFinite(now()) || now() - intentAt < 60_000 || now() >= MAX_END) fail("recovery_age")
  const branchSha = io.checkBranch?.()
  if (!/^[a-f0-9]{40}$/.test(branchSha ?? "")) fail("branch_not_pushed")
  const checks = []
  for (let i = 0; i < 3; i++) {
    if (i) await io.sleep(5000)
    const time = now()
    if (!Number.isFinite(time) || time - intentAt < 60_000 || time >= MAX_END || (i && time - Date.parse(checks[i - 1].at) < 5000) || io.checkBranch?.() !== branchSha) fail("recovery_drift")
    const result = await io.api(`/v10/projects/${S.project}/env`)
    if (!Array.isArray(result.envs) || result.envs.length > 1024 || result.pagination?.next != null || result.continuationToken) fail("inventory")
    const relevant = result.envs.filter(row => (Array.isArray(row.target) ? row.target : [row.target]).includes("preview") &&
      (row.gitBranch === S.branch || (!row.gitBranch && KEYS.includes(row.key))))
    if (relevant.length) fail("recovery_not_absent")
    checks.push({ at: new Date(time).toISOString(), relevantRows: 0 })
  }
  return prepareGuideConfiguration({ ...io,
    checkBranch: () => { const current = io.checkBranch?.(); if (current !== branchSha) fail("branch_drift"); return current },
    begin: log => {
      if (Object.keys(log.prior).length) fail("recovery_not_absent")
      log.recovery = { kind: "explicit-first-inactive-write-only", originalJournalSha256: hash, originalIntentAt: old.entries[0].intentAt, branchSha, absenceChecks: checks }
      io.begin(log)
    },
  }, true)
}

function privateJson(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try { const s = fstatSync(fd); if (!s.isFile() || s.uid !== process.getuid() || (s.mode & 0o077) || s.size > 262144) fail("private_file"); return JSON.parse(readFileSync(fd, "utf8")) }
  finally { closeSync(fd) }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let journalFd
  try {
    if (process.argv.length !== 3 || !["plan", "prepare", "prepare-reconciled-first-write"].includes(process.argv[2])) fail("arguments")
    const recovering = process.argv[2] === "prepare-reconciled-first-write"
    const git = args => execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20000 }).trim()
    if (fileURLToPath(new URL("../..", import.meta.url)) !== ROOT + "/" || git(["branch", "--show-current"]) !== "integration/main-journey-20260929" ||
      (process.argv[2] !== "plan" && git(["status", "--porcelain"]))) fail("worktree")
    const checkBranch = () => {
      const matches = git(["ls-remote", "origin", `refs/heads/${S.branch}`]).split(/\s+/)
      if (matches.length !== 2 || matches[1] !== `refs/heads/${S.branch}` || !/^[a-f0-9]{40}$/.test(matches[0])) fail("branch_not_pushed")
      return matches[0]
    }
    if (process.argv[2] !== "plan") checkBranch()
    const token = privateJson(AUTH).token
    if (typeof token !== "string" || !/^[A-Za-z0-9_.-]{16,512}$/.test(token)) fail("auth")
    const api = async (path, method = "GET", body) => {
      const url = new URL(path, "https://api.vercel.com"); url.searchParams.set("teamId", S.team)
      const r = await fetch(url, { method, redirect: "error", signal: AbortSignal.timeout(15000), headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
      return readGuidePreparationResponse(r, method)
    }
    const save = value => { if (journalFd === undefined) fail("journal"); writeFileSync(journalFd, JSON.stringify(value) + "\n"); fsyncSync(journalFd) }
    const io = { api, checkBranch, sleep: ms => new Promise(resolve => setTimeout(resolve, ms)), begin: value => {
      mkdirSync(RUN, { recursive: true, mode: 0o700 })
      const s = lstatSync(RUN); if (!s.isDirectory() || s.isSymbolicLink() || realpathSync(RUN) !== RUN || s.uid !== process.getuid() || (s.mode & 0o077)) fail("journal")
      journalFd = openSync(RUN + (recovering ? "/public-inputs.reconciled.jsonl" : "/public-inputs.jsonl"), "wx", 0o600); save(value)
    }, save }
    let result
    if (recovering) {
      // Original file is read-only and remains untouched. Only complete lines
      // with identical scope are considered; malformed/truncated logs refuse.
      const fd = openSync(RUN + "/public-inputs.jsonl", constants.O_RDONLY | constants.O_NOFOLLOW)
      let raw
      try { const s = fstatSync(fd); if (!s.isFile() || s.uid !== process.getuid() || (s.mode & 0o077) || s.size > 262144) fail("private_file"); raw = readFileSync(fd, "utf8") }
      finally { closeSync(fd) }
      if (!raw.endsWith("\n")) fail("recovery_journal")
      const lines = raw.trimEnd().split("\n").map(line => JSON.parse(line))
      if (lines.length < 2 || lines.length > 4 || lines.some(log => log.schema !== "ktour-guide-preparation/v1" || log.project !== S.project || log.team !== S.team || log.branch !== S.branch || log.complete !== false || log.recovery || Object.keys(log.prior ?? {}).length || !Array.isArray(log.entries) || log.entries.length > 1 || log.entries.some(e => e.key !== FLAG || e.after))) fail("recovery_journal")
      result = await reconcileGuideFirstWrite(io, { log: lines.at(-1), sha256: createHash("sha256").update(raw).digest("hex") })
    } else result = await prepareGuideConfiguration(io, process.argv[2] === "prepare")
    console.log(JSON.stringify(result))
  } catch (error) { console.error(JSON.stringify({ ok: false, code: /^guide_preparation_[a-z_]+$/.test(error?.message ?? "") ? error.message : "guide_preparation_failed", ...(error instanceof PreparationHttpError ? { diagnostic: error.diagnostic } : {}) })); process.exitCode = 1 }
  finally { if (journalFd !== undefined) closeSync(journalFd) }
}
