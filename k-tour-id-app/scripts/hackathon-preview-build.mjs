import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { resolve } from "node:path"

export const PREVIEW_BRANCH = "feat/hackathon-readiness-preview-20260925"

export function assertPreviewTarget(env) {
  if (env.VERCEL_ENV === "production") throw new Error("Readiness profile cannot be deployed to Production")
  const hasVercelMetadata = Object.keys(env).some(key => key === "VERCEL" || key.startsWith("VERCEL_"))
  if (hasVercelMetadata && (
    env.VERCEL !== "1" ||
    env.VERCEL_ENV !== "preview" ||
    env.VERCEL_GIT_PROVIDER !== "github" ||
    env.VERCEL_GIT_COMMIT_REF !== PREVIEW_BRANCH ||
    env.VERCEL_GIT_REPO_OWNER !== "woogieboogie-jl" ||
    env.VERCEL_GIT_REPO_SLUG !== "k-tour-id" ||
    !/^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA ?? "")
  )) throw new Error("Readiness profile requires the approved GitHub Preview branch and revision")
}

export function previewBuildEnv(env) {
  assertPreviewTarget(env)
  // Only transport/build tooling variables are inherited. Never copy provider,
  // chain, OAuth, AI or storage keys into a build/prerender process.
  const allowed = [
    "PATH", "HOME", "TMPDIR", "TMP", "TEMP", "SystemRoot", "LANG", "LC_ALL", "CI",
    "VERCEL", "VERCEL_ENV", "VERCEL_TARGET_ENV", "VERCEL_URL", "VERCEL_REGION",
    "VERCEL_PROJECT_ID", "VERCEL_ORG_ID",
    "VERCEL_GIT_PROVIDER", "VERCEL_GIT_COMMIT_REF", "VERCEL_GIT_COMMIT_SHA", "VERCEL_GIT_REPO_OWNER", "VERCEL_GIT_REPO_SLUG",
  ]
  const out = Object.fromEntries(Object.entries(env).filter(([key]) => allowed.includes(key)))
  return {
    ...out, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_HK_PREVIEW_READ_ONLY: "1",
    NEXT_PUBLIC_HK_CX_PREVIEW: "0",
    NEXT_PUBLIC_HK_ENABLED: "1", NEXT_PUBLIC_HK_DEMO_ENTRY: "1",
    NEXT_PUBLIC_HK_CX_BROWSER_QR: "0", NEXT_PUBLIC_ONDO_QA_CONTROLS: "0",
    HK_API_ENABLED: "1", HK_ISOLATED_MOCK: "1",
    HK_MODE_CX: "mock", HK_MODE_OPENDID: "mock", HK_AI_MODE: "rule",
  }
}

export function cxPreviewBuildEnv(env) {
  return {
    ...previewBuildEnv(env),
    NEXT_PUBLIC_HK_PREVIEW_READ_ONLY: "0", NEXT_PUBLIC_HK_CX_PREVIEW: "1",
    HK_ISOLATED_MOCK: "0", HK_MODE_CX: "cx",
  }
}

if (process.argv[1] === import.meta.filename) {
  try {
    for (const file of [".env", ".env.local", ".env.production", ".env.production.local"]) {
      if (existsSync(resolve(file))) throw new Error("Readiness builds must not load local env files")
    }
    if (process.argv.slice(2).some(arg => arg !== "--cx-only")) throw new Error("Unknown preview profile")
    const cxOnly = process.argv.includes("--cx-only")
    const env = cxOnly ? cxPreviewBuildEnv(process.env) : previewBuildEnv(process.env)
    console.log(cxOnly ? "Building private CX-only preview; runtime access and Redis required" : "Building read-only UI + API readiness preview; no provider credentials")
    const result = spawnSync(process.execPath, ["node_modules/next/dist/bin/next", "build", "--webpack"], { env, stdio: "inherit" })
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Readiness build refused")
    process.exitCode = 1
  }
}
