import assert from "node:assert/strict"
import { test } from "node:test"
import { createHmac } from "node:crypto"
import { HkError } from "../../lib/hackathon/util"
import { assertIntegrationPreviewBody, assertIntegrationPreviewOrigin, assertIntegrationPreviewTarget, grantIntegrationPreviewAccess,
  integrationPreviewBody, integrationPreviewPreflightIssues, integrationPreviewRequestOrigin, integrationPreviewRouteAllowed,
  INTEGRATION_PREVIEW_BRANCH, INTEGRATION_PREVIEW_COOKIE, INTEGRATION_PREVIEW_MAX_END, requireIntegrationPreviewAccess, requiresIntegrationPreviewAccess } from "../../lib/hackathon/integration-preview-access"

const now = Date.parse("2026-09-28T00:00:00Z")
const origin = "https://integration-fixture.vercel.app"
const fixture = {
  NEXT_PUBLIC_HK_INTEGRATION_PREVIEW: "1", NEXT_PUBLIC_HK_CX_PREVIEW: "0", NEXT_PUBLIC_HK_PREVIEW_READ_ONLY: "0", NEXT_PUBLIC_HK_ENABLED: "1",
  VERCEL: "1", VERCEL_ENV: "preview", VERCEL_REGION: "icn1", VERCEL_URL: new URL(origin).host,
  VERCEL_GIT_PROVIDER: "github", VERCEL_GIT_COMMIT_REF: INTEGRATION_PREVIEW_BRANCH, VERCEL_GIT_REPO_OWNER: "woogieboogie-jl",
  VERCEL_GIT_REPO_SLUG: "k-tour-id", VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
  VERCEL_PROJECT_ID: "prj_w5rckTz9B1DO55fvVRXjQRy9L5RM", VERCEL_ORG_ID: "team_6kJAloQ9WlswvMtbbCmGI7Er",
  HK_INTEGRATION_PREVIEW_ENABLED: "1", HK_INTEGRATION_PREVIEW_EXPIRES_AT: "2026-09-30T14:59:59Z",
  HK_INTEGRATION_PREVIEW_ACCESS_SECRET: "b".repeat(64), HK_INTEGRATION_PREVIEW_ACCESS_CODE: "integration-fixture-access-0123456789",
  HK_API_ENABLED: "1", HK_ISOLATED_MOCK: "0", HK_MODE_CX: "cx", HK_MODE_OPENDID: "opendid",
  HK_CX_BASE_URL: "https://cx.raonsecure.co.kr:18543", HK_CX_PROVIDER: "comdl", HK_CX_ZKP_TYPE: "AdultVerify",
  HK_ISSUER_SIGNING_SEED: "c".repeat(64), UPSTASH_REDIS_REST_URL: "https://integration-fixture.upstash.io", UPSTASH_REDIS_REST_TOKEN: "synthetic-redis-token",
  HK_STORE_KEY: "ktour:integration-preview:unit-fixture",
}
function request(options: { cookie?: string; method?: string; headers?: Record<string, string>; url?: string } = {}) {
  return new Request(options.url ?? `${origin}/api/hackathon/v1/config`, { method: options.method ?? "GET", headers: {
    host: fixture.VERCEL_URL, "x-forwarded-host": fixture.VERCEL_URL, "x-forwarded-proto": "https", origin, "sec-fetch-site": "same-origin",
    ...(options.cookie ? { cookie: options.cookie } : {}), ...options.headers,
  } })
}
const errorCode = (code: string) => (e: unknown) => e instanceof HkError && e.code === code
const grant = (time = now, env = fixture) => grantIntegrationPreviewAccess(request({ method: "POST" }), env.HK_INTEGRATION_PREVIEW_ACCESS_CODE, env, time)
const cookie = (response: Response) => response.headers.get("set-cookie")!.split(";")[0]

