// Pure, fail-closed checks shared by submission, recovery and final fulfillment.
// Inputs must come from server RPC reads, never from a client's success marker.
import { HkError } from "./util"

export type ChainEvent = { type: string; sender?: string; json: unknown }
export type ChainTransaction = { digest: string; success: boolean; events: ChainEvent[]; createdObjectIds: string[] }
export type GrantEvidence = { objectId: string; type: string; initialSharedVersion: string | null; json: Record<string, unknown> }
export type GrantExpectation = {
  campaignId: string; grantType: string; grantId?: string; owner: string; agent: string; recipient: string
  intentRef: string; actionCommitment: string; consentCommitment: string; expiresAtMs: number; policyVersion: number
  events: { granted: string; consent: string; consumed: string; attested: string }
}
export type ExecutionExpectation = GrantExpectation & {
  grantId: string; decisionCommitment: string; manifestCommitment: string; recordId?: string
}

function check(ok: unknown, field: string): asserts ok {
  if (!ok) throw new HkError("sui_evidence_mismatch", `Sui evidence mismatch: ${field}`, 502)
}
export function chainId(value: unknown): string | null {
  return typeof value === "string" && /^0x[0-9a-f]{1,64}$/i.test(value) ? "0x" + value.slice(2).toLowerCase().padStart(64, "0") : null
}
export function commitment(value: unknown): string | null {
  if (Array.isArray(value)) {
    return value.length === 32 && value.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
      ? "0x" + Buffer.from(value).toString("hex") : null
  }
  if (typeof value !== "string") return null
  if (/^0x[0-9a-f]{64}$/i.test(value)) return value.toLowerCase()
  // gRPC JSON may encode vector<u8> as canonical base64.
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) return null
  const bytes = Buffer.from(value, "base64")
  return bytes.length === 32 && bytes.toString("base64") === value ? "0x" + bytes.toString("hex") : null
}
function sameId(actual: unknown, expected: string, field: string) { check(chainId(expected) && chainId(actual) === chainId(expected), field) }
function sameHash(actual: unknown, expected: string, field: string) { check(commitment(expected) && commitment(actual) === commitment(expected), field) }
function uint(value: unknown): number | null {
  if (typeof value !== "number" && !(typeof value === "string" && /^\d+$/.test(value))) return null
  const n = Number(value)
  return Number.isSafeInteger(n) && n >= 0 ? n : null
}
function oneEvent(tx: ChainTransaction, type: string, sender: string): Record<string, unknown> {
  const events = tx.events.filter((e) => e.type === type)
  check(events.length === 1, `${type}: exactly one event required`)
  sameId(events[0].sender, sender, `${type}.sender`)
  const json = events[0].json
  check(json && typeof json === "object" && !Array.isArray(json), `${type}.json`)
  return json as Record<string, unknown>
}
function transaction(tx: ChainTransaction, expectedDigest?: string) {
  check(tx.success === true && typeof tx.digest === "string" && tx.digest.length > 0, "transaction success")
  if (expectedDigest !== undefined) check(tx.digest === expectedDigest, "transaction digest")
}
function created(tx: ChainTransaction, id: string) {
  check(chainId(id) && tx.createdObjectIds.some((v) => chainId(v) === chainId(id)), "object must be created in the same transaction")
}

export function verifyGrantEvidence(grant: GrantEvidence, expected: GrantExpectation, uses: 0 | 1) {
  check(grant.type === expected.grantType, "grant type")
  check(grant.initialSharedVersion && uint(grant.initialSharedVersion), "shared grant")
  if (expected.grantId) sameId(grant.objectId, expected.grantId, "grant object id")
  const j = grant.json
  sameId(j.campaign, expected.campaignId, "grant.campaign")
  sameId(j.owner, expected.owner, "grant.owner")
  sameId(j.agent, expected.agent, "grant.agent")
  sameId(j.recipient, expected.recipient, "grant.recipient")
  sameHash(j.intent_ref, expected.intentRef, "grant.intent_ref")
  sameHash(j.action_commitment, expected.actionCommitment, "grant.action_commitment")
  check(uint(j.expires_at_ms) === expected.expiresAtMs, "grant.expiry")
  check(uint(j.policy_version) === expected.policyVersion, "grant.policy")
  check(uint(j.max_uses) === 1 && uint(j.uses) === uses && j.revoked === false, "grant usage/revocation")
}

export function verifyDelegationEvidence(tx: ChainTransaction, grant: GrantEvidence, expected: GrantExpectation, expectedDigest?: string) {
  transaction(tx, expectedDigest)
  verifyGrantEvidence(grant, expected, 0)
  const g = oneEvent(tx, expected.events.granted, expected.owner)
  const c = oneEvent(tx, expected.events.consent, expected.owner)
  sameId(g.grant, grant.objectId, "GrantCreated.grant")
  sameId(c.grant, grant.objectId, "ConsentAttested.grant")
  for (const [j, name] of [[g, "GrantCreated"], [c, "ConsentAttested"]] as const) {
    sameId(j.campaign, expected.campaignId, `${name}.campaign`)
    sameId(j.owner, expected.owner, `${name}.owner`)
  }
  sameId(g.agent, expected.agent, "GrantCreated.agent")
  sameId(g.recipient, expected.recipient, "GrantCreated.recipient")
  sameHash(g.intent_ref, expected.intentRef, "GrantCreated.intent_ref")
  sameHash(g.action_commitment, expected.actionCommitment, "GrantCreated.action_commitment")
  sameHash(c.consent_commitment, expected.consentCommitment, "ConsentAttested.consent_commitment")
  check(uint(g.expires_at_ms) === expected.expiresAtMs, "GrantCreated.expiry")
  created(tx, grant.objectId)
  return grant.objectId
}

export function verifyExecutionEvidence(tx: ChainTransaction, grant: GrantEvidence, expected: ExecutionExpectation, expectedDigest?: string) {
  transaction(tx, expectedDigest)
  verifyGrantEvidence(grant, expected, 1)
  const c = oneEvent(tx, expected.events.consumed, expected.agent)
  const a = oneEvent(tx, expected.events.attested, expected.agent)
  for (const [j, name] of [[c, "GrantConsumed"], [a, "ExecutionAttested"]] as const) {
    sameId(j.campaign, expected.campaignId, `${name}.campaign`)
    sameId(j.agent, expected.agent, `${name}.agent`)
  }
  sameId(c.grant, expected.grantId, "GrantConsumed.grant")
  sameId(c.recipient, expected.recipient, "GrantConsumed.recipient")
  sameHash(c.intent_ref, expected.intentRef, "GrantConsumed.intent_ref")
  sameHash(c.decision_commitment, expected.decisionCommitment, "GrantConsumed.decision_commitment")
  sameHash(a.manifest_commitment, expected.manifestCommitment, "ExecutionAttested.manifest_commitment")
  const recordId = chainId(c.record)
  check(recordId, "execution record id")
  sameId(a.record, recordId, "ExecutionAttested.record")
  if (expected.recordId) sameId(recordId, expected.recordId, "expected execution record")
  const executedAtMs = uint(c.executed_at_ms)
  check(executedAtMs !== null && executedAtMs < expected.expiresAtMs, "execution expiry")
  created(tx, recordId)
  return { recordId, executedAtMs }
}
