import assert from "node:assert/strict"
import { test } from "node:test"
import {
  chainId, commitment, verifyDelegationEvidence, verifyExecutionEvidence,
  type ChainTransaction, type ExecutionExpectation, type GrantEvidence, type GrantExpectation,
} from "../../lib/hackathon/sui-evidence"
import { HkError } from "../../lib/hackathon/util"

// Deterministic RPC-shaped evidence only: no adapters, providers, signing or network.
const id = (digit: string) => "0x" + digit.repeat(64)
const hash = (byte: string) => "0x" + byte.repeat(32)
const digest = "fixture-transaction-digest"
const recordId = id("6")
const otherId = id("9")
const otherHash = hash("ff")
type Mode = "delegation" | "execution"
type Fixture = { tx: ChainTransaction; grant: GrantEvidence; expected: ExecutionExpectation }
const modes: Mode[] = ["delegation", "execution"]
const mismatch = (error: unknown) => error instanceof HkError && error.code === "sui_evidence_mismatch"
const json = (f: Fixture, index: number) => f.tx.events[index].json as Record<string, unknown>

function fixture(mode: Mode): Fixture {
  const expected: ExecutionExpectation = {
    campaignId: id("1"), grantType: `${id("a")}::entitlement::Grant`, grantId: id("5"),
    owner: id("2"), agent: id("3"), recipient: id("4"), intentRef: hash("11"),
    actionCommitment: hash("22"), consentCommitment: hash("33"), decisionCommitment: hash("44"),
    manifestCommitment: hash("55"), expiresAtMs: 2_000_000_000_000, policyVersion: 1, recordId,
    events: {
      granted: `${id("a")}::entitlement::GrantCreated`, consent: `${id("a")}::entitlement::ConsentAttested`,
      consumed: `${id("a")}::entitlement::GrantConsumed`, attested: `${id("a")}::entitlement::ExecutionAttested`,
    },
  }
  const grant: GrantEvidence = {
    objectId: expected.grantId, type: expected.grantType, initialSharedVersion: "7",
    json: {
      campaign: expected.campaignId, owner: expected.owner, agent: expected.agent, recipient: expected.recipient,
      intent_ref: expected.intentRef, action_commitment: expected.actionCommitment,
      expires_at_ms: String(expected.expiresAtMs), policy_version: "1", max_uses: 1,
      uses: mode === "delegation" ? 0 : 1, revoked: false,
    },
  }
  const tx: ChainTransaction = {
    digest, success: true, createdObjectIds: [mode === "delegation" ? grant.objectId : recordId],
    events: mode === "delegation" ? [
      { type: expected.events.granted, sender: expected.owner, json: {
        campaign: expected.campaignId, grant: grant.objectId, owner: expected.owner, agent: expected.agent,
        recipient: expected.recipient, intent_ref: expected.intentRef, action_commitment: expected.actionCommitment,
        expires_at_ms: String(expected.expiresAtMs),
      } },
      { type: expected.events.consent, sender: expected.owner, json: {
        campaign: expected.campaignId, grant: grant.objectId, owner: expected.owner,
        consent_commitment: expected.consentCommitment,
      } },
    ] : [
      { type: expected.events.consumed, sender: expected.agent, json: {
        campaign: expected.campaignId, grant: grant.objectId, record: recordId, agent: expected.agent,
        recipient: expected.recipient, intent_ref: expected.intentRef, decision_commitment: expected.decisionCommitment,
        executed_at_ms: String(expected.expiresAtMs - 1),
      } },
      { type: expected.events.attested, sender: expected.agent, json: {
        campaign: expected.campaignId, record: recordId, agent: expected.agent,
        manifest_commitment: expected.manifestCommitment,
      } },
    ],
  }
  return { tx, grant, expected }
}

function verify(mode: Mode, f: Fixture) {
  return mode === "delegation"
    ? verifyDelegationEvidence(f.tx, f.grant, f.expected, digest)
    : verifyExecutionEvidence(f.tx, f.grant, f.expected, digest)
}

