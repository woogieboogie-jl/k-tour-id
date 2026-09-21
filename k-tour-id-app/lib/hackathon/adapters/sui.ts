// Sui adapter — Move package `ondo_entitlement` on Testnet (HK-06/07).
//
// Roles (all keys server-side except the user):
//   issuer  : mints an Entitlement to the user's address after VP verification (sponsored).
//   user    : signs the delegation PTB (zkLogin or demo signer). Gas is sponsored, so
//             the user never holds SUI. The server builds the PTB from an allowlist —
//             the model never produces transaction bytes.
//   agent   : consumes the Grant exactly once with a 2-command PTB (consume + attest_execution).
// Every result is verified from effects/events/objects, never from a client-side "success".
import { SuiGrpcClient } from "@mysten/sui/grpc"
import { Transaction, TransactionDataBuilder } from "@mysten/sui/transactions"
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519"
import { fromBase64, toBase64 } from "@mysten/sui/utils"
import { assertExternalServicesEnabled, hkConfig } from "../config"
import { hexToBytes, sha256Hex, HkError } from "../util"
import { chainId, commitment, verifyDelegationEvidence, verifyExecutionEvidence, type ChainTransaction, type GrantExpectation, type ExecutionExpectation } from "../sui-evidence"

export type ObjRef = { objectId: string; version: string; digest: string }

/** Hash already-built full BCS bytes locally; unlike Transaction.getDigest this
 * cannot invoke resolution plugins or an RPC client. Not the UI SHA-256 digest. */
export function transactionDigest(bytes: Uint8Array): string {
  return TransactionDataBuilder.getDigestFromBytes(bytes)
}

let clientSingleton: SuiGrpcClient | null = null
export function suiClient() {
  assertExternalServicesEnabled("Sui")
  const c = hkConfig().sui
  if (!clientSingleton) clientSingleton = new SuiGrpcClient({ network: c.network as "testnet" | "mainnet" | "devnet" | "localnet", baseUrl: c.grpcUrl })
  return clientSingleton
}

function keypair(secret: string, label: string) {
  if (!secret) throw new HkError("sui_unconfigured", `${label} key not configured`, 503)
  return Ed25519Keypair.fromSecretKey(secret)
}
export function suiKeys() {
  assertExternalServicesEnabled("Sui signing")
  const c = hkConfig().sui
  const issuer = keypair(c.issuerSecretKey, "HK_SUI_ISSUER_SECRET_KEY")
  const agent = keypair(c.agentSecretKey, "HK_SUI_AGENT_SECRET_KEY")
  const sponsor = keypair(c.sponsorSecretKey, "HK_SUI_SPONSOR_SECRET_KEY")
  return { issuer, agent, sponsor, issuerAddress: issuer.toSuiAddress(), agentAddress: agent.toSuiAddress(), sponsorAddress: sponsor.toSuiAddress() }
}
export function suiTargets() {
  assertExternalServicesEnabled("Sui")
  const c = hkConfig().sui
  if (!c.packageId || !c.campaignId) throw new HkError("sui_unconfigured", "HK_SUI_PACKAGE_ID / HK_SUI_CAMPAIGN_ID missing", 503)
  const mod = `${c.packageId}::entitlement`
  return {
    packageId: c.packageId,
    campaign: { objectId: c.campaignId, initialSharedVersion: c.campaignInitialVersion },
    fn: { issue: `${mod}::issue`, delegate: `${mod}::delegate`, attestConsent: `${mod}::attest_consent`, consume: `${mod}::consume`, attestExecution: `${mod}::attest_execution`, revoke: `${mod}::revoke` },
    types: { entitlement: `${mod}::Entitlement`, grant: `${mod}::Grant`, record: `${mod}::ExecutionRecord` },
    events: { granted: `${mod}::GrantCreated`, consumed: `${mod}::GrantConsumed`, consent: `${mod}::ConsentAttested`, attested: `${mod}::ExecutionAttested`, issued: `${mod}::EntitlementIssued` },
  }
}

