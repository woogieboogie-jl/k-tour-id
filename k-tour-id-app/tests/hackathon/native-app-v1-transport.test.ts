import assert from "node:assert/strict"
import test from "node:test"
import { boundedNativeAppCall, cancelNativeAppRequest, nativeAppBridge, nativeBindingAppBridge, parseNativeBindingLaunch, nativeAppOfferText, nativeAppUi, parseNativeAppCancel, parseNativeAppFlow, parseNativeAppWallet, readNativeAppWallet, type NativeAppBridge } from "../../features/ondo/hackathon-b/native-app-v1-transport-b"

// Public Swift contract snapshot: native ac9c2d31, KTourNativeContract.swift
// sha256 bb171ddc71857316737483a2d3122b6b6a30d6e0ca88c24e4f53c0624fe5118b.
// Synthetic transport fixtures only; never native issuance or real CX evidence.
const ID = "0".repeat(32)
const wallet = { v: 1, state: "ready", biometric: "none", holder: "synthetic" }
const flow = { v: 1, requestId: ID, outcome: "submitted", retryable: false }
test("real binding extension and launch are separately exact, correlated, short-lived capabilities", () => {
  const env = { origin: "https://ktour-id.vercel.app", isTopLevel: true, bridge: bridge() }
  assert.equal(nativeBindingAppBridge(env), null)
  assert(nativeBindingAppBridge({ ...env, bridge: bridge({ bindingVersion: "cx-holder-v1", bind: async () => flow }) }))
  const now = Date.now(), op = "op_native_fixture_123", launch = { version: "cx-holder-v1", operationId: op, bindingId: "nhb_" + "a".repeat(24), token: "b".repeat(43), authNonce: "c".repeat(64), expiresAt: new Date(now + 60000).toISOString(), status: "challenge" }
  assert(parseNativeBindingLaunch(launch, op, now))
  for (const patch of [{ operationId: "op_other_fixture_123" }, { status: "verified" }, { status: "allocated" }, { token: "short" }, { authNonce: "short" }, { expiresAt: new Date(now).toISOString() }, { expiresAt: new Date(now + 600001).toISOString() }, { holderDid: "did:omn:private" }]) assert.equal(parseNativeBindingLaunch({ ...launch, ...patch }, op, now), null)
})
function bridge(patch: Record<string, unknown> = {}): NativeAppBridge {
  return Object.freeze({ available: true, version: 1, platform: "ios", wallet: async () => wallet, setup: async () => flow, unlock: async () => flow, issue: async () => flow, present: async () => flow, cancel: async () => ({ v: 1, cancelled: true }), ...patch }) as NativeAppBridge
}

test("app v1 detector requires exact production origin, top-level, frozen own data capability", () => {
  const env = { origin: "https://ktour-id.vercel.app", isTopLevel: true, bridge: bridge() }
  assert.equal(nativeAppBridge(env), env.bridge)
  for (const patch of [{ origin: "http://ktour-id.vercel.app" }, { origin: "https://ktour-id.vercel.app.evil.invalid" }, { origin: "https://preview.vercel.app" }, { origin: "http://127.0.0.1:3181" }, { isTopLevel: false }, { bridge: { ...env.bridge } }, { bridge: bridge({ version: 2 }) }, { bridge: bridge({ available: "true" }) }, { bridge: bridge({ issue: undefined }) }]) assert.equal(nativeAppBridge({ ...env, ...patch }), null)
  let getter = 0
  const accessor = Object.freeze({ ...env.bridge, get version() { getter++; return 1 } })
  assert.equal(nativeAppBridge({ ...env, bridge: accessor }), null)
  assert.equal(getter, 0)
})

test("flow DTO exact shape/request correlation; submitted is only an unprivileged hint", () => {
  assert.deepEqual(parseNativeAppFlow(flow, ID), flow)
  for (const patch of [{ requestId: "1".repeat(32) }, { v: "1" }, { outcome: "approved" }, { retryable: 1 }, { authorized: true }, { code: "private error text" }, { providerCode: "provider URL/token" }]) assert.equal(parseNativeAppFlow({ ...flow, ...patch }, ID), null)
  assert.equal(parseNativeAppFlow(flow, "invalid"), null)
  assert.equal(parseNativeAppFlow({ ...flow, code: "timeout", providerCode: "MSDKWLT12200" }, ID)?.code, "timeout")
  let getter = 0
  assert.equal(parseNativeAppFlow({ ...flow, get outcome() { getter++; return "submitted" } }, ID), null)
  assert.equal(getter, 0)
})

