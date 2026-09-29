// Inactive guide Preview ONLY. No environment writes, provider secrets, Production,
// aliases, provider requests, or ledger operations. Manual CLI, never build/CI.
import { constants, openSync, fstatSync, readFileSync, closeSync, mkdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { GUIDE_PREPARATION_SCOPE as S, GUIDE_INACTIVE_VALUES, prepareGuideConfiguration } from "./hackathon-guide-prepare.mjs"
import { createJournalStorage } from "./hackathon-hosted-sui-operator.mjs"

const ROOT = "/Users/woogieboogie/github/k-tour-id/.codex-worktrees/guide-main-20260929"
const AUTH = "/Users/woogieboogie/.config/vercel-accounts/jaewook/auth.json"
const RUN = "/Users/woogieboogie/.local/share/ktour-guide-preview-20260929"
const SHA = /^[a-f0-9]{40}$/, HASH = /^[a-f0-9]{64}$/, NONCE = /^[a-f0-9]{32}$/
const SCHEMA = "ktour-guide-inactive-preview/v1", MAX_END = Date.parse(GUIDE_INACTIVE_VALUES.HK_GUIDE_EXPIRES_AT)
const fail = code => { throw new Error(`guide_preview_${code}`) }
const digest = value => createHash("sha256").update(value).digest("hex")
const record = v => v && typeof v === "object" && !Array.isArray(v)
const clone = v => structuredClone(v)

export function validateGuideManifest(value) {
  if (!record(value) || Object.keys(value).sort().join() !== "$schema,buildCommand,framework,git,regions" ||
    value.$schema !== "https://openapi.vercel.sh/vercel.json" || value.buildCommand !== "node scripts/hackathon-guide-build.mjs" ||
    value.framework !== "nextjs" || JSON.stringify(value.regions) !== '["icn1"]' ||
    !record(value.git) || Object.keys(value.git).join() !== "deploymentEnabled" || value.git.deploymentEnabled !== false) fail("manifest")
  return value
}

/** Git deployments use committed vercel.json. projectSettings is NOT used as a
 * per-deploy override: vercel.json takes precedence and shared project settings
 * must not change. The guide branch's sole extra commit installs the manifest.
 * https://vercel.com/docs/project-configuration/vercel-json#buildcommand */
export function guidePreviewLocalCheck() {
  const here = resolve(fileURLToPath(new URL("../..", import.meta.url)))
  const git = args => execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20_000 }).trim()
  if (here !== ROOT || git(["branch", "--show-current"]) !== S.branch || git(["status", "--porcelain"])) fail("worktree")
  if (git(["remote", "get-url", "origin"]) !== "https://github.com/woogieboogie-jl/k-tour-id.git") fail("repository")
  const sha = git(["rev-parse", "HEAD"]), sourceSha = git(["rev-parse", "HEAD^"])
  const remote = git(["ls-remote", "origin", `refs/heads/${S.branch}`, "refs/heads/main"]).split("\n").map(line => line.split(/\s+/))
  if (!SHA.test(sha) || !SHA.test(sourceSha) || remote.length !== 2 || remote.find(r => r[1] === `refs/heads/${S.branch}`)?.[0] !== sha || remote.find(r => r[1] === "refs/heads/main")?.[0] !== sourceSha) fail("revision")
  if (git(["rev-list", "--parents", "-n", "1", "HEAD"]).split(/\s+/).length !== 2 || git(["diff", "--name-only", "HEAD^", "HEAD"]) !== "k-tour-id-app/vercel.json") fail("manifest_commit")
  const manifest = readFileSync(resolve(ROOT, "k-tour-id-app/vercel.guide.json"), "utf8")
  validateGuideManifest(JSON.parse(manifest))
  if (readFileSync(resolve(ROOT, "k-tour-id-app/vercel.json"), "utf8") !== manifest) fail("manifest")
  return { sha, sourceSha, manifestDigest: digest(manifest) }
}