function campaignArg(tx: Transaction, mutable: boolean) {
  const t = suiTargets()
  return tx.sharedObjectRef({ objectId: t.campaign.objectId, initialSharedVersion: t.campaign.initialSharedVersion, mutable })
}
const clockArg = (tx: Transaction) => tx.sharedObjectRef({ objectId: "0x6", initialSharedVersion: 1, mutable: false })
const bytes32 = (tx: Transaction, hex: string) => tx.pure.vector("u8", Array.from(hexToBytes(hex)))

async function executeSigned(bytes: Uint8Array, signatures: string[]) {
  const client = suiClient()
  const res = await client.executeTransaction({ transaction: bytes, signatures, include: { effects: true, events: true } })
  const txn = res.Transaction ?? res.FailedTransaction
  if (!txn) throw new HkError("sui_execute", "no transaction result", 502, true)
  if (txn.digest !== transactionDigest(bytes)) throw new HkError("sui_evidence_mismatch", "transaction response digest differs from submitted bytes", 502)
  if (!txn.status.success) throw new HkError("sui_execute_failed", `Sui execution failed: ${JSON.stringify(txn.status.error).slice(0, 300)}`, 502)
  // executeTransaction returns on validator certification; the fullnode we read from
  // may lag by a checkpoint. Wait until it has indexed this tx so the follow-up
  // getObject / gas-coin lookups never see stale state ("Object … not found").
  await waitForIndexed(txn.digest)
  return txn
}

async function waitForIndexed(digest: string, timeoutMs = 15_000) {
  const client = suiClient() as unknown as { waitForTransaction?: (o: { digest: string; timeout?: number }) => Promise<unknown> }
  const deadline = Date.now() + timeoutMs
  if (typeof client.waitForTransaction === "function") {
    try { await client.waitForTransaction({ digest, timeout: timeoutMs }); return } catch { /* fall through to polling */ }
  }
  while (Date.now() < deadline) {
    try { const r = await suiClient().getTransaction({ digest }); if (r.Transaction ?? r.FailedTransaction) return } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 400))
  }
}

/** getObject with a short retry: a freshly created object can trail the tx by a moment. */
async function getObjectRetry(objectId: string, include?: { json?: boolean }, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  let lastErr: unknown = null
  while (Date.now() < deadline) {
    try { return (await suiClient().getObject(include ? { objectId, include } : { objectId })).object } catch (e) { lastErr = e }
    await new Promise((r) => setTimeout(r, 400))
  }
  throw lastErr instanceof Error ? lastErr : new HkError("sui_read", `object ${objectId} not readable`, 502, true)
}

type Executed = Awaited<ReturnType<typeof executeSigned>>
function transactionEvidence(txn: Executed): ChainTransaction {
  return { digest: txn.digest, success: txn.status.success, events: (txn.events ?? []).map((e) => ({ type: e.eventType, sender: e.sender, json: e.json })), createdObjectIds: createdRefs(txn).map((o) => o.objectId) }
}
function createdRefs(txn: Executed): ObjRef[] {
  const effects = txn.effects
  if (!effects) return []
  return effects.changedObjects.filter((c) => c.idOperation === "Created").map((c) => ({ objectId: c.objectId, version: c.outputVersion ?? "0", digest: c.outputDigest ?? "" }))
}
async function objectType(objectId: string) {
  return getObjectRetry(objectId)
}

// ── issuer: mint entitlement to user (sponsored by sponsor) ───────────
export async function issueEntitlement(opts: { intentRefHex: string; holder: string; expiresAtMs: number; beforeBroadcast?: (digest: string) => Promise<void> }) {
  const t = suiTargets(); const k = suiKeys()
  const tx = new Transaction()
  tx.setSender(k.issuerAddress)
  tx.setGasOwner(k.sponsorAddress)
  tx.moveCall({ target: t.fn.issue, arguments: [campaignArg(tx, true), bytes32(tx, opts.intentRefHex), tx.pure.address(opts.holder), tx.pure.u64(BigInt(opts.expiresAtMs)), clockArg(tx)] })
  const bytes = await tx.build({ client: suiClient() })
  const sigs = [(await k.issuer.signTransaction(bytes)).signature]
  if (k.sponsorAddress !== k.issuerAddress) sigs.push((await k.sponsor.signTransaction(bytes)).signature)
  await opts.beforeBroadcast?.(transactionDigest(bytes))
  const txn = await executeSigned(bytes, sigs)
  const created = createdRefs(txn)
  let entitlement: ObjRef | null = null
  for (const ref of created) {
    const obj = await objectType(ref.objectId)
    if (obj.type === t.types.entitlement) { entitlement = { objectId: obj.objectId, version: obj.version, digest: obj.digest }; break }
  }
  if (!entitlement) throw new HkError("sui_issue_verify", "Entitlement object not found in effects", 502)
  const issuedEvent = (txn.events ?? []).find((e) => e.eventType === t.events.issued)
  if (!issuedEvent) throw new HkError("sui_issue_verify", "EntitlementIssued event missing", 502)
  return { txDigest: txn.digest, entitlement }
}

