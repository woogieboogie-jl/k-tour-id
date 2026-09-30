import assert from "node:assert/strict"
import { test } from "node:test"
import { CX_AGE19_POLICY, JIT_IDENTITY_VERSION, type JitIdentityReceipt } from "../../lib/hackathon/jit-identity-contract"
import { completeGlobalAfter19CxCheckB, isGlobalAfter19NightViewCurrent, sanitizeGlobalAfter19Session } from "../../features/ondo/after19/after19-global-b-model"

const now = new Date("2026-09-30T00:00:00Z")
const receipt = (): JitIdentityReceipt => ({ version: JIT_IDENTITY_VERSION, receiptId: "idr_age19fixture1234", context: { action: "after19_access", purpose: "age19", venueId: null, tableId: null, contextDigest: `0x${"a".repeat(64)}` }, authorizedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 120000).toISOString(), evidenceExpiresAt: new Date(now.getTime() + 3600000).toISOString(), provider: "omnione_cx", personVerified: true, adultVerified: false, age19Verified: true, age19Policy: CX_AGE19_POLICY, paymentKycVerified: false })
test("only in-document consumed age19 receipt opens night view; persisted JSON cannot restore authority", () => {
  const session = completeGlobalAfter19CxCheckB(receipt(), "idn_age19fixture1234", now)!
  assert.equal(session.mode, "on"); assert.equal(isGlobalAfter19NightViewCurrent(session, now), true)
  assert.equal(sanitizeGlobalAfter19Session(session, now).mode, "on")
  assert.equal(sanitizeGlobalAfter19Session(JSON.parse(JSON.stringify(session)), now).mode, "off")
  assert.equal(isGlobalAfter19NightViewCurrent(session, new Date(now.getTime() + 120000)), false)
  assert.equal(sanitizeGlobalAfter19Session(session, new Date(now.getTime() + 120000)).mode, "off")
})
test("person/adult/wrong-action/old-policy receipts cannot become night-view age authority", () => {
  for (const r of [ { ...receipt(), age19Verified: false }, { ...receipt(), age19Policy: undefined }, { ...receipt(), age19Policy: "old" },
    { ...receipt(), context: { ...receipt().context, action: "pass_setup" as const } }, { ...receipt(), context: { ...receipt().context, purpose: "person" as const } } ])
    assert.equal(completeGlobalAfter19CxCheckB(r, "idn_age19fixture1234", now), null)
})
test("consumed server view expiry may exceed grant deadline without enabling persisted or other-purpose authority", () => {
  const view = { ...receipt(), expiresAt: new Date(now.getTime() + 3600000).toISOString() }
  const session = completeGlobalAfter19CxCheckB(view, "idn_age19fixture1234", now)!
  const later = new Date(now.getTime() + 121000)
  assert.equal(sanitizeGlobalAfter19Session(session, later).mode, "on")
  assert.equal(isGlobalAfter19NightViewCurrent(session, later), true)
  assert.equal(sanitizeGlobalAfter19Session(JSON.parse(JSON.stringify(session)), later).mode, "off")
})
