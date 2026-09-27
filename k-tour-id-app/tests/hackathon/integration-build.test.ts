import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { mkdtempSync, readFileSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import { TARGET } from "../../scripts/vercel-ktour-account.mjs"

let subject: typeof import("../../scripts/hackathon-integration-build.mjs")
const originalFetch = globalThis.fetch
let networkCalls = 0
before(async () => {
  globalThis.fetch = async () => { networkCalls += 1; throw new Error("fixture_network_forbidden") }
  subject = await import("../../scripts/hackathon-integration-build.mjs")
})
after(() => { globalThis.fetch = originalFetch; assert.equal(networkCalls, 0) })

function metadata() {
  return {
    VERCEL: "1", VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "preview",
    VERCEL_PROJECT_ID: TARGET.projectId, VERCEL_ORG_ID: TARGET.orgId,
    VERCEL_GIT_PROVIDER: "github", VERCEL_GIT_COMMIT_REF: subject.INTEGRATION_BRANCH,
    VERCEL_GIT_REPO_OWNER: TARGET.repoOwner, VERCEL_GIT_REPO_SLUG: TARGET.repoName,
    VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
  }
}

test("remote integration build requires exact approved Preview branch, project, org, repository and revision", () => {
  assert.equal(subject.INTEGRATION_BRANCH, "integration/autonomous-finish-20260927")
  assert.doesNotThrow(() => subject.assertIntegrationTarget(metadata()))
  for (const changed of [
    { VERCEL: "0" }, { VERCEL_ENV: "production" }, { VERCEL_ENV: "development" }, { VERCEL_TARGET_ENV: "production" },
    { VERCEL_TARGET_ENV: "custom-live" }, { VERCEL_PROJECT_ID: "other-project" }, { VERCEL_ORG_ID: "other-org" },
    { VERCEL_GIT_PROVIDER: "gitlab" }, { VERCEL_GIT_COMMIT_REF: "main" }, { VERCEL_GIT_COMMIT_REF: TARGET.branch },
    { VERCEL_GIT_COMMIT_REF: "integration/sumsub-live-20260927" }, { VERCEL_GIT_REPO_OWNER: "other-owner" },
    { VERCEL_GIT_REPO_SLUG: "other-repo" }, { VERCEL_GIT_COMMIT_SHA: "not-a-sha" }, { VERCEL_GIT_COMMIT_SHA: "A".repeat(40) },
  ]) assert.throws(() => subject.assertIntegrationTarget({ ...metadata(), ...changed }), { message: "integration_build_target" })
})

test("partial remote metadata never falls back to a local build; local preparation needs no remote credentials", () => {
  assert.doesNotThrow(() => subject.assertIntegrationTarget({}))
  assert.doesNotThrow(() => subject.assertIntegrationTarget({ NODE_ENV: "production", CI: "1" }))
  for (const env of [{ VERCEL: "1" }, { VERCEL_ENV: "production" }, { VERCEL_ENV: "preview" }, { VERCEL_TOKEN: "fixture-secret" }, { VERCEL_PROJECT_ID: TARGET.projectId }]) {
    assert.throws(() => subject.assertIntegrationTarget(env), { message: "integration_build_target" })
  }
  for (const name of Object.keys(metadata()).filter(name => name !== "VERCEL_TARGET_ENV")) {
    const incomplete: Record<string, string> = metadata(); delete incomplete[name]
    assert.throws(() => subject.assertIntegrationTarget(incomplete), { message: "integration_build_target" })
  }
})

test("build profile compiles integration UI but keeps runtime locked and provider modes fail closed", () => {
  const env = subject.integrationBuildEnv({ ...metadata(), NODE_ENV: "development", HK_INTEGRATION_PREVIEW_ENABLED: "1", HK_ISOLATED_MOCK: "1", HK_MODE_CX: "mock", HK_MODE_OPENDID: "mock", HK_AI_MODE: "gemini", NEXT_PUBLIC_HK_CX_PREVIEW: "1", NEXT_PUBLIC_HK_PREVIEW_READ_ONLY: "1", NEXT_PUBLIC_HK_ENABLED: "0", NEXT_PUBLIC_ONDO_SUMSUB_SANDBOX: "1", NEXT_PUBLIC_ONDO_QA_CONTROLS: "1" })
  assert.equal(env.NODE_ENV, "production")
  assert.equal(env.NEXT_PUBLIC_HK_INTEGRATION_PREVIEW, "1")
  assert.equal(env.NEXT_PUBLIC_HK_ENABLED, "1")
  assert.equal(env.HK_API_ENABLED, "1")
  assert.equal(env.NEXT_PUBLIC_HK_CX_PREVIEW, "0")
  assert.equal(env.NEXT_PUBLIC_HK_PREVIEW_READ_ONLY, "0")
  assert.equal(env.HK_INTEGRATION_PREVIEW_ENABLED, "0")
  assert.equal(env.HK_ISOLATED_MOCK, "0")
  assert.equal(env.HK_MODE_CX, "cx")
  assert.equal(env.HK_MODE_OPENDID, "opendid")
  assert.equal(env.HK_AI_MODE, "rule")
  assert.equal(env.NEXT_PUBLIC_ONDO_SUMSUB_SANDBOX, "0")
  assert.equal(env.NEXT_PUBLIC_ONDO_QA_CONTROLS, "0")
})

test("child receives only known tooling/validated metadata/fixed flags, never credentials or arbitrary public vars", () => {
  const denied = [
    "HK_CX_API_KEY", "HK_OPENDID_TOKEN", "HK_ISSUER_SIGNING_SEED", "GEMINI_API_KEY", "ENOKI_API_KEY", "HK_ZKLOGIN_SALT_SEED",
    "HK_SUI_ISSUER_SECRET_KEY", "HK_SUI_AGENT_SECRET_KEY", "HK_SUI_SPONSOR_SECRET_KEY", "HK_SUI_ONLY_USER_SECRET_KEY",
    "HK_OMNIONE_RPC_URL", "HK_OMNIONE_PRIVATE_KEY", "REDIS_URL", "KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_TOKEN",
    "HK_INTEGRATION_PREVIEW_ACCESS_SECRET", "HK_INTEGRATION_PREVIEW_ACCESS_CODE", "HK_INTEGRATION_PREVIEW_EXPIRES_AT",
    "HK_CX_PREVIEW_ACCESS_SECRET", "HK_CX_PREVIEW_ACCESS_CODE", "HK_DATA_DIR", "SUMSUB_APP_TOKEN", "SUMSUB_SECRET_KEY",
    "NEXT_PUBLIC_GOOGLE_CLIENT_ID", "NEXT_PUBLIC_OTHER_TOKEN", "NEXT_PUBLIC_KAKAO_MAP_APP_KEY", "VERCEL_TOKEN", "VERCEL_OIDC_TOKEN",
    "VERCEL_URL", "NODE_OPTIONS", "NODE_EXTRA_CA_CERTS", "NODE_PATH", "LD_PRELOAD", "DYLD_INSERT_LIBRARIES", "NPM_TOKEN", "npm_config_userconfig",
  ]
  const input = { ...metadata(), PATH: "/fixture-tools", HOME: "/fixture-original-home", TMPDIR: "/tmp", CI: "1", ...Object.fromEntries(denied.map(name => [name, "fixture-secret"])) }
  const before = structuredClone(input)
  const env = subject.integrationBuildEnv(input)
  for (const name of denied) assert.equal(Object.hasOwn(env, name), false, name)
  assert.equal(JSON.stringify(env).includes("fixture-secret"), false)
  assert.equal(env.PATH, "/fixture-tools")
  assert.equal(env.HOME, "/fixture-original-home", "HOME is never repurposed")
  assert.equal(env.VERCEL_PROJECT_ID, TARGET.projectId)
  assert.deepEqual(input, before)
})

test("unknown secret getters are not inspected by environment projection", () => {
  const input = { ...metadata() }
  Object.defineProperty(input, "HK_SUI_ISSUER_SECRET_KEY", { enumerable: true, get() { throw new Error("secret must not be read") } })
  assert.doesNotThrow(() => subject.integrationBuildEnv(input))
})

test("every Next dotenv source is refused by existence only before a build plan can be returned", () => {
  assert.deepEqual(subject.ENV_FILES, [".env", ".env.local", ".env.production", ".env.production.local", ".env.development", ".env.development.local", ".env.test", ".env.test.local"])
  for (const file of subject.ENV_FILES) {
    const checked: string[] = []
    assert.throws(() => subject.integrationBuildPlan({ env: {}, exists: path => { checked.push(path); return basename(path) === file } }), { message: "integration_build_env_file" })
    assert.ok(checked.every(path => path.startsWith(`${subject.APP_ROOT}/`)))
  }
  assert.throws(() => subject.assertNoIntegrationEnvFiles(subject.APP_ROOT, () => { throw new Error("fixture-private-path") }), { message: "integration_build_env_check" })
})

test("real dotenv files and dangling symlinks fail closed; examples remain harmless and no contents are loaded", () => {
  const root = mkdtempSync(join(tmpdir(), "ktour-integration-build-fixture-"))
  const example = join(root, ".env.example"), envFile = join(root, ".env.production.local")
  try {
    writeFileSync(example, "fixture-example-only")
    assert.doesNotThrow(() => subject.assertNoIntegrationEnvFiles(root))
    writeFileSync(envFile, "fixture-secret")
    assert.throws(() => subject.assertNoIntegrationEnvFiles(root), { message: "integration_build_env_file" })
    assert.equal(readFileSync(envFile, "utf8"), "fixture-secret", "guard must not remove or rewrite dotenv")
    unlinkSync(envFile)
    symlinkSync(join(root, "nonexistent-fixture-target"), envFile)
    assert.throws(() => subject.assertNoIntegrationEnvFiles(root), { message: "integration_build_env_file" })
  } finally {
    // Only this test's two exact files and its now-empty directory are removed.
    for (const file of [envFile, example]) { try { unlinkSync(file) } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error } }
    rmdirSync(root)
  }
})

