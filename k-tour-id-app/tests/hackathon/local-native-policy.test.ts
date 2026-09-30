import assert from "node:assert/strict"
import test from "node:test"
import { assertLocalNativeProfile, localNativeEnabled, localNativeRequested, assertLocalNativeTarget, localNativeRouteAllowed, assertLocalNativeBody, LOCAL_NATIVE_MARKER as MARKER, LOCAL_NATIVE_ORIGIN as ORIGIN, LOCAL_NATIVE_STORE_KEY, LOCAL_NATIVE_DATA_DIR, LOCAL_NATIVE_PINS } from "../../lib/hackathon/local-native-policy"
import { nativeAppOriginAllowed } from "../../features/ondo/hackathon-b/native-app-v1-transport-b"
import { nativeBindingConfiguration } from "../../lib/hackathon/native-binding-provider"
const base: NodeJS.ProcessEnv = { ...LOCAL_NATIVE_PINS, HK_OPENDID_BRIDGE_TOKEN: "fixture".repeat(8), HK_OPENDID_OWNER_BINDING_SECRET: "owner".repeat(8), HK_OPENDID_ADMIN_TOKEN: "admin".repeat(8), HK_ISSUER_SIGNING_SEED: "identity".repeat(8), NODE_ENV: "development", HK_LOCAL_NATIVE: MARKER, NEXT_PUBLIC_HK_LOCAL_NATIVE: MARKER, HK_STORE_KEY: LOCAL_NATIVE_STORE_KEY, HK_DATA_DIR: LOCAL_NATIVE_DATA_DIR, HK_API_ENABLED: "1", NEXT_PUBLIC_HK_ENABLED: "1", HK_ISOLATED_MOCK: "0", HK_MODE_CX: "cx", HK_MODE_OPENDID: "opendid", HK_AI_MODE: "rule" }
test("local native requires both markers, dev, exact namespace and no deployed/secret mixing", () => {
  assertLocalNativeProfile(base); assert(localNativeEnabled(base)); assert(!localNativeRequested({}))
  for (const patch of [{ HK_LOCAL_NATIVE: "" }, { NEXT_PUBLIC_HK_LOCAL_NATIVE: undefined }, { NODE_ENV: "production" }, { NODE_ENV: "test" }, { VERCEL: "" }, { VERCEL_REGION: "local" }, { UPSTASH_REDIS_REST_URL: "" }, { KV_REST_API_TOKEN: "fixture" }, { HK_STORE_KEY: "old-ledger" }, { HK_DATA_DIR: ".data/hackathon" }, { HK_SUI_AGENT_SECRET_KEY: "fixture" }, { GEMINI_API_KEY: "fixture" }, { NEXT_PUBLIC_HK_HOSTED_SUI: "0" }, { HK_MODE_CX: "mock" }, { HK_ISOLATED_MOCK: "1" }, { HK_AI_MODE: "gemini" }, { HK_API_ENABLED: "0" }]) {
    assert.throws(() => assertLocalNativeProfile({ ...base, ...patch } as NodeJS.ProcessEnv)); assert(!localNativeEnabled({ ...base, ...patch }))
  }
})
test("exact local request origin and Next forwarded agreement, never arbitrary proxy trust", () => {
  assertLocalNativeTarget(new Request(ORIGIN + "/api/hackathon/v1/config"), base)
  assertLocalNativeTarget(new Request(ORIGIN + "/api/hackathon/v1/config", { headers: { host: "127.0.0.1:3183", "x-forwarded-host": "127.0.0.1:3183", "x-forwarded-proto": "http" } }), base)
  assertLocalNativeTarget(new Request("http://localhost:3183/api/hackathon/v1/config", { headers: { host: "127.0.0.1:3183", "x-forwarded-host": "127.0.0.1:3183", "x-forwarded-proto": "http" } }), base)
  assert.throws(() => assertLocalNativeTarget(new Request("http://localhost:3183/api/hackathon/v1/config", { headers: { host: "127.0.0.1:3183" } }), base))
  for (const url of ["http://localhost:3183", "http://127.0.0.1:3181", "http://127.0.0.1:3182", "https://ktour-id.vercel.app", "https://preview.vercel.app", ORIGIN + "/?x=1"]) assert.throws(() => assertLocalNativeTarget(new Request(url), base))
  for (const headers of [{ host: "evil.invalid" }, { "x-forwarded-host": "evil.invalid" }, { "x-forwarded-host": "127.0.0.1:3183, evil.invalid" }, { "x-forwarded-proto": "https" }, { forwarded: "host=127.0.0.1:3183" }] as Record<string, string>[]) assert.throws(() => assertLocalNativeTarget(new Request(ORIGIN, { headers }), base))
})
test("local API allows explicit real identity/provider actions but no sample, guide, signing, AI or fulfillment", () => {
  const op = ["operations", "op_local_fixture01"]
  for (const path of [["sessions"], ["operations"], [...op, "identity", "start"], [...op, "identity", "complete"], [...op, "native-binding", "prove"], [...op, "provider", "issuance", "start"], [...op, "provider", "presentation", "refresh"], [...op, "cancel"]]) assert(localNativeRouteAllowed("POST", path))
  for (const path of [["identity", "requests"], ["guide", "operations"], ["zklogin", "prove"], [...op, "credential", "issue"], [...op, "presentation", "submit"], [...op, "proposal"], [...op, "delegation", "prepare"], [...op, "agent", "run"], [...op, "redeem"], [...op, "reconcile"], [...op, "provider", "issuance", "start", "extra"]]) assert(!localNativeRouteAllowed("POST", path))
  assert(localNativeRouteAllowed("GET", [...op, "evidence"])); assert(!localNativeRouteAllowed("DELETE", op))
  assertLocalNativeBody(["operations"], { venueId: "fixture", consentVersion: "consent", locale: "ja" })
  assertLocalNativeBody([...op, "identity", "start"], { mobile: false })
  assertLocalNativeBody([...op, "identity", "complete"], {})
  for (const value of [{ sample: { outcome: "verified" } }, { proof: "fixture" }, { mobile: true }]) assert.throws(() => assertLocalNativeBody([...op, "identity", "complete"], value))
})
test("native browser transport is local only in an explicitly marked dev bundle", () => {
  assert(nativeAppOriginAllowed(ORIGIN, MARKER, "development"))
  assert(nativeAppOriginAllowed("https://ktour-id.vercel.app", undefined, "production"))
  for (const [origin, marker, mode] of [[ORIGIN, MARKER, "production"], [ORIGIN, "", "development"], ["http://localhost:3183", MARKER, "development"], ["http://127.0.0.1:3181", MARKER, "development"]]) assert(!nativeAppOriginAllowed(origin, marker, mode))
})
test("native capability digest binds local versus main profile/origin even with equal provider credentials", () => {
  const { HK_LOCAL_NATIVE: _runtime, NEXT_PUBLIC_HK_LOCAL_NATIVE: _build, ...provider } = base
  assert.notEqual(nativeBindingConfiguration(provider).configBinding, nativeBindingConfiguration(base).configBinding)
  for (const patch of [{ HK_OPENDID_CAS_URL: "http://127.0.0.1:19303" }, { HK_OPENDID_DID_API_URL: "http://127.0.0.1:19406" }, { HK_OPENDID_BRIDGE_URL: "https://remote.invalid" }, { HK_OPENDID_OWNER_BINDING_SECRET: "short" }, { HK_CX_BASE_URL: "https://remote.invalid" }]) assert.throws(() => nativeBindingConfiguration({ ...base, ...patch }))
})
