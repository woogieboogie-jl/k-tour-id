import assert from "node:assert/strict"
import { after, afterEach, mock, test } from "node:test"
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external"

// Actual BFF handlers, synthetic metadata only. Any session, Redis, provider,
// AI or chain access is a failing tripwire; no live server or credentials.
const originalEnv = { ...process.env }
const originalFetch = globalThis.fetch
const now = Date.parse("2026-09-28T00:00:00Z")
let clock = now
const origin = "https://integration-routes-fixture.vercel.app"
const op = "op_fixture12345"
const fixture = {
  NODE_ENV: "test", NEXT_PUBLIC_HK_INTEGRATION_PREVIEW: "1", NEXT_PUBLIC_HK_CX_PREVIEW: "0", NEXT_PUBLIC_HK_PREVIEW_READ_ONLY: "0", NEXT_PUBLIC_HK_ENABLED: "1",
  VERCEL: "1", VERCEL_ENV: "preview", VERCEL_REGION: "icn1", VERCEL_URL: new URL(origin).host,
  VERCEL_GIT_PROVIDER: "github", VERCEL_GIT_COMMIT_REF: "integration/autonomous-finish-20260927", VERCEL_GIT_REPO_OWNER: "woogieboogie-jl",
  VERCEL_GIT_REPO_SLUG: "k-tour-id", VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
  VERCEL_PROJECT_ID: "prj_w5rckTz9B1DO55fvVRXjQRy9L5RM", VERCEL_ORG_ID: "team_6kJAloQ9WlswvMtbbCmGI7Er",
  HK_INTEGRATION_PREVIEW_ENABLED: "1", HK_INTEGRATION_PREVIEW_EXPIRES_AT: "2026-09-30T14:59:59Z",
  HK_INTEGRATION_PREVIEW_ACCESS_SECRET: "b".repeat(64), HK_INTEGRATION_PREVIEW_ACCESS_CODE: "integration-route-fixture-0123456789",
  HK_API_ENABLED: "1", HK_ISOLATED_MOCK: "0", HK_MODE_CX: "cx", HK_MODE_OPENDID: "opendid",
  HK_CX_BASE_URL: "https://cx.raonsecure.co.kr:18543", HK_CX_PROVIDER: "comdl", HK_CX_ZKP_TYPE: "AdultVerify",
  HK_ISSUER_SIGNING_SEED: "c".repeat(64), UPSTASH_REDIS_REST_URL: "https://integration-fixture.upstash.io", UPSTASH_REDIS_REST_TOKEN: "synthetic-route-redis-token",
  HK_STORE_KEY: "ktour:integration-preview:route-fixture", NEXT_PUBLIC_GOOGLE_CLIENT_ID: "synthetic-client.apps.googleusercontent.com",
}
function resetEnv() {
  for (const key of Object.keys(process.env)) delete process.env[key]
  Object.assign(process.env, fixture, originalEnv.NODE_TEST_CONTEXT ? { NODE_TEST_CONTEXT: originalEnv.NODE_TEST_CONTEXT } : {})
}
resetEnv()
mock.method(Date, "now", () => clock)
let fetchCalls = 0
let sessionReads = 0
globalThis.fetch = async () => { fetchCalls += 1; throw new Error("forbidden_integration_fixture_network") }
mock.method(workAsyncStorage, "getStore", () => { sessionReads += 1; throw new Error("integration_session_tripwire") })
const route = await import("../../app/api/hackathon/v1/[...path]/route")
const session = await import("../../lib/hackathon/session")
afterEach(() => {
  assert.equal(fetchCalls, 0, "handler touched network/provider/Redis")
  assert.equal(sessionReads, 0, "denied handler touched session scope")
  clock = now; resetEnv()
})
after(() => {
  globalThis.fetch = originalFetch; mock.restoreAll()
  for (const key of Object.keys(process.env)) delete process.env[key]
  Object.assign(process.env, originalEnv)
})

