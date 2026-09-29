import assert from "node:assert/strict"
import { test } from "node:test"
import { GUIDE_PRODUCTION, guideProductionPreflightIssues, isGuideProductionProfile } from "../../lib/hackathon/guide-production-profile"
import { assertGuideProductionBody, assertGuideProductionTarget, grantGuideProductionAccess, guideProductionOrigin, guideProductionRouteAllowed, requireGuideProductionAccess } from "../../lib/hackathon/guide-production-access"
import { GUIDE_SAVE_V2 } from "../../lib/hackathon/guide-contract"
import { requiresIntegrationSuiLimits } from "../../lib/hackathon/integration-sui-limits"
import { isHostedSuiProfile } from "../../lib/hackathon/hosted-sui-profile"

const now = Date.parse("2026-09-29T01:00:00Z")
const fixture = {
  NEXT_PUBLIC_HK_GUIDE_PRODUCTION: "1", HK_GUIDE_PRODUCTION_ENABLED: "1", NEXT_PUBLIC_HK_ENABLED: "1", HK_API_ENABLED: "1",
  NEXT_PUBLIC_HK_HOSTED_SUI: "0", NEXT_PUBLIC_HK_INTEGRATION_PREVIEW: "0", NEXT_PUBLIC_HK_CX_PREVIEW: "0", NEXT_PUBLIC_HK_PREVIEW_READ_ONLY: "0",
  HK_ISOLATED_MOCK: "0", HK_MODE_CX: "cx", HK_MODE_OPENDID: "opendid", HK_AI_MODE: "gemini",
  HK_CX_BASE_URL: "https://cx.raonsecure.co.kr:18543", HK_CX_PROVIDER: "comdl", HK_CX_ZKP_TYPE: "AdultVerify",
  HK_GUIDE_EXPIRES_AT: "2026-09-30T14:59:59Z", HK_GUIDE_ACCESS_SECRET: "a".repeat(64), HK_GUIDE_ACCESS_CODE: "synthetic-guide-access-0123456789012345",
  HK_ISSUER_SIGNING_SEED: "b".repeat(64), HK_STORE_KEY: GUIDE_PRODUCTION.storeKey,
  KV_REST_API_URL: "https://guide-offline-fixture.upstash.io", KV_REST_API_TOKEN: "synthetic-token",
  VERCEL: "1", VERCEL_ENV: "production", VERCEL_REGION: "icn1", VERCEL_URL: "guide-offline-fixture.vercel.app",
  VERCEL_PROJECT_ID: GUIDE_PRODUCTION.projectId, VERCEL_ORG_ID: GUIDE_PRODUCTION.orgId, VERCEL_GIT_PROVIDER: "github",
  VERCEL_GIT_COMMIT_REF: GUIDE_PRODUCTION.branch, VERCEL_GIT_COMMIT_SHA: "c".repeat(40), VERCEL_GIT_REPO_OWNER: "woogieboogie-jl", VERCEL_GIT_REPO_SLUG: "k-tour-id",
}
const request = (host = "ktour-id.vercel.app", cookie?: string, headers: Record<string, string> = {}) => new Request(`https://${host}/api/hackathon/v1/guide/access`, { method: "POST", headers: { host, "x-forwarded-host": host, "x-forwarded-proto": "https", origin: `https://${host}`, "sec-fetch-site": "same-origin", ...(cookie ? { cookie } : {}), ...headers } })
const code = (error: unknown, expected: string) => !!error && (error as { code?: string }).code === expected
test("future production guide profile is strict and does not alter the existing hosted branch", () => {
  assert.deepEqual(guideProductionPreflightIssues(fixture, now), [])
  assert.equal(isGuideProductionProfile(fixture), true)
  assert.equal(requiresIntegrationSuiLimits(fixture), true)
  assert.equal(isHostedSuiProfile(fixture), false)
  assert.equal(isGuideProductionProfile({ VERCEL_GIT_COMMIT_REF: "deploy/sui-main-20260928" }), false)
  for (const field of ["NEXT_PUBLIC_HK_GUIDE_PRODUCTION", "HK_GUIDE_PRODUCTION_ENABLED", "VERCEL_GIT_COMMIT_REF"]) assert.equal(isGuideProductionProfile({ [field]: fixture[field as keyof typeof fixture] }), true)
})
test("profile rejects removed flags, drift, overlapping modes, wrong deployment and increased expiry", () => {
  for (const [key, value] of Object.entries({ NEXT_PUBLIC_HK_GUIDE_PRODUCTION: "0", HK_GUIDE_PRODUCTION_ENABLED: "0", NEXT_PUBLIC_HK_HOSTED_SUI: "1", NEXT_PUBLIC_HK_INTEGRATION_PREVIEW: "1", HK_MODE_OPENDID: "mock", HK_AI_MODE: "rule", VERCEL_PROJECT_ID: "other", VERCEL_ORG_ID: "other", VERCEL_GIT_COMMIT_REF: "main", VERCEL_ENV: "development", VERCEL_TARGET_ENV: "preview", VERCEL_REGION: "iad1", HK_GUIDE_EXPIRES_AT: "2026-10-01T00:00:00Z", HK_CAMPAIGN_ID: "hk-identity-perk-v1", HK_STORE_KEY: "ktour:sui-hosted:20260928:v1", HK_GUIDE_LOCAL_TEST: "1" })) {
    assert.ok(guideProductionPreflightIssues({ ...fixture, [key]: value }, now).length, key)
    assert.throws(() => assertGuideProductionTarget(request(), { ...fixture, [key]: value }, now), e => code(e, "guide_production_unavailable"), key)
  }
  assert.ok(guideProductionPreflightIssues(fixture, GUIDE_PRODUCTION.maxEnd).includes("expiry"))
})
test("private guide cookies are secure, origin-bound, expiring and reject duplicates/tampering/old-profile cookies", () => {
  const response = grantGuideProductionAccess(request(), fixture.HK_GUIDE_ACCESS_CODE, fixture, now)
  const header = response.headers.get("set-cookie")!
  for (const attr of ["__Host-ktour_guide_access=", "HttpOnly", "Secure", "SameSite=Lax", "Path=/", "Max-Age=7200"]) assert.ok(header.includes(attr))
  const cookie = header.split(";")[0]
  requireGuideProductionAccess(request(undefined, cookie), fixture, now)
  for (const value of ["", cookie + "; " + cookie, cookie + "x", cookie.replace("__Host-ktour_guide_access", "__Host-ktour_sui_access")]) assert.throws(() => requireGuideProductionAccess(request(undefined, value), fixture, now), e => code(e, "guide_access_denied"))
  assert.throws(() => requireGuideProductionAccess(request(fixture.VERCEL_URL, cookie), fixture, now), e => code(e, "guide_access_denied"))
  assert.throws(() => requireGuideProductionAccess(request(undefined, cookie), fixture, now + 7200000), e => code(e, "guide_access_denied"))
  assert.throws(() => grantGuideProductionAccess(request(), "wrong-code-01234567890123456789012345", fixture, now), e => code(e, "guide_access_denied"))
  assert.throws(() => grantGuideProductionAccess(request(undefined, undefined, { origin: "https://hostile.invalid" }), fixture.HK_GUIDE_ACCESS_CODE, fixture, now), e => code(e, "csrf"))
})
test("production alias is refused on Preview; proxy authority must agree", () => {
  assert.equal(guideProductionOrigin(request(), fixture), GUIDE_PRODUCTION.origin)
  assert.equal(guideProductionOrigin(request(fixture.VERCEL_URL), { ...fixture, VERCEL_ENV: "preview" }), `https://${fixture.VERCEL_URL}`)
  assert.throws(() => guideProductionOrigin(request(), { ...fixture, VERCEL_ENV: "preview" }))
  const malformed: Record<string, string>[] = [{ "x-forwarded-host": "hostile.invalid" }, { "x-forwarded-proto": "http" }, { host: "hostile.invalid" }]
  for (const headers of malformed) assert.throws(() => guideProductionOrigin(request(undefined, undefined, headers), fixture))
})
test("guide profile route allowlist excludes legacy entry, mock issuance, sample completion and remote workers", () => {
  const op = "op_fixture12345"
  for (const path of [["operations"], ["integration", "access"], ["hosted", "access"], ["operations", op, "credential", "issue"], ["operations", op, "presentation", "submit"], ["outbox", "run"], ["guide", "operations", "extra"]]) assert.equal(guideProductionRouteAllowed("POST", path), false, path.join("/"))
  for (const action of ["identity/start", "identity/complete", "provider/issuance/start", "provider/presentation/refresh", "delegation/prepare", "agent/run", "redeem", "cancel", "reconcile"]) assert.equal(guideProductionRouteAllowed("POST", ["operations", op, ...action.split("/")]), true)
  assert.equal(guideProductionRouteAllowed("HEAD", ["config"]), false)
  assert.throws(() => assertGuideProductionBody(["operations", op, "identity", "complete"], { sample: { outcome: "verified" } }))
  assert.throws(() => assertGuideProductionBody(["operations", op, "delegation", "prepare"], { signer: "demo" }))
  assert.throws(() => assertGuideProductionBody(["guide", "operations"], { venueId: GUIDE_SAVE_V2.venueId, consentVersion: "hk-consent-2026-09-14", locale: "ja" }))
  assert.doesNotThrow(() => assertGuideProductionBody(["guide", "operations"], { venueId: GUIDE_SAVE_V2.venueId, consentVersion: GUIDE_SAVE_V2.consentVersion, locale: "ja" }))
})
