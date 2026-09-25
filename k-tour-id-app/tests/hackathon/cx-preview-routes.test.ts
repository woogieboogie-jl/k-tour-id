import assert from "node:assert/strict"
import { after, afterEach, mock, test } from "node:test"
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external"

// Import the real routes only after installing synthetic configuration and I/O
// tripwires. No Next server, Redis, provider, or existing session is involved.
const originalEnv = { ...process.env }
const originalFetch = globalThis.fetch
const originalNow = Date.now
const origin = "https://cx-preview-fixture.vercel.app"
const op = "op_fixture12345"
const fixtureNow = Date.parse("2026-09-25T12:00:00Z")
const fixture = {
  NEXT_PUBLIC_HK_CX_PREVIEW: "1", NEXT_PUBLIC_HK_PREVIEW_READ_ONLY: "0", NEXT_PUBLIC_HK_ENABLED: "1",
  VERCEL: "1", VERCEL_ENV: "preview", VERCEL_REGION: "icn1", VERCEL_GIT_PROVIDER: "github",
  VERCEL_URL: new URL(origin).host,
  VERCEL_GIT_COMMIT_REF: "feat/hackathon-readiness-preview-20260925", VERCEL_GIT_REPO_OWNER: "woogieboogie-jl",
  VERCEL_GIT_REPO_SLUG: "k-tour-id", VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
  HK_CX_PREVIEW_ENABLED: "1", HK_CX_PREVIEW_EXPIRES_AT: "2026-09-30T14:59:59Z",
  HK_CX_PREVIEW_ACCESS_CODE: "route-access-fixture-0123456789-abcdefghijk",
  HK_CX_PREVIEW_ACCESS_SECRET: "b".repeat(64), HK_MODE_CX: "cx", HK_ISOLATED_MOCK: "0", HK_API_ENABLED: "1",
  HK_CX_BASE_URL: "https://cx.raonsecure.co.kr:18543", HK_CX_PROVIDER: "comdl", HK_CX_ZKP_TYPE: "AdultVerify",
  HK_CX_API_KEY: "cx-private-fixture", KV_REST_API_URL: "https://fixture-redis.invalid", KV_REST_API_TOKEN: "redis-private-fixture",
  HK_STORE_KEY: "ktour:cx-preview:routes-fixture", HK_ISSUER_SIGNING_SEED: "c".repeat(64),
  HK_MODE_OPENDID: "opendid", HK_AI_MODE: "gemini", GEMINI_API_KEY: "gemini-private-fixture",
  HK_SUI_PACKAGE_ID: "package-private-fixture", HK_SUI_ISSUER_SECRET_KEY: "issuer-private-fixture", HK_SUI_AGENT_SECRET_KEY: "agent-private-fixture",
  HK_OMNIONE_RPC_URL: "https://chain-never-called.invalid", HK_OMNIONE_PRIVATE_KEY: "chain-private-fixture", HK_OMNIONE_REGISTRY_ADDRESS: "registry-private-fixture",
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: "oauth-private-fixture",
}
for (const key of Object.keys(process.env)) delete process.env[key]
Object.assign(process.env, { NODE_ENV: "test", ...fixture,
  ...(originalEnv.NODE_TEST_CONTEXT ? { NODE_TEST_CONTEXT: originalEnv.NODE_TEST_CONTEXT } : {}),
})
mock.method(Date, "now", () => fixtureNow)

let fetchCalls = 0
let sessionScopeReads = 0
globalThis.fetch = async () => { fetchCalls += 1; throw new Error("forbidden_fixture_network") }
// Both next/headers.headers() and cookies() enter this actual Next request
// scope before they can read a session or perform the legacy CSRF check.
mock.method(workAsyncStorage, "getStore", () => { sessionScopeReads += 1; throw new Error("session_scope_tripwire") })