function revision(value) {
  if (!record(value) || !SHA.test(value.sha ?? "") || !SHA.test(value.sourceSha ?? "") || value.sha === value.sourceSha || !HASH.test(value.manifestDigest ?? "")) fail("revision")
  return { sha: value.sha, sourceSha: value.sourceSha, manifestDigest: value.manifestDigest }
}
function journal(value) {
  if (value === null) return { schema: SCHEMA, ...S, deployments: {} }
  if (!record(value) || value.schema !== SCHEMA || value.project !== S.project || value.team !== S.team || value.branch !== S.branch || !record(value.deployments) || Object.keys(value.deployments).length > 32) fail("journal")
  for (const [sha, entry] of Object.entries(value.deployments)) {
    if (!SHA.test(sha) || !record(entry) || !SHA.test(entry.sourceSha ?? "") || !HASH.test(entry.manifestDigest ?? "") || !HASH.test(entry.environmentDigest ?? "") || !NONCE.test(entry.nonce ?? "") || !Number.isFinite(Date.parse(entry.sentAt)) || (entry.id !== undefined && !/^dpl_[A-Za-z0-9]+$/.test(entry.id))) fail("journal")
  }
  return clone(value)
}
function deploymentInfo(value, rev, intent) {
  if (!record(value) || !/^dpl_[A-Za-z0-9]+$/.test(value.id ?? "") || (intent.id && value.id !== intent.id) ||
    value.projectId !== S.project || value.ownerId !== S.team || ![undefined, null, "preview"].includes(value.target) || value.customEnvironment ||
    !/^[a-z0-9-]+\.vercel\.app$/.test(value.url ?? "") || value.meta?.githubCommitRef !== S.branch || value.meta?.githubCommitSha !== rev.sha ||
    value.meta?.ktourGuideSource !== rev.sourceSha || value.meta?.ktourGuideInactive !== intent.nonce || value.meta?.ktourGuideConfig !== intent.environmentDigest ||
    !["QUEUED", "INITIALIZING", "BUILDING", "READY", "ERROR", "CANCELED"].includes(value.readyState) ||
    (value.readyState === "READY" && JSON.stringify(value.regions) !== '["icn1"]')) fail("deployment_binding")
  return { id: value.id, url: `https://${value.url}`, state: value.readyState, target: "preview", branch: S.branch, ...rev, runtimeEnabled: false, providerVerified: false, signingAllowed: false }
}

/** Tests supply in-memory dependencies. CLI has no target/env/URL overrides. */
export function createGuidePreviewOperator(io) {
  const timeCheck = () => { const time = io.now?.() ?? Date.now(); if (!Number.isFinite(time) || time >= MAX_END) fail("expired"); return time }
  const prepared = async () => {
    const summary = await prepareGuideConfiguration({ api: io.api, now: io.now }, false)
    if (summary.wouldCreate.length || summary.runtimeEnabled !== false) fail("not_prepared")
    const { envs } = await io.api(`/v10/projects/${S.project}/env`)
    if (!Array.isArray(envs)) fail("environment")
    const effective = envs.filter(e => (Array.isArray(e.target) ? e.target : [e.target]).includes("preview") && (!e.gitBranch || e.gitBranch === S.branch))
    // Inactive candidate never inherits guide/provider credentials or unknown
    // profile selectors. Only preparation's pinned public values are accepted.
    if (effective.some(e => /^(?:HK_|NEXT_PUBLIC_HK_|KV_|UPSTASH_|ENOKI_|GEMINI_|GOOGLE_|NEXT_PUBLIC_GOOGLE_|NODE_OPTIONS$)/.test(e.key) && !Object.hasOwn(GUIDE_INACTIVE_VALUES, e.key))) fail("unexpected_configuration")
    const publicRows = Object.keys(GUIDE_INACTIVE_VALUES).sort().map(key => {
      const rows = effective.filter(e => e.key === key)
      if (rows.length !== 1 || rows[0].gitBranch !== S.branch) fail("environment")
      return [key, rows[0].id, rows[0].createdAt, rows[0].updatedAt]
    })
    return digest(JSON.stringify(publicRows))
  }
  return async action => {
    if (!["plan", "deploy-preview", "inspect"].includes(action)) fail("action")
    return io.withLock(action, async () => {
      timeCheck()
      const rev = revision(io.localCheck()), environmentDigest = await prepared()
      const project = await io.api(`/v9/projects/${S.project}`)
      if (project.id !== S.project || project.accountId !== S.team || project.name !== "ondo" || project.rootDirectory !== "k-tour-id-app" ||
        project.link?.type !== "github" || project.link?.org !== "woogieboogie-jl" || project.link?.repo !== "k-tour-id" ||
        !["string", "number"].includes(typeof project.link?.repoId) || !/^[1-9][0-9]{0,19}$/.test(String(project.link.repoId)) || (typeof project.link.repoId === "number" && !Number.isSafeInteger(project.link.repoId))) fail("repository")
      const j = journal(io.loadJournal()), existing = j.deployments[rev.sha]
      if (existing && (existing.environmentDigest !== environmentDigest || existing.sourceSha !== rev.sourceSha || existing.manifestDigest !== rev.manifestDigest)) fail("drift")
      if (action === "plan") return { ...S, ...rev, target: "preview", environmentDigest, alreadySubmitted: !!existing, runtimeEnabled: false, providerVerified: false, signingAllowed: false, mutation: false }
      if (existing) {
        if (!existing.id) fail("outcome_unknown")
        return { ...deploymentInfo(await io.api(`/v13/deployments/${existing.id}`), rev, existing), replayed: true }
      }
      if (action === "inspect") fail("not_submitted")
      // Re-check source, public environment and expiry immediately before intent
      // and the only remote write; drift never silently creates a new candidate.
      if (JSON.stringify(revision(io.localCheck())) !== JSON.stringify(rev) || await prepared() !== environmentDigest) fail("drift")
      const nonce = io.nonce?.() ?? randomBytes(16).toString("hex")
      if (!NONCE.test(nonce)) fail("nonce")
      const intent = { ...rev, environmentDigest, nonce, sentAt: new Date(timeCheck()).toISOString() }
      j.deployments[rev.sha] = intent; io.saveJournal(j)
      timeCheck()
      let response
      try { response = await io.api("/v13/deployments", "POST", { name: "ondo", project: S.project, gitSource: { type: "github", repoId: String(project.link.repoId), ref: S.branch, sha: rev.sha },
        meta: { ktourGuideInactive: nonce, ktourGuideSource: rev.sourceSha, ktourGuideConfig: environmentDigest } }) }
      catch { fail("outcome_unknown") }
      const info = deploymentInfo(response, rev, intent)
      intent.id = info.id; io.saveJournal(j)
      return info
    })
  }
}