for (const mode of modes) {
  test(`${mode}: accepts fully bound evidence without mutating it`, () => {
    const f = fixture(mode), before = structuredClone(f)
    assert.deepEqual(verify(mode, f), mode === "delegation" ? f.grant.objectId : {
      recordId, executedAtMs: f.expected.expiresAtMs - 1,
    })
    assert.deepEqual(f, before)
  })

  test(`${mode}: rejects wrong event identity, sender, multiplicity and JSON`, () => {
    const cases: Array<[string, (f: Fixture, index: number) => void]> = [
      ["foreign package/type", (f, i) => { f.tx.events[i].type = f.tx.events[i].type.replace(id("a"), otherId) }],
      ["wrong sender", (f, i) => { f.tx.events[i].sender = otherId }],
      ["missing sender", (f, i) => { delete f.tx.events[i].sender }],
      ["missing event", (f, i) => { f.tx.events.splice(i, 1) }],
      ["duplicate event", (f, i) => { f.tx.events.push(structuredClone(f.tx.events[i])) }],
      ["missing JSON", (f, i) => { f.tx.events[i].json = null }],
      ["array JSON", (f, i) => { f.tx.events[i].json = [] }],
    ]
    for (const [label, mutate] of cases) for (const i of [0, 1]) {
      const f = fixture(mode)
      mutate(f, i)
      assert.throws(() => verify(mode, f), mismatch, `${label}, event ${i}`)
    }
  })

  test(`${mode}: rejects failed/foreign transactions and missing creation effects`, () => {
    const cases: Array<[string, (f: Fixture) => void]> = [
      ["failed transaction", (f) => { f.tx.success = false }],
      ["different transaction digest", (f) => { f.tx.digest = "other-transaction-digest" }],
      ["empty transaction digest", (f) => { f.tx.digest = "" }],
      ["missing creation effects", (f) => { f.tx.createdObjectIds = [] }],
      ["unrelated created object", (f) => { f.tx.createdObjectIds = [otherId] }],
      ["malformed created object", (f) => { f.tx.createdObjectIds = ["not-an-object-id"] }],
    ]
    for (const [label, mutate] of cases) {
      const f = fixture(mode)
      mutate(f)
      assert.throws(() => verify(mode, f), mismatch, label)
    }
  })

  test(`${mode}: binds every grant object field and requires exact usage/revocation state`, () => {
    const fields: Array<[string, unknown]> = [
      ["campaign", otherId], ["owner", otherId], ["agent", otherId], ["recipient", otherId],
      ["intent_ref", otherHash], ["action_commitment", otherHash], ["expires_at_ms", 1],
      ["policy_version", 2], ["max_uses", 2], ["max_uses", null],
      ["uses", mode === "delegation" ? 1 : 0], ["uses", 2], ["uses", -1], ["uses", ""],
      ["uses", false], ["uses", 0.5], ["revoked", true], ["revoked", "false"], ["revoked", undefined],
    ]
    for (const [field, value] of fields) {
      const f = fixture(mode)
      f.grant.json[field] = value
      assert.throws(() => verify(mode, f), mismatch, `${field}=${String(value)}`)
    }
    for (const [field, value] of [
      ["objectId", otherId], ["type", "foreign::Grant"], ["initialSharedVersion", null],
      ["initialSharedVersion", "0"], ["initialSharedVersion", "-1"], ["initialSharedVersion", "not-a-version"],
    ] as const) {
      const f = fixture(mode)
      f.grant[field] = value as never
      assert.throws(() => verify(mode, f), mismatch, `${field}=${String(value)}`)
    }
  })
}

test("delegation: binds both events to the operation and the same grant", () => {
  const cases: Array<[number, string, unknown]> = [
    [0, "campaign", otherId], [0, "grant", otherId], [0, "owner", otherId], [0, "agent", otherId],
    [0, "recipient", otherId], [0, "intent_ref", otherHash], [0, "action_commitment", otherHash],
    [0, "expires_at_ms", 1], [1, "campaign", otherId], [1, "grant", otherId],
    [1, "owner", otherId], [1, "consent_commitment", otherHash],
  ]
  for (const [index, field, value] of cases) {
    const f = fixture("delegation")
    json(f, index)[field] = value
    assert.throws(() => verify("delegation", f), mismatch, `event ${index}.${field}`)
  }
  const f = fixture("delegation")
  const expected: GrantExpectation = { ...f.expected }
  delete expected.grantId
  assert.equal(verifyDelegationEvidence(f.tx, f.grant, expected, digest), f.grant.objectId)
})

test("execution: binds recipient, grant, operation hashes and both record references", () => {
  const cases: Array<[number, string, unknown]> = [
    [0, "campaign", otherId], [0, "grant", otherId], [0, "agent", otherId], [0, "recipient", otherId],
    [0, "intent_ref", otherHash], [0, "decision_commitment", otherHash], [0, "record", otherId],
    [0, "record", ""], [1, "campaign", otherId], [1, "agent", otherId],
    [1, "record", otherId], [1, "manifest_commitment", otherHash],
  ]
  for (const [index, field, value] of cases) {
    const f = fixture("execution")
    json(f, index)[field] = value
    assert.throws(() => verify("execution", f), mismatch, `event ${index}.${field}`)
  }
  const f = fixture("execution")
  json(f, 0).record = otherId
  json(f, 1).record = otherId
  f.tx.createdObjectIds = [otherId]
  assert.throws(() => verify("execution", f), mismatch, "self-consistent record still differs from persisted record ID")
})