test("integration boundary activates from build flag or exact branch, never needs provider I/O", () => {
  assert.equal(requiresIntegrationPreviewAccess({}), false)
  assert.equal(requiresIntegrationPreviewAccess({ NEXT_PUBLIC_HK_INTEGRATION_PREVIEW: "1" }), true)
  assert.equal(requiresIntegrationPreviewAccess({ VERCEL_GIT_COMMIT_REF: INTEGRATION_PREVIEW_BRANCH }), true)
  assert.equal(requiresIntegrationPreviewAccess({ VERCEL_GIT_COMMIT_REF: "feat/hackathon-readiness-preview-20260925" }), false)
  assert.deepEqual(integrationPreviewPreflightIssues(request(), fixture, now), [])
  assert.equal(assertIntegrationPreviewTarget(request(), fixture, now).origin, origin)
})

test("missing/changed exact runtime, target, provider-mode and storage pins fail closed", () => {
  for (const key of Object.keys(fixture)) {
    const env: Record<string, string | undefined> = { ...fixture }; delete env[key]
    assert.throws(() => assertIntegrationPreviewTarget(request(), env, now), errorCode("integration_preview_unavailable"), key)
  }
  const overrides: Record<string, string>[] = [
    { VERCEL_ENV: "production" }, { VERCEL_REGION: "iad1" }, { VERCEL_GIT_COMMIT_REF: "main" },
    { VERCEL_GIT_COMMIT_SHA: "HEAD" }, { VERCEL_PROJECT_ID: "other" }, { VERCEL_ORG_ID: "other" },
    { NEXT_PUBLIC_HK_CX_PREVIEW: "1" }, { NEXT_PUBLIC_HK_PREVIEW_READ_ONLY: "1" }, { HK_ISOLATED_MOCK: "1" },
    { HK_MODE_CX: "mock" }, { HK_MODE_OPENDID: "mock" }, { HK_CX_BASE_URL: "https://attacker.invalid" },
    { HK_INTEGRATION_PREVIEW_ENABLED: "0" }, { HK_INTEGRATION_PREVIEW_EXPIRES_AT: "invalid" },
    { HK_INTEGRATION_PREVIEW_EXPIRES_AT: new Date(now).toISOString() }, { HK_INTEGRATION_PREVIEW_EXPIRES_AT: new Date(INTEGRATION_PREVIEW_MAX_END + 1).toISOString() },
    { HK_INTEGRATION_PREVIEW_ACCESS_SECRET: "not-secret" }, { HK_INTEGRATION_PREVIEW_ACCESS_CODE: "short" },
    { HK_ISSUER_SIGNING_SEED: "ondo-hackathon-sample-issuer-seed-change-me" },
    { HK_ISSUER_SIGNING_SEED: "sentinel-" + "c".repeat(64) }, { HK_ISSUER_SIGNING_SEED: "change_me-" + "c".repeat(64) }, { HK_ISSUER_SIGNING_SEED: "c".repeat(32) + "\n" + "c".repeat(32) },
    { HK_STORE_KEY: "ktour:cx-preview:unit" }, { UPSTASH_REDIS_REST_URL: "http://integration-fixture.upstash.io" },
    { KV_REST_API_TOKEN: "mixed-alias" }, { KV_REST_API_URL: "https://other.upstash.io", KV_REST_API_TOKEN: "mixed-pair" },
  ]
  for (const override of overrides) assert.throws(() => assertIntegrationPreviewTarget(request(), { ...fixture, ...override }, now), errorCode("integration_preview_unavailable"), JSON.stringify(Object.keys(override)))
  assert.throws(() => assertIntegrationPreviewTarget(request(), fixture, NaN), errorCode("integration_preview_unavailable"))
})

test("immutable HTTPS proxy origin accepts internal Next URL but rejects aliases and ambiguous headers", () => {
  assert.equal(integrationPreviewRequestOrigin(request({ url: "http://n/api/hackathon/v1/config" }), fixture), origin)
  for (const headers of [{ host: "alias.vercel.app" }, { "x-forwarded-host": "alias.vercel.app" }, { "x-forwarded-host": `${fixture.VERCEL_URL},evil.invalid` },
    { "x-forwarded-proto": "http" }, { "x-forwarded-proto": "https,http" }, { host: "" }, { "x-forwarded-host": "" }, { "x-forwarded-proto": "" }] as Record<string, string>[]) {
    assert.throws(() => assertIntegrationPreviewTarget(request({ headers }), fixture, now), errorCode("integration_preview_unavailable"))
  }
  assert.throws(() => assertIntegrationPreviewTarget(request(), { ...fixture, VERCEL_URL: "https://integration-fixture.vercel.app" }, now), errorCode("integration_preview_unavailable"))
  for (const headers of [{ origin: "https://evil.invalid" }, { origin: "" }, { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }] as Record<string, string>[]) {
    assert.throws(() => assertIntegrationPreviewOrigin(request({ headers }), fixture), errorCode("csrf"))
  }
})

