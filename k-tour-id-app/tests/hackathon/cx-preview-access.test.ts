import assert from "node:assert/strict"
import { after, test } from "node:test"
import { assertCxPreviewOrigin, assertCxPreviewTarget, cxPreviewRequestOrigin, cxPreviewRequestOriginChecks, cxPreviewPreflightIssues, cxPreviewBody, cxPreviewRouteAllowed, CX_PREVIEW_COOKIE, grantCxPreviewAccess, requireCxPreviewAccess } from "../../lib/hackathon/cx-preview-access"
import { hkConfig, hkPublicConfig, assertExternalServicesEnabled } from "../../lib/hackathon/config"
import { HkError } from "../../lib/hackathon/util"

const original = { ...process.env }
after(() => { for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key]; Object.assign(process.env, original) })
process.env.NEXT_PUBLIC_HK_CX_PREVIEW = "1"
process.env.NEXT_PUBLIC_HK_PREVIEW_READ_ONLY = "0"
const now = Date.parse("2026-09-25T12:00:00Z")
const origin = "https://cx-preview-fixture.vercel.app"
const env = {
  VERCEL: "1", VERCEL_ENV: "preview", VERCEL_REGION: "icn1", VERCEL_GIT_PROVIDER: "github",
  VERCEL_URL: new URL(origin).host,
  VERCEL_GIT_COMMIT_REF: "feat/hackathon-readiness-preview-20260925", VERCEL_GIT_REPO_OWNER: "woogieboogie-jl", VERCEL_GIT_REPO_SLUG: "k-tour-id", VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
  HK_CX_PREVIEW_ENABLED: "1", HK_CX_PREVIEW_EXPIRES_AT: "2026-09-30T14:59:59Z",
  HK_CX_PREVIEW_ACCESS_CODE: "a".repeat(64), HK_CX_PREVIEW_ACCESS_SECRET: "b".repeat(64),
  HK_MODE_CX: "cx", HK_ISOLATED_MOCK: "0", HK_API_ENABLED: "1",
  HK_CX_BASE_URL: "https://cx.raonsecure.co.kr:18543", HK_CX_PROVIDER: "comdl", HK_CX_ZKP_TYPE: "AdultVerify",
  KV_REST_API_URL: "https://fixture.upstash.io", KV_REST_API_TOKEN: "fixture-token",
  HK_STORE_KEY: "ktour:cx-preview:fixture", HK_ISSUER_SIGNING_SEED: "c".repeat(64),
}
const proxyHeaders = { host: env.VERCEL_URL, "x-forwarded-host": env.VERCEL_URL, "x-forwarded-proto": "https" }
const req = (path = "/config", init: RequestInit = {}) => {
  const headers = new Headers(proxyHeaders)
  new Headers(init.headers).forEach((value, key) => headers.set(key, value))
  return new Request(origin + "/api/hackathon/v1" + path, { ...init, headers })
}
const isCode = (code: string) => (error: unknown) => error instanceof HkError && error.code === code

test("preflight diagnostics expose only fixed failed check names and keep target fail-closed", () => {
  assert.deepEqual(cxPreviewPreflightIssues(req(), env, now), [])
  const broken = { ...env, VERCEL_GIT_PROVIDER: "private-sentinel", HK_CX_PREVIEW_ACCESS_SECRET: "private-sentinel", KV_REST_API_TOKEN: "" }
  assert.deepEqual(cxPreviewPreflightIssues(req(), broken, now), ["git_provider", "access_signing_key", "redis_configuration"])
  assert.equal(JSON.stringify(cxPreviewPreflightIssues(req(), broken, now)).includes("private-sentinel"), false)
  assert.throws(() => assertCxPreviewTarget(req(), broken, now), isCode("cx_preview_unavailable"))
})

