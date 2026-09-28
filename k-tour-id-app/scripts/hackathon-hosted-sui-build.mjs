// Build preparation for the explicitly approved hosted-Sui lane. This file
// never deploys, loads provider credentials, or inherits arbitrary env vars.
import { spawnSync } from "node:child_process"
import { lstatSync } from "node:fs"
import { resolve } from "node:path"

export const HOSTED_SUI_BRANCH = "deploy/sui-main-20260928"
export const PROJECT_ID = "prj_w5rckTz9B1DO55fvVRXjQRy9L5RM"
export const ORG_ID = "team_6kJAloQ9WlswvMtbbCmGI7Er"
export const REPO_OWNER = "woogieboogie-jl"
export const REPO_NAME = "k-tour-id"
export const APP_ROOT = resolve(import.meta.dirname, "..")
export const BUILD_TIMEOUT_MS = 10 * 60_000
export const HOSTED_SUI_MAX_EXPIRES_AT = "2026-09-30T14:59:59Z"
export const ENV_FILES = Object.freeze([
  ".env", ".env.local", ".env.production", ".env.production.local",
  ".env.development", ".env.development.local", ".env.test", ".env.test.local",
])
const TOOLING = Object.freeze(["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "SystemRoot", "LANG", "LC_ALL", "CI"])
const REMOTE = Object.freeze([
  "VERCEL", "VERCEL_ENV", "VERCEL_TARGET_ENV", "VERCEL_URL", "VERCEL_REGION",
  "VERCEL_PROJECT_ID", "VERCEL_ORG_ID", "VERCEL_GIT_PROVIDER", "VERCEL_GIT_COMMIT_REF",
  "VERCEL_GIT_COMMIT_SHA", "VERCEL_GIT_REPO_OWNER", "VERCEL_GIT_REPO_SLUG",
])
const PUBLIC_ORIGINS = Object.freeze(["NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_ONDO_B_ORIGIN"])
const fail = code => { throw new Error(`hosted_sui_build_${code}`) }

export function assertHostedSuiTarget(env) {
  const failed = hostedSuiTargetFailures(env)
  if (failed.length) fail("target")
}
export function hostedSuiTargetFailures(env) {
  const remote = Object.keys(env).some(key => key === "VERCEL" || key.startsWith("VERCEL_"))
  if (!remote) return []
  const target = env.VERCEL_ENV
  return [
    env.VERCEL !== "1" || !["preview", "production"].includes(target) || (env.VERCEL_TARGET_ENV !== undefined && env.VERCEL_TARGET_ENV !== target) ? "flags" : null,
    env.VERCEL_PROJECT_ID !== PROJECT_ID ? "project" : null,
    env.VERCEL_ORG_ID !== undefined && env.VERCEL_ORG_ID !== ORG_ID ? "optionalorg" : null,
    env.VERCEL_GIT_PROVIDER !== "github" ? "provider" : null,
    env.VERCEL_GIT_COMMIT_REF !== HOSTED_SUI_BRANCH ? "branch" : null,
    env.VERCEL_GIT_REPO_OWNER !== REPO_OWNER ? "owner" : null,
    env.VERCEL_GIT_REPO_SLUG !== REPO_NAME ? "repo" : null,
    !/^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA ?? "") ? "sha" : null,
  ].filter(Boolean)
}

export function hostedSuiBuildEnv(env) {
  assertHostedSuiTarget(env)
  const out = Object.fromEntries([...TOOLING, ...REMOTE].flatMap(name => typeof env[name] === "string" ? [[name, env[name]]] : []))
  for (const name of PUBLIC_ORIGINS) {
    if (typeof env[name] !== "string") continue
    let url
    try { url = new URL(env[name]) } catch { fail("public_origin") }
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) fail("public_origin")
    out[name] = url.origin
  }
  return {
    ...out,
    NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_HK_HOSTED_SUI: "1", NEXT_PUBLIC_HK_ENABLED: "1", NEXT_PUBLIC_HK_DEMO_ENTRY: "1",
    NEXT_PUBLIC_HK_INTEGRATION_PREVIEW: "0", NEXT_PUBLIC_HK_CX_PREVIEW: "0", NEXT_PUBLIC_HK_PREVIEW_READ_ONLY: "0",
    NEXT_PUBLIC_HK_CX_BROWSER_QR: "0", NEXT_PUBLIC_ONDO_QA_CONTROLS: "0", NEXT_PUBLIC_ONDO_SUMSUB_SANDBOX: "0",
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: "",
    HK_API_ENABLED: "1", HK_ISOLATED_MOCK: "0", HK_MODE_CX: "mock", HK_MODE_OPENDID: "mock", HK_AI_MODE: "rule",
    HK_INTEGRATION_PREVIEW_ENABLED: "0", HK_CX_PREVIEW_ENABLED: "0", HK_HOSTED_SUI_ENABLED: "0", HK_HOSTED_SUI_LOCAL_TEST: "0",
    HK_HOSTED_SUI_EXPIRES_AT: HOSTED_SUI_MAX_EXPIRES_AT,
  }
}

function envFileExists(file) { try { lstatSync(file); return true } catch (error) { if (error?.code === "ENOENT") return false; fail("env_check") } }
export function assertNoHostedSuiEnvFiles(root, exists = envFileExists) {
  for (const name of ENV_FILES) {
    let present
    try { present = exists(resolve(root, name)) } catch { fail("env_check") }
    if (present !== false) fail("env_file")
  }
}

export function hostedSuiBuildPlan({ env, args = [], cwd = APP_ROOT, exists = envFileExists }) {
  if (args.length) fail("arguments")
  if (resolve(cwd) !== APP_ROOT) fail("cwd")
  if (env.NODE_OPTIONS !== undefined && env.NODE_OPTIONS !== "") fail("node_options")
  const buildEnv = hostedSuiBuildEnv(env)
  assertNoHostedSuiEnvFiles(APP_ROOT, exists)
  return { command: process.execPath, args: [resolve(APP_ROOT, "node_modules/next/dist/bin/next"), "build", "--webpack"],
    options: { cwd: APP_ROOT, env: buildEnv, shell: false, stdio: "inherit", timeout: BUILD_TIMEOUT_MS, killSignal: "SIGKILL" } }
}

if (process.argv[1] === import.meta.filename) {
  try { const plan = hostedSuiBuildPlan({ env: process.env, args: process.argv.slice(2), cwd: process.cwd() }); console.log("Building the locked hosted-Sui artifact; no deployment or provider credential loading."); const result = spawnSync(plan.command, plan.args, plan.options); if (result.error) fail("child"); process.exitCode = result.status ?? 1 }
  catch (error) {
    const code = typeof error?.message === "string" && /^hosted_sui_build_[a-z_]+$/.test(error.message) ? error.message.slice("hosted_sui_build_".length) : "failed"
    const failedChecks = code === "target" ? hostedSuiTargetFailures(process.env) : []
    console.error(JSON.stringify({ code, failedChecks }))
    process.exitCode = 1
  }
}
