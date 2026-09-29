import assert from "node:assert/strict"
import { after, afterEach, mock, test } from "node:test"
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external"
import { PIN } from "../../lib/hackathon/hosted-sui-profile"

// Actual route handlers with network/session tripwires, synthetic keys only.
const original = { ...process.env }, originalFetch = globalThis.fetch
const now = Date.parse("2026-09-28T14:00:00Z")
let clock = now, network = 0, sessions = 0
const immutable = "https://sui-route-fixture.vercel.app", publicOrigin = PIN.publicOrigin
const op = "op_fixture12345"
const fixture = {
  NODE_ENV: "test", NEXT_PUBLIC_HK_HOSTED_SUI: "1", HK_HOSTED_SUI_ENABLED: "1", NEXT_PUBLIC_HK_ENABLED: "1", HK_API_ENABLED: "1",
  NEXT_PUBLIC_HK_CX_PREVIEW: "0", NEXT_PUBLIC_HK_PREVIEW_READ_ONLY: "0", NEXT_PUBLIC_HK_INTEGRATION_PREVIEW: "0", HK_ISOLATED_MOCK: "0",
  HK_MODE_CX: "mock", HK_MODE_OPENDID: "mock", HK_AI_MODE: "rule", HK_HOSTED_SUI_EXPIRES_AT: PIN.maxExpiresAt,
  HK_HOSTED_SUI_ACCESS_SECRET: "a".repeat(64), HK_HOSTED_SUI_ACCESS_CODE: "b".repeat(48), HK_ISSUER_SIGNING_SEED: "c".repeat(64),
  HK_SUI_NETWORK: PIN.network, HK_SUI_GRPC_URL: PIN.rpc, HK_SUI_PACKAGE_ID: PIN.packageId, HK_SUI_CAMPAIGN_ID: PIN.campaignId, HK_SUI_CAMPAIGN_INITIAL_VERSION: PIN.campaignInitialVersion,
  HK_SUI_ISSUER_SECRET_KEY: "suiprivkey1" + "q".repeat(59), HK_SUI_AGENT_SECRET_KEY: "suiprivkey1" + "p".repeat(59),
  HK_STORE_KEY: PIN.storeKey, UPSTASH_REDIS_REST_URL: "https://hosted-fixture.upstash.io", UPSTASH_REDIS_REST_TOKEN: "d".repeat(64),
  VERCEL: "1", VERCEL_ENV: "production", VERCEL_TARGET_ENV: "production", VERCEL_URL: new URL(immutable).host, VERCEL_REGION: PIN.region,
  VERCEL_PROJECT_ID: PIN.projectId, VERCEL_ORG_ID: PIN.orgId, VERCEL_GIT_PROVIDER: "github", VERCEL_GIT_COMMIT_REF: PIN.branch,
  VERCEL_GIT_REPO_OWNER: PIN.repoOwner, VERCEL_GIT_REPO_SLUG: PIN.repoName, VERCEL_GIT_COMMIT_SHA: "e".repeat(40),
}
function reset() { for (const k of Object.keys(process.env)) delete process.env[k]; Object.assign(process.env, fixture) }
reset()
mock.method(Date, "now", () => clock)
globalThis.fetch = async () => { network++; throw new Error("network_tripwire") }
mock.method(workAsyncStorage, "getStore", () => { sessions++; throw new Error("session_tripwire") })
const route = await import("../../app/api/hackathon/v1/[...path]/route")
const service = await import("../../lib/hackathon/service")
afterEach(() => { assert.equal(network, 0); assert.equal(sessions, 0); clock = now; reset() })
after(() => { globalThis.fetch = originalFetch; mock.restoreAll(); for (const k of Object.keys(process.env)) delete process.env[k]; Object.assign(process.env, original) })