const route = await import("../../app/api/hackathon/v1/[...path]/route")
const ask = await import("../../app/api/ask/route")
const chat = await import("../../app/api/chat/route")
const session = await import("../../lib/hackathon/session")

afterEach(() => {
  assert.equal(fetchCalls, 0, "a route reached storage/provider/AI/chain fetch")
  assert.equal(sessionScopeReads, 0, "a denied route reached legacy session/header I/O")
})
after(() => {
  globalThis.fetch = originalFetch
  mock.restoreAll()
  Date.now = originalNow
  for (const key of Object.keys(process.env)) delete process.env[key]
  Object.assign(process.env, originalEnv)
})

const ctx = (path: string[]) => ({ params: Promise.resolve({ path }) })
function request(path: string[], options: { method?: string; cookie?: string; body?: string; headers?: Record<string, string>; query?: string } = {}) {
  const method = options.method ?? "GET"
  return new Request(`${origin}/api/hackathon/v1/${path.join("/")}${options.query ?? ""}`, {
    method,
    headers: { ...(method === "POST" ? { origin, "content-type": "application/json", "sec-fetch-site": "same-origin" } : {}),
      ...(options.cookie ? { cookie: options.cookie } : {}), ...options.headers },
    ...(method === "POST" ? { body: options.body ?? "{}" } : {}),
  })
}
const call = (path: string[], options: Parameters<typeof request>[1] = {}) => {
  const req = request(path, options)
  return options.method === "POST" ? route.POST(req, ctx(path)) : route.GET(req, ctx(path))
}
async function expectDenied(response: Response, status: number, code: string) {
  assert.equal(response.status, status)
  assert.equal(response.headers.get("set-cookie"), null)
  assert.equal(response.headers.get("cache-control"), "no-store")
  const body = await response.json()
  assert.equal(body.error?.code, code)
  for (const secret of [fixture.HK_CX_PREVIEW_ACCESS_CODE, fixture.HK_CX_PREVIEW_ACCESS_SECRET,
    fixture.HK_ISSUER_SIGNING_SEED, fixture.KV_REST_API_TOKEN, fixture.HK_CX_API_KEY]) assert.equal(JSON.stringify(body).includes(secret), false)
}
async function accessCookie() {
  const response = await call(["preview", "access"], { method: "POST", body: JSON.stringify({ accessCode: fixture.HK_CX_PREVIEW_ACCESS_CODE }) })
  assert.equal(response.status, 200)
  const header = response.headers.get("set-cookie")!
  for (const attribute of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"]) assert.ok(header.includes(attribute))
  assert.equal(header.includes("ondo_hk_session"), false)
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.equal(JSON.stringify(body).includes(fixture.HK_CX_PREVIEW_ACCESS_CODE), false)
  return header.split(";")[0]
}

test("session tripwire actually intercepts both session lookup and legacy Origin lookup", async () => {
  await assert.rejects(session.ensureSession(), /session_scope_tripwire/)
  await assert.rejects(session.assertSameOrigin(), /session_scope_tripwire/)
  assert.equal(sessionScopeReads, 2)
  sessionScopeReads = 0
})

test("unauthenticated real GET/HEAD/POST routes deny before session, body parsing, or Redis", async () => {
  for (const path of [["config"], ["me"], ["operations", op], ["places", "venue-fixture", "demo-entitlements"]]) {
    await expectDenied(await call(path), 401, "cx_preview_access_denied")
  }
  await expectDenied(await call(["config"], { method: "HEAD" }), 401, "cx_preview_access_denied")
  for (const path of [["sessions"], ["operations"], ["operations", op, "identity", "start"], ["operations", op, "identity", "complete"], ["operations", op, "cancel"]]) {
    await expectDenied(await call(path, { method: "POST", body: "not-json-private-fixture", cookie: "ondo_hk_session=untrusted" }), 401, "cx_preview_access_denied")
  }
  await expectDenied(await call(["preview", "access"], { method: "POST", body: JSON.stringify({ accessCode: "wrong-private-code" }) }), 401, "cx_preview_access_denied")
})

test("unknown, prefixed, nested, invalid-operation and query paths deny even with private access", async () => {
  const cookie = await accessCookie()
  for (const path of [["unknown"], ["configuration"], ["config", "extra"], ["me", "extra"],
    ["operations", "invalid"], ["operations", op, "evidence"], ["places", "venue", "demo-entitlements", "extra"], ["readiness", "redis"], ["readiness", "cx"]]) {
    await expectDenied(await call(path, { cookie }), 403, "cx_preview_scope")
  }
  for (const path of [["sessions", "extra"], ["operations", op, "identity", "complete", "extra"],
    ["operations", "op_/invalid", "identity", "start"], ["preview", "access", "extra"]]) {
    await expectDenied(await call(path, { method: "POST", cookie }), 403, "cx_preview_scope")
  }
  await expectDenied(await call(["config"], { cookie, query: "?secret=private-fixture" }), 403, "cx_preview_scope")
  await expectDenied(await call(["sessions"], { method: "POST", cookie, query: "?debug=1" }), 403, "cx_preview_scope")
})

test("valid private access never permits cross-origin or cross-site POSTs", async () => {
  const cookie = await accessCookie()
  const origins: Record<string, string>[] = [{ origin: "https://evil.invalid" }, { origin: "" }, { "sec-fetch-site": "cross-site" }]
  for (const headers of origins) {
    await expectDenied(await call(["sessions"], { method: "POST", cookie, headers }), 403, "csrf")
    await expectDenied(await call(["preview", "access"], { method: "POST", cookie, headers }), 403, "csrf")
  }
})

test("extra fields, sample identity results, malformed JSON and nonboolean start fail before session I/O", async () => {
  const cookie = await accessCookie()
  const cases: Array<{ path: string[]; body: unknown }> = [
    { path: ["sessions"], body: { subjectRef: "injected" } },
    { path: ["operations"], body: { venueId: "venue-fixture", consentVersion: "fixture", locale: "ko", sample: true } },
    { path: ["operations", op, "identity", "complete"], body: { sample: { outcome: "verified", subjectSeed: "attacker" } } },
    { path: ["operations", op, "identity", "complete"], body: { token: "injected" } },
    { path: ["operations", op, "identity", "start"], body: { mobile: "true" } },
    { path: ["operations", op, "identity", "start"], body: {} },
    { path: ["operations", op, "identity", "start"], body: { mobile: true, provider: "other" } },
    { path: ["operations", op, "cancel"], body: { chain: true } },
  ]
  for (const item of cases) await expectDenied(await call(item.path, { method: "POST", cookie, body: JSON.stringify(item.body) }), 400, "cx_preview_body")
  for (const body of ["not-json-private-fixture", "[]", "null", JSON.stringify({ extra: "x".repeat(4096) })]) {
    await expectDenied(await call(["sessions"], { method: "POST", cookie, body }), 400, "bad_request")
  }
  await expectDenied(await call(["preview", "access"], { method: "POST", body: JSON.stringify({ accessCode: fixture.HK_CX_PREVIEW_ACCESS_CODE, extra: "injected" }) }), 400, "bad_request")
})

test("private access cannot open issuance, delegation, chain, reconciliation, or AI endpoints", async () => {
  const cookie = await accessCookie()
  for (const action of [["credential", "issue"], ["credential", "holder-ack"], ["presentation", "request"],
    ["presentation", "submit"], ["presentation", "deny"], ["proposal"], ["delegation", "prepare"],
    ["delegation", "submit"], ["agent", "run"], ["redeem"], ["reconcile"], ["sui", "agent-address"]]) {
    await expectDenied(await call(["operations", op, ...action], { method: "POST", cookie }), 403, "cx_preview_scope")
  }
  await expectDenied(await call(["zklogin", "params"], { cookie }), 403, "cx_preview_scope")
  await expectDenied(await call(["zklogin", "prove"], { method: "POST", cookie }), 403, "cx_preview_scope")
  for (const handler of [ask.POST, chat.POST]) {
    const response = await handler(new Request(origin + "/api/ask", { method: "POST", headers: { cookie }, body: "malformed-json" }))
    await expectDenied(response, 503, "preview_read_only")
  }
})

test("tampered, duplicate and expired access cookies deny without touching the session", async () => {
  const cookie = await accessCookie()
  for (const invalid of [cookie + "x", cookie + "; " + cookie, "__Host-ktour_cx_preview=invalid"]) {
    await expectDenied(await call(["config"], { cookie: invalid }), 401, "cx_preview_access_denied")
  }
  const clock = mock.method(Date, "now", () => fixtureNow + 2 * 3600_000)
  try { await expectDenied(await call(["config"], { cookie }), 401, "cx_preview_access_denied") }
  finally { clock.mock.restore() }
})

test("runtime kill switch, mismatched metadata, missing Redis and sample seed stop authenticated requests early", async () => {
  const cookie = await accessCookie()
  for (const [key, value] of Object.entries({ HK_CX_PREVIEW_ENABLED: "0", VERCEL_ENV: "production", VERCEL_REGION: "iad1",
    VERCEL_GIT_COMMIT_REF: "main", KV_REST_API_TOKEN: "", HK_ISSUER_SIGNING_SEED: "ondo-hackathon-sample-issuer-seed-change-me",
    HK_CX_PREVIEW_EXPIRES_AT: new Date(fixtureNow).toISOString() })) {
    const previous = process.env[key]
    process.env[key] = value
    try {
      await expectDenied(await call(["config"], { cookie }), 503, "cx_preview_unavailable")
      await expectDenied(await call(["sessions"], { method: "POST", cookie }), 503, "cx_preview_unavailable")
    } finally { if (previous === undefined) delete process.env[key]; else process.env[key] = previous }
  }
})

test("valid private cookie reaches only a redacted CX-only configuration despite inherited live-looking settings", async () => {
  const cookie = await accessCookie()
  const response = await call(["config"], { cookie })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("set-cookie"), null)
  assert.equal(response.headers.get("cache-control"), "no-store")
  const body = await response.json()
  assert.equal(body.cxPreview, true)
  assert.equal(body.previewReadOnly, false)
  assert.equal(body.isolatedMock, false)
  assert.deepEqual(body.deployment, { profile: "cx-only-preview", region: "icn1", revision: fixture.VERCEL_GIT_COMMIT_SHA })
  assert.deepEqual(body.modes, { cx: "cx", opendid: "disabled-cx-preview", ai: "disabled-cx-preview",
    sui: "disabled-cx-preview", omnione: "disabled-cx-preview", zklogin: "disabled-cx-preview" })
  assert.equal(body.capabilities.chainExecutionEnabled, false)
  assert.equal(body.capabilities.opendidProviderReady, false)
  assert.equal(body.sui.packageId, ""); assert.equal(body.sui.campaignId, ""); assert.equal(body.sui.googleClientId, "")
  assert.equal(body.omnione.registryAddress, "")
  const output = JSON.stringify(body)
  for (const value of [fixture.HK_CX_PREVIEW_ACCESS_CODE, fixture.HK_CX_PREVIEW_ACCESS_SECRET, fixture.KV_REST_API_URL,
    fixture.KV_REST_API_TOKEN, fixture.HK_STORE_KEY, fixture.HK_ISSUER_SIGNING_SEED, fixture.HK_CX_API_KEY,
    fixture.GEMINI_API_KEY, fixture.HK_SUI_ISSUER_SECRET_KEY, fixture.HK_OMNIONE_PRIVATE_KEY, fixture.NEXT_PUBLIC_GOOGLE_CLIENT_ID]) {
    assert.equal(output.includes(value), false)
  }
})
