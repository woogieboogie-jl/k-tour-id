import assert from "node:assert/strict"
import { test } from "node:test"
import { clearJourneyOnCloseB } from "../../features/ondo/hackathon-b/hackathon-recovery-b"
import { fixture } from "./fixtures/hosted-omnione.fixture"

test("pending new-target confirmation survives close and temporary provider unavailability", () => {
  const { op } = fixture()
  op.status = "pending"; op.phase = "fulfillment"; op.hostedTestRedemption = true
  assert.equal(clearJourneyOnCloseB(op, false, true), false)
  op.allowedActions = ["check_status", "return"]
  assert.equal(clearJourneyOnCloseB(op, false, true), false)
  assert.equal(clearJourneyOnCloseB(op, true, false), false)
})
test("legacy hosted completed-Sui close and terminal cleanup remain unchanged", () => {
  const { op } = fixture()
  op.status = "pending"; op.phase = "fulfillment"
  assert.equal(clearJourneyOnCloseB(op, false, true), true)
  assert.equal(clearJourneyOnCloseB(op, true, true), false)
  op.hostedTestRedemption = true
  for (const status of ["succeeded", "cancelled", "expired", "failed"] as const) {
    op.status = status
    assert.equal(clearJourneyOnCloseB(op, false, true), true)
  }
  assert.equal(clearJourneyOnCloseB(null, false, true), false)
})
