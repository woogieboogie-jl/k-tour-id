import assert from "node:assert/strict"
import { test } from "node:test"
import { readFileSync, symlinkSync, unlinkSync, writeFileSync, mkdtempSync, rmdirSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import { tmpdir } from "node:os"

const subject = await import("../../scripts/hackathon-hosted-sui-build.mjs")
const { TARGET } = await import("../../scripts/vercel-ktour-account.mjs")

function metadata(environment = "preview") { return {
  VERCEL: "1", VERCEL_ENV: environment, VERCEL_TARGET_ENV: environment,
  VERCEL_PROJECT_ID: TARGET.projectId, VERCEL_ORG_ID: TARGET.orgId, VERCEL_GIT_PROVIDER: "github",
  VERCEL_GIT_COMMIT_REF: subject.HOSTED_SUI_BRANCH, VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
  VERCEL_GIT_REPO_OWNER: TARGET.repoOwner, VERCEL_GIT_REPO_SLUG: TARGET.repoName,
} }

test("hosted-Sui target accepts only the approved project, repo, branch and Preview/Production", () => {
  assert.doesNotThrow(() => subject.assertHostedSuiTarget(metadata("preview")))
  assert.doesNotThrow(() => subject.assertHostedSuiTarget(metadata("production")))
  for (const change of [{ VERCEL_ENV: "development" }, { VERCEL_TARGET_ENV: "production" }, { VERCEL_PROJECT_ID: "other" }, { VERCEL_ORG_ID: "other" }, { VERCEL_GIT_COMMIT_REF: TARGET.branch }, { VERCEL_GIT_REPO_OWNER: "other" }, { VERCEL_GIT_COMMIT_SHA: "bad" }]) {
    assert.throws(() => subject.assertHostedSuiTarget({ ...metadata(), ...change }), { message: "hosted_sui_build_target" })
  }
})

test("local planning needs no Vercel metadata but rejects wrong cwd, args and inherited loaders", () => {
  assert.doesNotThrow(() => subject.hostedSuiBuildPlan({ env: {}, exists: () => false }))
  assert.throws(() => subject.hostedSuiBuildPlan({ env: {}, args: ["--prod"], exists: () => false }), { message: "hosted_sui_build_arguments" })
  assert.throws(() => subject.hostedSuiBuildPlan({ env: {}, cwd: resolve(subject.APP_ROOT, ".."), exists: () => false }), { message: "hosted_sui_build_cwd" })
  assert.throws(() => subject.hostedSuiBuildPlan({ env: { NODE_OPTIONS: "--import=secret" }, exists: () => false }), { message: "hosted_sui_build_node_options" })
})

test("build env has hosted-Sui literals, old profiles disabled, and no inherited secrets", () => {
  const input = { ...metadata(), NEXT_PUBLIC_SITE_URL: "https://ktour-id.vercel.app/", NEXT_PUBLIC_ONDO_B_ORIGIN: "https://ktour-id.vercel.app/", HK_SUI_ISSUER_SECRET_KEY: "secret", HK_HOSTED_SUI_ACCESS_SECRET: "secret", KV_REST_API_TOKEN: "secret", GEMINI_API_KEY: "secret", NEXT_PUBLIC_GOOGLE_CLIENT_ID: "old" }
  const env = subject.hostedSuiBuildEnv(input)
  assert.equal(env.NEXT_PUBLIC_HK_HOSTED_SUI, "1"); assert.equal(env.HK_MODE_OPENDID, "mock"); assert.equal(env.HK_AI_MODE, "rule")
  assert.equal(env.NEXT_PUBLIC_GOOGLE_CLIENT_ID, ""); assert.equal(env.HK_INTEGRATION_PREVIEW_ENABLED, "0"); assert.equal(env.HK_CX_PREVIEW_ENABLED, "0"); assert.equal(env.HK_HOSTED_SUI_ENABLED, "0")
  assert.equal(env.NEXT_PUBLIC_SITE_URL, "https://ktour-id.vercel.app"); assert.equal(env.NEXT_PUBLIC_ONDO_B_ORIGIN, "https://ktour-id.vercel.app")
  assert.equal(env.HK_HOSTED_SUI_EXPIRES_AT, subject.HOSTED_SUI_MAX_EXPIRES_AT)
  for (const name of ["HK_SUI_ISSUER_SECRET_KEY", "HK_HOSTED_SUI_ACCESS_SECRET", "KV_REST_API_TOKEN", "GEMINI_API_KEY"]) assert.equal(Object.hasOwn(env, name), false)
  assert.equal(JSON.stringify(env).includes("secret"), false)
})

test("public origin inheritance accepts only HTTPS origin values", () => {
  for (const value of ["http://ktour-id.vercel.app", "https://user:pass@ktour-id.vercel.app/", "https://ktour-id.vercel.app/path", "not-a-url"]) {
    assert.throws(() => subject.hostedSuiBuildEnv({ NEXT_PUBLIC_SITE_URL: value }), { message: "hosted_sui_build_public_origin" })
  }
})

test("dotenv files, including dangling symlinks, stop the plan without reading contents", () => {
  const root = mkdtempSync(join(tmpdir(), "ktour-hosted-sui-build-")), file = join(root, ".env.local")
  try { writeFileSync(file, "secret"); assert.throws(() => subject.assertNoHostedSuiEnvFiles(root), { message: "hosted_sui_build_env_file" }); unlinkSync(file); symlinkSync(join(root, "missing"), file); assert.throws(() => subject.assertNoHostedSuiEnvFiles(root), { message: "hosted_sui_build_env_file" }) }
  finally { try { unlinkSync(file) } catch {} try { rmdirSync(root) } catch {} }
})

test("hosted profile config keeps existing profiles untouched", () => {
  const profile = JSON.parse(readFileSync(resolve(subject.APP_ROOT, "vercel.hosted-sui.json"), "utf8")), current = JSON.parse(readFileSync(resolve(subject.APP_ROOT, "vercel.json"), "utf8")), pkg = JSON.parse(readFileSync(resolve(subject.APP_ROOT, "package.json"), "utf8"))
  assert.equal(profile.buildCommand, "node scripts/hackathon-hosted-sui-build.mjs"); assert.deepEqual(profile.regions, ["icn1"]); assert.equal(profile.git.deploymentEnabled, false)
  assert.equal(current.buildCommand, "pnpm build:vercel:cx-preview"); assert.equal(pkg.scripts["build:vercel:hosted-sui"], "node scripts/hackathon-hosted-sui-build.mjs")
})
