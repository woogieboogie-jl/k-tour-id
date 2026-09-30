import assert from "node:assert/strict"
import { test } from "node:test"
import { cxAge19FromClaims, currentCxAge19, CX_AGE19_POLICY } from "../../lib/hackathon/cx-age-policy"
import { HkError } from "../../lib/hackathon/util"

test("full 19 threshold changes at Korea midnight, never server-local/UTC midnight", () => {
  const birth = "20070930"
  assert.equal(cxAge19FromClaims({ birth }, Date.parse("2026-09-29T14:59:59.999Z")), false)
  assert.equal(cxAge19FromClaims({ birth }, Date.parse("2026-09-29T15:00:00Z")), true)
  assert.equal(cxAge19FromClaims({ birth: "20070929" }, Date.parse("2026-09-29T00:00:00Z")), true)
})
test("leap-day births conservatively advance March 1 in the non-leap 19th year", () => {
  assert.equal(cxAge19FromClaims({ birth: "20080229" }, Date.parse("2027-02-28T14:59:59.999Z")), false)
  assert.equal(cxAge19FromClaims({ birth: "20080229" }, Date.parse("2027-02-28T15:00:00Z")), true)
})
test("missing/invalid/calendar-overflow/future birth never becomes true", () => {
  for (const birth of [undefined, null, true, 20000101, "", "2000-01-01", "20000101 ", "19000229", "20070229", "20071301", "20070431", "00000101", "99999999", "20261001"])
    assert.equal(cxAge19FromClaims({ birth }, Date.parse("2026-09-30T00:00:00Z")), null)
  assert.equal(cxAge19FromClaims({ birth: "20000101" }, NaN), null)
  assert.equal(cxAge19FromClaims({ birth: "20000101" }, Infinity), null)
})
test("only canonical documented birth is used, conflicting aliases are rejected", () => {
  assert.equal(cxAge19FromClaims({ birthDate: "20000101" }), null)
  for (const key of ["birthDate", "birthdate", "dateOfBirth", "dob"]) {
    assert.throws(() => cxAge19FromClaims({ birth: "20000101", [key]: "20100101" }), (e: unknown) => e instanceof HkError && e.code === "cx_age_claim_conflict" && !e.message.includes("2000"))
  }
})
test("AdultVerify, CI and mode flags never establish a 19+ predicate", () => {
  for (const claims of [{ adult: true }, { adultYn: "Y", zkp: true }, { ci: "20000101" }, { age19Verified: true }]) assert.equal(cxAge19FromClaims(claims), null)
  assert.equal(currentCxAge19({ mode: "cx", age19Verified: true }), false)
  assert.equal(currentCxAge19({ mode: "mock", age19Verified: true, age19Policy: CX_AGE19_POLICY }), false)
  assert.equal(currentCxAge19({ mode: "cx", age19Verified: true, age19Policy: "old" }), false)
  assert.equal(currentCxAge19({ mode: "cx", age19Verified: true, age19Policy: CX_AGE19_POLICY }), true)
})
