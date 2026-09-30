import assert from "node:assert/strict"
import { test } from "node:test"
import { nativeBindingRoute, nativeBindingRouteAllowed } from "../../lib/hackathon/native-binding-route"
import type { createNativeBindingService } from "../../lib/hackathon/native-binding-service"
const MAIN = "https://ktour-id.vercel.app", OP = "op_native_fixture01", BINDING = "nhb_" + "a".repeat(24), TOKEN = "b".repeat(43)
const path = (action: string) => ["operations", OP, "native-binding", action]
const state = { version: "cx-holder-v1", bindingId: BINDING, status: "challenge", expiresAt: "2099-01-01T00:00:00Z" }
function setup() {
  const calls: string[] = []
  const service = { async start(s: string, id: string) { calls.push(`start:${s}:${id}`); return state }, async status() { calls.push("status"); return state }, async cancel() { calls.push("cancel"); return state }, async begin(id: string, binding: string, token: string) { assert.equal(id, OP); assert.equal(binding, BINDING); assert.equal(token, TOKEN); calls.push("begin"); return state }, async prove() { calls.push("prove"); return state }, async confirm() { calls.push("confirm"); return state } } as unknown as ReturnType<typeof createNativeBindingService>
  return { calls, run: (req: Request, action: string) => nativeBindingRoute(req, path(action), async () => ({ sessionId: "session_fixture" }), () => service, r => new URL(r.url).origin) }
}
function req(action: string, body: unknown = {}, headers: Record<string, string> = { origin: MAIN }) { return new Request(`${MAIN}/api/hackathon/v1/${path(action).join("/")}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }) }
test("dispatcher admits only exact scoped routes and browser session versus native capability", async () => {
  const h = setup(); assert.equal((await h.run(req("start"), "start"))?.status, 200)
  await h.run(req("begin", { version: "cx-holder-v1", bindingId: BINDING }, { authorization: `Bearer ${TOKEN}` }), "begin")
  assert.deepEqual(h.calls, [`start:session_fixture:${OP}`, "begin"])
  for (const [method, p] of [["GET", path("start")], ["POST", path("status")], ["POST", [...path("begin"), "extra"]], ["DELETE", path("cancel")]] as [string, string[]][]) assert.equal(nativeBindingRouteAllowed(method, p), false)
})
test("mixed browser/native credentials, cross origin, extra fields, oversized body are denied before service", async () => {
  const h = setup()
  for (const r of [req("begin", { version: "cx-holder-v1", bindingId: BINDING }, { origin: MAIN, authorization: `Bearer ${TOKEN}` }), req("begin", { version: "cx-holder-v1", bindingId: BINDING }, { cookie: "session=x", authorization: `Bearer ${TOKEN}` }), req("begin", { version: "cx-holder-v1", bindingId: BINDING, url: "https://attacker.invalid" }, { authorization: `Bearer ${TOKEN}` })]) await assert.rejects(h.run(r, "begin"))
  for (const r of [req("start", {}, {}), req("start", {}, { origin: "https://attacker.invalid" }), req("start", { allow: true }), req("start", { oversized: "x".repeat(65536) }), req("start", {}, { origin: MAIN, authorization: `Bearer ${TOKEN}` })]) await assert.rejects(h.run(r, "start"))
  assert.deepEqual(h.calls, [])
})
test("browser status returns only no-store public state; disabled production cannot instantiate provider", async () => {
  const h = setup(), r = await h.run(new Request(`${MAIN}/api/hackathon/v1/${path("status").join("/")}`), "status")
  assert.equal(r?.headers.get("cache-control"), "no-store, private"); assert.deepEqual(await r?.json(), state)
  await assert.rejects(nativeBindingRoute(req("start"), path("start"), async () => ({ sessionId: "session" }), undefined, r => new URL(r.url).origin))
})
