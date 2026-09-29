// Manual, explicitly scoped release operations. Never runs during build/CI.
// Secret values stay in memory. The private journal stores metadata and a keyed
// configuration fingerprint, never values, tokens, or signing keys.
import { readFileSync, lstatSync, fstatSync, openSync, closeSync, writeFileSync, fsyncSync, renameSync, unlinkSync, realpathSync, constants } from "node:fs"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash, createHmac, randomBytes } from "node:crypto"
import { HOSTED_SUI_BRANCH, PROJECT_ID, ORG_ID } from "./hackathon-hosted-sui-build.mjs"
import { PROVIDER_FIXED_VALUES, PROVIDER_SECRET_KEYS, PROVIDER_INPUT_KEYS, PROVIDER_ADDED_KEYS, readHostedProviderInputs } from "./hackathon-hosted-provider-inputs.mjs"

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)))
const EXPECTED_ROOT = "/Users/woogieboogie/github/k-tour-id/.codex-worktrees/sui-main-20260928"
const AUTH = "/Users/woogieboogie/.config/vercel-accounts/jaewook/auth.json"
const RUN = "/Users/woogieboogie/.local/share/ktour-sui-e2e/run-20260928-pukp3X"
const CX_BRANCH = "feat/hackathon-readiness-preview-20260925"
const SCHEMA = "ktour-hosted-sui-release/v1"
const MAX_END = Date.parse("2026-09-30T14:59:59Z")
const ID = /^[A-Za-z0-9_-]{1,128}$/, SHA = /^[a-f0-9]{40}$/, HASH = /^[a-f0-9]{64}$/, NONCE = /^[a-f0-9]{32}$/
const stop = code => { throw new Error(`release_${code}`) }
const API_ERROR_CODES = new Set(["bad_request", "invalid_request", "invalid_request_body", "invalid_request_parameter", "validation_error", "missing_required_property", "unauthorized", "forbidden", "not_found", "conflict", "rate_limited", "too_many_requests", "payment_required", "git_repo_not_found", "git_ref_not_found", "git_reference_conflict", "git_author_must_have_access", "missing_git_author", "deployment_name_invalid", "deployment_limit_reached", "builds_queue_full", "project_not_found", "invalid_project_id"])
const API_FIELDS = Object.freeze({ repoId: "/gitSource/repoId", ref: "/gitSource/ref", sha: "/gitSource/sha", type: "/gitSource/type", gitSource: "/gitSource", name: "/name", project: "/project", meta: "/meta", target: "/target" })
function safeDiagnostic(value) {
  return { kind: value?.kind === "http" ? "http" : "unknown", httpStatus: Number.isInteger(value?.httpStatus) && value.httpStatus >= 400 && value.httpStatus <= 599 ? value.httpStatus : null,
    providerCode: API_ERROR_CODES.has(value?.providerCode) ? value.providerCode : null,
    fieldHints: Object.values(API_FIELDS).filter(field => Array.isArray(value?.fieldHints) && value.fieldHints.includes(field)) }
}
function privateApiMessage(message, redactValues) {
  if (typeof message !== "string") return undefined
  let safe = message
  for (const value of redactValues) if (typeof value === "string" && value.length) safe = safe.split(value).join("[redacted]")
  safe = safe.slice(0, 8192).replace(/-----BEGIN[\s\S]*?-----END[^-]*-----/g, "[redacted]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/https?:\/\/[^\s<>"']+/gi, "[url]")
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[email]")
    .replace(/\b(?:authorization|token|api[_ -]?key|secret|password)\b\s*[:=]\s*["']?[^\s"',;]+/gi, "[redacted]")
    .replace(/[A-Za-z0-9_+/=-]{32,}/g, "[redacted]")
    .replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim()
  return safe.slice(0, 256) || undefined
}
class ApiHttpError extends Error {
  constructor(status, body, options = {}) {
    super(`release_http_${status}`)
    const provider = body?.error, message = typeof provider?.message === "string" ? provider.message.slice(0, 4096) : ""
    // Only fixed field-name hints survive; never retain body/message/values.
    this.diagnostic = safeDiagnostic({ kind: "http", httpStatus: status, providerCode: provider?.code,
      fieldHints: Object.entries(API_FIELDS).filter(([field]) => new RegExp(`\\b${field}\\b`).test(message)).map(([, pointer]) => pointer) })
    // This extra detail is ONLY for the private operator journal. It is never
    // copied into MutationError, inspect output or the command-line error JSON.
    if (options.deploymentError === true) this.privateMessage = privateApiMessage(provider?.message, options.redactValues ?? [])
  }
}
class MutationError extends Error {
  constructor(scope, diagnostic) {
    const failure = safeDiagnostic(diagnostic)
    super(`release_${scope}_${failure.httpStatus >= 400 && failure.httpStatus < 500 && failure.httpStatus !== 408 ? "rejected" : "outcome_unknown"}`)
    this.diagnostic = failure
  }
}
/** Response-only helper for synthetic tests; no credentials or network access. */
export async function readApiResponse(response, options = {}) {
  let raw, parsed
  try { raw = await response.text() } catch { if (!response.ok) throw new ApiHttpError(response.status); stop("response_body") }
  if (raw.length > 2_000_000) { if (!response.ok) throw new ApiHttpError(response.status); stop("response_size") }
  try { parsed = JSON.parse(raw) } catch { if (!response.ok) throw new ApiHttpError(response.status); stop("response_json") }
  if (!response.ok) throw new ApiHttpError(response.status, parsed, options)
  return parsed
}
const record = value => value && typeof value === "object" && !Array.isArray(value)
const targetsOf = item => Array.isArray(item?.target) ? item.target : typeof item?.target === "string" ? [item.target] : []
const sensitive = new Set(["HK_HOSTED_SUI_ACCESS_SECRET", "HK_ISSUER_SIGNING_SEED", "KV_REST_API_TOKEN", "HK_SUI_ISSUER_SECRET_KEY", "HK_SUI_AGENT_SECRET_KEY", "HK_SUI_SPONSOR_SECRET_KEY", ...PROVIDER_SECRET_KEYS])
const fixedValues = Object.freeze({
  NEXT_PUBLIC_HK_HOSTED_SUI: "1", NEXT_PUBLIC_HK_ENABLED: "1", NEXT_PUBLIC_HK_DEMO_ENTRY: "1",
  NEXT_PUBLIC_HK_CX_PREVIEW: "0", NEXT_PUBLIC_HK_INTEGRATION_PREVIEW: "0", NEXT_PUBLIC_HK_PREVIEW_READ_ONLY: "0",
  HK_API_ENABLED: "1", HK_HOSTED_SUI_ENABLED: "1", HK_HOSTED_SUI_EXPIRES_AT: "2026-09-30T14:59:59Z",
  HK_MODE_CX: "mock", HK_MODE_OPENDID: "mock", HK_AI_MODE: "rule", HK_ISOLATED_MOCK: "0", HK_STORE_KEY: "ktour:sui-hosted:20260928:v1",
  HK_SUI_NETWORK: "testnet", HK_SUI_GRPC_URL: "https://fullnode.testnet.sui.io:443",
  HK_SUI_PACKAGE_ID: "0x7a28a5e59d87e385f2eb3047ca2bbe76301627343f8d88eeb0f03733d4f2389e",
  HK_SUI_CAMPAIGN_ID: "0xa273ccd96315ae187b16eb3192c822795bc2031e6f79405739daec4a52275afd",
  HK_SUI_CAMPAIGN_INITIAL_VERSION: "349181963", HK_SUI_EXPLORER: "https://suiscan.xyz/testnet",
})
const dynamicKeys = ["HK_HOSTED_SUI_ACCESS_SECRET", "HK_HOSTED_SUI_ACCESS_CODE", "KV_REST_API_URL", "KV_REST_API_TOKEN", "HK_ISSUER_SIGNING_SEED", "HK_SUI_ISSUER_SECRET_KEY", "HK_SUI_AGENT_SECRET_KEY", "HK_SUI_SPONSOR_SECRET_KEY"]
const allKeys = [...Object.keys(fixedValues), ...dynamicKeys]
const cxValues = Object.freeze({ HK_CX_BASE_URL: "https://cx.raonsecure.co.kr:18543", HK_CX_PROVIDER: "comdl", HK_CX_ZKP_TYPE: "AdultVerify" })
const targetKeys = state => [...allKeys, ...(state?.cxEnabled === true ? Object.keys(cxValues) : []), ...(state?.providersEnabled === true ? PROVIDER_ADDED_KEYS : [])]

function privateJson(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const s = fstatSync(fd)
    if (!s.isFile() || (s.mode & 0o077) || s.uid !== process.getuid() || s.size > 262144) stop("private_file")
    return JSON.parse(readFileSync(fd, "utf8"))
  } finally { closeSync(fd) }
}
/** Exported for offline tests with private temp dirs. CLI always uses RUN. */
export function createJournalStorage(directory) {
  const file = resolve(directory, "hosted-sui-release.json"), lockPath = resolve(directory, ".hosted-sui-release.lock")
  function directoryCheck() {
    const s = lstatSync(directory)
    if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== process.getuid() || (s.mode & 0o077) || realpathSync(directory) !== directory) stop("journal_directory")
  }
  function existingFileCheck() {
    try { const s = lstatSync(file); if (!s.isFile() || s.isSymbolicLink() || s.uid !== process.getuid() || (s.mode & 0o077)) stop("journal_file") }
    catch (error) { if (error?.code !== "ENOENT") throw error }
  }
  function syncDirectory() { const fd = openSync(directory, "r"); try { fsyncSync(fd) } finally { closeSync(fd) } }
  return {
    load() { directoryCheck(); existingFileCheck(); try { return privateJson(file) } catch (error) { if (error?.code === "ENOENT") return null; throw error } },
    save(value) {
      directoryCheck(); existingFileCheck()
      const temporary = `${file}.${randomBytes(8).toString("hex")}.tmp`, fd = openSync(temporary, "wx", 0o600)
      try { writeFileSync(fd, JSON.stringify(value, null, 2) + "\n"); fsyncSync(fd) } finally { closeSync(fd) }
      renameSync(temporary, file); syncDirectory()
    },
    async lock(action, task) {
      directoryCheck()
      let fd
      try { fd = openSync(lockPath, "wx", 0o600) } catch (error) { if (error?.code === "EEXIST") stop("operator_locked"); throw error }
      const own = fstatSync(fd)
      try {
        writeFileSync(fd, JSON.stringify({ pid: process.pid, action, at: new Date().toISOString() })); fsyncSync(fd); syncDirectory()
        return await task()
      } finally {
        closeSync(fd)
        const current = lstatSync(lockPath)
        if (current.dev !== own.dev || current.ino !== own.ino || current.isSymbolicLink()) stop("lock_changed")
        unlinkSync(lockPath); syncDirectory()
      }
    },
  }
}
function git(args) { return execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20000 }).trim() }
function localCheck() {
  if (ROOT !== EXPECTED_ROOT || git(["branch", "--show-current"]) !== HOSTED_SUI_BRANCH || git(["status", "--porcelain"])) stop("local_revision")
  if (git(["remote", "get-url", "origin"]) !== "https://github.com/woogieboogie-jl/k-tour-id.git") stop("repository")
  const sha = git(["rev-parse", "HEAD"])
  if (!SHA.test(sha) || sha !== git(["ls-remote", "origin", `refs/heads/${HOSTED_SUI_BRANCH}`]).split(/\s/)[0]) stop("remote_revision")
  const config = JSON.parse(readFileSync(resolve(ROOT, "k-tour-id-app/vercel.json"), "utf8"))
  if (config.buildCommand !== "node scripts/hackathon-hosted-sui-build.mjs" || config.regions?.join() !== "icn1" || config.git?.deploymentEnabled !== false) stop("build_profile")
  return sha
}
async function api(path, method = "GET", body) {
  if (!path.startsWith("/v") || path.includes("..") || path.includes("://")) stop("api_path")
  const auth = privateJson(AUTH), url = new URL(path, "https://api.vercel.com"); url.searchParams.set("teamId", ORG_ID)
  const response = await fetch(url, { method, redirect: "error", signal: AbortSignal.timeout(30000), headers: { authorization: `Bearer ${auth.token}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return readApiResponse(response, { deploymentError: method === "POST" && path === "/v13/deployments", redactValues: [auth.token] })
}
function journal(value) {
  if (value === null) return { schema: SCHEMA, project: PROJECT_ID, team: ORG_ID, branch: HOSTED_SUI_BRANCH, targets: {} }
  if (!record(value) || value.schema !== SCHEMA || value.project !== PROJECT_ID || value.team !== ORG_ID || value.branch !== HOSTED_SUI_BRANCH || !record(value.targets) || Object.keys(value.targets).some(key => !["preview", "production"].includes(key))) stop("journal_scope")
  return structuredClone(value)
}
function marker(state, key) { return `ktour-hosted-sui/v1:${state.nonce}:${key}` }
function matchesTarget(item, target) { return targetsOf(item).includes(target) && (target === "production" || !item.gitBranch || item.gitBranch === HOSTED_SUI_BRANCH) }
function metadata(item, key, target, state, expected) {
  if (!record(item) || !ID.test(item.id ?? "") || item.key !== key || item.type !== (sensitive.has(key) ? "sensitive" : "encrypted") || targetsOf(item).length !== 1 || targetsOf(item)[0] !== target ||
    (target === "production" ? Boolean(item.gitBranch) : item.gitBranch !== HOSTED_SUI_BRANCH) || (item.customEnvironmentIds?.length ?? 0) !== 0 || item.comment !== marker(state, key) ||
    !Number.isSafeInteger(item.createdAt) || !Number.isSafeInteger(item.updatedAt) || item.createdAt <= 0 || item.updatedAt < item.createdAt) stop("environment_scope")
  if (expected?.id && (item.id !== expected.id || item.createdAt !== expected.createdAt || item.updatedAt !== expected.updatedAt)) stop("environment_drift")
  return { id: item.id, createdAt: item.createdAt, updatedAt: item.updatedAt }
}
function stateCheck(state) {
  if (!record(state) || !NONCE.test(state.nonce ?? "") || !HASH.test(state.fingerprint ?? "") || !record(state.entries) || !record(state.deployments) || Object.keys(state.entries).some(key => !allKeys.includes(key) && !Object.hasOwn(cxValues, key) && !PROVIDER_ADDED_KEYS.includes(key))) stop("journal_target")
  if (state.cxMigration && state.cxMigration.complete !== true) stop("cx_migration_incomplete")
  if (state.providerMigration && state.providerMigration.complete !== true) stop("provider_migration_incomplete")
  if (state.providersEnabled === true && state.cxEnabled !== true) stop("provider_requires_cx")
}
function reconcile(envs, target, state, complete = false) {
  stateCheck(state)
  if (!Array.isArray(envs)) stop("environment_list")
  const missing = []
  // Validate the ENTIRE batch before persisting state or sending any POST.
  for (const key of targetKeys(state)) {
    const matches = envs.filter(item => item.key === key && matchesTarget(item, target)), entry = state.entries[key]
    if (matches.length > 1 || (matches.length && !entry?.intentAt)) stop("existing_target_variable")
    if (matches.length) state.entries[key] = { ...entry, ...metadata(matches[0], key, target, state, entry) }
    else {
      if (entry?.id) stop("environment_drift")
      if (entry?.intentAt) stop("environment_outcome_unknown") // Never retry an indeterminate POST.
      if (complete) stop("target_not_prepared")
      missing.push(key)
    }
  }
  return missing
}
function environmentDigest(state) { return createHash("sha256").update(JSON.stringify(targetKeys(state).map(key => [key, state.entries[key]]))).digest("hex") }
function createdItem(response) {
  // Official SDK: created is one object OR an array; failed is an array.
  // https://github.com/vercel/sdk/blob/main/src/models/createprojectenvop.ts
  if (!record(response) || (response.failed !== undefined && (!Array.isArray(response.failed) || response.failed.length))) stop("environment_create_result")
  const list = Array.isArray(response.created) ? response.created : record(response.created) ? [response.created] : []
  if (list.length !== 1) stop("environment_create_result")
  return list[0]
}
function deploymentInfo(d) {
  if (!record(d) || !/^dpl_[A-Za-z0-9]+$/.test(d.id ?? "") || d.projectId !== PROJECT_ID || d.ownerId !== ORG_ID || !/^[a-z0-9-]+\.vercel\.app$/.test(d.url ?? "") ||
    d.meta?.githubCommitRef !== HOSTED_SUI_BRANCH || !SHA.test(d.meta?.githubCommitSha ?? "") || ![null, undefined, "preview", "production"].includes(d.target)) stop("deployment_scope")
  return { id: d.id, url: d.url, state: /^[A-Z_]+$/.test(d.readyState ?? "") ? d.readyState : null, target: d.target === "production" ? "production" : "preview", branch: HOSTED_SUI_BRANCH, sha: d.meta.githubCommitSha,
    errorCode: /^[a-zA-Z0-9_]+$/.test(d.errorCode ?? "") ? d.errorCode : null }
}
function boundDeployment(d, target, sha, intent, ready = false) {
  const info = deploymentInfo(d)
  if (!record(intent) || info.target !== target || info.sha !== sha || (intent.id && info.id !== intent.id) || d.meta.ktourHostedSuiRelease !== intent.nonce || d.meta.ktourHostedSuiConfig !== intent.environmentDigest) stop("deployment_binding")
  if (ready && (info.state !== "READY" || !Array.isArray(d.regions) || d.regions.length !== 1 || d.regions[0] !== "icn1")) stop("preview_not_ready")
  return info
}

/** Tests inject synthetic in-memory APIs; CLI cannot override any dependency. */
export function createReleaseOperator(io) {
  const now = () => io.now?.() ?? Date.now(), stamp = () => new Date(now()).toISOString(), nonce = () => io.nonce?.() ?? randomBytes(16).toString("hex")
  async function projectCheck() {
    const [user, project] = await Promise.all([io.api("/v2/user"), io.api(`/v9/projects/${PROJECT_ID}`)])
    if (user.user?.username !== "jaewook-9643" || project.id !== PROJECT_ID || project.accountId !== ORG_ID || project.name !== "ondo" || project.rootDirectory !== "k-tour-id-app" || project.link?.org !== "woogieboogie-jl" || project.link?.repo !== "k-tour-id" || project.link?.type !== "github" ||
      !["number", "string"].includes(typeof project.link?.repoId) || !/^[1-9][0-9]{0,19}$/.test(String(project.link.repoId)) || (typeof project.link.repoId === "number" && !Number.isSafeInteger(project.link.repoId))) stop("project")
    return project
  }
  async function listEnvs() { const result = await io.api(`/v10/projects/${PROJECT_ID}/env`); if (!Array.isArray(result.envs)) stop("environment_list"); return result.envs }
  async function readCxValue(envs, key) {
    const entries = envs.filter(e => e.key === key && e.gitBranch === CX_BRANCH && targetsOf(e).length === 1 && targetsOf(e)[0] === "preview")
    if (entries.length !== 1 || !ID.test(entries[0].id ?? "")) stop("source_scope")
    const item = await io.api(`/v1/projects/${PROJECT_ID}/env/${entries[0].id}`)
    if (item.key !== key || item.gitBranch !== CX_BRANCH || targetsOf(item).length !== 1 || targetsOf(item)[0] !== "preview" || item.decrypted !== true || typeof item.value !== "string" || !item.value) stop("source_value")
    return item.value
  }
  async function desiredValues(envs, cxEnabled = false, providersEnabled = false) {
    const [kvUrl, kvToken, code] = await Promise.all(["KV_REST_API_URL", "KV_REST_API_TOKEN", "HK_CX_PREVIEW_ACCESS_CODE"].map(key => readCxValue(envs, key)))
    const privateKeys = io.readSecrets()
    if (!HASH.test(privateKeys.credentialSeed ?? "") || !/^[A-Za-z0-9_-]{32,128}$/.test(code) || ![privateKeys.issuer, privateKeys.agent, kvToken].every(value => typeof value === "string" && value.length >= 32 && value.length <= 1024 && !/[\x00-\x20\x7f]/.test(value))) stop("missing_value")
    let url
    try { url = new URL(kvUrl) } catch { stop("source_value") }
    if (kvUrl !== kvUrl.trim() || /[\x00-\x20\x7f]/.test(kvUrl) || url.protocol !== "https:" || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.upstash\.io$/.test(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== "/" || (url.port && url.port !== "443")) stop("source_value")
    const accessSecret = createHash("sha256").update(`ktour-hosted-sui-access/v1:${privateKeys.credentialSeed}`).digest("hex")
    const values = { ...fixedValues, ...(cxEnabled ? { ...cxValues, HK_MODE_CX: "cx" } : {}), HK_HOSTED_SUI_ACCESS_SECRET: accessSecret, HK_HOSTED_SUI_ACCESS_CODE: code, KV_REST_API_URL: kvUrl, KV_REST_API_TOKEN: kvToken,
      HK_ISSUER_SIGNING_SEED: privateKeys.credentialSeed, HK_SUI_ISSUER_SECRET_KEY: privateKeys.issuer, HK_SUI_AGENT_SECRET_KEY: privateKeys.agent, HK_SUI_SPONSOR_SECRET_KEY: privateKeys.issuer }
    const originalKeys = targetKeys({ cxEnabled })
    const previousFingerprint = createHmac("sha256", privateKeys.credentialSeed).update(JSON.stringify(originalKeys.map(key => [key, values[key]]))).digest("hex")
    if (providersEnabled) {
      if (!cxEnabled || typeof io.readProviderInputs !== "function") stop("provider_input")
      const additions = io.readProviderInputs()
      if (!record(additions) || Object.keys(additions).length !== PROVIDER_INPUT_KEYS.length || PROVIDER_INPUT_KEYS.some(key => typeof additions[key] !== "string" || !additions[key] || additions[key].length > 4096 || /[\x00-\x20\x7f]/.test(additions[key]))) stop("provider_input")
      Object.assign(values, PROVIDER_FIXED_VALUES, additions, { HK_AI_MODE: "gemini" })
    }
    const keys = targetKeys({ cxEnabled, providersEnabled })
    if (Object.keys(values).length !== keys.length || keys.some(key => typeof values[key] !== "string" || !values[key])) stop("missing_value")
    return { values, fingerprint: createHmac("sha256", privateKeys.credentialSeed).update(JSON.stringify(keys.map(key => [key, values[key]]))).digest("hex"),
      previousFingerprint,
      baseFingerprint: createHmac("sha256", privateKeys.credentialSeed).update(JSON.stringify(allKeys.map(key => [key, key === "HK_MODE_CX" ? "mock" : values[key]]))).digest("hex") }
  }
  function prepared(j, target, sha, envs) {
    const state = j.targets[target]
    if (!state?.complete || state.revision !== sha) stop("target_not_prepared")
    reconcile(envs, target, state, true)
    if (state.environmentDigest !== environmentDigest(state)) stop("environment_drift")
    return state
  }
  async function readyTestedPreview(j, sha, envs) {
    const state = prepared(j, "preview", sha, envs), intent = state.deployments[sha], proof = intent?.remoteTests
    if (!intent?.id || intent.environmentDigest !== state.environmentDigest || proof?.deploymentId !== intent.id || proof.sha !== sha || !HASH.test(proof.evidenceSha256 ?? "") || proof.environmentDigest !== state.environmentDigest) stop("preview_tests_required")
    return boundDeployment(await io.api(`/v13/deployments/${intent.id}`), "preview", sha, intent, true)
  }
  return async function command(action, extra, evidenceHash) {
    const simple = ["inspect", "prepare-preview", "prepare-production", "plan-preview", "plan-production", "deploy-preview", "deploy-production", "retry-rejected-preview", "plan-cx-preview", "plan-cx-production", "enable-cx-preview", "enable-cx-production", "plan-providers-preview", "plan-providers-production", "enable-providers-preview", "enable-providers-production"]
    if (!simple.includes(action) && !["status", "reconcile-deployment", "mark-preview-passed"].includes(action)) stop("arguments")
    if ((simple.includes(action) && extra !== undefined) || (action !== "mark-preview-passed" && evidenceHash !== undefined) || (!simple.includes(action) && !/^dpl_[A-Za-z0-9]+$/.test(extra ?? "")) || (action === "mark-preview-passed" && !HASH.test(evidenceHash ?? ""))) stop("arguments")
    const project = await projectCheck()
    if (action === "status") return { ...deploymentInfo(await io.api(`/v13/deployments/${extra}`)), mutation: false }
    if (action === "inspect") {
      const j = journal(io.loadJournal())
      return { project: "ondo", production: /^dpl_[A-Za-z0-9]+$/.test(project.targets?.production?.id ?? "") ? project.targets.production.id : null,
        productionSha: SHA.test(project.targets?.production?.meta?.githubCommitSha ?? "") ? project.targets.production.meta.githubCommitSha : null, branch: HOSTED_SUI_BRANCH, mutation: false,
        preparedTargets: ["preview", "production"].filter(target => j.targets[target]?.complete === true),
        deploymentAttempts: ["preview", "production"].flatMap(target => Object.entries(j.targets[target]?.deployments ?? {}).filter(([sha]) => SHA.test(sha)).map(([sha, intent]) => ({ target, sha,
          id: /^dpl_[A-Za-z0-9]+$/.test(intent?.id ?? "") ? intent.id : null, failure: intent?.failure ? safeDiagnostic(intent.failure) : null }))) }
    }
    const sha = io.localCheck()
    if (!SHA.test(sha)) stop("local_revision")
    if (!Number.isFinite(now()) || now() >= MAX_END) stop("release_expired")
    const work = async () => {
      const j = journal(io.loadJournal()), envs = await listEnvs()
      if (action === "mark-preview-passed" || action === "reconcile-deployment") {
        const d = await io.api(`/v13/deployments/${extra}`), info = deploymentInfo(d), state = prepared(j, info.target, sha, envs), intent = state.deployments[sha]
        if (!intent || intent.environmentDigest !== state.environmentDigest || (action === "mark-preview-passed" && (info.target !== "preview" || intent.id !== extra))) stop("deployment_not_recorded")
        boundDeployment(d, info.target, sha, intent, action === "mark-preview-passed"); intent.id = extra
        if (action === "mark-preview-passed") {
          // OPERATOR ATTESTATION after remote tests; this command runs no browser
          // and issues no credential. Evidence is a report SHA-256, not a secret.
          intent.remoteTests = { deploymentId: extra, sha, evidenceSha256: evidenceHash, environmentDigest: state.environmentDigest, passedAt: stamp() }
        }
        io.saveJournal(j)
        return { ...info, reconciled: true, remoteTestsAttested: action === "mark-preview-passed", mutation: "local-journal-only" }
      }
      const target = action.endsWith("production") ? "production" : "preview"
      if (action.startsWith("plan-providers-") || action.startsWith("enable-providers-")) {
        const state = prepared(j, target, sha, envs)
        if (state.providersEnabled === true) {
          const { fingerprint } = await desiredValues(envs, true, true)
          if (fingerprint !== state.fingerprint) stop("prepared_values_changed")
          return { target, providers: "connected-20260930-v1", mutation: false, alreadyEnabled: true }
        }
        if (state.cxEnabled !== true) stop("provider_requires_cx")
        if (state.deployments[sha]) stop("provider_requires_new_revision")
        for (const key of PROVIDER_ADDED_KEYS) if (envs.some(item => item.key === key && matchesTarget(item, target))) stop("existing_target_variable")
        const { values, fingerprint, previousFingerprint } = await desiredValues(envs, true, true)
        // Compare ALL original secrets and public scope from the same read.
        // Opting into providers cannot bless a store, budget, seed or signer rotation.
        if (state.fingerprint !== previousFingerprint) stop("prepared_values_changed")
        if (target === "production") {
          await readyTestedPreview(j, sha, envs)
          if (j.targets.preview.providersEnabled !== true || j.targets.preview.fingerprint !== fingerprint) stop("provider_preview_tests_required")
        }
        if (action.startsWith("plan-")) return { target, revision: sha, wouldCreate: PROVIDER_ADDED_KEYS, wouldUpdate: ["HK_AI_MODE"], mutation: false }
        state.providerMigration = { startedAt: stamp(), complete: false }; state.complete = false; io.saveJournal(j)
        for (const key of PROVIDER_ADDED_KEYS) {
          state.entries[key] = { intentAt: stamp() }; io.saveJournal(j)
          let response
          try { response = await io.api(`/v10/projects/${PROJECT_ID}/env`, "POST", { key, value: values[key], type: sensitive.has(key) ? "sensitive" : "encrypted", target: [target], ...(target === "preview" ? { gitBranch: HOSTED_SUI_BRANCH } : {}), comment: marker(state, key) }) }
          catch { stop("provider_migration_outcome_unknown") }
          state.entries[key] = { ...state.entries[key], ...metadata(createdItem(response), key, target, state) }; io.saveJournal(j)
        }
        const prior = state.entries.HK_AI_MODE
        state.providerMigration.modeIntentAt = stamp(); io.saveJournal(j)
        let updated
        try { updated = await io.api(`/v9/projects/${PROJECT_ID}/env/${prior.id}`, "PATCH", { value: "gemini" }) }
        catch { stop("provider_migration_outcome_unknown") }
        const next = metadata(updated, "HK_AI_MODE", target, state)
        if (next.id !== prior.id || next.createdAt !== prior.createdAt || next.updatedAt < prior.updatedAt) stop("environment_drift")
        state.entries.HK_AI_MODE = { ...prior, ...next }
        state.providersEnabled = true; state.providerMigration.complete = true; state.fingerprint = fingerprint
        reconcile(await listEnvs(), target, state, true)
        state.environmentDigest = environmentDigest(state); state.complete = true; io.saveJournal(j)
        return { target, revision: sha, providers: "connected-20260930-v1", updated: ["HK_AI_MODE"], created: PROVIDER_ADDED_KEYS, mutation: "environment-only", deploymentRequired: true }
      }
      if (action.startsWith("plan-cx-") || action.startsWith("enable-cx-")) {
        const state = prepared(j, target, sha, envs)
        if (state.cxEnabled === true) return { target, identity: "cx", mutation: false, alreadyEnabled: true }
        // No old Sui-only deployment/attestation may be reused for this SHA.
        if (state.deployments[sha]) stop("cx_requires_new_revision")
        for (const key of Object.keys(cxValues)) if (envs.some(item => item.key === key && matchesTarget(item, target))) stop("existing_target_variable")
        const { fingerprint, baseFingerprint } = await desiredValues(envs, true)
        // Both digests derive from the SAME secret/source snapshot. Migrating
        // public CX flags cannot bless a rotation of untouched target values.
        if (state.fingerprint !== baseFingerprint) stop("prepared_values_changed")
        if (target === "production") {
          await readyTestedPreview(j, sha, envs)
          if (j.targets.preview.cxEnabled !== true || j.targets.preview.fingerprint !== fingerprint) stop("cx_preview_tests_required")
        }
        if (action.startsWith("plan-")) return { target, revision: sha, wouldCreate: Object.keys(cxValues), wouldUpdate: ["HK_MODE_CX"], mutation: false }
        state.cxMigration = { startedAt: stamp(), complete: false }; state.complete = false; io.saveJournal(j)
        // Exactly three public connection values plus the identity-mode switch.
        // Never copy/rotate a signer, seed, Redis credential, or access code.
        for (const [key, value] of Object.entries(cxValues)) {
          state.entries[key] = { intentAt: stamp() }; io.saveJournal(j)
          let response
          try { response = await io.api(`/v10/projects/${PROJECT_ID}/env`, "POST", { key, value, type: "encrypted", target: [target], ...(target === "preview" ? { gitBranch: HOSTED_SUI_BRANCH } : {}), comment: marker(state, key) }) }
          catch { stop("cx_migration_outcome_unknown") }
          state.entries[key] = { ...state.entries[key], ...metadata(createdItem(response), key, target, state) }; io.saveJournal(j)
        }
        const prior = state.entries.HK_MODE_CX
        state.cxMigration.modeIntentAt = stamp(); io.saveJournal(j)
        let updated
        try { updated = await io.api(`/v9/projects/${PROJECT_ID}/env/${prior.id}`, "PATCH", { value: "cx" }) }
        catch { stop("cx_migration_outcome_unknown") }
        const next = metadata(updated, "HK_MODE_CX", target, state)
        if (next.id !== prior.id || next.createdAt !== prior.createdAt || next.updatedAt < prior.updatedAt) stop("environment_drift")
        state.entries.HK_MODE_CX = { ...prior, ...next }
        state.cxEnabled = true; state.cxMigration.complete = true; state.fingerprint = fingerprint
        reconcile(await listEnvs(), target, state, true)
        state.environmentDigest = environmentDigest(state); state.complete = true; io.saveJournal(j)
        return { target, revision: sha, identity: "cx", updated: ["HK_MODE_CX"], created: Object.keys(cxValues), mutation: "environment-only", deploymentRequired: true }
      }
      if (action.startsWith("deploy") || action === "retry-rejected-preview") {
        const state = prepared(j, target, sha, envs)
        if (target === "production") {
          await readyTestedPreview(j, sha, envs)
          if (state.fingerprint !== j.targets.preview.fingerprint) stop("prepared_values_changed")
        }
        let intent = state.deployments[sha], previousAttempts
        if (action === "retry-rejected-preview") {
          // One explicit Preview-only retry after a proven validation rejection.
          // No unknown/timeout/5xx retry, no production retry, no auto invocation.
          if (!intent || intent.id || intent.failure?.kind !== "http" || intent.failure.httpStatus !== 400 || intent.environmentDigest !== state.environmentDigest) stop("preview_retry_not_rejected")
          if (intent.previousAttempts?.length) stop("preview_retry_limit")
          previousAttempts = [intent]; intent = undefined
        }
        if (intent) {
          if (intent.environmentDigest !== state.environmentDigest) stop("environment_drift")
          if (!intent.id) stop("deployment_outcome_unknown")
          return { ...boundDeployment(await io.api(`/v13/deployments/${intent.id}`), target, sha, intent), replayed: true }
        }
        intent = { nonce: nonce(), environmentDigest: state.environmentDigest, sentAt: stamp(), ...(previousAttempts ? { previousAttempts } : {}) }; state.deployments[sha] = intent; io.saveJournal(j)
        let d
        // GitHub SDK accepts number|string repoId. Normalize, without claiming
        // numeric repoId caused the previous unclassified request failure.
        try { d = await io.api("/v13/deployments", "POST", { name: "ondo", project: PROJECT_ID, gitSource: { type: "github", repoId: String(project.link.repoId), ref: HOSTED_SUI_BRANCH, sha },
          meta: { ktourHostedSuiRelease: intent.nonce, ktourHostedSuiConfig: intent.environmentDigest }, ...(target === "production" ? { target: "production" } : {}) }) }
        catch (error) {
          intent.failure = { ...safeDiagnostic(error instanceof ApiHttpError ? error.diagnostic : null), recordedAt: stamp(),
            ...(error instanceof ApiHttpError && error.privateMessage ? { privateMessage: error.privateMessage } : {}) }; io.saveJournal(j)
          throw new MutationError("deployment", intent.failure)
        }
        const info = boundDeployment(d, target, sha, intent); intent.id = info.id; io.saveJournal(j); return info
      }
      const { values, fingerprint } = await desiredValues(envs, j.targets[target]?.cxEnabled === true, j.targets[target]?.providersEnabled === true), state = j.targets[target] ?? { nonce: nonce(), fingerprint, entries: {}, deployments: {} }
      if (state.fingerprint !== fingerprint) stop("prepared_values_changed")
      const missing = reconcile(envs, target, state)
      if (action.startsWith("plan")) return { target, branch: target === "preview" ? HOSTED_SUI_BRANCH : null, revision: sha, wouldCreate: missing, alreadyCreated: targetKeys(state).length - missing.length, mutation: false }
      j.targets[target] = state; state.complete = false; io.saveJournal(j)
      for (const key of missing) {
        state.entries[key] = { intentAt: stamp() }; io.saveJournal(j) // BEFORE each remote POST.
        let response
        try { response = await io.api(`/v10/projects/${PROJECT_ID}/env`, "POST", { key, value: values[key], type: sensitive.has(key) ? "sensitive" : "encrypted", target: [target],
          ...(target === "preview" ? { gitBranch: HOSTED_SUI_BRANCH } : {}), comment: marker(state, key) }) }
        catch (error) {
          state.entries[key].failure = { ...safeDiagnostic(error instanceof ApiHttpError ? error.diagnostic : null), recordedAt: stamp() }; io.saveJournal(j)
          throw new MutationError("environment", state.entries[key].failure)
        }
        state.entries[key] = { ...state.entries[key], ...metadata(createdItem(response), key, target, state) }; io.saveJournal(j)
      }
      reconcile(await listEnvs(), target, state, true)
      state.revision = sha; state.environmentDigest = environmentDigest(state); state.preparedAt = stamp(); state.complete = true; io.saveJournal(j)
      return { target, branch: target === "preview" ? HOSTED_SUI_BRANCH : null, created: missing, reconciledCount: targetKeys(state).length - missing.length, runtimeProfile: state.providersEnabled ? "cx-sui-connected" : state.cxEnabled ? "cx-sui" : "sui-only", revision: sha }
    }
    // Dry runs do not create a lock or journal; every remote request is GET.
    return action.startsWith("plan") ? work() : io.withLock(action, work)
  }
}
const storage = createJournalStorage(RUN)
export const releaseCommand = createReleaseOperator({ api, localCheck, readSecrets: () => privateJson(`${RUN}/private.json`), readProviderInputs: readHostedProviderInputs, loadJournal: storage.load, saveJournal: storage.save, withLock: storage.lock })
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { if (process.argv.length > 5) stop("arguments"); console.log(JSON.stringify(await releaseCommand(process.argv[2], process.argv[3], process.argv[4]))) }
  catch (error) { const code = typeof error?.message === "string" && /^release_[a-z_0-9]+$/.test(error.message) ? error.message : "release_failed";
    console.error(JSON.stringify({ ok: false, code, ...(error instanceof MutationError || error instanceof ApiHttpError ? { failure: safeDiagnostic(error.diagnostic) } : {}) })); process.exitCode = 1 }
}
