import assert from "node:assert/strict"
import { test } from "node:test"
import { GUIDE_BRANCH, guideBuildEnv, guideBuildPlan } from "../../scripts/hackathon-guide-build.mjs"
const remote = { VERCEL: "1", VERCEL_ENV: "production", VERCEL_PROJECT_ID: "prj_w5rckTz9B1DO55fvVRXjQRy9L5RM", VERCEL_ORG_ID: "team_6kJAloQ9WlswvMtbbCmGI7Er", VERCEL_GIT_PROVIDER: "github", VERCEL_GIT_COMMIT_REF: GUIDE_BRANCH, VERCEL_GIT_COMMIT_SHA: "a".repeat(40), VERCEL_GIT_REPO_OWNER: "woogieboogie-jl", VERCEL_GIT_REPO_SLUG: "k-tour-id" }
test("future guide build carries only positive-allowlisted metadata, never credentials or runtime activation", () => {
  const env = guideBuildEnv({ ...remote, NODE_OPTIONS: "private-runtime-loader", HK_GUIDE_PRODUCTION_ENABLED: "1", HK_GUIDE_ACCESS_SECRET: "private", GEMINI_API_KEY: "private", HK_SUI_ISSUER_SECRET_KEY: "private", HK_OPENDID_BRIDGE_TOKEN: "private" })
  assert.equal(env.NEXT_PUBLIC_HK_GUIDE_PRODUCTION, "1")
  assert.equal(env.HK_GUIDE_PRODUCTION_ENABLED, "0")
  assert.equal(env.NEXT_PUBLIC_HK_INTEGRATION_PREVIEW, "0")
  assert.equal(env.NEXT_PUBLIC_HK_HOSTED_SUI, "0")
  assert.equal(JSON.stringify(env).includes("private"), false)
})
test("guide build rejects wrong project/branch/platform, env files and local code injection", () => {
  for (const [key, value] of Object.entries({ VERCEL_ENV: "development", VERCEL_PROJECT_ID: "wrong", VERCEL_ORG_ID: "wrong", VERCEL_GIT_COMMIT_REF: "main", VERCEL_GIT_REPO_OWNER: "wrong", VERCEL_GIT_COMMIT_SHA: "invalid" })) assert.throws(() => guideBuildEnv({ ...remote, [key]: value }))
  assert.throws(() => guideBuildEnv({ NODE_OPTIONS: "--import unsafe" }))
  assert.throws(() => guideBuildPlan({ env: {}, exists: () => true }))
  assert.throws(() => guideBuildPlan({ env: {}, args: ["--activate"], exists: () => false }))
  const plan = guideBuildPlan({ env: {}, exists: () => false })
  assert.equal(plan.options.shell, false)
  assert.equal(plan.options.env.HK_GUIDE_PRODUCTION_ENABLED, "0")
  assert.ok(plan.args.includes("--webpack"))
})
