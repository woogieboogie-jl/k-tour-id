import assert from "node:assert/strict"
import { test } from "node:test"
import { createNativeBindingProvider, nativeBindingConfiguration } from "../../lib/hackathon/native-binding-provider"
const cfg = { casOrigin: "https://provider.invalid", taOrigin: "https://provider.invalid", didOrigin: "https://provider.invalid", adminToken: "offline-fixture-token".repeat(2) }, id = "a".repeat(43), ref = "b".repeat(64)
test("private provider config is opt-in, origin-pinned and invalidates rotated credentials", () => {
  const e = { NODE_ENV: "test" as const, HK_OPENDID_HOLDER_BINDING_ENABLED: "1", HK_OPENDID_ADMIN_TOKEN: cfg.adminToken, HK_OPENDID_CAS_URL: cfg.casOrigin, HK_OPENDID_TA_URL: cfg.taOrigin, HK_OPENDID_DID_API_URL: cfg.didOrigin, HK_OPENDID_TRUSTED_ORIGIN: cfg.casOrigin, HK_OPENDID_OWNER_BINDING_SECRET: "fixture-secret".repeat(4) }
  const c = nativeBindingConfiguration(e); assert(c.configBinding.startsWith("0x"))
  for (const patch of [{ HK_OPENDID_HOLDER_BINDING_ENABLED: "0" }, { HK_OPENDID_ADMIN_TOKEN: "short" }, { HK_OPENDID_CAS_URL: "https://other.invalid" }, { HK_OPENDID_TA_URL: "https://provider.invalid/private" }, { HK_OPENDID_DID_API_URL: "https://a:b@provider.invalid" }]) assert.throws(() => nativeBindingConfiguration({ ...e, ...patch }))
  assert.notEqual(nativeBindingConfiguration({ ...e, HK_OPENDID_ADMIN_TOKEN: "changed".repeat(8) }).configBinding, c.configBinding)
})
test("CAS allocate is one write plus exact readback with token header, never redirect or retry", async () => {
  const calls: { url: string; init?: RequestInit }[] = []
  const p = createNativeBindingProvider(cfg, async (url, init) => { calls.push({ url: String(url), init }); return Response.json(calls.length === 1 ? null : { pii: ref }) })
  await p.allocateCas(id, ref); assert.equal(calls.length, 2)
  assert(calls[0].url.endsWith("/cas/api/v1/save-user-info")); assert.equal(calls[0].init?.redirect, "error"); assert.equal(calls[0].init?.credentials, "omit")
  assert.equal(new Headers(calls[0].init?.headers).get("x-ktour-admin-token"), cfg.adminToken)
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { userId: id, pii: ref })
})
test("transport failures, response mismatch/oversize and ignored-abort timeout are bounded/redacted", async () => {
  for (const fetcher of [async () => { throw new Error("private-token-or-url") }, async () => Response.json({ pii: "wrong" }), async () => Response.json({ pii: ref, extra: true }), async () => new Response("x".repeat(131073)), async () => new Promise<Response>(() => {})]) {
    const started = performance.now(); await assert.rejects(createNativeBindingProvider(cfg, fetcher, 15).confirmCas(id, ref), e => e instanceof Error && e.message === "The holder connection could not be confirmed"); assert(performance.now() - started < 1000)
  }
})
