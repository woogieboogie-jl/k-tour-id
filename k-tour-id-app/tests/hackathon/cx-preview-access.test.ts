import assert from "node:assert/strict"
import { after, test } from "node:test"
import { assertCxPreviewOrigin, assertCxPreviewTarget, cxPreviewBody, cxPreviewRouteAllowed, CX_PREVIEW_COOKIE, grantCxPreviewAccess, requireCxPreviewAccess } from "../../lib/hackathon/cx-preview-access"
import { hkConfig, hkPublicConfig, assertExternalServicesEnabled } from "../../lib/hackathon/config"
import { HkError } from "../../lib/hackathon/util"

const original = { ...process.env }
after(() => { for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key]; Object.assign(process.env, original) })
process.env.NEXT_PUBLIC_HK_CX_PREVIEW = "1"
process.env.NEXT_PUBLIC_HK_PREVIEW_READ_ONLY = "0"
const now = Date.parse("2026-09-25T12:00:00Z")
const origin = "https://preview.example.test"
const env = {
  VERCEL: "1", VERCEL_ENV: "preview", VERCEL_REGION: "icn1", VERCEL_GIT_PROVIDER: "github",
  VERCEL_GIT_COMMIT_REF: "feat/hackathon-readiness-preview-20260925", VERCEL_GIT_REPO_OWNER: "woogieboogie-jl", VERCEL_GIT_REPO_SLUG: "k-tour-id", VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
  HK_CX_PREVIEW_ENABLED: "1", HK_CX_PREVIEW_EXPIRES_AT: "2026-09-30T14:59:59Z",
  HK_CX_PREVIEW_ACCESS_CODE: "a".repeat(64), HK_CX_PREVIEW_ACCESS_SECRET: "b".repeat(64),
  HK_MODE_CX: "cx", HK_ISOLATED_MOCK: "0", HK_API_ENABLED: "1",
  HK_CX_BASE_URL: "https://cx.raonsecure.co.kr:18543", HK_CX_PROVIDER: "comdl", HK_CX_ZKP_TYPE: "AdultVerify",
  KV_REST_API_URL: "https://fixture.upstash.io", KV_REST_API_TOKEN: "fixture-token",
  HK_STORE_KEY: "ktour:cx-preview:fixture", HK_ISSUER_SIGNING_SEED: "c".repeat(64),
}
const req = (path = "/config", init: RequestInit = {}) => new Request(origin + "/api/hackathon/v1" + path, init)
const isCode = (code: string) => (error: unknown) => error instanceof HkError && error.code === code

test("CX profile requires exact deploy, runtime opt-in, fixed provider and bounded expiry", () => {
  assert.doesNotThrow(() => assertCxPreviewTarget(req(), env, now))
  for (const [key, value] of Object.entries({
    VERCEL: "0", VERCEL_ENV: "production", VERCEL_REGION: "iad1", VERCEL_GIT_PROVIDER: "gitlab", VERCEL_GIT_COMMIT_REF: "main", VERCEL_GIT_REPO_OWNER: "other", VERCEL_GIT_REPO_SLUG: "other", VERCEL_GIT_COMMIT_SHA: "bad",
    HK_CX_PREVIEW_ENABLED: "0", HK_CX_PREVIEW_EXPIRES_AT: "2027-01-01T00:00:00Z", HK_MODE_CX: "mock", HK_ISOLATED_MOCK: "1", HK_API_ENABLED: "0", HK_CX_BASE_URL: "https://evil.invalid", HK_CX_PROVIDER: "unknown", HK_CX_ZKP_TYPE: "unknown", HK_CX_PREVIEW_ACCESS_SECRET: "short", HK_CX_PREVIEW_ACCESS_CODE: "short",
  })) assert.throws(() => assertCxPreviewTarget(req(), { ...env, [key]: value }, now), isCode("cx_preview_unavailable"), key)
  assert.throws(() => assertCxPreviewTarget(req(), { ...env, HK_CX_PREVIEW_EXPIRES_AT: new Date(now).toISOString() }, now), isCode("cx_preview_unavailable"))
  for (const override of [{ KV_REST_API_TOKEN: "" }, { HK_ISSUER_SIGNING_SEED: "change-me" }, { HK_STORE_KEY: "live:journey" }, { UPSTASH_REDIS_REST_URL: env.KV_REST_API_URL }]) {
    assert.throws(() => assertCxPreviewTarget(req(), { ...env, ...override }, now), isCode("cx_preview_unavailable"))
  }
  process.env.NEXT_PUBLIC_HK_PREVIEW_READ_ONLY = "1"
  assert.throws(() => assertCxPreviewTarget(req(), env, now), isCode("cx_preview_unavailable"))
  process.env.NEXT_PUBLIC_HK_PREVIEW_READ_ONLY = "0"
})

