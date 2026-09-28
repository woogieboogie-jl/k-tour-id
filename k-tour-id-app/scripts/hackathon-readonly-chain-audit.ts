// READ ONLY: inspect the three public transactions supplied by Harvey.
// No key loading, signing, faucet, transaction building or broadcasting.
// This checks historical data/schema compatibility, NOT a newly completed E2E.
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { SuiGrpcClient } from "@mysten/sui/grpc"
import { commitment, verifyExecutionEvidence, type ChainTransaction } from "../lib/hackathon/sui-evidence"
import { HISTORICAL_TESTNET, readTransactionWithHistoricalFallback } from "../lib/hackathon/sui-historical-read"

let stage = "arguments"
export function parseHistoricalAuditArgs(args: string[]) {
  if (args.length !== 1 || args[0] !== "--read-only") throw new Error("read_only_required")
}
export function createHistoricalAuditTransport(fetchImpl: typeof fetch) {
let fullnodeRequests = 0
const boundedFetch: typeof fetch = async (input, init) => {
  assert.equal(typeof input, "string")
  const url = new URL(String(input))
  assert.equal(url.origin, "https://fullnode.testnet.sui.io")
  // SDK core getObject() delegates to getObjects() / BatchGetObjects.
  assert.ok(["/sui.rpc.v2.LedgerService/GetTransaction", "/sui.rpc.v2.LedgerService/BatchGetObjects"].includes(url.pathname))
  assert.ok(!url.username && !url.password && !url.search && !url.hash && init?.method === "POST")
  assert.ok(++fullnodeRequests <= 5)
  const signal = AbortSignal.any([AbortSignal.timeout(15_000), ...(init?.signal ? [init.signal] : [])])
  const response = await fetchImpl(url.href, { ...init, signal, credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer" })
  assert.ok(!response.redirected && response.body)
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      assert.ok(bytes <= HISTORICAL_TESTNET.responseBytes)
      chunks.push(chunk.value)
    }
    const headers = new Headers()
    for (const key of ["content-type", "grpc-status"]) {
      const value = response.headers.get(key)
      if (value !== null) headers.set(key, value)
    }
    return new Response(Buffer.concat(chunks), { status: response.status, headers })
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock() }
}
return { fetch: boundedFetch, requests: () => fullnodeRequests }
}
async function main() {
parseHistoricalAuditArgs(process.argv.slice(2))
const transport = createHistoricalAuditTransport(fetch)
const client = new SuiGrpcClient({ network: "testnet", baseUrl: "https://fullnode.testnet.sui.io:443", format: "binary", fetch: transport.fetch })
const digests = ["4pNNdcruJvmdWyYnSamrh7vxBRCCxWUAwG58uHBP1Wy3", "EATbwBKz3PqhQRdqkar1VGxVS31eBL9ex3UYjEdudM5W", "CisRR8SYFCxukw8WntxzkxGbrx9Xc19D2Vh96SZgfB4D"]
stage = "transaction_reads"
const transactions = await Promise.all(digests.map(async digest => {
  const tx = await readTransactionWithHistoricalFallback({ digest, network: "testnet", readFullnode: async signal => {
    const response = await client.getTransaction({ digest, include: { effects: true, events: true }, signal })
    const value = response.Transaction ?? response.FailedTransaction
    return value ? { digest: value.digest, success: value.status.success, events: (value.events ?? []).map(e => ({ type: e.eventType, sender: e.sender, json: e.json })), createdObjectIds: (value.effects?.changedObjects ?? []).filter(o => o.idOperation === "Created").map(o => o.objectId) } : null
  } })
  assert.ok(tx?.success, `Historical transaction must have succeeded: ${digest}`)
  return tx
}))
stage = "historical_event_links"
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
assert.equal(consumed.intent_ref, issued.intent_ref)
for (const event of [issued, granted, consent, consumed, attested]) assert.equal(event.campaign, "0xe3fce96c9c9e1086ff20dd7453e16ff2c52d3d3324e6e4e34446c7d0dc2ecf16")
assert.equal(granted.grant, "0x2bbedb66aa3327bae443608800d8bb905e5427ecb01f0e3b642bb26e3b960a3f")
assert.equal(consumed.record, "0xce1095866585fd01f230517890b0d8bf1d4ddc15bb9f49e12b329b9bb7a2a186")
assert.equal(attested.record, consumed.record)
stage = "current_grant_read"
const object = (await client.getObject({ objectId: String(granted.grant), include: { json: true }, signal: AbortSignal.timeout(15_000) })).object
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
stage = "execution_evidence"
const verified = verifyExecutionEvidence(transactions[2], grant, expected, digests[2])
stage = "current_record_read"
const record = (await client.getObject({ objectId: verified.recordId, include: { json: true }, signal: AbortSignal.timeout(15_000) })).object
stage = "record_ownership"
assert.equal(record.type, `${moduleId}::ExecutionRecord`)
assert.equal(record.owner.$kind === "AddressOwner" ? record.owner.AddressOwner : null, expected.recipient)
console.log(JSON.stringify({
  checkedAt: new Date().toISOString(), mode: "historical-read-only", network: "testnet", newTransactions: 0,
  evidence: transactions.map(tx => ({ digest: tx.digest, success: tx.success, readSource: tx.readSource, checkpoint: tx.checkpoint ?? null, eventTypes: tx.events.map(e => e.type.split("::").at(-1)) })),
  linkedExecutionRecord: verified.recordId, schemaAndObjectOwnershipMatch: true,
  safety: { fullnodeRequests: transport.requests(), historicalRequests: transactions.filter(tx => tx.readSource === "testnet-graphql-historical").length, signatures: 0, broadcasts: 0, retries: 0 },
  limitation: "Historical public chain consistency only. Does not prove current CX/OpenDID, original consent UI, new zkLogin, service redemption, or OmniOne completion.",
}, null, 2))
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(() => { console.error(JSON.stringify({ ok: false, mode: "historical-read-only", stage, newTransactions: 0 })); process.exitCode = 1 })
}
