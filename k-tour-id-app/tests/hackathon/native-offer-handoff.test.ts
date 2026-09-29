import assert from "node:assert/strict"
import test from "node:test"
import { canUseNativeOfferHandoff, createNativeOfferHandoff, nativeOfferContext, nativeV1Policy, type NativeEnvironment, type NativeOfferContext } from "../../features/ondo/hackathon-b/native-offer-handoff-b"
import { guideJourney } from "../../lib/hackathon/guide-contract"
import type { OperationResult } from "../../lib/hackathon/types"

const NOW = 1_800_000_000_000
const QR = '{"payloadType":"ISSUE_VC","payload":"synthetic-opaque-offer-not-real"}'
const context: NativeOfferContext = { operationId: "op_synthetic_native_fixture", venueId: "fixture-venue", campaignId: "fixture-campaign", policyVersion: 1, phase: "issuance", revision: 2, expiresAt: new Date(NOW + 300_000).toISOString(), status: "pending", execution: "provider", providerSupported: true }
function environment(openOffer: (qr: string) => void = () => {}): NativeEnvironment {
  return { origin: "https://ktour-id.vercel.app", isTopLevel: true, bridge: Object.freeze({ available: true, platform: "ios", openOffer, showWallet() {} }) }
}

test("native transport exists only on the exact main origin/top frame and documented frozen bridge", () => {
  const env = environment()
  assert.equal(canUseNativeOfferHandoff(env), true)
  for (const patch of [{ origin: "http://ktour-id.vercel.app" }, { origin: "https://ktour-id.vercel.app.evil.invalid" }, { origin: "https://preview.vercel.app" }, { origin: "http://127.0.0.1:3174" }, { isTopLevel: false }, { bridge: null }, { bridge: { available: true, platform: "ios", openOffer() {}, showWallet() {} } }, { bridge: Object.freeze({ available: "true", platform: "ios", openOffer() {}, showWallet() {} }) }, { bridge: Object.freeze({ available: true, platform: "android", openOffer() {}, showWallet() {} }) }, { bridge: Object.freeze({ available: true, platform: "ios", openOffer: "call-me", showWallet() {} }) }]) {
    assert.equal(canUseNativeOfferHandoff({ ...env, ...patch }), false)
  }
  let read = false
  const spoof = Object.freeze({ get available() { read = true; return true }, platform: "ios", openOffer() {}, showWallet() {} })
  assert.equal(canUseNativeOfferHandoff({ ...env, bridge: spoof }), false)
  assert.equal(read, false)
})

test("opaque QR stays unchanged, sent exactly once, no result can authorize or mutate operation", () => {
  const received: string[] = [], env = environment(qr => { received.push(qr); return { authorized: true } })
  const before = JSON.stringify(context)
  const handoff = createNativeOfferHandoff(context, QR, NOW)!
  assert.equal(received.length, 0)
  assert.equal(handoff.open(context, env, NOW), "sent")
  assert.equal(handoff.open(context, env, NOW), "already_sent")
  assert.deepEqual(received, [QR])
  assert.equal(JSON.stringify(context), before)
  assert.equal("authorized" in handoff, false)
  assert.equal(JSON.stringify(handoff).includes(QR), false)
})

test("different operation, revision, phase, terminal status, provider mode and expired source all block", () => {
  let calls = 0
  for (const patch of [{ operationId: "op_another_pending_fixture" }, { venueId: "another-place" }, { campaignId: "another-campaign" }, { policyVersion: 2 }, { revision: 3 }, { phase: "presentation" as const }, { status: "cancelled" as const }, { status: "unknown" as const }, { execution: "sample" as const }, { providerSupported: false }, { expiresAt: new Date(NOW).toISOString() }]) {
    const handoff = createNativeOfferHandoff(context, QR, NOW)!
    assert.equal(handoff.open({ ...context, ...patch }, environment(() => { calls++ }), NOW), "stale")
    assert.equal(handoff.open(context, environment(), NOW), "stale")
  }
  assert.equal(calls, 0)
})

test("cancellation/unmount invalidation and conservative offer expiry permanently discard QR", () => {
  const handoff = createNativeOfferHandoff(context, QR, NOW)!
  handoff.invalidate()
  assert.equal(handoff.open(context, environment(), NOW), "stale")
  const expiring = createNativeOfferHandoff(context, QR, NOW)!
  assert.equal(expiring.expiresAt, NOW + 120_000)
  assert.equal(expiring.open(context, environment(), NOW + 120_000), "stale")
  const short = { ...context, expiresAt: new Date(NOW + 1000).toISOString() }
  assert.equal(createNativeOfferHandoff(short, QR, NOW)!.expiresAt, NOW + 1000)
})

test("reentrant native bridge and unknown throw cannot double-send", () => {
  let calls = 0
  const handoff = createNativeOfferHandoff(context, QR, NOW)!
  const env = environment(() => {
    calls++
    assert.equal(handoff.open(context, env, NOW), "already_sent")
    throw new Error("synthetic transport outcome unknown")
  })
  assert.equal(handoff.open(context, env, NOW), "failed")
  assert.equal(handoff.open(context, env, NOW), "already_sent")
  assert.equal(calls, 1)
})

test("missing or swapped-out bridge never consumes the request", () => {
  const handoff = createNativeOfferHandoff(context, QR, NOW)!
  assert.equal(handoff.open(context, { ...environment(), bridge: null }, NOW), "unavailable")
  assert.equal(handoff.open(context, environment(), NOW), "sent")
})

test("empty/oversized/invalid offers and nonprovider contexts never create handoff", () => {
  for (const qr of ["", " ", "\0", "x".repeat(8193), "日".repeat(3000)]) assert.equal(createNativeOfferHandoff(context, qr, NOW), null)
  for (const patch of [{ providerSupported: false }, { status: "succeeded" as const }, { phase: "proposal" as const }, { revision: NaN }, { expiresAt: "invalid" }, { operationId: "not-an-operation" }]) {
    assert.equal(createNativeOfferHandoff({ ...context, ...patch }, QR, NOW), null)
  }
})

test("actual native V1 policy excludes guide V2 and mock/source-expired evidence", () => {
  const op: OperationResult = { ...context, kind: "demo_entitlement", createdAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString(), safeNextAction: "wait", allowedActions: ["issue", "cancel"], returnContext: null, consent: null,
    identity: { evidenceId: "fixture", subjectRef: "fixture", source: "cx_mobile_id", mode: "cx", provider: "synthetic", personVerified: true, adultVerified: false, verifiedAt: new Date(NOW).toISOString(), expiresAt: new Date(NOW + 1000).toISOString(), providerTransactionRef: "synthetic", handoff: null },
    credential: null, presentation: null, proposal: null, delegation: null, agent: null, fulfillment: null, chain: null, error: null }
  assert.equal(nativeV1Policy(op), true)
  assert.equal(nativeOfferContext(op).providerSupported, true)
  assert.equal(nativeOfferContext(op).expiresAt, op.identity!.expiresAt)
  assert.equal(nativeOfferContext({ ...op, journey: guideJourney() }).providerSupported, false)
  assert.equal(nativeOfferContext({ ...op, policyVersion: 2 }).providerSupported, false)
  assert.equal(nativeOfferContext({ ...op, execution: "sample" }).providerSupported, false)
  assert.equal(nativeOfferContext({ ...op, identity: { ...op.identity!, mode: "mock" } }).providerSupported, false)
  assert.equal(nativeOfferContext({ ...op, identity: { ...op.identity!, sourceCurrent: false } }).providerSupported, false)
})