test("wallet readiness is only a hint, never an actual CX authority or pass disclosure", async () => {
  assert.deepEqual(parseNativeAppWallet(wallet), wallet)
  assert.equal(parseNativeAppWallet({ ...wallet, holder: "cx_bound" })?.holder, "cx_bound")
  for (const patch of [{ holder: "verified" }, { state: "approved" }, { biometric: "faceid" }, { passes: [] }, { holderDid: "did:example:private" }, { code: "unknown" }]) assert.equal(parseNativeAppWallet({ ...wallet, ...patch }), null)
  let args: unknown = "unset"
  const result = await readNativeAppWallet(bridge({ wallet: async (value: unknown) => { args = value; return wallet } }))
  assert.equal(args, undefined)
  assert.equal(result.status, "reply")
  if (result.status === "reply") assert.equal(result.reply.holder, "synthetic")
  assert.equal("authorized" in result, false)
})

test("offer bytes/controls and UI match native parser; opaque content is not rewritten", () => {
  const qr = '{"payloadType":"ISSUE_VC","payload":"synthetic fixture"}'
  assert.equal(nativeAppOfferText(qr), true)
  assert.equal(nativeAppOfferText("x".repeat(8192)), true)
  for (const invalid of ["", "x".repeat(8193), "日".repeat(3000), "a\n", "a\r", "a\0", "a\x7f", "a\x85", "a\u2028", "a\u2029"]) assert.equal(nativeAppOfferText(invalid), false)
  for (const locale of ["ko", "en", "ja"]) assert.equal(nativeAppUi({ locale, theme: "dark" }), true)
  for (const invalid of [{ locale: "de", theme: "dark" }, { locale: "ko", theme: "auto" }, { locale: "ko", theme: "light", callback: "https://evil.invalid" }]) assert.equal(nativeAppUi(invalid), false)
})

test("cancel in-flight is not an undo and cancellation sends only the correlated request id", async () => {
  const reply = { v: 1, cancelled: false, reason: "in_flight" }
  assert.deepEqual(parseNativeAppCancel(reply), reply)
  assert.equal(parseNativeAppCancel({ v: 1, cancelled: true, reason: "in_flight" }), null)
  assert.equal(parseNativeAppCancel({ ...reply, authorized: true }), null)
  const calls: unknown[] = []
  const native = bridge({ cancel: async (args: unknown) => { calls.push(args); return reply } })
  assert.equal((await cancelNativeAppRequest(native, "invalid")).status, "unavailable")
  assert.deepEqual(await cancelNativeAppRequest(native, ID), { status: "reply", reply })
  assert.deepEqual(calls, [{ requestId: ID }])
})

test("timeout and cancellation ignore late native replies without retrying or parsing them", async () => {
  let calls = 0, parses = 0, resolve!: (value: unknown) => void
  const work = () => { calls++; return new Promise<unknown>(done => { resolve = done }) }
  assert.deepEqual(await boundedNativeAppCall(work, value => { parses++; return value }, { timeoutMs: 5 }), { status: "timeout" })
  resolve(flow); await Promise.resolve()
  assert.equal(calls, 1); assert.equal(parses, 0)
  const controller = new AbortController()
  const pending = boundedNativeAppCall(work, value => { parses++; return value }, { timeoutMs: 100, signal: controller.signal })
  controller.abort(); assert.deepEqual(await pending, { status: "cancelled" })
  resolve(flow); await Promise.resolve()
  assert.equal(calls, 2); assert.equal(parses, 0)
  await boundedNativeAppCall(work, value => value, { timeoutMs: 100, signal: controller.signal })
  assert.equal(calls, 2)
})

test("native rejection/throw and invalid timeout do not leak private messages or invoke again", async () => {
  let calls = 0
  const fail = () => { calls++; throw new Error("private provider details must not leave transport") }
  assert.deepEqual(await boundedNativeAppCall(fail, value => value, { timeoutMs: 5 }), { status: "unavailable" })
  assert.deepEqual(await boundedNativeAppCall(fail, value => value, { timeoutMs: 0 }), { status: "unavailable" })
  assert.equal(calls, 1)
  assert.deepEqual(await boundedNativeAppCall(async () => flow, () => null, { timeoutMs: 10 }), { status: "invalid_reply" })
})
