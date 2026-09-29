/** Actual routes/session/CX parser/store, synthetic transport only. No external
 * network, real identity approval, Sui signature or production authority. */
import assert from "node:assert/strict"
import { beforeEach, mock, test } from "node:test"
import { AsyncLocalStorage } from "node:async_hooks"
import { createRequire } from "node:module"
import { PIN } from "../../../lib/hackathon/hosted-sui-profile"
import { JIT_IDENTITY_CONSENT } from "../../../lib/hackathon/jit-identity-contract"
import { digestOf } from "../../../lib/hackathon/util"

const require = createRequire(import.meta.url), origin = PIN.publicOrigin, redis = "https://jit-synthetic-only.upstash.io"
mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-09-29T06:00:00Z") })
Object.assign(process.env, {
  NODE_ENV: "test", NEXT_PUBLIC_HK_HOSTED_SUI: "1", HK_HOSTED_SUI_ENABLED: "1", NEXT_PUBLIC_HK_ENABLED: "1", HK_API_ENABLED: "1",
  NEXT_PUBLIC_HK_CX_PREVIEW: "0", NEXT_PUBLIC_HK_PREVIEW_READ_ONLY: "0", NEXT_PUBLIC_HK_INTEGRATION_PREVIEW: "0", HK_ISOLATED_MOCK: "0",
  HK_MODE_CX: "cx", HK_MODE_OPENDID: "mock", HK_AI_MODE: "rule", HK_HOSTED_SUI_EXPIRES_AT: PIN.maxExpiresAt,
  HK_HOSTED_SUI_ACCESS_SECRET: "a".repeat(64), HK_HOSTED_SUI_ACCESS_CODE: "b".repeat(48), HK_ISSUER_SIGNING_SEED: "c".repeat(64),
  HK_CX_BASE_URL: "https://cx.raonsecure.co.kr:18543", HK_CX_PROVIDER: "comdl", HK_CX_ZKP_TYPE: "AdultVerify",
  HK_SUI_NETWORK: PIN.network, HK_SUI_GRPC_URL: PIN.rpc, HK_SUI_PACKAGE_ID: PIN.packageId, HK_SUI_CAMPAIGN_ID: PIN.campaignId, HK_SUI_CAMPAIGN_INITIAL_VERSION: PIN.campaignInitialVersion,
  HK_SUI_ISSUER_SECRET_KEY: "suiprivkey1" + "q".repeat(59), HK_SUI_AGENT_SECRET_KEY: "suiprivkey1" + "p".repeat(59),
  HK_STORE_KEY: PIN.storeKey, UPSTASH_REDIS_REST_URL: redis, UPSTASH_REDIS_REST_TOKEN: "d".repeat(64),
  VERCEL: "1", VERCEL_ENV: "production", VERCEL_TARGET_ENV: "production", VERCEL_URL: "jit-route-synthetic-only.vercel.app", VERCEL_REGION: PIN.region,
  VERCEL_PROJECT_ID: PIN.projectId, VERCEL_ORG_ID: PIN.orgId, VERCEL_GIT_PROVIDER: "github", VERCEL_GIT_COMMIT_REF: PIN.branch,
  VERCEL_GIT_REPO_OWNER: PIN.repoOwner, VERCEL_GIT_REPO_SLUG: PIN.repoName, VERCEL_GIT_COMMIT_SHA: "e".repeat(40),
})
let raw: string | null = null, lock: string | null = null, writes = 0, trans = 0, providerCalls = 0
const requests = new Map<string, { txId: string; cxId: string }>()
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input), b = init?.body ? JSON.parse(String(init.body)) : {}
  if (url.origin === redis) {
    const c = b as Array<string | number>; let result: unknown
    if (c[0] === "GET") { assert.equal(c[1], PIN.storeKey); result = raw }
    else if (c[0] === "SET") { assert.equal(c[1], `${PIN.storeKey}:lock`); assert.equal(lock, null); lock = String(c[2]); result = "OK" }
    else if (c[0] === "EVAL" && c[2] === 2) { assert.deepEqual(c.slice(3, 5), [`${PIN.storeKey}:lock`, PIN.storeKey]); result = lock === c[5] ? 1 : 0; if (result) { raw = String(c[6]); writes++ } }
    else if (c[0] === "EVAL" && c[2] === 1) { assert.equal(c[3], `${PIN.storeKey}:lock`); result = lock === c[4] ? 1 : 0; if (result) lock = null }
    else throw new Error("unexpected Redis fixture command")
    return Response.json({ result })
  }
  assert.equal(url.origin, "https://cx.raonsecure.co.kr:18543", "all non-fixture network forbidden")
  providerCalls++
  if (url.pathname.endsWith("/trans")) {
    trans++; const token = `fixture-token-${trans}`, row = { txId: `fixture-tx-${trans}`, cxId: `fixture-cx-${trans}` }; requests.set(token, row)
    return Response.json({ code: 200, token, txId: row.txId })
  }
  const token = String(b.token).replace("complete-", ""), row = requests.get(token); assert(row)
  if (url.pathname.endsWith("/qr/request")) return Response.json({ code: 200, token, ...row, data: { qrBase64: Buffer.from("89504e470d0a1a0a", "hex").toString("base64") } })
  if (url.pathname.endsWith("/qr/result")) return Response.json({ code: 200, oacxStatus: "AFTER_RESULT", token: `complete-${token}`, ...row, reqTxId: row.txId, data: { verified: true } })
  if (url.pathname.endsWith("/trans/token")) return Response.json({ code: 200, data: { ci: `synthetic-ci-${token}`, sub: "AFTER_RESULT", adult: "Y" } })
  throw new Error("unexpected CX fixture path")
}
type Browser = Map<string, string>
const ctx = new AsyncLocalStorage<{ browser: Browser; req: Request }>()
mock.module(require.resolve("next/headers"), { namedExports: {
  headers: async () => ctx.getStore()!.req.headers,
  cookies: async () => ({ get: (key: string) => ctx.getStore()!.browser.has(key) ? { value: ctx.getStore()!.browser.get(key)! } : undefined,
    set: (key: string, value: string, options: { httpOnly: boolean; sameSite: string }) => { assert(options.httpOnly); assert.equal(options.sameSite, "lax"); ctx.getStore()!.browser.set(key, value) } }),
} })
const route = await import("../../../app/api/hackathon/v1/[...path]/route")
const store = await import("../../../lib/hackathon/store")
beforeEach(() => { raw = null; lock = null; writes = 0; trans = 0; providerCalls = 0; requests.clear() })
async function call(browser: Browser, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const req = new Request(`${origin}/api/hackathon/v1/${path}`, { method: body === undefined ? "GET" : "POST", headers: {
    host: "ktour-id.vercel.app", "x-forwarded-host": "ktour-id.vercel.app", "x-forwarded-proto": "https", origin, "sec-fetch-site": "same-origin", "content-type": "application/json",
    cookie: [...browser].map(([k, v]) => `${k}=${v}`).join("; "), ...headers,
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const response = await ctx.run({ browser, req }, () => (body === undefined ? route.GET : route.POST)(req, { params: Promise.resolve({ path: path.split("/") }) }))
  const c = response.headers.get("set-cookie")?.split(";")[0]; if (c) browser.set(c.slice(0, c.indexOf("=")), c.slice(c.indexOf("=") + 1))
  assert.equal(response.headers.get("cache-control"), "no-store")
  return { status: response.status, value: await response.json() }
}
async function ok(browser: Browser, path: string, body?: unknown) { const r = await call(browser, path, body); assert.equal(r.status, 200, JSON.stringify(r.value)); return r.value }
async function browser() { const b: Browser = new Map(); await ok(b, "hosted/access", { accessCode: process.env.HK_HOSTED_SUI_ACCESS_CODE }); return b }
const input = (n: number, action = "pass_setup", venueId: string | null = null) => ({ action, purpose: "person", venueId, tableId: null, contextDigest: digestOf(n), consentVersion: JIT_IDENTITY_CONSENT })
async function verified(b: Browser) { const r = await ok(b, "identity/requests", input(0)); await ok(b, `identity/requests/${r.requestId}/start`, { mobile: false }); return ok(b, `identity/requests/${r.requestId}/complete`, {}) }

test("authenticated eligibility GET is genuinely read-only and anonymous access creates no session", async () => {
  const b = await browser(), value = await ok(b, "identity/eligibility"); assert.equal(value.person.state, "proof_required"); assert.equal(value.canStart, true)
  assert.equal(raw, null); assert.equal(writes, 0); assert.equal(providerCalls, 0); assert.equal(b.has("ondo_hk_session"), false)
})
test("actual JIT route/session/store/CX parser completes proof, reuses it for local action, no Sui call", async () => {
  const b = await browser(), proof = await verified(b); assert.equal(proof.status, "authorized"); assert.equal(trans, 1)
  const db = JSON.parse(raw!); assert.equal(Object.keys(db.operations).length, 1); assert.equal(Object.values<any>(db.operations)[0].kind, "identity_check")
  const r = await ok(b, "identity/requests", input(1, "local_moment", PIN.venueId)); assert.equal(r.status, "authorized"); assert.equal(trans, 1)
  const receipt = await ok(b, `identity/authorizations/${r.authorizationRef}/consume`, r.context)
  assert.equal(receipt.personVerified, true); assert.equal(receipt.paymentKycVerified, false)
  assert.deepEqual(await ok(b, `identity/requests/${r.requestId}/receipt`), receipt)
  const before = writes; await ok(b, "identity/eligibility"); assert.equal(writes, before)
  const picker = await ok(b, `places/${PIN.venueId}/demo-entitlements`); assert.equal(picker.operation, null)
  for (const text of ["synthetic-ci", "fixture-token", "fixture-tx"]) assert(!JSON.stringify([r, receipt, picker]).includes(text))
})
test("actual perk creation consumes existing proof once, same-create retry returns same operation, cancellation blocks issuance", async () => {
  const b = await browser(), source = await verified(b), grant = await ok(b, "identity/requests", input(1, "designated_perk", PIN.venueId))
  await ok(b, `identity/authorizations/${grant.authorizationRef}/consume`, grant.context)
  const payload = { venueId: PIN.venueId, consentVersion: PIN.consentVersion, locale: "ja", identityAuthorizationRef: grant.authorizationRef, identityContextDigest: grant.context.contextDigest }
  const op = await ok(b, "operations", payload); assert.equal(op.phase, "issuance"); assert.equal(trans, 1)
  const before = Object.keys(JSON.parse(raw!).operations).length
  assert.equal((await ok(b, "operations", payload)).operationId, op.operationId); assert.equal(Object.keys(JSON.parse(raw!).operations).length, before)
  await ok(b, `identity/requests/${source.requestId}/cancel`, {})
  const loaded = await ok(b, `operations/${op.operationId}`); assert.equal(loaded.identity.sourceCurrent, false); assert(!loaded.allowedActions.includes("issue"))
  const picker = await ok(b, `places/${PIN.venueId}/demo-entitlements`); assert.equal(picker.operation.identity.sourceCurrent, false); assert(!picker.operation.allowedActions.includes("issue"))
  const result = await call(b, `operations/${op.operationId}/credential/issue`, { publicKeyPem: "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n-----END PUBLIC KEY-----\n", alg: "Ed25519" })
  assert.equal(result.status, 409); assert.equal(result.value.error.code, "cx_mode_changed"); assert.equal(trans, 1)
})
test("foreign authenticated session, fake claims, source operation direct routes and context replay cannot authorize", async () => {
  const b = await browser(), source = await verified(b), stranger = await browser(); await ok(stranger, "sessions", {})
  assert.equal((await call(stranger, `identity/requests/${source.requestId}`)).status, 404)
  assert.equal((await call(stranger, `identity/authorizations/${source.authorizationRef}/consume`, source.context)).status, 403)
  const opId = Object.keys(JSON.parse(raw!).operations)[0], before = providerCalls
  assert.equal((await call(b, `operations/${opId}/identity/start`, { mobile: false })).status, 404)
  assert.equal((await call(b, `identity/requests/${source.requestId}/complete`, { sample: { outcome: "verified" } })).status, 400)
  assert.equal((await call(b, `identity/authorizations/${source.authorizationRef}/consume`, { ...source.context, contextDigest: digestOf("other") })).status, 403)
  assert.equal(providerCalls, before)
})
test("same literal 10-slot hosted cap includes all new identity checks and cancellation never resets it", async () => {
  const b = await browser()
  for (let n = 0; n < 10; n++) { const r = await ok(b, "identity/requests", input(n)); await ok(b, `identity/requests/${r.requestId}/start`, { mobile: false }); await ok(b, `identity/requests/${r.requestId}/cancel`, {}) }
  const r = await ok(b, "identity/requests", input(10)); const denied = await call(b, `identity/requests/${r.requestId}/start`, { mobile: false })
  assert.equal(denied.status, 429); assert.equal(denied.value.error.code, "hosted_sui_limit"); assert.equal(trans, 10); assert.equal(Object.keys(JSON.parse(raw!).operations).length, 10)
})
test("source proof policy provenance survives storage round-trip, but current policy drift removes eligibility", async () => {
  const b = await browser(); await verified(b); assert.equal((await ok(b, "identity/eligibility")).person.state, "verified")
  await store.withStore(db => { Object.values(db.operations)[0].identity!.providerPolicyDigest = digestOf("old-origin-policy") })
  assert.equal((await ok(b, "identity/eligibility")).person.state, "proof_required")
})