test("same recipient is insufficient: internally consistent evidence from another operation is rejected", () => {
  for (const mode of modes) for (const field of ["intent", "action", "consent", "decision", "manifest"]) {
    if ((mode === "delegation" && ["decision", "manifest"].includes(field)) || (mode === "execution" && field === "consent")) continue
    const f = fixture(mode)
    if (field === "intent") { f.grant.json.intent_ref = otherHash; json(f, 0).intent_ref = otherHash }
    if (field === "action") {
      f.grant.json.action_commitment = otherHash
      if (mode === "delegation") json(f, 0).action_commitment = otherHash
    }
    if (field === "consent") json(f, 1).consent_commitment = otherHash
    if (field === "decision") json(f, 0).decision_commitment = otherHash
    if (field === "manifest") json(f, 1).manifest_commitment = otherHash
    assert.equal(json(f, 0).recipient, f.expected.recipient)
    assert.throws(() => verify(mode, f), mismatch, `${mode}: foreign ${field}`)
  }
})

test("commitments reject missing, malformed, noncanonical and non-byte representations", () => {
  const malformed: unknown[] = [
    undefined, null, "", "0x", "0x" + "11".repeat(31), "0x" + "11".repeat(33), "0x" + "gg".repeat(32),
    "!".repeat(43) + "=", Buffer.alloc(31).toString("base64"), Buffer.alloc(32).toString("base64").replace(/=$/, ""),
    "A".repeat(42) + "B=", [], Array(31).fill(1), Array(33).fill(1),
    [...Array(31).fill(1), -1], [...Array(31).fill(1), 256], [...Array(31).fill(1), 1.5],
    [...Array(31).fill(1), "1"], [...Array(31).fill(1), null], {},
  ]
  for (const value of malformed) {
    assert.equal(commitment(value), null, `decoder: ${JSON.stringify(value)}`)
    for (const mode of modes) {
      const targets: Array<["grant" | number, string]> = [
        ["grant", "intent_ref"], ["grant", "action_commitment"], [0, "intent_ref"],
        [0, mode === "delegation" ? "action_commitment" : "decision_commitment"],
        [1, mode === "delegation" ? "consent_commitment" : "manifest_commitment"],
      ]
      for (const [target, field] of targets) {
        const f = fixture(mode)
        ;(target === "grant" ? f.grant.json : json(f, target))[field] = value
        assert.throws(() => verify(mode, f), mismatch, `${mode}: ${target}.${field}=${JSON.stringify(value)}`)
      }
    }
  }
})

test("execution time must be a safe unsigned integer strictly before grant expiry", () => {
  for (const value of [undefined, null, "", "not-a-time", -1, 0.5, Number.MAX_SAFE_INTEGER + 1, 2_000_000_000_000, 2_000_000_000_001]) {
    const f = fixture("execution")
    json(f, 0).executed_at_ms = value
    assert.throws(() => verify("execution", f), mismatch, String(value))
  }
})

test("accepts canonical equivalent address, byte-array, base64 and integer encodings", () => {
  assert.equal(chainId("0xA"), "0x" + "a".padStart(64, "0"))
  for (const value of [undefined, null, "", "0x", "0xgg", "0x" + "1".repeat(65), 1]) assert.equal(chainId(value), null)
  const bytes = Array.from(Buffer.from("ab".repeat(32), "hex"))
  assert.equal(commitment(bytes), hash("ab"))
  assert.equal(commitment(Buffer.from(bytes).toString("base64")), hash("ab"))
  assert.equal(commitment("0x" + "AB".repeat(32)), hash("ab"))
  for (const mode of modes) {
    const f = fixture(mode)
    for (const j of [f.grant.json, json(f, 0), json(f, 1)]) {
      for (const [key, value] of Object.entries(j)) {
        if (key === "intent_ref" && typeof value === "string") j[key] = Array.from(Buffer.from(value.slice(2), "hex"))
        if (key.endsWith("_commitment") && typeof value === "string") j[key] = Buffer.from(value.slice(2), "hex").toString("base64")
      }
    }
    f.grant.json.uses = mode === "delegation" ? "0" : "1"
    f.grant.json.max_uses = "1"
    assert.doesNotThrow(() => verify(mode, f))
  }
})