// ── user: build sponsored delegation PTB (2 commands) ─────────────────
export async function buildDelegationPtb(opts: { userAddress: string; entitlement: ObjRef; recipient: string; actionCommitmentHex: string; consentCommitmentHex: string; expiresAtMs: number }) {
  const t = suiTargets(); const k = suiKeys()
  const tx = new Transaction()
  tx.setSender(opts.userAddress)
  tx.setGasOwner(k.sponsorAddress)
  const grantId = tx.moveCall({ target: t.fn.delegate, arguments: [campaignArg(tx, true), tx.objectRef(opts.entitlement), tx.pure.address(opts.recipient), bytes32(tx, opts.actionCommitmentHex), tx.pure.u64(BigInt(opts.expiresAtMs)), clockArg(tx)] })
  tx.moveCall({ target: t.fn.attestConsent, arguments: [campaignArg(tx, false), grantId, bytes32(tx, opts.consentCommitmentHex)] })
  const bytes = await tx.build({ client: suiClient() })
  const sponsorSignature = (await k.sponsor.signTransaction(bytes)).signature
  return { txBytesB64: toBase64(bytes), txBytesDigest: sha256Hex(bytes), sponsorSignature }
}

/** Execute the delegation with the user's signature (zkLogin or Ed25519) + the sponsor's. */
export async function executeDelegation(opts: { txBytesB64: string; userSignature: string; sponsorSignature: string; expected: GrantExpectation }) {
  const t = suiTargets()
  const bytes = fromBase64(opts.txBytesB64)
  const txn = await executeSigned(bytes, [opts.userSignature, opts.sponsorSignature])
  const granted = (txn.events ?? []).find((e) => e.eventType === t.events.granted)
  if (!granted) throw new HkError("sui_delegate_verify", "GrantCreated event missing", 502)
  const json = (granted.json ?? {}) as Record<string, unknown>
  const grantId = String(json.grant ?? "")
  if (!grantId) throw new HkError("sui_delegate_verify", "grant id missing in event", 502)
  const grant = await readGrant(grantId)
  verifyDelegationEvidence(transactionEvidence(txn), grant, opts.expected)
  return { txDigest: txn.digest, grant: { objectId: grantId, initialSharedVersion: grant.initialSharedVersion! }, event: json }
}

// ── agent: consume grant + attest execution (2 commands, sponsored) ───
export async function agentConsume(opts: { grant: { objectId: string; initialSharedVersion: string }; expected: ExecutionExpectation; beforeBroadcast?: (digest: string) => Promise<void> }) {
  const t = suiTargets(); const k = suiKeys()
  const tx = new Transaction()
  tx.setSender(k.agentAddress)
  tx.setGasOwner(k.sponsorAddress)
  const grantArg = tx.sharedObjectRef({ objectId: opts.grant.objectId, initialSharedVersion: Number(opts.grant.initialSharedVersion), mutable: true })
  const recordId = tx.moveCall({ target: t.fn.consume, arguments: [campaignArg(tx, true), grantArg, bytes32(tx, opts.expected.decisionCommitment), clockArg(tx)] })
  tx.moveCall({ target: t.fn.attestExecution, arguments: [campaignArg(tx, false), recordId, bytes32(tx, opts.expected.manifestCommitment)] })
  const bytes = await tx.build({ client: suiClient() })
  const sigs = [(await k.agent.signTransaction(bytes)).signature]
  if (k.sponsorAddress !== k.agentAddress) sigs.push((await k.sponsor.signTransaction(bytes)).signature)
  await opts.beforeBroadcast?.(transactionDigest(bytes))
  const txn = await executeSigned(bytes, sigs)
  const grant = await readGrant(opts.grant.objectId)
  const verified = verifyExecutionEvidence(transactionEvidence(txn), grant, opts.expected)
  await verifyExecutionRecord(verified.recordId, opts.expected, verified.executedAtMs)
  return { txDigest: txn.digest, ...verified, grantUses: grant.uses }
}

