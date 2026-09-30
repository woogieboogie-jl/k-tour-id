// Actual Next route admission; downstream identity/operation/session ports are
// synthetic. No real provider, cookie store, signing, database or network I/O.
import assert from "node:assert/strict"
import { after, before, beforeEach, mock, test } from "node:test"
import { PIN } from "../../lib/hackathon/hosted-sui-profile"
import { PUBLIC_CX_MARKER } from "../../lib/hackathon/public-cx-policy"
import { JIT_IDENTITY_CONSENT } from "../../lib/hackathon/jit-identity-contract"
import { HkError } from "../../lib/hackathon/util"

const savedEnv = { ...process.env }, savedFetch = globalThis.fetch
let authenticated = false, sessions = 0, identityCalls = 0, operationCalls = 0, counters = 0
const session = { sessionId: "ses_fixture", subjectRef: null, createdAt: "2026-09-30T00:00:00Z", lastSeenAt: "2026-09-30T00:00:00Z" }
mock.module(new URL("../../lib/hackathon/session.ts", import.meta.url).href, { namedExports: {
  assertSameOrigin: async () => assert.fail("Public route uses stricter request-bound origin"),
  getSession: async () => authenticated ? session : null,
  ensureSession: async () => { sessions++; authenticated = true; return session },
  requireSession: async () => { if (!authenticated) throw new HkError("no_session", "Session required", 401); return session },
} })
const actualJit = await import("../../lib/hackathon/jit-identity")
mock.module(new URL("../../lib/hackathon/jit-identity.ts", import.meta.url).href, { namedExports: {
  ...actualJit,
  jitIdentity: {
    eligibility: async () => ({ canStart: true, provider: "omnione_cx" }),
    create: async () => { identityCalls++; return { status: "awaiting_identity" } },
    start: async () => { identityCalls++; return { status: "handoff" } },
    complete: async () => { identityCalls++; return { status: "authorized" } },
    get: async () => ({ status: "handoff" }), receipt: async () => ({ receipt: true }),
    cancel: async () => ({ status: "cancelled" }), consume: async () => ({ consumed: true }),
  },
} })
const actualService = await import("../../lib/hackathon/service")
mock.module(new URL("../../lib/hackathon/service.ts", import.meta.url).href, { namedExports: {
  ...actualService, createOperation: async () => { operationCalls++; throw new HkError("jit_identity_scope", "Fixture rejects unproven grant", 403) },
} })
const route = await import("../../app/api/hackathon/v1/[...path]/route")
const path = ["identity", "requests"], id = "idn_" + "a".repeat(24)
const context = { action: "pass_setup", purpose: "person", venueId: null, tableId: null, contextDigest: "0x" + "a".repeat(64), consentVersion: JIT_IDENTITY_CONSENT }
function request(method: string, p: string[], value?: unknown, patch: Record<string, string> = {}) {
  return new Request(`https://ktour-id.vercel.app/api/hackathon/v1/${p.join("/")}`, { method,
    headers: { host: PIN.publicHost, "x-forwarded-host": PIN.publicHost, "x-forwarded-proto": "https", origin: PIN.publicOrigin,
      "sec-fetch-site": "same-origin", "x-vercel-forwarded-for": "192.0.2.2", "content-type": "application/json", ...patch },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  })
}
const get = (p: string[], patch = {}) => route.GET(request("GET", p, undefined, patch), { params: Promise.resolve({ path: p }) })
const post = (p: string[], value: unknown, patch = {}) => route.POST(request("POST", p, value, patch), { params: Promise.resolve({ path: p }) })
before(() => {
  for (const key of Object.keys(process.env)) if (/^(?:HK_|NEXT_PUBLIC_HK_|VERCEL|KV_|UPSTASH_|GEMINI_|GOOGLE_|NEXT_PUBLIC_GOOGLE_)/.test(key)) delete process.env[key]
  Object.assign(process.env, {
    NODE_ENV: "production", NEXT_PUBLIC_HK_PUBLIC_CX: PUBLIC_CX_MARKER, HK_PUBLIC_CX: PUBLIC_CX_MARKER,
    NEXT_PUBLIC_HK_HOSTED_SUI: "1", HK_HOSTED_SUI_ENABLED: "1", HK_API_ENABLED: "1", NEXT_PUBLIC_HK_ENABLED: "1",
    NEXT_PUBLIC_HK_CX_PREVIEW: "0", NEXT_PUBLIC_HK_INTEGRATION_PREVIEW: "0", NEXT_PUBLIC_HK_PREVIEW_READ_ONLY: "0",
    HK_MODE_CX: "cx", HK_MODE_OPENDID: "mock", HK_AI_MODE: "rule", HK_ISOLATED_MOCK: "0",
    HK_CX_BASE_URL: "https://cx.raonsecure.co.kr:18543", HK_CX_PROVIDER: "comdl", HK_CX_ZKP_TYPE: "AdultVerify",
    HK_ISSUER_SIGNING_SEED: "c".repeat(64), HK_HOSTED_SUI_ACCESS_SECRET: "d".repeat(64), HK_HOSTED_SUI_ACCESS_CODE: "e".repeat(48),
    HK_HOSTED_SUI_EXPIRES_AT: PIN.maxExpiresAt, HK_STORE_KEY: PIN.storeKey, KV_REST_API_URL: "https://fixture.upstash.io", KV_REST_API_TOKEN: "f".repeat(48),
    HK_SUI_NETWORK: PIN.network, HK_SUI_GRPC_URL: PIN.rpc, HK_SUI_PACKAGE_ID: PIN.packageId, HK_SUI_CAMPAIGN_ID: PIN.campaignId,
    HK_SUI_CAMPAIGN_INITIAL_VERSION: PIN.campaignInitialVersion, HK_SUI_ISSUER_SECRET_KEY: "g".repeat(64), HK_SUI_AGENT_SECRET_KEY: "h".repeat(64),
    VERCEL: "1", VERCEL_ENV: "production", VERCEL_URL: "fixture-immutable.vercel.app", VERCEL_PROJECT_ID: PIN.projectId, VERCEL_REGION: PIN.region,
    VERCEL_GIT_PROVIDER: "github", VERCEL_GIT_COMMIT_REF: PIN.branch, VERCEL_GIT_REPO_OWNER: PIN.repoOwner, VERCEL_GIT_REPO_SLUG: PIN.repoName, VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
  })
  mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-09-30T00:00:00Z") })
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://fixture.upstash.io"); const b = JSON.parse(String(init?.body)); assert.equal(b[0], "EVAL"); counters++
    return Response.json({ result: 1 })
  }
})
beforeEach(() => { authenticated = false; sessions = identityCalls = operationCalls = counters = 0; process.env.HK_PUBLIC_CX = PUBLIC_CX_MARKER })
after(() => { mock.timers.reset(); mock.restoreAll(); globalThis.fetch = savedFetch; for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key]; Object.assign(process.env, savedEnv) })
test("anonymous config and identity availability no longer require an access code or create a session", async () => {
  assert.equal((await get(["config"])).status, 200)
  assert.equal((await get(["identity", "eligibility"])).status, 200)
  assert.equal(sessions + identityCalls + operationCalls + counters, 0)
})
test("same-origin consent creates a purpose request, never a chain operation", async () => {
  const response = await post(path, context); assert.equal(response.status, 200)
  assert.equal(sessions, 1); assert.equal(identityCalls, 1); assert.equal(operationCalls, 0); assert.equal(counters, 1)
})
test("CSRF and injected proof claims reject before session/provider/counter work", async () => {
  assert.equal((await post(path, context, { origin: "https://attacker.invalid" })).status, 403)
  assert.equal((await post(path, { ...context, personVerified: true })).status, 400)
  assert.equal(sessions + identityCalls + operationCalls + counters, 0)
})
test("request state/action remains session-owned and never trusts a browser completion boolean", async () => {
  assert.equal((await get(["identity", "requests", id])).status, 401)
  assert.equal((await post(["identity", "requests", id, "complete"], { verified: true })).status, 400)
  assert.equal(identityCalls, 0)
})
test("public operation creation requires a consumed exact-action grant; no anonymous budget exhaustion", async () => {
  const body = { venueId: PIN.venueId, consentVersion: PIN.consentVersion, locale: "en" }
  assert.equal((await post(["operations"], body)).status, 403)
  assert.equal(operationCalls + sessions + counters, 0)
  authenticated = true
  assert.equal((await post(["operations"], { ...body, identityAuthorizationRef: "ida_" + "a".repeat(24), identityContextDigest: context.contextDigest })).status, 403)
  assert.equal(operationCalls, 1, "actual service then rechecks the purported grant; route never mints one")
})
test("removed public flag restores restricted access, not a silent mock fallback", async () => {
  process.env.HK_PUBLIC_CX = ""
  assert.equal((await get(["identity", "eligibility"])).status, 401)
  assert.equal(identityCalls + sessions, 0)
})