test("origin diagnostics disclose only fixed names for the public proxy contract", () => {
  const request = (url: string, headers: Record<string, string> = proxyHeaders) => ({ url, headers: new Headers(headers) }) as Request
  const cases = [
    { request: req(), env: { ...env, VERCEL: "0" }, reason: "origin_vercel" },
    { request: req(), env: { ...env, VERCEL_ENV: "production" }, reason: "origin_preview" },
    { request: req(), env: { ...env, VERCEL_URL: "private-sentinel.invalid" }, reason: "origin_deployment_host_format" },
    { request: request(origin.replace("https://", "https://private-sentinel:private-sentinel@")), env, reason: "origin_url_credentials" },
    { request: req("/config", { headers: { host: "private-sentinel.invalid" } }), env, reason: "origin_host_header" },
    { request: req("/config", { headers: { "x-forwarded-host": "private-sentinel.invalid" } }), env, reason: "origin_forwarded_host_header" },
    { request: req("/config", { headers: { "x-forwarded-proto": "private-sentinel" } }), env, reason: "origin_forwarded_proto" },
    { request: request(origin.replace("https:", "ftp:")), env, reason: "origin_url_protocol" },
  ]
  for (const item of cases) {
    const checks = cxPreviewRequestOriginChecks(item.request, item.env)
    assert.equal(checks[item.reason], false)
    assert.ok(Object.values(checks).every(value => typeof value === "boolean"))
    const issues = cxPreviewPreflightIssues(item.request, item.env, now)
    assert.ok(issues.includes("request_origin") && issues.includes(item.reason))
    assert.equal(JSON.stringify({ checks, issues }).includes("private-sentinel"), false)
    assert.equal(JSON.stringify({ checks, issues }).includes("4321"), false)
    assert.throws(() => cxPreviewRequestOrigin(item.request, item.env), isCode("cx_preview_unavailable"))
    assert.throws(() => assertCxPreviewTarget(item.request, item.env, now), isCode("cx_preview_unavailable"))
  }
  for (const internalUrl of ["http://n/", "http://localhost:4321/", "http://127.0.0.1/", "https://[::1]/", "http://private-sentinel.invalid/"]) {
    // URL authority is internal; only the fixed deployment + all three exact
    // proxy headers attest the public origin, not this arbitrary internal name.
    const internal = request(internalUrl)
    assert.deepEqual(cxPreviewPreflightIssues(internal, env, now), [])
    assert.equal(cxPreviewRequestOrigin(internal, env), origin)
  }
  for (const key of Object.keys(proxyHeaders)) {
    const headers = new Headers(proxyHeaders); headers.delete(key)
    assert.throws(() => assertCxPreviewTarget(new Request("http://n/", { headers }), env, now), isCode("cx_preview_unavailable"))
  }
  assert.throws(() => assertCxPreviewTarget(request("https://private-sentinel.invalid/", {}), env, now), isCode("cx_preview_unavailable"))
  assert.deepEqual(cxPreviewPreflightIssues(req(), env, now), [])
  assert.deepEqual(cxPreviewRequestOriginChecks(request("http://localhost:4321/"), {}), {})
  assert.equal(cxPreviewRequestOrigin(request("http://localhost:4321/"), {}), "http://localhost:4321")
})

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
  assert.throws(() => requireCxPreviewAccess(new Request("https://other.example.test/api/hackathon/v1/config", { headers: { cookie } }), env, now), isCode("cx_preview_unavailable"))
  assert.throws(() => requireCxPreviewAccess(req(), env, now), isCode("cx_preview_access_denied"))
  assert.ok(cookie.startsWith(CX_PREVIEW_COOKIE + "="))
})

test("Vercel TLS termination uses the same pinned HTTPS origin for CSRF and cookie signatures", () => {
  const internal = (headers: Record<string, string> = {}) => new Request(origin.replace("https:", "http:") + "/api/hackathon/v1/config", {
    headers: { "x-forwarded-proto": "https", host: env.VERCEL_URL, "x-forwarded-host": env.VERCEL_URL, ...headers },
  })
  assert.equal(cxPreviewRequestOrigin(internal(), env), origin)
  assert.doesNotThrow(() => assertCxPreviewTarget(internal(), env, now))
  assert.doesNotThrow(() => assertCxPreviewOrigin(internal({ origin }), env))
  const response = grantCxPreviewAccess(internal({ origin }), env.HK_CX_PREVIEW_ACCESS_CODE, env, now)
  const cookie = response.headers.get("set-cookie")!.split(";")[0]
  assert.doesNotThrow(() => requireCxPreviewAccess(internal({ cookie }), env, now + 1))
  assert.doesNotThrow(() => requireCxPreviewAccess(req("/config", { headers: { cookie } }), env, now + 1))
  const dummy = new Request("http://n/api/hackathon/v1/config", { headers: { ...proxyHeaders, cookie, origin } })
  assert.doesNotThrow(() => requireCxPreviewAccess(dummy, env, now + 1))
  assert.doesNotThrow(() => assertCxPreviewOrigin(dummy, env))
  const otherHost = "different-deployment.vercel.app"
  const otherDeployment = new Request("http://n/api/hackathon/v1/config", { headers: { ...proxyHeaders, host: otherHost, "x-forwarded-host": otherHost, cookie } })
  assert.throws(() => requireCxPreviewAccess(otherDeployment, { ...env, VERCEL_URL: otherHost }, now + 1), isCode("cx_preview_access_denied"))
  const conflictingHeaders: Record<string, string>[] = [
    { "x-forwarded-proto": "http" }, { "x-forwarded-proto": "https,http" }, { "x-forwarded-proto": "" },
    { host: "other.vercel.app" }, { "x-forwarded-host": "other.vercel.app" }, { "x-forwarded-host": env.VERCEL_URL + ",other.vercel.app" },
  ]
  for (const headers of conflictingHeaders) assert.throws(() => assertCxPreviewTarget(internal(headers), env, now), isCode("cx_preview_unavailable"))
  for (const key of ["host", "x-forwarded-host"]) {
    for (const value of ["", env.VERCEL_URL + ":443", env.VERCEL_URL + ",other.vercel.app"]) {
      assert.throws(() => assertCxPreviewTarget(internal({ [key]: value }), env, now), isCode("cx_preview_unavailable"))
    }
  }
  assert.throws(() => assertCxPreviewTarget(new Request(origin.replace("https:", "http:")), env, now), isCode("cx_preview_unavailable"))
  for (const overrides of [{ VERCEL_URL: "" }, { VERCEL_URL: "other.vercel.app" }, { VERCEL_URL: env.VERCEL_URL + ":443" }, { VERCEL_URL: "evil.invalid" }, { VERCEL_ENV: "production" }]) {
    assert.throws(() => assertCxPreviewTarget(internal(), { ...env, ...overrides }, now), isCode("cx_preview_unavailable"))
  }
  assert.throws(() => assertCxPreviewTarget(new Request("http://evil.invalid/api/hackathon/v1/config", { headers: { "x-forwarded-proto": "https", host: env.VERCEL_URL } }), env, now), isCode("cx_preview_unavailable"))
  assert.throws(() => assertCxPreviewOrigin(internal({ origin: "https://evil.invalid" }), env), isCode("csrf"))
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
