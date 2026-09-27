import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { resolve } from "node:path"

export const PREVIEW_BRANCH = "integration/sumsub-live-20260927"
const REPO_OWNER = "woogieboogie-jl"
const REPO_SLUG = "k-tour-id"

export function assertPreviewTarget(env) {
  if (env.VERCEL_ENV === "production") throw new Error("Sumsub preview cannot be deployed to Production")
  const hasVercelMetadata = Object.keys(env).some(key => key === "VERCEL" || key.startsWith("VERCEL_"))
  if (hasVercelMetadata && (
    env.VERCEL !== "1" || env.VERCEL_ENV !== "preview" || env.VERCEL_GIT_PROVIDER !== "github"
    || env.VERCEL_GIT_COMMIT_REF !== PREVIEW_BRANCH || env.VERCEL_GIT_REPO_OWNER !== REPO_OWNER
    || env.VERCEL_GIT_REPO_SLUG !== REPO_SLUG || !/^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA ?? "")
  )) throw new Error("Sumsub preview requires the approved GitHub Preview branch and revision")
}

export function previewBuildEnv(env) {
  assertPreviewTarget(env)
  const allowed = [
    "PATH", "HOME", "TMPDIR", "TMP", "TEMP", "SystemRoot", "LANG", "LC_ALL", "CI",
    "VERCEL", "VERCEL_ENV", "VERCEL_TARGET_ENV", "VERCEL_URL", "VERCEL_REGION",
    "VERCEL_PROJECT_ID", "VERCEL_ORG_ID", "VERCEL_GIT_PROVIDER", "VERCEL_GIT_COMMIT_REF",
    "VERCEL_GIT_COMMIT_SHA", "VERCEL_GIT_REPO_OWNER", "VERCEL_GIT_REPO_SLUG",
  ]
  const inherited = Object.fromEntries(Object.entries(env).filter(([key]) => allowed.includes(key)))
  return {
    ...inherited,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_ONDO_SUMSUB_SANDBOX: "1",
    NEXT_PUBLIC_HK_PREVIEW_READ_ONLY: "0",
    NEXT_PUBLIC_HK_CX_PREVIEW: "0",
    NEXT_PUBLIC_HK_ENABLED: "0",
    NEXT_PUBLIC_ONDO_QA_CONTROLS: "0",
    HK_API_ENABLED: "0",
    HK_ISOLATED_MOCK: "0",
    SUMSUB_MODE: "sandbox",
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  try {
    for (const file of [".env", ".env.local", ".env.production", ".env.production.local"])
      if (existsSync(resolve(file))) throw new Error("Sumsub preview builds must not load local env files")
    if (process.argv.length !== 2) throw new Error("Unknown Sumsub preview build arguments")
    const result = spawnSync(process.execPath, ["node_modules/next/dist/bin/next", "build", "--webpack"], {
      env: previewBuildEnv(process.env), stdio: "inherit",
    })
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Sumsub preview build refused")
    process.exitCode = 1
  }
}
