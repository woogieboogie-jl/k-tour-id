import assert from "node:assert/strict"
import test from "node:test"
import { classifyIdentityResult } from "../../scripts/hackathon-cx-browser-smoke.mjs"

const operationId = "op_fixture12345"
const pending = { operationId, phase: "identity", status: "pending", identity: { mode: "cx", personVerified: false, handoff: { kind: "qr" } }, error: null }

test("CX browser smoke classifier accepts only explicit pending or not-verified outcomes", () => {
  assert.equal(classifyIdentityResult(pending, operationId), "pending")
  for (const code of ["identity_failed", "identity_cancelled", "identity_expired"]) {
    assert.equal(classifyIdentityResult({ operationId, phase: "identity", status: "pending", identity: null, error: { code, retryable: true } }, operationId), "rejected")
  }
  for (const body of [
    { ...pending, operationId: "op_other" },
    { ...pending, phase: "issuance" },
    { ...pending, status: "succeeded" },
    { ...pending, identity: { ...pending.identity, personVerified: true } },
    { ...pending, identity: { ...pending.identity, mode: "mock" } },
    { ...pending, error: { code: "unknown", retryable: true } },
    { operationId, phase: "identity", status: "pending", identity: null, error: { code: "unknown", retryable: true } },
    { operationId, phase: "identity", status: "pending", identity: null, error: { code: "identity_failed" } },
    { operationId, phase: "identity", status: "pending", identity: null, error: { code: "identity_failed", retryable: false } },
    null, [], {},
  ]) assert.throws(() => classifyIdentityResult(body, operationId), /cx browser result invalid/)
})
