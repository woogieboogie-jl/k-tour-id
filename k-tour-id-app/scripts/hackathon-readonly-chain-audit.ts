// READ ONLY: inspect the three public transactions supplied by Harvey.
// No key loading, signing, faucet, transaction building or broadcasting.
// This checks historical data/schema compatibility, NOT a newly completed E2E.
import assert from "node:assert/strict"
import { SuiGrpcClient } from "@mysten/sui/grpc"
import { commitment, verifyExecutionEvidence, type ChainTransaction } from "../lib/hackathon/sui-evidence"

if (!process.argv.includes("--read-only")) throw new Error("Pass --read-only to query historical Sui Testnet evidence")
const client = new SuiGrpcClient({ network: "testnet", baseUrl: "https://fullnode.testnet.sui.io:443" })
const digests = ["4pNNdcruJvmdWyYnSamrh7vxBRCCxWUAwG58uHBP1Wy3", "EATbwBKz3PqhQRdqkar1VGxVS31eBL9ex3UYjEdudM5W", "CisRR8SYFCxukw8WntxzkxGbrx9Xc19D2Vh96SZgfB4D"]
const transactions = await Promise.all(digests.map(async digest => {
  const response = await client.getTransaction({ digest, include: { effects: true, events: true } })
  const tx = response.Transaction ?? response.FailedTransaction
  assert.ok(tx?.status.success, `Historical transaction must have succeeded: ${digest}`)
  return { digest: tx.digest, success: tx.status.success, events: (tx.events ?? []).map(e => ({ type: e.eventType, sender: e.sender, json: e.json })), createdObjectIds: (tx.effects?.changedObjects ?? []).filter(o => o.idOperation === "Created").map(o => o.objectId) } satisfies ChainTransaction
}))
const moduleId = "0xc5d26326ffd5267bb5b54625c1e2b9c03f7cca4753232d0b042c62ee74fd975d::entitlement"
const event = (tx: ChainTransaction, name: string) => {
  const events = tx.events.filter(e => e.type === `${moduleId}::${name}`)
  assert.equal(events.length, 1)
  return events[0].json as Record<string, unknown>
}
const issued = event(transactions[0], "EntitlementIssued")
const granted = event(transactions[1], "GrantCreated"), consent = event(transactions[1], "ConsentAttested")
const consumed = event(transactions[2], "GrantConsumed"), attested = event(transactions[2], "ExecutionAttested")
assert.equal(issued.holder, granted.owner)
assert.equal(issued.intent_ref, granted.intent_ref)
assert.equal(granted.grant, consumed.grant)
assert.equal(granted.grant, consent.grant)
const object = (await client.getObject({ objectId: String(granted.grant), include: { json: true } })).object
assert.equal(object.owner.$kind, "Shared")
const grant = { objectId: object.objectId, type: object.type, initialSharedVersion: object.owner.$kind === "Shared" ? object.owner.Shared.initialSharedVersion : null, json: object.json as Record<string, unknown> }
const expected = {
  campaignId: String(granted.campaign), grantType: `${moduleId}::Grant`, grantId: String(granted.grant),
  owner: String(granted.owner), agent: String(granted.agent), recipient: String(granted.recipient),
  intentRef: commitment(granted.intent_ref)!, actionCommitment: commitment(granted.action_commitment)!, consentCommitment: commitment(consent.consent_commitment)!,
  expiresAtMs: Number(granted.expires_at_ms), policyVersion: 1,
  decisionCommitment: commitment(consumed.decision_commitment)!, manifestCommitment: commitment(attested.manifest_commitment)!,
  events: { granted: `${moduleId}::GrantCreated`, consent: `${moduleId}::ConsentAttested`, consumed: `${moduleId}::GrantConsumed`, attested: `${moduleId}::ExecutionAttested` },
}
const verified = verifyExecutionEvidence(transactions[2], grant, expected, digests[2])
const record = (await client.getObject({ objectId: verified.recordId, include: { json: true } })).object
assert.equal(record.type, `${moduleId}::ExecutionRecord`)
assert.equal(record.owner.$kind === "AddressOwner" ? record.owner.AddressOwner : null, expected.recipient)
console.log(JSON.stringify({
  checkedAt: new Date().toISOString(), mode: "historical-read-only", network: "testnet", newTransactions: 0,
  evidence: transactions.map(tx => ({ digest: tx.digest, success: tx.success, eventTypes: tx.events.map(e => e.type.split("::").at(-1)) })),
  linkedExecutionRecord: verified.recordId, schemaAndObjectOwnershipMatch: true,
  limitation: "Historical public chain consistency only. Does not prove current CX/OpenDID, original consent UI, new zkLogin, service redemption, or OmniOne completion.",
}, null, 2))
