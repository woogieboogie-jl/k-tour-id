import assert from "node:assert/strict"
import { after, afterEach, mock, test } from "node:test"
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external"
import { GUIDE_PRODUCTION } from "../../lib/hackathon/guide-production-profile"

// Actual handlers with synthetic platform metadata. No sessions, storage, keys,
// provider or chain access are allowed by this boundary suite.
const originalEnv = { ...process.env }, originalFetch = globalThis.fetch
const now = Date.parse("2026-09-29T01:00:00Z"), origin = GUIDE_PRODUCTION.origin
const fixture = { NODE_ENV: "test", NEXT_PUBLIC_HK_GUIDE_PRODUCTION: "1", HK_GUIDE_PRODUCTION_ENABLED: "1", HK_API_ENABLED: "1", NEXT_PUBLIC_HK_ENABLED: "1",
  NEXT_PUBLIC_HK_HOSTED_SUI: "0", NEXT_PUBLIC_HK_INTEGRATION_PREVIEW: "0", NEXT_PUBLIC_HK_CX_PREVIEW: "0", NEXT_PUBLIC_HK_PREVIEW_READ_ONLY: "0",
  HK_ISOLATED_MOCK: "0", HK_MODE_CX: "cx", HK_MODE_OPENDID: "opendid", HK_AI_MODE: "gemini",
  HK_CX_BASE_URL: "https://cx.raonsecure.co.kr:18543", HK_CX_PROVIDER: "comdl", HK_CX_ZKP_TYPE: "AdultVerify",
  HK_GUIDE_EXPIRES_AT: "2026-09-30T14:59:59Z", HK_GUIDE_ACCESS_SECRET: "a".repeat(64), HK_GUIDE_ACCESS_CODE: "synthetic-guide-access-0123456789012345",
  HK_ISSUER_SIGNING_SEED: "b".repeat(64), HK_STORE_KEY: GUIDE_PRODUCTION.storeKey, KV_REST_API_URL: "https://guide-routes-fixture.upstash.io", KV_REST_API_TOKEN: "synthetic-token",
  VERCEL: "1", VERCEL_ENV: "production", VERCEL_REGION: "icn1", VERCEL_URL: "guide-route-fixture.vercel.app",
  VERCEL_PROJECT_ID: GUIDE_PRODUCTION.projectId, VERCEL_ORG_ID: GUIDE_PRODUCTION.orgId, VERCEL_GIT_PROVIDER: "github", VERCEL_GIT_COMMIT_REF: GUIDE_PRODUCTION.branch,
  VERCEL_GIT_COMMIT_SHA: "c".repeat(40), VERCEL_GIT_REPO_OWNER: "woogieboogie-jl", VERCEL_GIT_REPO_SLUG: "k-tour-id" }
function reset() { for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, fixture) }
reset()
mock.method(Date, "now", () => now)
let network = 0, sessions = 0
globalThis.fetch = async () => { network++; throw new Error("network_tripwire") }
mock.method(workAsyncStorage, "getStore", () => { sessions++; throw new Error("session_tripwire") })
const route = await import("../../app/api/hackathon/v1/[...path]/route")
afterEach(() => { assert.equal(network, 0); assert.equal(sessions, 0); reset() })
after(() => { globalThis.fetch = originalFetch; mock.restoreAll(); for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, originalEnv) })
function call(path: string[], { method = "GET", body = "{}", cookie = "", headers = {} }: { method?: string; body?: string; cookie?: string; headers?: Record<string, string> } = {}) {
  const req = new Request(`${origin}/api/hackathon/v1/${path.join("/")}`, { method, headers: { host: "ktour-id.vercel.app", "x-forwarded-host": "ktour-id.vercel.app", "x-forwarded-proto": "https", origin, "content-type": "application/json", cookie, ...headers }, ...(method === "POST" ? { body } : {}) })
  return (method === "POST" ? route.POST : route.GET)(req, { params: Promise.resolve({ path }) })
}
async function cookie() {
  const r = await call(["guide", "access"], { method: "POST", body: JSON.stringify({ accessCode: fixture.HK_GUIDE_ACCESS_CODE }) })
  assert.equal(r.status, 200); return r.headers.get("set-cookie")!.split(";")[0]
}
test("production public readiness stays honest; config/collection require dedicated access", async () => {
  const r = await call(["guide", "readiness"]); assert.equal(r.status, 200)
  const result = await r.json(); assert.equal(result.ready, false); assert.equal(result.accessProfile, "guide-production")
  assert.equal(result.verification, "configuration_only")
  for (const path of [["config"], ["guide", "collection"]]) {
    const res = await call(path); assert.equal(res.status, 401); assert.equal((await res.json()).error.code, "guide_access_denied")
  }
})
test("production config identifies v2 scope without activating unavailable providers", async () => {
  const res = await call(["config"], { cookie: await cookie() }); assert.equal(res.status, 200)
  const b = await res.json(); assert.equal(b.guideProfile, "guide-production")
  assert.equal(b.campaign.campaignId, "ktour-neighborhood-guide-save-v2")
  assert.equal(b.consentVersion, "ktour-guide-save-consent-2026-09-29-v2")
  assert.equal(b.capabilities.chainExecutionEnabled, false)
  assert.equal(JSON.stringify(b).includes(fixture.HK_GUIDE_ACCESS_SECRET), false)
  assert.equal(JSON.stringify(b).includes(fixture.KV_REST_API_TOKEN), false)
})
test("production routes reject legacy/sample/unknown paths before session or provider work", async () => {
  const c = await cookie()
  for (const path of [["operations"], ["integration", "access"], ["hosted", "access"], ["operations", "op_fixture12345", "credential", "issue"], ["operations", "op_fixture12345", "presentation", "submit"], ["guide", "operations", "extra"]]) {
    const r = await call(path, { method: "POST", cookie: c }); assert.equal(r.status, 403, path.join("/")); assert.equal((await r.json()).error.code, "guide_production_scope")
  }
  for (const [path, body] of [[["operations", "op_fixture12345", "identity", "complete"], { sample: { outcome: "verified" } }], [["operations", "op_fixture12345", "delegation", "prepare"], { signer: "demo" }]] as const) {
    const r = await call([...path], { method: "POST", cookie: c, body: JSON.stringify(body) }); assert.equal(r.status, 400)
  }
})
test("grant access rejects malformed JSON/unknown fields, cross-origin and wrong runtime target", async () => {
  for (const body of ["[]", "null", "{", JSON.stringify({ accessCode: fixture.HK_GUIDE_ACCESS_CODE, approved: true })]) assert.equal((await call(["guide", "access"], { method: "POST", body })).status, 400)
  assert.equal((await call(["guide", "access"], { method: "POST", headers: { origin: "https://hostile.invalid" } })).status, 403)
  process.env.HK_GUIDE_PRODUCTION_ENABLED = "0"
  assert.equal((await call(["guide", "access"], { method: "POST" })).status, 503)
})