test("build plan rejects arguments, a foreign cwd and inherited Node preload options without spawning", () => {
  const base = { env: {}, exists: () => false }
  for (const args of [["--prod"], ["--execute"], ["--url=https://other.invalid"], [".env"], ["--webpack"]]) {
    assert.throws(() => subject.integrationBuildPlan({ ...base, args }), { message: "integration_build_arguments" })
  }
  assert.throws(() => subject.integrationBuildPlan({ ...base, cwd: resolve(subject.APP_ROOT, "..") }), { message: "integration_build_cwd" })
  assert.throws(() => subject.integrationBuildPlan({ ...base, env: { NODE_OPTIONS: "--import=fixture-private.mjs" } }), { message: "integration_build_node_options" })
})

test("bounded build plan uses exact Node/Next executable, webpack, fixed cwd and no shell or deployment command", () => {
  const plan = subject.integrationBuildPlan({ env: {}, exists: () => false })
  assert.equal(plan.command, process.execPath)
  assert.deepEqual(plan.args, [resolve(subject.APP_ROOT, "node_modules/next/dist/bin/next"), "build", "--webpack"])
  assert.equal(plan.options.cwd, subject.APP_ROOT)
  assert.equal(plan.options.timeout, 600_000)
  assert.equal(plan.options.killSignal, "SIGKILL")
  assert.equal(plan.options.shell, false)
  assert.equal(plan.options.env.HK_INTEGRATION_PREVIEW_ENABLED, "0")
  assert.equal(plan.args.some(arg => /deploy|npx|vercel/.test(arg)), false)
})

