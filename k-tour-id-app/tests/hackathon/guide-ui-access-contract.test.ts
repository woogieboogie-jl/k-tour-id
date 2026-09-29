import assert from "node:assert/strict"
import test from "node:test"
import { GUIDE_SAVE_V2 as V } from "../../lib/hackathon/guide-contract"
import { guideAccessEndpointB, validGuideConfigB } from "../../features/ondo/experience-b/guide-access-contract-b"

const config = () => ({ isolatedMock: false, guideProfile: "guide-production", guide: { ...V },
  campaign: { ...V, purpose: V.action }, consentVersion: V.consentVersion,
  modes: { cx: "cx", opendid: "opendid", sui: "testnet", omnione: "stage", ai: "gemini", zklogin: "google" } })

test("guide UI selects a distinct, explicit access endpoint for each profile", () => {
  assert.equal(guideAccessEndpointB("guide-production"), "/api/hackathon/v1/guide/access")
  assert.equal(guideAccessEndpointB("integration-preview"), "/api/hackathon/v1/integration/access")
})

test("guide production config requires the complete canonical tuple and true-provider modes", () => {
  assert.equal(validGuideConfigB(config(), "guide-production"), true)
  for (const key of Object.keys(V)) {
    const c = config(); (c.guide as Record<string, unknown>)[key] = "mismatch"
    assert.equal(validGuideConfigB(c, "guide-production"), false, key)
  }
  for (const key of ["venueId", "campaignId", "purpose", "policyVersion", "endsAt"]) {
    const c = config(); (c.campaign as Record<string, unknown>)[key] = "legacy-v1"
    assert.equal(validGuideConfigB(c, "guide-production"), false, key)
  }
  for (const key of Object.keys(config().modes)) {
    const c = config(); (c.modes as Record<string, unknown>)[key] = "mock"
    assert.equal(validGuideConfigB(c, "guide-production"), false, key)
  }
  for (const c of [null, [], {}, { ...config(), isolatedMock: true }, { ...config(), guideProfile: undefined }, { ...config(), guideProfile: "integration-preview" }, { ...config(), guide: undefined }, { ...config(), consentVersion: "legacy-v1" }]) {
    assert.equal(validGuideConfigB(c, "guide-production"), false)
  }
})

test("integration config may retain historical generic campaign, never a historical guide tuple", () => {
  const c = { ...config(), guideProfile: "integration-preview", campaign: { campaignId: "historical-v1" }, consentVersion: "historical-v1" }
  assert.equal(validGuideConfigB(c, "integration-preview"), true)
  assert.equal(validGuideConfigB(c, "guide-production"), false)
  assert.equal(validGuideConfigB({ ...c, guide: { ...V, action: "redeem_demo_entitlement" } }, "integration-preview"), false)
})
