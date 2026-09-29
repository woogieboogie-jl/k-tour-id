import assert from "node:assert/strict"
import { test } from "node:test"
import { PIN, hostedSuiPreflightIssues } from "../../lib/hackathon/hosted-sui-profile"
import { hostedOmnioneOperationAllowed, assertHostedOmnioneOutbox } from "../../lib/hackathon/hosted-omnione-policy"
import { omnioneTargetSnapshot } from "../../lib/hackathon/omnione-targets"
import type { OperationRecord } from "../../lib/hackathon/store"
import { digestOf } from "../../lib/hackathon/util"
import { env, fixture, now } from "./fixtures/hosted-omnione.fixture"

const stamp = new Date(now).toISOString()
test("explicit connected target admits app-owned test result without enabling native", () => {
  const { op, db, row } = fixture()
  assert.deepEqual(hostedSuiPreflightIssues(env(), now), [])
  assert.equal(hostedOmnioneOperationAllowed(op, env(), now), true)
  assert.doesNotThrow(() => assertHostedOmnioneOutbox(db, row, env(), now))
})
test("absent/partial opt-in, changed pool, cap or deadline never admits a write", () => {
  const { op } = fixture()
  for (const [key, value] of [["HK_HOSTED_OMNIONE_ENABLED", "0"], ["HK_HOSTED_PROVIDERS", ""], ["NEXT_PUBLIC_HK_HOSTED_PROVIDERS", ""], ["HK_STORE_KEY", "another"], ["HK_HOSTED_SUI_MAX_OPERATIONS", "11"], ["HK_HOSTED_SUI_GAS_BUDGET_MIST", "11000000"], ["HK_OMNIONE_GAS_LIMIT", "300001"]]) {
    assert.equal(hostedOmnioneOperationAllowed(op, { ...env(), [key]: value }, now), false, key)
  }
  assert.equal(hostedOmnioneOperationAllowed(op, env(), PIN.maxEnd), false)
})
test("legacy target, auth-only requests, other campaign and mock identity cannot be upgraded", () => {
  const { op } = fixture()
  for (const patch of [{ omnioneTarget: undefined }, { omnioneTarget: omnioneTargetSnapshot() }, { kind: "identity_check" }, { venueId: "another" }, { campaignId: "another" }, { policyVersion: 2 }, { identity: { ...op.identity!, mode: "mock" } }, { credential: { ...op.credential!, mode: "opendid" } }]) {
    assert.equal(hostedOmnioneOperationAllowed({ ...op, ...patch } as OperationRecord, env(), now), false)
  }
})
test("dispatch requires committed redemption and confirmed execution, not a synthetic probe", () => {
  for (const mutate of [
    ({ db }: ReturnType<typeof fixture>) => { db.redemptions = {} },
    ({ op }: ReturnType<typeof fixture>) => { op.status = "pending" },
    ({ op }: ReturnType<typeof fixture>) => { op.fulfillment!.status = "pending" },
    ({ op }: ReturnType<typeof fixture>) => { op.agent!.verified = null },
    ({ op }: ReturnType<typeof fixture>) => { op.presentation!.decisionConsumedAt = null },
    ({ row }: ReturnType<typeof fixture>) => { row.operationId = "missing" },
    ({ row }: ReturnType<typeof fixture>) => { row.target = omnioneTargetSnapshot() },
    ({ row }: ReturnType<typeof fixture>) => { row.payload.kind = "selftest" },
  ]) {
    const f = fixture(); mutate(f)
    assert.throws(() => assertHostedOmnioneOutbox(f.db, f.row, env(), now), /required|enabled/)
  }
})
test("matching payload hash cannot hide different execution or manifest evidence", () => {
  for (const field of ["suiDigestCommitment", "manifestCommitment"]) {
    const f = fixture(); f.row.payload[field] = "another-execution"; f.row.payloadCommitment = digestOf(f.row.payload); f.op.chain!.payloadCommitment = f.row.payloadCommitment
    assert.throws(() => assertHostedOmnioneOutbox(f.db, f.row, env(), now), /required/)
  }
})
test("already committed fact can be audited after credential expiry, not after hosted deadline", () => {
  const f = fixture(); f.op.identity!.expiresAt = stamp; f.op.credential!.validUntil = stamp
  assert.doesNotThrow(() => assertHostedOmnioneOutbox(f.db, f.row, env(), now + 1000))
  assert.throws(() => assertHostedOmnioneOutbox(f.db, f.row, env(), PIN.maxEnd), /enabled/)
})
