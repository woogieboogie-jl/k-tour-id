// Future main-guide artifact preparation only. No runtime activation, secrets,
// deployment, remote requests, store migration, or provider calls.
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { assertNoIntegrationEnvFiles } from "./hackathon-integration-build.mjs"

export const GUIDE_BRANCH = "deploy/guide-main-20260929"
export const GUIDE_APP_ROOT = resolve(import.meta.dirname, "..")
const tooling = ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "SystemRoot", "LANG", "LC_ALL", "CI"]
const metadata = ["VERCEL", "VERCEL_ENV", "VERCEL_TARGET_ENV", "VERCEL_PROJECT_ID", "VERCEL_ORG_ID", "VERCEL_GIT_PROVIDER", "VERCEL_GIT_COMMIT_REF", "VERCEL_GIT_COMMIT_SHA", "VERCEL_GIT_REPO_OWNER", "VERCEL_GIT_REPO_SLUG"]
const fail = () => { throw new Error("guide_build_refused") }

export function guideBuildEnv(env) {
  const remote = Object.keys(env).some(k => k === "VERCEL" || k.startsWith("VERCEL_"))
  if (remote && (env.VERCEL !== "1" || !["preview", "production"].includes(env.VERCEL_ENV) ||
    (env.VERCEL_TARGET_ENV && env.VERCEL_TARGET_ENV !== env.VERCEL_ENV) ||
    env.VERCEL_PROJECT_ID !== "prj_w5rckTz9B1DO55fvVRXjQRy9L5RM" || env.VERCEL_ORG_ID !== "team_6kJAloQ9WlswvMtbbCmGI7Er" ||
    env.VERCEL_GIT_PROVIDER !== "github" || env.VERCEL_GIT_COMMIT_REF !== GUIDE_BRANCH ||
    env.VERCEL_GIT_REPO_OWNER !== "woogieboogie-jl" || env.VERCEL_GIT_REPO_SLUG !== "k-tour-id" || !/^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA ?? ""))) fail()
  if (!remote && env.NODE_OPTIONS) fail()
  const out = {}
  for (const key of [...tooling, ...metadata]) if (typeof env[key] === "string") out[key] = env[key]
  return { ...out, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_HK_GUIDE_PRODUCTION: "1", NEXT_PUBLIC_HK_HOSTED_SUI: "0", NEXT_PUBLIC_HK_INTEGRATION_PREVIEW: "0",
    NEXT_PUBLIC_HK_CX_PREVIEW: "0", NEXT_PUBLIC_HK_PREVIEW_READ_ONLY: "0", NEXT_PUBLIC_HK_ENABLED: "1", NEXT_PUBLIC_HK_DEMO_ENTRY: "1",
    NEXT_PUBLIC_HK_CX_BROWSER_QR: "0", NEXT_PUBLIC_ONDO_QA_CONTROLS: "0", NEXT_PUBLIC_ONDO_SUMSUB_SANDBOX: "0",
    HK_API_ENABLED: "1", HK_GUIDE_PRODUCTION_ENABLED: "0", HK_ISOLATED_MOCK: "0", HK_MODE_CX: "cx", HK_MODE_OPENDID: "opendid", HK_AI_MODE: "gemini",
  }
}
export function guideBuildPlan({ env, args = [], cwd = GUIDE_APP_ROOT, exists }) {
  if (args.length || resolve(cwd) !== GUIDE_APP_ROOT) fail()
  const buildEnv = guideBuildEnv(env)
  assertNoIntegrationEnvFiles(GUIDE_APP_ROOT, exists)
  return { command: process.execPath, args: [resolve(GUIDE_APP_ROOT, "node_modules/next/dist/bin/next"), "build", "--webpack"],
    options: { cwd: GUIDE_APP_ROOT, env: buildEnv, shell: false, stdio: "inherit", timeout: 10 * 60_000, killSignal: "SIGKILL" } }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const plan = guideBuildPlan({ env: process.env, args: process.argv.slice(2), cwd: process.cwd() })
    console.log("Building guarded main-guide artifact; runtime activation remains disabled.")
    const child = spawnSync(plan.command, plan.args, plan.options)
    process.exitCode = !child.error && child.status === 0 ? 0 : 1
  } catch { console.error("Guide artifact build refused or failed; no activation performed."); process.exitCode = 1 }
}