test("local fixture is explicit, loopback-only, nonproduction and cannot bypass remote metadata", () => {
  const local: Record<string, string | undefined> = Object.fromEntries(Object.entries(fixture).filter(([key]) => !key.startsWith("VERCEL")))
  const req = request({ url: "http://127.0.0.1:3137/api/hackathon/v1/config" })
  assert.throws(() => assertIntegrationPreviewTarget(req, local, now), errorCode("integration_preview_unavailable"))
  local.HK_INTEGRATION_PREVIEW_LOCAL_TEST = "1"
  assert.equal(assertIntegrationPreviewTarget(req, local, now).origin, "http://127.0.0.1:3137")
  for (const change of [{ NODE_ENV: "production" }, { VERCEL_ENV: "preview" }]) assert.throws(() => assertIntegrationPreviewTarget(req, { ...local, ...change }, now), errorCode("integration_preview_unavailable"))
  assert.throws(() => assertIntegrationPreviewTarget(request({ url: "https://evil.invalid" }), local, now), errorCode("integration_preview_unavailable"))
})

test("access cookie is separate, secure, two-hour capped and origin/secret/expiry bound", async () => {
  const response = grant()
  const header = response.headers.get("set-cookie")!
  assert.ok(header.startsWith(INTEGRATION_PREVIEW_COOKIE + "="))
  for (const attribute of ["Path=/", "HttpOnly", "Secure", "SameSite=Lax", "Max-Age=7200"]) assert.ok(header.includes(attribute))
  assert.equal(header.includes("Domain="), false)
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.equal((await response.json()).expiresAt, new Date(now + 7200000).toISOString())
  const valid = cookie(response)
  requireIntegrationPreviewAccess(request({ cookie: valid }), fixture, now + 1000)
  for (const value of ["", valid + "; " + valid, valid.slice(0, -1) + (valid.endsWith("a") ? "b" : "a"), valid.replace(INTEGRATION_PREVIEW_COOKIE, "__Host-ktour_cx_preview")]) {
    assert.throws(() => requireIntegrationPreviewAccess(request({ cookie: value }), fixture, now), errorCode("integration_preview_access_denied"))
  }
  assert.throws(() => requireIntegrationPreviewAccess(request({ cookie: valid }), fixture, now + 7200000), errorCode("integration_preview_access_denied"))
  assert.throws(() => requireIntegrationPreviewAccess(request({ cookie: valid }), { ...fixture, HK_INTEGRATION_PREVIEW_ACCESS_SECRET: "d".repeat(64) }, now), errorCode("integration_preview_access_denied"))
  const otherHost = "other-fixture.vercel.app"
  assert.throws(() => requireIntegrationPreviewAccess(request({ cookie: valid, headers: { host: otherHost, "x-forwarded-host": otherHost } }), { ...fixture, VERCEL_URL: otherHost }, now), errorCode("integration_preview_access_denied"))
  assert.throws(() => grantIntegrationPreviewAccess(request({ method: "POST" }), "wrong", fixture, now), errorCode("integration_preview_access_denied"))
  const late = grant(INTEGRATION_PREVIEW_MAX_END - 30000)
  assert.ok(late.headers.get("set-cookie")!.includes("Max-Age=30"))
  assert.throws(() => requireIntegrationPreviewAccess(request({ cookie: cookie(late) }), fixture, INTEGRATION_PREVIEW_MAX_END), errorCode("integration_preview_unavailable"))
  const payload = `${now + 7200001}.${"e".repeat(32)}`
  const mac = createHmac("sha256", fixture.HK_INTEGRATION_PREVIEW_ACCESS_SECRET).update(`integration-preview/v1:${INTEGRATION_PREVIEW_BRANCH}:${origin}:${payload}`).digest("base64url")
  assert.throws(() => requireIntegrationPreviewAccess(request({ cookie: `${INTEGRATION_PREVIEW_COOKIE}=${payload}.${mac}` }), fixture, now), errorCode("integration_preview_access_denied"))
})