type Options = { method?: string; cookie?: string; body?: string; origin?: string; headers?: Record<string, string>; query?: string }
function req(path: string[], opts: Options = {}) {
  const origin = opts.origin ?? publicOrigin, method = opts.method ?? "GET", host = new URL(origin).host
  return new Request(`${origin}/api/hackathon/v1/${path.join("/")}${opts.query ?? ""}`, { method,
    headers: { host, "x-forwarded-host": host, "x-forwarded-proto": "https", ...(method === "POST" ? { origin, "sec-fetch-site": "same-origin", "content-type": "application/json" } : {}), ...(opts.cookie ? { cookie: opts.cookie } : {}), ...opts.headers },
    ...(method === "POST" ? { body: opts.body ?? "{}" } : {}) })
}
const context = (path: string[]) => ({ params: Promise.resolve({ path }) })
const call = (path: string[], opts: Options = {}) => opts.method === "POST" ? route.POST(req(path, opts), context(path)) : route.GET(req(path, opts), context(path))
async function deny(response: Response, status: number, code: string) {
  assert.equal(response.status, status); assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal(response.headers.get("set-cookie"), null)
  const json = await response.json(); assert.equal(json.error.code, code)
  for (const value of [fixture.HK_HOSTED_SUI_ACCESS_CODE, fixture.HK_HOSTED_SUI_ACCESS_SECRET, fixture.HK_SUI_ISSUER_SECRET_KEY, fixture.UPSTASH_REDIS_REST_TOKEN]) assert.equal(JSON.stringify(json).includes(value), false)
}
async function cookie(origin: string = publicOrigin) {
  const response = await call(["hosted", "access"], { method: "POST", origin, body: JSON.stringify({ accessCode: fixture.HK_HOSTED_SUI_ACCESS_CODE }) })
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store")
  const header = response.headers.get("set-cookie")!
  for (const value of ["__Host-ktour_sui_access=", "Path=/", "HttpOnly", "Secure", "SameSite=Lax", "Max-Age=7200"]) assert.ok(header.includes(value))
  assert.deepEqual(await response.json(), { ok: true, expiresAt: new Date(now + 7200000).toISOString() })
  return header.split(";")[0]
}
test("real BFF grants access and honestly exposes Sui-only config without session/provider access", async () => {
  for (const origin of [publicOrigin, immutable]) {
    const access = await cookie(origin), response = await call(["config"], { origin, cookie: access })
    assert.equal(response.status, 200)
    const config = await response.json()
    assert.equal(config.hostedSui, true); assert.equal(config.isolatedMock, false)
    assert.equal(config.modes.cx, "mock"); assert.equal(config.modes.opendid, "mock"); assert.equal(config.sui.network, "testnet")
    assert.equal(config.capabilities.redemptionEnabled, false); assert.equal(config.sui.googleClientId, "")
  }
})
test("access is host-bound, expires and cannot be forged or substituted", async () => {
  const access = await cookie()
  for (const value of [access + "; " + access, access.slice(0, -2) + "!?", access.replace("ktour_sui_access", "ktour_cx_preview"), "ondo_hk_session=attacker"]) await deny(await call(["config"], { cookie: value }), 401, "hosted_sui_access_denied")
  await deny(await call(["config"], { origin: immutable, cookie: access }), 401, "hosted_sui_access_denied")
  clock += 7200000; await deny(await call(["config"], { cookie: access }), 401, "hosted_sui_access_denied")
})
test("missing access denies before parsing body, opening session or issuing a transaction", async () => {
  for (const path of [["config"], ["operations", op], ["operations", op, "evidence"]]) await deny(await call(path), 401, "hosted_sui_access_denied")
  for (const path of [["sessions"], ["operations"], ["operations", op, "credential", "issue"], ["operations", op, "delegation", "submit"], ["operations", op, "agent", "run"]]) {
    const request = req(path, { method: "POST", body: "invalid" })
    Object.defineProperty(request, "body", { get() { throw new Error("premature_body_read") } })
    await deny(await route.POST(request, context(path)), 401, "hosted_sui_access_denied")
  }
})
test("all excluded provider/redemption paths and tails reject even after access", async () => {
  const access = await cookie()
  for (const path of [["zklogin", "params"], ["readiness", "cx"], ["config", "extra"], ["operations", op, "evidence", "extra"]]) await deny(await call(path, { cookie: access }), 403, "hosted_sui_scope")
  for (const path of [["operations", op, "redeem"], ["zklogin", "prove"], ["integration", "access"], ["preview", "access"], ["operations", op, "constructor"]]) await deny(await call(path, { method: "POST", cookie: access }), 403, "hosted_sui_scope")
  await deny(await call(["config"], { cookie: access, query: "?bypass=1" }), 403, "hosted_sui_scope")
  await assert.rejects(service.redeem("session", op, { idempotencyKey: "fixture", bodyDigest: "fixture" }), (e: any) => e.code === "hosted_sui_scope")
})
test("metadata/expiry/profile/Redis drift fails closed before access and signing", async () => {
  for (const patch of [{ VERCEL_ENV: "preview" }, { VERCEL_REGION: "iad1" }, { VERCEL_GIT_COMMIT_REF: "main" }, { HK_HOSTED_SUI_ENABLED: "0" }, { HK_MODE_OPENDID: "opendid" }, { HK_SUI_NETWORK: "mainnet" }, { HK_SUI_PACKAGE_ID: "0x1" }, { HK_STORE_KEY: "other" }, { UPSTASH_REDIS_REST_TOKEN: "" }, { KV_REST_API_TOKEN: "extra" }, { HK_HOSTED_SUI_EXPIRES_AT: new Date(now).toISOString() }]) {
    Object.assign(process.env, patch); await deny(await call(["config"]), 503, "hosted_sui_unavailable"); reset()
  }
})
test("origin/proxy mismatches and cross-site access cannot grant or consume cookies", async () => {
  const access = await cookie()
  for (const headers of [{ host: "evil.invalid" }, { "x-forwarded-host": "evil.invalid" }, { "x-forwarded-proto": "http" }] as Record<string, string>[]) await deny(await call(["config"], { cookie: access, headers }), 503, "hosted_sui_unavailable")
  for (const headers of [{ origin: "https://evil.invalid" }, { origin: "" }, { "sec-fetch-site": "same-site" }, { "sec-fetch-site": "cross-site" }] as Record<string, string>[]) await deny(await call(["sessions"], { method: "POST", cookie: access, headers }), 403, "csrf")
})
test("strict payload boundaries precede session and provider access", async () => {
  const access = await cookie()
  for (const [path, payload] of [
    [["sessions"], { verified: true }], [["operations"], { venueId: "other", consentVersion: PIN.consentVersion }],
    [["operations", op, "identity", "complete"], {}], [["operations", op, "identity", "start"], { mobile: "true" }],
    [["operations", op, "agent", "run"], { authorized: true }], [["operations", op, "delegation", "prepare"], { signer: "zklogin" }],
  ] as Array<[string[], unknown]>) await deny(await call(path, { method: "POST", cookie: access, body: JSON.stringify(payload) }), 403, "hosted_sui_scope")
  for (const body of ["null", "[]", "invalid", JSON.stringify({ value: "x".repeat(32768) })]) await deny(await call(["sessions"], { method: "POST", cookie: access, body }), 400, "bad_request")
})

