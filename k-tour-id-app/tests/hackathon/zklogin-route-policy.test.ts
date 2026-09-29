import assert from "node:assert/strict"
import test from "node:test"
import { assertZkLoginRequestBody, zkLoginRouteAllowed } from "../../lib/hackathon/zklogin-route-policy"
import { integrationPreviewRouteAllowed, assertIntegrationPreviewBody } from "../../lib/hackathon/integration-preview-access"
import { guideProductionRouteAllowed, assertGuideProductionBody } from "../../lib/hackathon/guide-production-access"

const operationId = "op_abcdefgh12345678", attemptId = "zkl_" + "a".repeat(24)
const start = { operationId, attemptId, extendedEphemeralPublicKey: "fixture-public-key", maxEpoch: 42, jwtRandomness: "12345678" }
test("all protected profile route owners share exact operation-bound Google attempt shapes", () => {
  for (const routes of [zkLoginRouteAllowed, integrationPreviewRouteAllowed, guideProductionRouteAllowed]) {
    for (const [method, path] of [["GET", ["zklogin", "params"]], ["GET", ["zklogin", "status", operationId, attemptId]], ["POST", ["zklogin", "start"]], ["POST", ["zklogin", "prove"]], ["POST", ["zklogin", "cancel"]]] as const) assert.equal(routes(method, [...path]), true)
    for (const [method, path] of [["GET", ["zklogin", "status", operationId]], ["GET", ["zklogin", "status", operationId, "bad"]], ["POST", ["zklogin", "start", "extra"]], ["POST", ["zklogin", "params"]], ["GET", ["zklogin", "prove"]], ["DELETE", ["zklogin", "cancel"]]] as const) assert.equal(routes(method, [...path]), false)
  }
  for (const body of [assertZkLoginRequestBody, assertIntegrationPreviewBody, assertGuideProductionBody]) {
    body(["zklogin", "start"], start)
    body(["zklogin", "prove"], { operationId, attemptId, jwt: "a.b.c" })
    body(["zklogin", "cancel"], { operationId, attemptId })
    for (const patch of [{ attemptId: "other" }, { operationId: "op_short" }, { maxEpoch: 0.5 }, { maxEpoch: -1 }, { jwtRandomness: "-1" }, { jwtRandomness: "1".repeat(79) }, { extendedEphemeralPublicKey: "a b" }, { extra: true }]) assert.throws(() => body(["zklogin", "start"], { ...start, ...patch }))
    assert.throws(() => body(["zklogin", "prove"], { jwt: "a.b.c", extendedEphemeralPublicKey: "old", maxEpoch: 1, jwtRandomness: "123" }))
    assert.throws(() => body(["zklogin", "cancel"], { operationId, attemptId, confirmed: true }))
  }
})
test("Google body parser rejects getters/prototype/symbol input before access", () => {
  let reads = 0
  const getter = { ...start, get jwtRandomness() { reads++; return "123" } }
  for (const value of [getter, { ...start, [Symbol("field")]: 1 }, Object.assign(Object.create({ inherited: true }), start), null, []]) assert.throws(() => assertZkLoginRequestBody(["zklogin", "start"], value))
  assert.equal(reads, 0)
})