type Options = { method?: string; cookie?: string; body?: string; headers?: Record<string, string>; query?: string }
const ctx = (path: string[]) => ({ params: Promise.resolve({ path }) })
function request(path: string[], options: Options = {}) {
  const method = options.method ?? "GET"
  return new Request(`${origin}/api/hackathon/v1/${path.join("/")}${options.query ?? ""}`, { method,
    headers: { host: fixture.VERCEL_URL, "x-forwarded-host": fixture.VERCEL_URL, "x-forwarded-proto": "https",
      ...(method === "POST" ? { origin, "content-type": "application/json", "sec-fetch-site": "same-origin" } : {}),
      ...(options.cookie ? { cookie: options.cookie } : {}), ...options.headers },
    ...(method === "POST" ? { body: options.body ?? "{}" } : {}),
  })
}
const call = (path: string[], options: Options = {}) => options.method === "POST" ? route.POST(request(path, options), ctx(path)) : route.GET(request(path, options), ctx(path))
async function denied(response: Response, status: number, code: string) {
  assert.equal(response.status, status)
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.equal(response.headers.get("set-cookie"), null)
  const value = await response.json()
  assert.equal(value.error?.code, code)
  for (const privateValue of [fixture.HK_INTEGRATION_PREVIEW_ACCESS_CODE, fixture.HK_INTEGRATION_PREVIEW_ACCESS_SECRET,
    fixture.HK_ISSUER_SIGNING_SEED, fixture.UPSTASH_REDIS_REST_TOKEN, "hostile-provider-private-value"]) assert.equal(JSON.stringify(value).includes(privateValue), false)
}
async function accessCookie() {
  const response = await call(["integration", "access"], { method: "POST", body: JSON.stringify({ accessCode: fixture.HK_INTEGRATION_PREVIEW_ACCESS_CODE }) })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("cache-control"), "no-store")
  const header = response.headers.get("set-cookie")!
  assert.ok(header.startsWith("__Host-ktour_integration_preview="))
  for (const attr of ["Path=/", "HttpOnly", "Secure", "SameSite=Lax", "Max-Age=7200"]) assert.ok(header.includes(attr))
  assert.equal(header.includes("ondo_hk_session"), false)
  assert.deepEqual(await response.json(), { ok: true, expiresAt: new Date(now + 7200000).toISOString() })
  return header.split(";")[0]
}

test("real handlers grant private access and return live-mode config without creating session/provider state", async () => {
  const cookie = await accessCookie()
  const response = await call(["config"], { cookie })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.equal(response.headers.get("set-cookie"), null)
  const config = await response.json()
  assert.equal(config.isolatedMock, false)
  assert.equal(config.cxPreview, false)
  assert.equal(config.modes.cx, "cx")
  assert.equal(config.modes.opendid, "opendid")
  assert.equal(config.capabilities.opendidProviderReady, false)
  assert.equal(config.sui.googleClientId, fixture.NEXT_PUBLIC_GOOGLE_CLIENT_ID)
  for (const value of [fixture.HK_INTEGRATION_PREVIEW_ACCESS_CODE, fixture.HK_INTEGRATION_PREVIEW_ACCESS_SECRET, fixture.HK_ISSUER_SIGNING_SEED, fixture.UPSTASH_REDIS_REST_TOKEN]) assert.equal(JSON.stringify(config).includes(value), false)
  const internal = new Request("http://n/api/hackathon/v1/config", { headers: request(["config"], { cookie }).headers })
  assert.equal((await route.GET(internal, ctx(["config"]))).status, 200)
})

test("session tripwire actually intercepts the real request-bound lookup", async () => {
  await assert.rejects(session.ensureSession(), /integration_session_tripwire/)
  assert.equal(sessionReads, 1)
  sessionReads = 0
})

test("unauthenticated operations deny before reading body, session or provider", async () => {
  for (const path of [["config"], ["me"], ["places", "fixture", "demo-entitlements"], ["operations", op], ["operations", op, "evidence"], ["zklogin", "params"]]) await denied(await call(path), 401, "integration_preview_access_denied")
  for (const path of [["sessions"], ["operations"], ["zklogin", "prove"], ["operations", op, "credential", "issue"], ["operations", op, "presentation", "submit"], ["operations", op, "agent", "run"]]) {
    const req = request(path, { method: "POST", body: "hostile-provider-private-value", cookie: "ondo_hk_session=attacker; __Host-ktour_cx_preview=other-cookie" })
    Object.defineProperty(req, "body", { get() { throw new Error("body_read_before_access") } })
    await denied(await route.POST(req, ctx(path)), 401, "integration_preview_access_denied")
  }
  await denied(await call(["integration", "access"], { method: "POST", body: JSON.stringify({ accessCode: "wrong" }) }), 401, "integration_preview_access_denied")
})

test("branch protection cannot silently downgrade when public/runtime/nonmock/provider flags disappear", async () => {
  for (const key of ["NEXT_PUBLIC_HK_INTEGRATION_PREVIEW", "HK_INTEGRATION_PREVIEW_ENABLED", "HK_INTEGRATION_PREVIEW_EXPIRES_AT", "HK_ISOLATED_MOCK", "HK_MODE_CX", "HK_MODE_OPENDID", "UPSTASH_REDIS_REST_TOKEN", "HK_STORE_KEY", "VERCEL_PROJECT_ID", "VERCEL_ORG_ID"]) {
    delete process.env[key]
    await denied(await call(["config"]), 503, "integration_preview_unavailable")
    await denied(await call(["sessions"], { method: "POST", body: "not-json" }), 503, "integration_preview_unavailable")
    resetEnv()
  }
  for (const override of [{ NEXT_PUBLIC_HK_CX_PREVIEW: "1" }, { NEXT_PUBLIC_HK_PREVIEW_READ_ONLY: "1" }, { HK_MODE_OPENDID: "mock" },
    { VERCEL_ENV: "production" }, { VERCEL_REGION: "iad1" }, { VERCEL_GIT_COMMIT_REF: "main" }, { KV_REST_API_TOKEN: "ambiguous" }] as Record<string, string>[]) {
    Object.assign(process.env, override)
    await denied(await call(["config"]), 503, "integration_preview_unavailable")
    await denied(await call(["sessions"], { method: "POST" }), 503, "integration_preview_unavailable")
    resetEnv()
  }
})