test("JIT identity endpoints preserve access, exact-body and origin guards before any provider/session work", async () => {
  const id = "idn_abcdefghijklmnop", auth = "ida_abcdefghijklmnop", access = await cookie()
  for (const path of [["identity", "eligibility"], ["identity", "requests", id], ["identity", "requests", id, "receipt"]]) await deny(await call(path), 401, "hosted_sui_access_denied")
  for (const path of [["identity", "requests"], ["identity", "requests", id, "start"], ["identity", "requests", id, "complete"], ["identity", "requests", id, "cancel"], ["identity", "authorizations", auth, "consume"]]) {
    await deny(await call(path, { method: "POST", body: "invalid" }), 401, "hosted_sui_access_denied")
    await deny(await call(path, { method: "POST", cookie: access, headers: { origin: "https://evil.invalid" } }), 403, "csrf")
  }
  await deny(await call(["identity", "requests", id, "complete"], { method: "POST", cookie: access, body: JSON.stringify({ sample: { outcome: "verified" } }) }), 400, "bad_request")
  await deny(await call(["identity", "requests", id, "start"], { method: "POST", cookie: access, body: JSON.stringify({ mobile: "true" }) }), 400, "bad_request")
  await deny(await call(["identity", "eligibility"], { cookie: access, query: "?approved=true" }), 403, "hosted_sui_scope")
})
