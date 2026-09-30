import assert from "node:assert/strict"
import { test } from "node:test"
import { PUBLIC_CX_MARKER, publicCxEnabled, publicCxRouteAllowed, publicJourneyRouteAllowed, assertPublicCxTarget, publicCxRateKeys, reservePublicCxRate } from "../../lib/hackathon/public-cx-policy"
import { hostedExecutionOperationCount } from "../../lib/hackathon/jit-identity-policy"
import type { Db, OperationRecord } from "../../lib/hackathon/store"
import { assertPublicIdentityStore, assertPublicIdentityMonotonic, publicIdentityAllocations } from "../../lib/hackathon/public-cx-integrity"

function env(): Record<string, string> { return {
  NEXT_PUBLIC_HK_PUBLIC_CX: PUBLIC_CX_MARKER, HK_PUBLIC_CX: PUBLIC_CX_MARKER,
  NEXT_PUBLIC_HK_HOSTED_SUI: "1", HK_MODE_CX: "cx", HK_ISOLATED_MOCK: "0", HK_API_ENABLED: "1", NEXT_PUBLIC_HK_ENABLED: "1",
  NEXT_PUBLIC_HK_CX_PREVIEW: "0", NEXT_PUBLIC_HK_INTEGRATION_PREVIEW: "0", NEXT_PUBLIC_HK_PREVIEW_READ_ONLY: "0",
  HK_CX_BASE_URL: "https://cx.raonsecure.co.kr:18543", HK_CX_PROVIDER: "comdl", HK_CX_ZKP_TYPE: "AdultVerify", HK_ISSUER_SIGNING_SEED: "b".repeat(64),
  HK_STORE_KEY: "ktour:sui-hosted:20260928:v1", KV_REST_API_URL: "https://synthetic.upstash.io", KV_REST_API_TOKEN: "not-a-real-secret",
  VERCEL: "1", VERCEL_ENV: "production", VERCEL_URL: "test-immutable.vercel.app", VERCEL_PROJECT_ID: "prj_w5rckTz9B1DO55fvVRXjQRy9L5RM",
  VERCEL_GIT_REPO_OWNER: "woogieboogie-jl", VERCEL_GIT_REPO_SLUG: "k-tour-id", VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
} }
function req(method = "GET", extra: Record<string, string> = {}) {
  return new Request("https://ktour-id.vercel.app/api/hackathon/v1/identity/eligibility", { method, headers: {
    host: "ktour-id.vercel.app", "x-forwarded-host": "ktour-id.vercel.app", "x-forwarded-proto": "https",
    origin: "https://ktour-id.vercel.app", "sec-fetch-site": "same-origin", "x-vercel-forwarded-for": "192.0.2.1", ...extra,
  } })
}
test("public identity requires dual opt-in and real pinned CX, never mock downgrade", () => {
  assert(publicCxEnabled(env()))
  for (const patch of [{ HK_PUBLIC_CX: "" }, { NEXT_PUBLIC_HK_PUBLIC_CX: "" }, { HK_MODE_CX: "mock" }, { HK_CX_BASE_URL: "https://foreign.invalid" }, { HK_ISOLATED_MOCK: "1" }, { NEXT_PUBLIC_HK_PREVIEW_READ_ONLY: "1" }]) assert.equal(publicCxEnabled({ ...env(), ...patch }), false)
})
test("no access code for exact identity paths; no operation/credential/chain/admin scope", () => {
  assert(publicCxRouteAllowed("GET", ["identity", "eligibility"], env()))
  assert(publicCxRouteAllowed("POST", ["identity", "requests"], env()))
  for (const p of [["identity", "eligibility", "tail"], ["operations"], ["hosted", "access"], ["outbox", "flush"], ["zklogin", "prove"], ["sessions"], ["config"]]) assert.equal(publicCxRouteAllowed("POST", p, env()), false)
  assert.equal(publicCxRouteAllowed("DELETE", ["identity", "requests"], env()), false)
})
test("public identity stays independent of chain expiry but requires real project/store/proxy/CSRF", () => {
  assert.doesNotThrow(() => assertPublicCxTarget(req("POST"), { ...env(), HK_HOSTED_SUI_EXPIRES_AT: "2020-01-01T00:00:00Z" }))
  const badHeaders: Record<string, string>[] = [{ origin: "https://attacker.invalid" }, { "sec-fetch-site": "cross-site" }, { "x-forwarded-host": "evil.invalid" }, { "x-forwarded-proto": "http" }]
  for (const headers of badHeaders) assert.throws(() => assertPublicCxTarget(req("POST", headers), env()))
  for (const patch of [{ VERCEL_PROJECT_ID: "other" }, { HK_STORE_KEY: "fresh-ledger" }, { KV_REST_API_TOKEN: "" }, { VERCEL_GIT_COMMIT_SHA: "not-sha" }]) assert.throws(() => assertPublicCxTarget(req(), { ...env(), ...patch }))
})
test("rate identifiers are pseudonymous, expire by window and never use attacker x-forwarded-for", () => {
  const now = Date.parse("2026-09-30T00:00:00Z"), a = publicCxRateKeys(req(), "start", env(), now)
  assert(a.every(k => !k.includes("192.0.2.1")))
  assert.deepEqual(a, publicCxRateKeys(req("POST", { "x-forwarded-for": "attacker" }), "start", env(), now))
  assert.notDeepEqual(a, publicCxRateKeys(req(), "start", env(), now + 3600000))
  assert.throws(() => publicCxRateKeys(req("POST", { "x-vercel-forwarded-for": "" }), "start", env(), now))
})
test("rate check sends only counter keys and rejects exhausted or malformed responses", async () => {
  const saved = globalThis.fetch
  try {
    let calls = 0, result: unknown = 1
    globalThis.fetch = async (_url, init) => { calls++; const cmd = JSON.parse(String(init?.body)); assert.equal(cmd[0], "EVAL"); assert.equal(cmd[2], 2); assert.equal(cmd[5], 5); assert(!String(init?.body).includes("192.0.2.1")); return Response.json({ result }) }
    await reservePublicCxRate(req("POST"), ["identity", "requests", "idn_fixture", "start"], env())
    assert.equal(calls, 1)
    for (const denied of [0, null, "1"]) { result = denied; await assert.rejects(reservePublicCxRate(req("POST"), ["identity", "requests", "idn_fixture", "start"], env())) }
    await reservePublicCxRate(req("POST"), ["identity", "requests", "idn_fixture", "cancel"], env()); assert.equal(calls, 4)
  } finally { globalThis.fetch = saved }
})
test("new identity-only rows never consume execution slots and legacy rows retain their allocation", () => {
  const db = { operations: {
    old: { kind: "identity_check", secrets: {} }, public: { kind: "identity_check", secrets: { publicIdentity: true } },
    chain: { kind: "entitlement", secrets: {} }, forgedChain: { kind: "entitlement", secrets: { publicIdentity: true } },
  } as unknown as Record<string, OperationRecord> } as Db
  assert.equal(hostedExecutionOperationCount(db), 3)
})
test("public journey access never opens admin/outbox/access-cookie or direct identity operation routes", () => {
  assert(publicJourneyRouteAllowed("GET", ["config"], env()))
  assert(publicJourneyRouteAllowed("POST", ["operations"], env()))
  for (const p of [["outbox", "flush"], ["hosted", "access"], ["operations", "op_abcdefgh12345678", "identity", "start"], ["operations", "op_abcdefgh12345678", "provider", "issuance", "start"], ["identity", "eligibility"]]) assert.equal(publicJourneyRouteAllowed("POST", p, env()), false)
  assert.equal(publicJourneyRouteAllowed("POST", ["operations"], { ...env(), HK_PUBLIC_CX: "" }), false)
})
test("identity pool labels cannot relabel a prior paid slot or carry execution material", () => {
  const op = { operationId: "op_fixture", kind: "identity_check", campaignId: "ktour-purpose-identity-v1", secrets: {} } as OperationRecord
  const db = { operations: { op_fixture: op } } as unknown as Db, before = publicIdentityAllocations(db)
  op.secrets.publicIdentity = true
  assert.throws(() => assertPublicIdentityMonotonic(before, db))
  assert.doesNotThrow(() => assertPublicIdentityStore(db))
  const publicBefore = publicIdentityAllocations(db)
  delete op.secrets.publicIdentity
  assert.throws(() => assertPublicIdentityMonotonic(publicBefore, db))
  op.secrets.publicIdentity = true; op.proposal = {} as OperationRecord["proposal"]
  assert.throws(() => assertPublicIdentityStore(db))
})