test("separate Seoul Preview config disables all Git autodeploy; default CX and existing scripts remain unchanged", () => {
  const read = (file: string) => JSON.parse(readFileSync(resolve(subject.APP_ROOT, file), "utf8"))
  const profile = read("vercel.integration.json"), current = read("vercel.json"), pkg = read("package.json")
  assert.equal(profile.buildCommand, "node scripts/hackathon-integration-build.mjs")
  assert.equal(profile.framework, "nextjs")
  assert.equal(profile.outputDirectory, ".next")
  assert.equal(profile.public, false)
  assert.equal(profile.git.deploymentEnabled, false)
  assert.deepEqual(profile.regions, ["icn1"])
  assert.equal(profile.env, undefined)
  assert.equal(profile.build?.env, undefined)
  assert.equal(current.buildCommand, "pnpm build:vercel:cx-preview")
  assert.equal(current.git.deploymentEnabled[subject.INTEGRATION_BRANCH], false)
  assert.equal(pkg.scripts["build:vercel:integration"], profile.buildCommand)
  assert.equal(pkg.scripts["build:vercel:cx-preview"], "node scripts/hackathon-preview-build.mjs --cx-only")
  assert.equal(pkg.scripts["test:harvey:verification"], "node --experimental-test-module-mocks --import tsx --test tests/hackathon-verification/*.test.ts")
  assert.equal(pkg.scripts["test:harvey:unit"], "node --import tsx --test tests/hackathon/*.test.ts")
})
