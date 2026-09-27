import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { assertPreviewTarget, PREVIEW_BRANCH, previewBuildEnv } from "../../scripts/kyc/sumsub-preview-build.mjs"

const metadata = {
  VERCEL: "1", VERCEL_ENV: "preview", VERCEL_GIT_PROVIDER: "github",
  VERCEL_GIT_COMMIT_REF: PREVIEW_BRANCH, VERCEL_GIT_REPO_OWNER: "woogieboogie-jl",
  VERCEL_GIT_REPO_SLUG: "k-tour-id", VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
}

test("Sumsub target is exact preview branch and rejects production or foreign metadata", () => {
  assert.doesNotThrow(() => assertPreviewTarget(metadata))
  assert.throws(() => assertPreviewTarget({ ...metadata, VERCEL_ENV: "production" }))
  assert.throws(() => assertPreviewTarget({ ...metadata, VERCEL_GIT_COMMIT_REF: "main" }))
  assert.throws(() => assertPreviewTarget({ ...metadata, VERCEL_GIT_REPO_OWNER: "other" }))
  assert.throws(() => assertPreviewTarget({ ...metadata, VERCEL_GIT_COMMIT_SHA: "not-a-sha" }))
  assert.doesNotThrow(() => assertPreviewTarget({ NODE_ENV: "test" }))
})

test("build environment has Sumsub UI only and never inherits credentials or HK routes", () => {
  const env = previewBuildEnv({ ...metadata, SUMSUB_SECRET_KEY: "secret", SUMSUB_APP_TOKEN: "sbx:token", HK_API_ENABLED: "1", NEXT_PUBLIC_HK_ENABLED: "1", NODE_OPTIONS: "--require=bad" })
  assert.equal(env.NEXT_PUBLIC_ONDO_SUMSUB_SANDBOX, "1")
  assert.equal(env.NEXT_PUBLIC_HK_ENABLED, "0")
  assert.equal(env.NEXT_PUBLIC_HK_PREVIEW_READ_ONLY, "0")
  assert.equal(env.NEXT_PUBLIC_HK_CX_PREVIEW, "0")
  assert.equal(env.NEXT_PUBLIC_ONDO_QA_CONTROLS, "0")
  assert.equal(env.HK_API_ENABLED, "0")
  assert.equal(env.HK_ISOLATED_MOCK, "0")
  for (const key of ["SUMSUB_SECRET_KEY", "SUMSUB_APP_TOKEN", "NODE_OPTIONS"]) assert.equal(key in env, false)
})

test("dedicated Vercel profile does not alter the existing default profile", () => {
  const profile = JSON.parse(readFileSync(resolve("vercel.sumsub-preview.json"), "utf8"))
  const current = JSON.parse(readFileSync(resolve("vercel.json"), "utf8"))
  assert.equal(profile.buildCommand, "node scripts/kyc/sumsub-preview-build.mjs")
  assert.equal(profile.regions[0], "icn1")
  assert.notEqual(profile.buildCommand, current.buildCommand)
  assert.equal(current.buildCommand, "pnpm build:vercel:cx-preview")
})
