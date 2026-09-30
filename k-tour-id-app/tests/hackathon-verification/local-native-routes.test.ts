// Actual route + service + isolated file store; only Next cookie context and
// network responses are synthetic. No identity is verified or provider called.
import assert from "node:assert/strict"
import { after, mock, test } from "node:test"
import { mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { LOCAL_NATIVE_PINS, LOCAL_NATIVE_MARKER, LOCAL_NATIVE_ORIGIN, LOCAL_NATIVE_DATA_DIR, LOCAL_NATIVE_STORE_KEY } from "../../lib/hackathon/local-native-policy"
import { HkError } from "../../lib/hackathon/util"
const originalEnv = process.env, originalFetch = globalThis.fetch, cwd = process.cwd()
const isolated = realpathSync(mkdtempSync(join(tmpdir(), "ktour-native-route-test-")))
process.chdir(isolated)
process.env = { NODE_ENV: "development", ...LOCAL_NATIVE_PINS, NEXT_PUBLIC_HK_LOCAL_NATIVE: LOCAL_NATIVE_MARKER, HK_LOCAL_NATIVE: LOCAL_NATIVE_MARKER, HK_STORE_KEY: LOCAL_NATIVE_STORE_KEY, HK_DATA_DIR: LOCAL_NATIVE_DATA_DIR, HK_API_ENABLED: "1", NEXT_PUBLIC_HK_ENABLED: "1", HK_ISOLATED_MOCK: "0", HK_MODE_CX: "cx", HK_MODE_OPENDID: "opendid", HK_AI_MODE: "rule", HK_OPENDID_BRIDGE_TOKEN: "fixture".repeat(8), HK_OPENDID_OWNER_BINDING_SECRET: "owner".repeat(8), HK_OPENDID_ADMIN_TOKEN: "admin".repeat(8), HK_ISSUER_SIGNING_SEED: "identity".repeat(8), HK_CAMPAIGN_ENDS_AT: "2099-01-01T00:00:00Z" }
const store = await import("../../lib/hackathon/store")
let session = "", calls = 0
globalThis.fetch = async (input, init) => {
  const url = String(input); calls++
  assert.equal(init?.method, "POST"); assert.equal(init?.redirect, "error")
  if (url === LOCAL_NATIVE_PINS.HK_CX_BASE_URL + "/oacx/api/v1.0/trans") return Response.json({ resultCode: 200, token: "fixture-token", txId: "fixture-tx" })
  if (url === LOCAL_NATIVE_PINS.HK_CX_BASE_URL + "/oacx/api/v1.0/authen/qr/request") return Response.json({ resultCode: 200, cxId: "fixture-cx", txId: "fixture-tx", data: { qrBase64: "iVBORw0KGgo=" } })
  assert.fail("No other transport allowed in this test")
}
mock.module(new URL("../../lib/hackathon/session.ts", import.meta.url).href, { namedExports: {
  assertSameOrigin: async () => {},
  getSession: async () => session ? store.readStore(db => db.sessions[session]) : null,
  ensureSession: async () => { session ||= "ses_local_fixture_01"; return store.withStore(db => db.sessions[session] ??= { sessionId: session, subjectRef: null, createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() }) },
  requireSession: async () => { if (!session) throw new HkError("no_session", "No session", 401); return store.readStore(db => db.sessions[session]) },
} })
const route = await import("../../app/api/hackathon/v1/[...path]/route")
const config = await import("../../lib/hackathon/config")
const api = (method: "GET" | "POST", path: string[], body?: unknown, origin = LOCAL_NATIVE_ORIGIN) => route[method](new Request(`${origin}/api/hackathon/v1/${path.join("/")}`, { method, headers: { host: new URL(origin).host, origin, "content-type": "application/json", "sec-fetch-site": "same-origin" }, ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}) }), { params: Promise.resolve({ path }) })
after(() => { mock.restoreAll(); globalThis.fetch = originalFetch; process.env = originalEnv; process.chdir(cwd); rmSync(isolated, { recursive: true }) })
test("local route exposes truthful config, explicit session and actual operation/CX parsing, not sample promotion", async () => {
  const cfg = await (await api("GET", ["config"])).json()
  assert.equal(cfg.modes.opendid, "opendid"); assert.equal(cfg.capabilities.nativeBindingConfigured, true); assert.equal(cfg.capabilities.chainExecutionEnabled, false)
  assert.equal(session, ""); assert.equal(calls, 0)
  assert.equal((await api("POST", ["sessions"])).status, 200)
  const created = await api("POST", ["operations"], { venueId: cfg.campaign.venueId, consentVersion: cfg.consentVersion, locale: "ko" })
  assert.equal(created.status, 200); const op = await created.json(); assert.equal(op.phase, "identity")
  const start = await api("POST", ["operations", op.operationId, "identity", "start"], { mobile: false })
  assert.equal(start.status, 200); assert.equal((await start.json()).identity.handoff.kind, "qr"); assert.equal(calls, 2)
  assert.equal((await api("POST", ["operations", op.operationId, "identity", "complete"], { sample: { outcome: "verified" } })).status, 503)
  const binding = await api("POST", ["operations", op.operationId, "native-binding", "start"])
  assert.equal(binding.status, 409, "the identity phase cannot start native registration; a QR never permits CAS allocation")
  assert.equal(calls, 2)
})
test("local route rejects all paid/signing/sample paths and profile/origin drift before side effects", async () => {
  const before = calls
  for (const path of [["operations", "op_local_fixture01", "proposal"], ["operations", "op_local_fixture01", "delegation", "prepare"], ["operations", "op_local_fixture01", "redeem"], ["operations", "op_local_fixture01", "credential", "issue"], ["identity", "requests"], ["zklogin", "prove"]]) assert.equal((await api("POST", path)).status, 403)
  assert.equal((await api("GET", ["config"], undefined, "http://127.0.0.1:3181")).status, 503)
  for (const service of ["Gemini proposal", "Sui", "OmniOne Chain", "zkLogin provider authentication"]) assert.throws(() => config.assertExternalServicesEnabled(service))
  process.env.VERCEL_REGION = "local"; assert.equal((await api("GET", ["config"])).status, 503); delete process.env.VERCEL_REGION
  assert.equal(calls, before)
})
