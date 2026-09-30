import test from "node:test"
import assert from "node:assert/strict"
import { JIT_IDENTITY_CONSENT, JIT_IDENTITY_VERSION, type JitIdentityEligibility } from "../../lib/hackathon/jit-identity-contract"
import { age19ReadinessB, age19ReadinessCopyB } from "../../features/ondo/identity-b/age19-readiness-b"
import { parseJitEligibility } from "../../features/ondo/identity-b/jit-identity-client-b"

const now = Date.parse("2026-09-30T00:00:00.000Z")
const future = new Date(now + 60_000).toISOString()
function dto(): JitIdentityEligibility {
  return { version: JIT_IDENTITY_VERSION, provider: "omnione_cx", execution: "provider", person: { state: "verified", expiresAt: future }, adult: { state: "verified", expiresAt: future }, age19: { state: "proof_required", expiresAt: null }, paymentKyc: { state: "unsupported" }, canStart: true, consentVersion: JIT_IDENTITY_CONSENT }
}

test("age readiness separates loading, read failure and unavailable provider from required evidence", () => {
  assert.equal(age19ReadinessB(null, "loading", now), "loading")
  assert.equal(age19ReadinessB(null, "unavailable", now), "unavailable")
  assert.equal(age19ReadinessB(dto(), "unavailable", now), "unavailable")
  assert.equal(age19ReadinessB({ ...dto(), execution: "unavailable" }, "ready", now), "unavailable")
  assert.equal(age19ReadinessB(dto(), "ready", now), "proof_required")
})

test("person and adult never become 19+; not-verified is not misrepresented as underage", () => {
  const source = dto(), before = JSON.stringify(source)
  assert.equal(age19ReadinessB(source, "ready", now), "proof_required")
  source.age19.state = "not_verified"
  assert.equal(age19ReadinessB(source, "ready", now), "not_verified")
  source.age19.state = "proof_required"
  assert.equal(JSON.stringify(source), before)
  assert.equal(age19ReadinessB({ ...source, age19: { state: "unavailable", expiresAt: null } }, "ready", now), "unavailable")
})

test("only current explicit age19 is verified, exact expiry closes display, invalid dates fail closed", () => {
  const source = { ...dto(), age19: { state: "verified" as const, expiresAt: future } }
  assert.equal(age19ReadinessB(source, "ready", now), "verified")
  assert.equal(age19ReadinessB(source, "ready", now + 60_000), "expired")
  assert.equal(age19ReadinessB(source, "ready", now + 60_001), "expired")
  for (const expiresAt of [null, "invalid"]) assert.equal(age19ReadinessB({ ...source, age19: { state: "verified", expiresAt } }, "ready", now), "unavailable")
  assert.equal(age19ReadinessB(source, "ready", Number.NaN), "unavailable")
})

test("legacy unsupported DTO remains unavailable through the existing strict parser", () => {
  const source = { ...dto(), person: { state: "proof_required", expiresAt: null }, adult: { state: "proof_required", expiresAt: null }, age19: { state: "unsupported" } }
  assert.equal(age19ReadinessB(parseJitEligibility(source), "ready", now), "unavailable")
})

test("all localized display states retain separate After19 purpose consent and no authority assertion", () => {
  for (const locale of ["ko", "en", "ja"] as const) for (const state of ["loading", "unavailable", "proof_required", "not_verified", "verified", "expired"] as const) {
    const copy = age19ReadinessCopyB(locale, state)
    assert.ok(copy.label.length > 0)
    assert.match(copy.guidance, /After19/)
    assert.match(copy.guidance, /별도로 동의|separate purpose consent|別途同意/)
  }
})