export async function readGrant(objectId: string) {
  assertExternalServicesEnabled("Sui grant lookup")
  const object = await getObjectRetry(objectId, { json: true })
  const j = (object.json ?? {}) as Record<string, unknown>
  return { objectId: object.objectId, type: object.type, initialSharedVersion: object.owner.$kind === "Shared" ? object.owner.Shared.initialSharedVersion : null, version: object.version, uses: Number(j.uses ?? -1), revoked: j.revoked !== false, agent: String(j.agent ?? ""), owner: String(j.owner ?? ""), recipient: String(j.recipient ?? ""), expiresAtMs: Number(j.expires_at_ms ?? 0), json: j }
}

export async function readTransaction(digest: string) {
  const res = await suiClient().getTransaction({ digest, include: { effects: true, events: true } })
  const txn = res.Transaction ?? res.FailedTransaction
  return txn ? transactionEvidence(txn) : null
}

async function verifyExecutionRecord(recordId: string, expected: ExecutionExpectation, executedAtMs: number) {
  const object = await getObjectRetry(recordId, { json: true })
  const j = (object.json ?? {}) as Record<string, unknown>
  const ids = [[object.objectId, recordId], [j.campaign, expected.campaignId], [j.grant, expected.grantId], [j.agent, expected.agent]]
  const hashes = [[j.intent_ref, expected.intentRef], [j.action_commitment, expected.actionCommitment], [j.decision_commitment, expected.decisionCommitment]]
  if (object.type !== suiTargets().types.record || object.owner.$kind !== "AddressOwner" || chainId(object.owner.AddressOwner) !== chainId(expected.recipient)
    || ids.some(([a, b]) => !chainId(b) || chainId(a) !== chainId(b))
    || hashes.some(([a, b]) => !commitment(b) || commitment(a) !== commitment(b))
    || String(j.executed_at_ms) !== String(executedAtMs)) throw new HkError("sui_evidence_mismatch", "ExecutionRecord does not match this operation", 502)
}

export async function verifyReadExecution(digest: string, expected: ExecutionExpectation) {
  const tx = await readTransaction(digest)
  if (!tx) throw new HkError("sui_evidence_missing", "execution transaction is not indexed", 502, true)
  const grant = await readGrant(expected.grantId)
  const verified = verifyExecutionEvidence(tx, grant, expected, digest)
  await verifyExecutionRecord(verified.recordId, expected, verified.executedAtMs)
  return { txDigest: tx.digest, ...verified, grantUses: grant.uses }
}

export async function verifyReadDelegation(digest: string, expected: GrantExpectation) {
  const tx = await readTransaction(digest)
  if (!tx) throw new HkError("sui_evidence_missing", "delegation transaction is not indexed", 502, true)
  const event = tx.events.find((e) => e.type === expected.events.granted)?.json as Record<string, unknown> | undefined
  const grantId = chainId(event?.grant)
  if (!grantId) throw new HkError("sui_evidence_mismatch", "delegation grant missing", 502)
  const grant = await readGrant(grantId)
  verifyDelegationEvidence(tx, grant, expected, digest)
  return { txDigest: tx.digest, grant: { objectId: grantId, initialSharedVersion: grant.initialSharedVersion! } }
}

export async function currentEpoch() {
  const s = await suiClient().getCurrentSystemState()
  return Number((s as unknown as { systemState?: { epoch?: string | number } }).systemState?.epoch ?? (s as unknown as { epoch?: string }).epoch ?? 0)
}

export function explorerTx(digest: string) { return `${hkConfig().sui.explorer}/tx/${digest}` }
export function explorerObject(id: string) { return `${hkConfig().sui.explorer}/object/${id}` }