function privateAuth() {
  const fd = openSync(AUTH, constants.O_RDONLY | constants.O_NOFOLLOW)
  try { const s = fstatSync(fd); if (!s.isFile() || s.uid !== process.getuid() || (s.mode & 0o077) || s.size > 262144) fail("auth"); const token = JSON.parse(readFileSync(fd, "utf8")).token; if (typeof token !== "string" || !/^[A-Za-z0-9_.-]{16,512}$/.test(token)) fail("auth"); return token }
  finally { closeSync(fd) }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3 || !["plan", "deploy-preview", "inspect"].includes(process.argv[2])) fail("arguments")
    guidePreviewLocalCheck()
    const token = privateAuth()
    const api = async (path, method = "GET", body) => {
      const allowedRead = path === "/v2/user" || path === `/v9/projects/${S.project}` || path === `/v10/projects/${S.project}/env` || new RegExp(`^/v1/projects/${S.project}/env/[A-Za-z0-9_-]{1,128}$`).test(path) || /^\/v13\/deployments\/dpl_[A-Za-z0-9]+$/.test(path)
      if (!((method === "GET" && allowedRead) || (method === "POST" && path === "/v13/deployments"))) fail("api_scope")
      const url = new URL(path, "https://api.vercel.com"); url.searchParams.set("teamId", S.team)
      const response = await fetch(url, { method, redirect: "error", signal: AbortSignal.timeout(30_000), headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
      if (!response.ok) fail(method === "GET" ? "read_failed" : "outcome_unknown")
      const reader = response.body?.getReader(); if (!reader) fail("response")
      const chunks = []; let size = 0
      for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 2_000_000) { await reader.cancel(); fail("response") } chunks.push(value) }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"))
    }
    mkdirSync(RUN, { recursive: true, mode: 0o700 })
    // Reuse the tested atomic private-file/lock implementation in a wholly
    // separate directory; no hosted release journal is opened or modified.
    const storage = createJournalStorage(RUN)
    const run = createGuidePreviewOperator({ api, localCheck: guidePreviewLocalCheck, loadJournal: storage.load, saveJournal: storage.save, withLock: storage.lock })
    console.log(JSON.stringify(await run(process.argv[2])))
  } catch (error) { console.error(JSON.stringify({ ok: false, code: /^(?:guide_preview|guide_preparation)_[a-z_]+$/.test(error?.message ?? "") ? error.message : "guide_preview_failed" })); process.exitCode = 1 }
}
