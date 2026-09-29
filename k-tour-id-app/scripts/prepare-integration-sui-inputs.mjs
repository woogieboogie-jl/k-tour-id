// One-shot, runtime-OFF input preparation. Never deploys, activates a provider,
// creates a budget, changes OpenDID, or writes outside the one Preview branch.
import { constants, openSync, fstatSync, readFileSync, writeFileSync, fsyncSync, closeSync, lstatSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { createHmac } from "node:crypto"
import { fileURLToPath } from "node:url"
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519"

export const SCOPE = Object.freeze({ project: "prj_w5rckTz9B1DO55fvVRXjQRy9L5RM", team: "team_6kJAloQ9WlswvMtbbCmGI7Er", branch: "integration/autonomous-finish-20260927" })
const ROOT = "/Users/woogieboogie/github/k-tour-id/.codex-worktrees/integration-inputs-20260929"
const RUN = "/Users/woogieboogie/.local/share/ktour-sui-e2e/run-20260928-pukp3X"
const AUTH = "/Users/woogieboogie/.config/vercel-accounts/jaewook/auth.json"
const JOURNAL = RUN + "/integration-inputs-20260929.jsonl"
const MODE = "HK_INTEGRATION_PREVIEW_ENABLED"
const ID = /^[A-Za-z0-9_-]{1,128}$/
const fail = code => { throw new Error(`integration_inputs_${code}`) }
export const PUBLIC = Object.freeze({
  HK_INTEGRATION_SUI_TARGET: "selfhosted-testnet",
  HK_SUI_GRPC_URL: "https://fullnode.testnet.sui.io:443",
  HK_SUI_CHAIN_IDENTIFIER: "69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD",
  HK_SUI_EXPLORER: "https://suiscan.xyz/testnet",
  HK_SUI_PACKAGE_ID: "0x7a28a5e59d87e385f2eb3047ca2bbe76301627343f8d88eeb0f03733d4f2389e",
  HK_SUI_CAMPAIGN_ID: "0xa273ccd96315ae187b16eb3192c822795bc2031e6f79405739daec4a52275afd",
  HK_SUI_CAMPAIGN_INITIAL_VERSION: "349181963",
})
const PRIOR = Object.freeze({
  HK_SUI_PACKAGE_ID: "0xc5d26326ffd5267bb5b54625c1e2b9c03f7cca4753232d0b042c62ee74fd975d",
  HK_SUI_CAMPAIGN_ID: "0xe3fce96c9c9e1086ff20dd7453e16ff2c52d3d3324e6e4e34446c7d0dc2ecf16",
  HK_SUI_CAMPAIGN_INITIAL_VERSION: "349181955",
})
const PRIVATE = ["HK_SUI_ISSUER_SECRET_KEY", "HK_SUI_AGENT_SECRET_KEY", "HK_SUI_SPONSOR_SECRET_KEY"]
const KEYS = [...Object.keys(PUBLIC), ...PRIVATE]
function scope(row, key) {
  if (!row || row.key !== key || !ID.test(row.id ?? "") || row.gitBranch !== SCOPE.branch || row.target?.length !== 1 || row.target[0] !== "preview" ||
    (row.customEnvironmentIds?.length ?? 0) !== 0 || row.type !== (PRIVATE.includes(key) ? "sensitive" : "encrypted") ||
    !Number.isSafeInteger(row.createdAt) || !Number.isSafeInteger(row.updatedAt) || row.createdAt <= 0 || row.updatedAt < row.createdAt) fail("scope")
  return { id: row.id, createdAt: row.createdAt, updatedAt: row.updatedAt }
}
function one(rows, key, required) {
  const matches = rows.filter(row => row.key === key && row.target?.includes("preview") && (!row.gitBranch || row.gitBranch === SCOPE.branch))
  if (matches.length > 1 || (required && matches.length !== 1)) fail("conflict")
  if (matches.length) scope(matches[0], key)
  return matches[0]
}
function same(a, b) { return a.id === b.id && a.createdAt === b.createdAt && a.updatedAt === b.updatedAt }
function created(response) {
  const rows = Array.isArray(response?.created) ? response.created : response?.created ? [response.created] : []
  if (rows.length !== 1 || (response.failed !== undefined && (!Array.isArray(response.failed) || response.failed.length))) fail("response")
  return rows[0]
}

/** Injected I/O is for offline fixtures; the CLI below pins all real inputs. */
export async function prepareIntegrationInputs(io, apply = false) {
  const user = await io.api("/v2/user"), project = await io.api(`/v9/projects/${SCOPE.project}`)
  if (user?.user?.username !== "jaewook-9643" || project?.id !== SCOPE.project || project.accountId !== SCOPE.team || project.name !== "ondo" ||
    project.rootDirectory !== "k-tour-id-app" || project.link?.type !== "github" || project.link.org !== "woogieboogie-jl" || project.link.repo !== "k-tour-id") fail("project")
  const list = (await io.api(`/v10/projects/${SCOPE.project}/env`)).envs
  if (!Array.isArray(list)) fail("list")
  const read = async row => {
    const value = await io.api(`/v1/projects/${SCOPE.project}/env/${row.id}`)
    if (!same(scope(value, row.key), scope(row, row.key)) || value.decrypted !== true || typeof value.value !== "string") fail("read")
    return value.value
  }
  const flag = one(list, MODE, true), network = one(list, "HK_SUI_NETWORK", true)
  const off = async () => { if (await read(flag) !== "0") fail("runtime_not_off") }
  await off(); if (await read(network) !== "testnet") fail("network")
  const plans = []
  for (const key of KEYS) {
    const row = one(list, key, Object.hasOwn(PRIOR, key))
    if (Object.hasOwn(PRIOR, key)) { if (await read(row) !== PRIOR[key]) fail("prior_tuple"); plans.push({ key, method: "PATCH", before: scope(row, key) }) }
    else { if (row) fail("existing_input"); plans.push({ key, method: "POST" }) }
  }
  const input = io.inputs()
  if (!input || Object.keys(input.values).sort().join() !== KEYS.slice().sort().join() || KEYS.some(key => typeof input.values[key] !== "string" || !input.values[key]) ||
    Object.entries(PUBLIC).some(([key, value]) => input.values[key] !== value) || !/^[a-f0-9]{64}$/.test(input.fingerprint ?? "")) fail("inputs")
  const summary = { branch: SCOPE.branch, runtimeEnabled: false, deployments: 0, created: plans.filter(p => p.method === "POST").map(p => p.key), updated: plans.filter(p => p.method === "PATCH").map(p => p.key) }
  if (!apply) return { ...summary, mutation: false }
  // Must create an exclusive journal BEFORE the first mutation. Existing,
  // interrupted and completed attempts cannot be replayed or silently rotated.
  const log = { schema: "ktour-integration-inputs/v1", ...SCOPE, sourceFingerprint: input.fingerprint, startedAt: new Date().toISOString(), complete: false, entries: [] }
  const fresh = async () => {
    const rows = (await io.api(`/v10/projects/${SCOPE.project}/env`)).envs
    if (!Array.isArray(rows)) fail("list")
    const currentFlag = one(rows, MODE, true), currentNetwork = one(rows, "HK_SUI_NETWORK", true)
    if (!same(scope(currentFlag, MODE), scope(flag, MODE)) || !same(scope(currentNetwork, "HK_SUI_NETWORK"), scope(network, "HK_SUI_NETWORK"))) fail("drift")
    if (await read(currentFlag) !== "0") fail("runtime_not_off")
    if (await read(currentNetwork) !== "testnet") fail("network")
    for (const plan of plans) {
      const done = log.entries.find(entry => entry.key === plan.key)?.after
      const row = one(rows, plan.key, !!done || !!plan.before)
      if (done) { if (!same(scope(row, plan.key), done)) fail("drift") }
      else if (plan.before) {
        if (!same(scope(row, plan.key), plan.before) || await read(row) !== PRIOR[plan.key]) fail("drift")
      } else if (row) fail("drift")
    }
    return rows
  }
  io.begin(log)
  for (const plan of plans) {
    await fresh()
    const entry = { ...plan, intentAt: new Date().toISOString() }; log.entries.push(entry); io.save(log)
    const path = plan.method === "POST" ? `/v10/projects/${SCOPE.project}/env` : `/v9/projects/${SCOPE.project}/env/${plan.before.id}`
    const body = plan.method === "PATCH" ? { value: input.values[plan.key] } : { key: plan.key, value: input.values[plan.key], type: PRIVATE.includes(plan.key) ? "sensitive" : "encrypted", target: ["preview"], gitBranch: SCOPE.branch, comment: "ktour-integration-inputs/20260929:runtime-off" }
    const response = await io.api(path, plan.method, body)
    const row = plan.method === "POST" ? created(response) : response
    const after = scope(row, plan.key)
    if (plan.before && (after.id !== plan.before.id || after.createdAt !== plan.before.createdAt || after.updatedAt < plan.before.updatedAt)) fail("drift")
    entry.after = after; io.save(log)
  }
  const after = await fresh()
  for (const entry of log.entries) if (!same(scope(one(after, entry.key, true), entry.key), entry.after)) fail("drift")
  if (!same(scope(one(after, MODE, true), MODE), scope(flag, MODE)) || !same(scope(one(after, "HK_SUI_NETWORK", true), "HK_SUI_NETWORK"), scope(network, "HK_SUI_NETWORK"))) fail("drift")
  log.complete = true; io.save(log)
  return { ...summary, mutation: "inactive-preview-inputs-only" }
}

function privateJson(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try { const s = fstatSync(fd); if (!s.isFile() || s.uid !== process.getuid() || (s.mode & 0o077) || s.size > 262144) fail("private_file"); return JSON.parse(readFileSync(fd, "utf8")) }
  finally { closeSync(fd) }
}
export function validatedOwnInputs(secret) {
  if (!/^[a-f0-9]{64}$/.test(secret?.credentialSeed ?? "")) fail("private_input")
  try {
    if (Ed25519Keypair.fromSecretKey(secret.issuer).toSuiAddress() !== "0x900cd55f3d9de4541e306c6a3b1fe85cd4ddbf04319ee316ae21b6bb3ba95d76" ||
      Ed25519Keypair.fromSecretKey(secret.agent).toSuiAddress() !== "0x17ee59f56d182c010732daaf509a2b35b221bf7ec62e4a59c3b2ceca2c3bbce4") fail("private_input")
  } catch { fail("private_input") }
  const values = { ...PUBLIC, HK_SUI_ISSUER_SECRET_KEY: secret.issuer, HK_SUI_AGENT_SECRET_KEY: secret.agent, HK_SUI_SPONSOR_SECRET_KEY: secret.issuer }
  return { values, fingerprint: createHmac("sha256", secret.credentialSeed).update(JSON.stringify(KEYS.map(key => [key, values[key]]))).digest("hex") }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let journalFd
  try {
    if (process.argv.length !== 3 || !["plan", "apply"].includes(process.argv[2])) fail("arguments")
    const git = args => execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20000 }).trim()
    if (fileURLToPath(new URL("../..", import.meta.url)) !== ROOT + "/" || git(["branch", "--show-current"]) !== "fix/integration-inputs-20260929" || git(["status", "--porcelain"])) fail("worktree")
    const token = privateJson(AUTH).token
    if (typeof token !== "string" || !/^[A-Za-z0-9_.-]{16,512}$/.test(token)) fail("auth")
    const api = async (path, method = "GET", body) => {
      const url = new URL(path, "https://api.vercel.com"); url.searchParams.set("teamId", SCOPE.team)
      const r = await fetch(url, { method, redirect: "error", signal: AbortSignal.timeout(20000), headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
      if (!r.ok) fail("request_outcome_unconfirmed")
      const text = await r.text(); if (text.length > 1000000) fail("response")
      return JSON.parse(text)
    }
    // Exclusive open fences retries. Each save appends a complete JSONL snapshot
    // and fsyncs the same private inode. The last complete line is the journal;
    // a torn journal blocks another run instead of creating another write.
    const save = value => { if (journalFd === undefined) fail("journal"); const bytes = Buffer.from(JSON.stringify(value) + "\n"); writeFileSync(journalFd, bytes); fsyncSync(journalFd) }
    const result = await prepareIntegrationInputs({ api, inputs: () => validatedOwnInputs(privateJson(RUN + "/private.json")), begin: value => {
      const s = lstatSync(RUN); if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== process.getuid() || (s.mode & 0o077)) fail("journal")
      journalFd = openSync(JOURNAL, "wx", 0o600); save(value)
    }, save }, process.argv[2] === "apply")
    console.log(JSON.stringify(result))
  } catch (error) { console.error(JSON.stringify({ ok: false, code: /^integration_inputs_[a-z_]+$/.test(error?.message ?? "") ? error.message : "integration_inputs_failed" })); process.exitCode = 1 }
  finally { if (journalFd !== undefined) closeSync(journalFd) }
}