test("exact routes reject HEAD/other methods, path tails, unknown queries and prototype actions", async () => {
  const cookie = await accessCookie()
  for (const method of ["HEAD", "OPTIONS", "PUT", "DELETE"]) await denied(await call(["config"], { method, cookie }), 403, "integration_preview_scope")
  for (const path of [["config", "extra"], ["me", "extra"], ["operations", op, "evidence", "extra"], ["operations", "invalid"], ["places", "fixture", "demo-entitlements", "extra"], ["readiness", "cx"]]) await denied(await call(path, { cookie }), 403, "integration_preview_scope")
  for (const path of [["preview", "access"], ["integration", "access", "extra"], ["sessions", "extra"], ["operations", op, "identity", "complete", "extra"], ["operations", op, "constructor"]]) await denied(await call(path, { method: "POST", cookie }), 403, "integration_preview_scope")
  await denied(await call(["config"], { cookie, query: "?debug=hostile-provider-private-value" }), 403, "integration_preview_scope")
  await denied(await call(["sessions"], { method: "POST", cookie, query: "?debug=1" }), 403, "integration_preview_scope")
})

test("proxy/origin disagreement, cross-site access and forged or expired cookies stay closed", async () => {
  const cookie = await accessCookie()
  for (const headers of [{ host: "alias.vercel.app" }, { "x-forwarded-host": "alias.vercel.app" }, { "x-forwarded-proto": "http" }, { "x-forwarded-host": "" }] as Record<string, string>[]) await denied(await call(["config"], { cookie, headers }), 503, "integration_preview_unavailable")
  for (const headers of [{ origin: "https://evil.invalid" }, { origin: "" }, { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }] as Record<string, string>[]) {
    await denied(await call(["sessions"], { method: "POST", cookie, headers }), 403, "csrf")
    await denied(await call(["integration", "access"], { method: "POST", headers }), 403, "csrf")
  }
  for (const value of [cookie + "; " + cookie, cookie.replace("__Host-ktour_integration_preview", "__Host-ktour_cx_preview"), cookie.slice(0, -2) + "!?", "ondo_hk_session=attacker"]) await denied(await call(["config"], { cookie: value }), 401, "integration_preview_access_denied")
  clock = now + 7200000
  await denied(await call(["config"], { cookie }), 401, "integration_preview_access_denied")
  clock = Date.parse(fixture.HK_INTEGRATION_PREVIEW_EXPIRES_AT)
  await denied(await call(["config"], { cookie }), 503, "integration_preview_unavailable")
})

test("bounded bodies and strict fields reject sample evidence before session or provider calls", async () => {
  const cookie = await accessCookie()
  for (const [path, body] of [
    [["sessions"], { subjectRef: "injected" }], [["operations"], { venueId: "fixture", sample: true }],
    [["operations", op, "identity", "complete"], { sample: { outcome: "verified" } }], [["operations", op, "identity", "start"], { mobile: "true" }],
    [["operations", op, "credential", "holder-ack"], { signatureB64: "fixture", verified: true }],
    [["operations", op, "presentation", "submit"], { disclosed: [], signatureB64: "fixture" }],
    [["operations", op, "delegation", "prepare"], { walletProof: { trusted: true } }], [["integration", "access"], { accessCode: fixture.HK_INTEGRATION_PREVIEW_ACCESS_CODE, bypass: true }],
  ] as Array<[string[], Record<string, unknown>]>) await denied(await call(path, { method: "POST", cookie, body: JSON.stringify(body) }), 400, "bad_request")
  for (const body of ["[]", "null", "not-json", JSON.stringify({ value: "x".repeat(32768) })]) await denied(await call(["sessions"], { method: "POST", cookie, body }), 400, "bad_request")
  await denied(await call(["sessions"], { method: "POST", cookie, headers: { "content-length": "32769" } }), 400, "bad_request")
  await denied(await call(["sessions"], { method: "POST", cookie, headers: { "content-type": "text/plain" } }), 400, "bad_request")
})

test("zklogin/prove consumes the checked large JSON once and reaches existing verification without network", async () => {
  const cookie = await accessCookie()
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")
  const jwt = `${encode({ alg: "RS256", kid: "fixture" })}.${encode({ iss: "https://accounts.google.com", aud: "wrong-audience", sub: "synthetic-subject", exp: now / 1000 + 600, padding: "x".repeat(4000) })}.fixture`
  assert.ok(jwt.length > 4096 && jwt.length < 8192)
  await denied(await call(["zklogin", "prove"], { method: "POST", cookie, body: JSON.stringify({ jwt, extendedEphemeralPublicKey: "fixture", maxEpoch: 3, jwtRandomness: "1" }) }), 400, "zklogin_aud")
})
