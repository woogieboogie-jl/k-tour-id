// Build preparation only: no deployment, provider activation, credential loading,
// remote account lookup, or changes to the default CX-only deployment profile.
import { spawnSync } from "node:child_process"
import { lstatSync } from "node:fs"
import { resolve } from "node:path"
import { TARGET } from "./vercel-ktour-account.mjs"

export const INTEGRATION_BRANCH = "integration/autonomous-finish-20260927"
export const APP_ROOT = resolve(import.meta.dirname, "..")
export const BUILD_TIMEOUT_MS = 10 * 60_000
export const ENV_FILES = Object.freeze([
  ".env", ".env.local", ".env.production", ".env.production.local",
  ".env.development", ".env.development.local", ".env.test", ".env.test.local",
])
const TOOLING = Object.freeze(["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "SystemRoot", "LANG", "LC_ALL", "CI"])
const REMOTE_FIELDS = Object.freeze([
  "VERCEL", "VERCEL_ENV", "VERCEL_TARGET_ENV", "VERCEL_PROJECT_ID", "VERCEL_ORG_ID",
  "VERCEL_GIT_PROVIDER", "VERCEL_GIT_COMMIT_REF", "VERCEL_GIT_COMMIT_SHA", "VERCEL_GIT_REPO_OWNER", "VERCEL_GIT_REPO_SLUG",
])
const fail = code => { throw new Error(`integration_build_${code}`) }

/** No remote metadata means a local artifact check, not permission to deploy it. */
export function assertIntegrationTarget(env) {
  const remote = Object.keys(env).some(key => key === "VERCEL" || key.startsWith("VERCEL_"))
  if (!remote) return
  if (env.VERCEL !== "1" || env.VERCEL_ENV !== "preview" ||
    (env.VERCEL_TARGET_ENV !== undefined && env.VERCEL_TARGET_ENV !== "preview") ||
    env.VERCEL_PROJECT_ID !== TARGET.projectId || env.VERCEL_ORG_ID !== TARGET.orgId ||
    env.VERCEL_GIT_PROVIDER !== "github" || env.VERCEL_GIT_COMMIT_REF !== INTEGRATION_BRANCH ||
    env.VERCEL_GIT_REPO_OWNER !== TARGET.repoOwner || env.VERCEL_GIT_REPO_SLUG !== TARGET.repoName ||
    !/^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA ?? "")) fail("target")
}

/**
 * Copy values by known name only. Never even inspect unknown provider/secret values.
 * @returns {Record<string, string>}
 */
export function integrationBuildEnv(env) {
  assertIntegrationTarget(env)
  const out = {}
  for (const name of [...TOOLING, ...REMOTE_FIELDS]) {
    const value = env[name]
    if (typeof value === "string") out[name] = value
  }
  return {
    ...out, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_HK_INTEGRATION_PREVIEW: "1",
    NEXT_PUBLIC_HK_CX_PREVIEW: "0", NEXT_PUBLIC_HK_PREVIEW_READ_ONLY: "0",
    NEXT_PUBLIC_HK_ENABLED: "1", NEXT_PUBLIC_HK_DEMO_ENTRY: "1",
    NEXT_PUBLIC_HK_CX_BROWSER_QR: "0", NEXT_PUBLIC_ONDO_QA_CONTROLS: "0",
    NEXT_PUBLIC_ONDO_SUMSUB_SANDBOX: "0",
    HK_API_ENABLED: "1", HK_INTEGRATION_PREVIEW_ENABLED: "0",
    HK_ISOLATED_MOCK: "0", HK_MODE_CX: "cx", HK_MODE_OPENDID: "opendid", HK_AI_MODE: "rule",
  }
}

function envFileExists(file) {
  try { lstatSync(file); return true }
  catch (error) { if (error?.code === "ENOENT") return false; fail("env_check") }
}

// Inspect path existence only, never contents. Dangling symlinks are refused too.
export function assertNoIntegrationEnvFiles(root, exists = envFileExists) {
  for (const name of ENV_FILES) {
    let present
    try { present = exists(resolve(root, name)) }
    catch { fail("env_check") }
    if (present !== false) fail("env_file")
  }
}

/**
 * Pure plan plus file-existence guard; importing this file never builds anything.
 * @param {{ env: Record<string, string | undefined>, args?: string[], cwd?: string, exists?: (file: string) => boolean }} input
 */
export function integrationBuildPlan({ env, args = [], cwd = APP_ROOT, exists = envFileExists }) {
  if (args.length !== 0) fail("arguments")
  if (resolve(cwd) !== APP_ROOT) fail("cwd")
  const buildEnv = integrationBuildEnv(env)
  // Match the reviewed hosted build policy: validate every remote target field
  // first, then omit Vercel's inherited NODE_OPTIONS via the positive allowlist.
  // Local custom loaders remain disallowed; no option reaches the build child.
  if (env.VERCEL !== "1" && env.NODE_OPTIONS !== undefined && env.NODE_OPTIONS !== "") fail("node_options")
  assertNoIntegrationEnvFiles(APP_ROOT, exists)
  return {
    command: process.execPath,
    args: [resolve(APP_ROOT, "node_modules/next/dist/bin/next"), "build", "--webpack"],
    options: { cwd: APP_ROOT, env: buildEnv, shell: false, stdio: "inherit", timeout: BUILD_TIMEOUT_MS, killSignal: "SIGKILL" },
  }
}

if (process.argv[1] === import.meta.filename) {
  try {
    const plan = integrationBuildPlan({ env: process.env, args: process.argv.slice(2), cwd: process.cwd() })
    console.log("Building locked private integration Preview artifact; no provider credentials or deployment.")
    const result = spawnSync(plan.command, plan.args, plan.options)
    if (result.error) fail("child")
    process.exitCode = result.status === 0 ? 0 : 1
  } catch {
    // Even filesystem or subprocess errors may contain input paths or values.
    console.error("Integration build refused or failed; no deployment or provider activation performed.")
    process.exitCode = 1
  }
}
