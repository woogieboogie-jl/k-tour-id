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
import { Transaction } from "@mysten/sui/transactions"
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519"
import { fromBase64, toBase64 } from "@mysten/sui/utils"
import { hkConfig } from "../config"
import { hexToBytes, sha256Hex, HkError } from "../util"

export type ObjRef = { objectId: string; version: string; digest: string }

let clientSingleton: SuiGrpcClient | null = null
export function suiClient() {
  const c = hkConfig().sui
  if (!clientSingleton) clientSingleton = new SuiGrpcClient({ network: c.network as "testnet" | "mainnet" | "devnet" | "localnet", baseUrl: c.grpcUrl })
  return clientSingleton
}

function keypair(secret: string, label: string) {
  if (!secret) throw new HkError("sui_unconfigured", `${label} key not configured`, 503)
  return Ed25519Keypair.fromSecretKey(secret)
}
export function suiKeys() {
  const c = hkConfig().sui
  const issuer = keypair(c.issuerSecretKey, "HK_SUI_ISSUER_SECRET_KEY")
  const agent = keypair(c.agentSecretKey, "HK_SUI_AGENT_SECRET_KEY")
  const sponsor = keypair(c.sponsorSecretKey, "HK_SUI_SPONSOR_SECRET_KEY")
  return { issuer, agent, sponsor, issuerAddress: issuer.toSuiAddress(), agentAddress: agent.toSuiAddress(), sponsorAddress: sponsor.toSuiAddress() }
}
export function suiTargets() {
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
function createdRefs(txn: Executed): ObjRef[] {
  const effects = txn.effects
  if (!effects) return []
  return effects.changedObjects.filter((c) => c.idOperation === "Created").map((c) => ({ objectId: c.objectId, version: c.outputVersion ?? "0", digest: c.outputDigest ?? "" }))
}
async function objectType(objectId: string) {
  return getObjectRetry(objectId)
}

// ── issuer: mint entitlement to user (sponsored by sponsor) ───────────
export async function issueEntitlement(opts: { intentRefHex: string; holder: string; expiresAtMs: number }) {
  const t = suiTargets(); const k = suiKeys()
  const tx = new Transaction()
  tx.setSender(k.issuerAddress)
  tx.setGasOwner(k.sponsorAddress)
  tx.moveCall({ target: t.fn.issue, arguments: [campaignArg(tx, true), bytes32(tx, opts.intentRefHex), tx.pure.address(opts.holder), tx.pure.u64(BigInt(opts.expiresAtMs)), clockArg(tx)] })
  const bytes = await tx.build({ client: suiClient() })
  const sigs = [(await k.issuer.signTransaction(bytes)).signature]
  if (k.sponsorAddress !== k.issuerAddress) sigs.push((await k.sponsor.signTransaction(bytes)).signature)
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
export async function executeDelegation(opts: { txBytesB64: string; userSignature: string; sponsorSignature: string; expectedGrantOwner: string }) {
  const t = suiTargets()
  const bytes = fromBase64(opts.txBytesB64)
  const txn = await executeSigned(bytes, [opts.userSignature, opts.sponsorSignature])
  const granted = (txn.events ?? []).find((e) => e.eventType === t.events.granted)
  const consent = (txn.events ?? []).find((e) => e.eventType === t.events.consent)
  if (!granted || !consent) throw new HkError("sui_delegate_verify", "GrantCreated/ConsentAttested events missing", 502)
  const json = (granted.json ?? {}) as Record<string, unknown>
  const grantId = String(json.grant ?? "")
  if (!grantId) throw new HkError("sui_delegate_verify", "grant id missing in event", 502)
  const grant = await objectType(grantId)
  if (grant.type !== t.types.grant) throw new HkError("sui_delegate_verify", "grant object type mismatch", 502)
  const owner = grant.owner
  const initialSharedVersion = owner.$kind === "Shared" ? owner.Shared.initialSharedVersion : null
  if (!initialSharedVersion) throw new HkError("sui_delegate_verify", "grant is not shared", 502)
  if (String(json.owner ?? "").toLowerCase() !== opts.expectedGrantOwner.toLowerCase()) throw new HkError("sui_delegate_verify", "grant owner mismatch", 502)
  return { txDigest: txn.digest, grant: { objectId: grantId, initialSharedVersion }, event: json }
}

// ── agent: consume grant + attest execution (2 commands, sponsored) ───
export async function agentConsume(opts: { grant: { objectId: string; initialSharedVersion: string }; decisionCommitmentHex: string; manifestCommitmentHex: string; expectedRecipient: string; expectedIntentRefHex: string }) {
  const t = suiTargets(); const k = suiKeys()
  const tx = new Transaction()
  tx.setSender(k.agentAddress)
  tx.setGasOwner(k.sponsorAddress)
  const grantArg = tx.sharedObjectRef({ objectId: opts.grant.objectId, initialSharedVersion: Number(opts.grant.initialSharedVersion), mutable: true })
  const recordId = tx.moveCall({ target: t.fn.consume, arguments: [campaignArg(tx, true), grantArg, bytes32(tx, opts.decisionCommitmentHex), clockArg(tx)] })
  tx.moveCall({ target: t.fn.attestExecution, arguments: [campaignArg(tx, false), recordId, bytes32(tx, opts.manifestCommitmentHex)] })
  const bytes = await tx.build({ client: suiClient() })
  const sigs = [(await k.agent.signTransaction(bytes)).signature]
  if (k.sponsorAddress !== k.agentAddress) sigs.push((await k.sponsor.signTransaction(bytes)).signature)
  const txn = await executeSigned(bytes, sigs)
  const consumed = (txn.events ?? []).find((e) => e.eventType === t.events.consumed)
  const attested = (txn.events ?? []).find((e) => e.eventType === t.events.attested)
  if (!consumed || !attested) throw new HkError("sui_consume_verify", "GrantConsumed/ExecutionAttested events missing", 502)
  const json = (consumed.json ?? {}) as Record<string, unknown>
  const recipient = String(json.recipient ?? "").toLowerCase()
  if (recipient !== opts.expectedRecipient.toLowerCase()) throw new HkError("sui_consume_verify", "recipient mismatch", 502)
  const intentRef = vecToHex(json.intent_ref)
  if (intentRef && intentRef !== opts.expectedIntentRefHex.toLowerCase()) throw new HkError("sui_consume_verify", "intent_ref mismatch", 502)
  const record = String(json.record ?? "")
  return { txDigest: txn.digest, recordId: record, event: json }
}

export async function readGrant(objectId: string) {
  const object = await getObjectRetry(objectId, { json: true })
  const j = (object.json ?? {}) as Record<string, unknown>
  return { type: object.type, version: object.version, uses: Number(j.uses ?? -1), revoked: Boolean(j.revoked), agent: String(j.agent ?? ""), owner: String(j.owner ?? ""), recipient: String(j.recipient ?? ""), expiresAtMs: Number(j.expires_at_ms ?? 0), json: j }
}

export async function readTransaction(digest: string) {
  const res = await suiClient().getTransaction({ digest, include: { effects: true, events: true } })
  const txn = res.Transaction ?? res.FailedTransaction
  return txn ? { digest: txn.digest, success: txn.status.success, events: (txn.events ?? []).map((e) => ({ type: e.eventType, json: e.json })) } : null
}

export async function currentEpoch() {
  const s = await suiClient().getCurrentSystemState()
  return Number((s as unknown as { systemState?: { epoch?: string | number } }).systemState?.epoch ?? (s as unknown as { epoch?: string }).epoch ?? 0)
}

function vecToHex(v: unknown): string | null {
  if (Array.isArray(v)) return "0x" + v.map((n) => Number(n).toString(16).padStart(2, "0")).join("")
  if (typeof v === "string") return v.startsWith("0x") ? v.toLowerCase() : "0x" + Buffer.from(v, "base64").toString("hex")
  return null
}

export function explorerTx(digest: string) { return `${hkConfig().sui.explorer}/tx/${digest}` }
export function explorerObject(id: string) { return `${hkConfig().sui.explorer}/object/${id}` }