test("only exact integration GET/POST routes and known request fields are allowed", () => {
  const op = "op_fixture12345"
  for (const path of [["config"], ["me"], ["places", "venue", "demo-entitlements"], ["operations", op], ["operations", op, "evidence"], ["zklogin", "params"]]) assert.equal(integrationPreviewRouteAllowed("GET", path), true)
  for (const path of [["integration", "access"], ["sessions"], ["operations"], ["zklogin", "prove"],
    ...["identity/start", "identity/complete", "credential/issue", "credential/holder-ack", "presentation/request", "presentation/submit", "presentation/deny", "proposal", "delegation/prepare", "delegation/submit", "agent/run", "redeem", "cancel", "reconcile", "sui/agent-address"].map(action => ["operations", op, ...action.split("/")])]) assert.equal(integrationPreviewRouteAllowed("POST", path), true)
  for (const method of ["HEAD", "OPTIONS", "PUT", "DELETE"]) assert.equal(integrationPreviewRouteAllowed(method, ["config"]), false)
  for (const path of [["config", "extra"], ["operations", "invalid"], ["operations", op, "evidence", "extra"], ["preview", "access"], ["integration", "access", "extra"], ["operations", op, "__proto__"], ["operations", op, "identity", "complete", "extra"]]) {
    assert.equal(integrationPreviewRouteAllowed("GET", path), false)
    assert.equal(integrationPreviewRouteAllowed("POST", path), false)
  }
  assertIntegrationPreviewBody(["operations", op, "identity", "start"], { mobile: true })
  assertIntegrationPreviewBody(["operations", op, "credential", "issue"], { publicKeyPem: "fixture", alg: "Ed25519" })
  for (const [path, body] of [
    [["sessions"], { subjectRef: "injected" }], [["operations", op, "identity", "complete"], { sample: { outcome: "verified" } }],
    [["operations", op, "identity", "start"], { mobile: "true" }], [["operations", op, "credential", "issue"], { alg: "invalid" }],
    [["operations", op, "delegation", "prepare"], { signer: "other" }], [["operations", op, "delegation", "prepare"], { walletProof: { verified: true } }],
    [["operations", op, "presentation", "submit"], { disclosed: [] }],
  ] as Array<[string[], Record<string, unknown>]>) assert.throws(() => assertIntegrationPreviewBody(path, body), errorCode("bad_request"))
})

test("JSON parser accepts JWT/signature-sized bodies but bounds bytes/type/UTF-8 and content length", async () => {
  const req = (body: string | Uint8Array, headers: Record<string, string> = {}) => new Request(origin, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: body as BodyInit })
  const jwt = "x".repeat(8192)
  assert.deepEqual(await integrationPreviewBody(req(JSON.stringify({ jwt }))), { jwt })
  for (const [body, headers] of [["[]", {}], ["null", {}], ["broken", {}], [JSON.stringify({ value: "x".repeat(32768) }), {}], ["{}", { "content-type": "text/plain" }], ["{}", { "content-length": "32769" }], ["{}", { "content-length": "-1" }], [new Uint8Array([123, 34, 120, 34, 58, 34, 255, 34, 125]), {}]] as Array<[string | Uint8Array, Record<string, string>]>) {
    await assert.rejects(integrationPreviewBody(req(body, headers)), errorCode("bad_request"))
  }
})

test("JSON parser returns after two seconds even when stream cancellation never resolves", async () => {
  let cancelled = false
  const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; return new Promise(() => {}) } })
  const req = new Request(origin, { method: "POST", headers: { "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit)
  const started = performance.now()
  await assert.rejects(integrationPreviewBody(req), errorCode("bad_request"))
  assert.equal(cancelled, true)
  assert.ok(performance.now() - started < 4000)
})