test("private cookie is signed, origin and branch-bound, expires, and never returns access code", async () => {
  const access = req("/preview/access", { method: "POST", headers: { origin } })
  assert.throws(() => grantCxPreviewAccess(access, "wrong", env, now), isCode("cx_preview_access_denied"))
  const response = grantCxPreviewAccess(access, env.HK_CX_PREVIEW_ACCESS_CODE, env, now)
  const header = response.headers.get("set-cookie")!
  for (const part of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"]) assert.ok(header.includes(part))
  assert.equal(JSON.stringify(await response.json()).includes(env.HK_CX_PREVIEW_ACCESS_CODE), false)
  const cookie = header.split(";")[0]
  assert.doesNotThrow(() => requireCxPreviewAccess(req("/config", { headers: { cookie } }), env, now + 1000))
  assert.throws(() => requireCxPreviewAccess(req("/config", { headers: { cookie: cookie + "; " + cookie } }), env, now), isCode("cx_preview_access_denied"))
  assert.throws(() => requireCxPreviewAccess(req("/config", { headers: { cookie: cookie.slice(0, -2) + "aa" } }), env, now), isCode("cx_preview_access_denied"))
  assert.throws(() => requireCxPreviewAccess(req("/config", { headers: { cookie } }), env, now + 2 * 3600_000), isCode("cx_preview_access_denied"))
  assert.throws(() => requireCxPreviewAccess(new Request("https://other.example.test/api/hackathon/v1/config", { headers: { cookie } }), env, now), isCode("cx_preview_access_denied"))
  assert.throws(() => requireCxPreviewAccess(req(), env, now), isCode("cx_preview_access_denied"))
  assert.ok(cookie.startsWith(CX_PREVIEW_COOKIE + "="))
})

test("POST requires exact Origin and no cross-site fetch metadata", () => {
  assert.doesNotThrow(() => assertCxPreviewOrigin(req("/sessions", { method: "POST", headers: { origin } })))
  const cases: Record<string, string>[] = [{}, { origin: "https://evil.invalid" }, { origin, "sec-fetch-site": "cross-site" }]
  for (const headers of cases) {
    assert.throws(() => assertCxPreviewOrigin(req("/sessions", { method: "POST", headers })), isCode("csrf"))
  }
})

test("exact allowlist denies chain, issuance, reconciliation and prefix path tricks", () => {
  const op = "op_fixture12345"
  for (const path of [["config"], ["me"], ["places", "venue-123", "demo-entitlements"], ["operations", op]]) assert.equal(cxPreviewRouteAllowed("GET", path), true)
  for (const path of [["sessions"], ["operations"], ["preview", "access"], ["operations", op, "cancel"], ["operations", op, "identity", "start"], ["operations", op, "identity", "complete"]]) assert.equal(cxPreviewRouteAllowed("POST", path), true)
  for (const path of [["sessions", "extra"], ["operations", op, "reconcile"], ["operations", op, "credential", "issue"], ["operations", op, "proposal"], ["operations", op, "delegation", "submit"], ["operations", op, "agent", "run"], ["operations", op, "redeem"], ["zklogin", "prove"], ["operations", op, "identity", "complete", "extra"], ["operations", "invalid", "identity", "start"]]) assert.equal(cxPreviewRouteAllowed("POST", path), false)
  assert.equal(cxPreviewRouteAllowed("GET", ["operations", op, "evidence"]), false)
})

test("JSON body parsing is bounded, rejects arrays and does not echo submitted secrets", async () => {
  const request = (body: string, headers: Record<string, string> = { "content-type": "application/json" }) => req("/sessions", { method: "POST", headers, body })
  assert.deepEqual(await cxPreviewBody(request("{}")), {})
  for (const body of ["invalid-secret-sentinel", "[]", "null", JSON.stringify({ x: "secret".repeat(1000) })]) {
    await assert.rejects(cxPreviewBody(request(body)), error => isCode("bad_request")(error) && !(error as Error).message.includes("secret"))
  }
  await assert.rejects(cxPreviewBody(request("{}", { "content-type": "text/plain" })), isCode("bad_request"))
})

test("stalled JSON streams time out without provider/session work or payload disclosure", async () => {
  let cancelled = false
  const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true } })
  const request = req("/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit)
  const started = Date.now()
  await assert.rejects(cxPreviewBody(request), isCode("bad_request"))
  assert.ok(Date.now() - started < 3500)
  assert.equal(cancelled, true)
})

test("CX flag overrides inherited AI/OpenDID/chain runtime settings without enabling them", () => {
  Object.assign(process.env, { HK_ISOLATED_MOCK: "1", HK_MODE_CX: "mock", HK_MODE_OPENDID: "opendid", HK_AI_MODE: "gemini", GEMINI_API_KEY: "sentinel", HK_SUI_PACKAGE_ID: "sentinel", HK_SUI_ISSUER_SECRET_KEY: "sentinel", HK_SUI_AGENT_SECRET_KEY: "sentinel", HK_OMNIONE_RPC_URL: "sentinel", HK_OMNIONE_PRIVATE_KEY: "sentinel", HK_OMNIONE_REGISTRY_ADDRESS: "sentinel" })
  assert.equal(hkConfig().cx.mode, "cx")
  assert.equal(hkConfig().opendid.mode, "mock")
  assert.equal(hkConfig().ai.mode, "rule")
  const config = hkPublicConfig()
  assert.equal(config.capabilities.chainExecutionEnabled, false)
  assert.equal(config.isolatedMock, false)
  for (const name of ["opendid", "ai", "sui", "omnione", "zklogin"] as const) assert.equal(config.modes[name], "disabled-cx-preview")
  assert.equal(JSON.stringify(config).includes("sentinel"), false)
  assert.throws(() => assertExternalServicesEnabled("Sui"), isCode("cx_preview_scope"))
})
