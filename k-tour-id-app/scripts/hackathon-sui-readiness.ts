// OFFLINE ONLY. This is not a Sui dev-inspect/simulation or a live readiness pass.
// No signer construction, environment inspection, RPC, session/store, or provider call.
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { Transaction } from "@mysten/sui/transactions"
import { transactionDigest } from "../lib/hackathon/adapters/sui"
import { verifyDelegationEvidence, verifyExecutionEvidence, type ChainTransaction, type ExecutionExpectation, type GrantEvidence } from "../lib/hackathon/sui-evidence"

export type SignerPlan = "demo" | "zklogin"
type PublicMetadata = {
  network: "testnet"; packageId: string; issuer: string; agent: string
  campaign: { objectId: string; initialSharedVersion: number; campaignRef: string; policyVersion: number }
}
const id = (byte: string) => `0x${byte.repeat(32)}`
const FIXTURE = { user: id("11"), entitlement: id("22"), grant: id("33"), record: id("44"), gas: id("55"), objectDigest: "11111111111111111111111111111111", expiresAtMs: 2_000_000_000_000 }
const hashes = { intent: id("66"), action: id("77"), consent: id("88"), decision: id("99"), manifest: id("aa") }
const invalid = () => new Error("sui_readiness_invalid_input")
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value))
const isId = (value: unknown): value is string => typeof value === "string" && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value)
const positiveInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0

/** Select public fields only. Never accept a path/URL or fall back to process.env. */
export function publicMetadata(value: unknown): PublicMetadata {
  if (!isRecord(value) || value.network !== "testnet" || !isId(value.packageId) || !isId(value.issuer) || !isId(value.agent) || !isRecord(value.campaign)) throw invalid()
  const c = value.campaign
  if (!isId(c.objectId) || !positiveInteger(c.initialSharedVersion) || !positiveInteger(c.policyVersion) || typeof c.campaignRef !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(c.campaignRef)) throw invalid()
  return { network: "testnet", packageId: value.packageId, issuer: value.issuer, agent: value.agent,
    campaign: { objectId: c.objectId, initialSharedVersion: c.initialSharedVersion, campaignRef: c.campaignRef, policyVersion: c.policyVersion } }
}

export function parseReadinessArgs(args: string[]): SignerPlan {
  if (args.length === 1 && args[0] === "--offline") return "demo"
  if (args.length === 2 && args[0] === "--offline" && ["--signer=demo", "--signer=zklogin"].includes(args[1])) return args[1] === "--signer=demo" ? "demo" : "zklogin"
  throw invalid()
}

/** Deliberately synthetic/expired gas references: these bytes must never be signed.
 * The command order mirrors the current adapter, without invoking its builders:
 * buildDelegationPtb signs with the sponsor, and issue/consume also broadcast. */
export async function unsignedRehearsal(input: unknown) {
  const metadata = publicMetadata(input)
  const target = `${metadata.packageId}::entitlement`
  const base = (sender: string) => {
    const tx = new Transaction()
    tx.setSender(sender); tx.setGasOwner(metadata.issuer)
    tx.setGasBudget(1_000_000); tx.setGasPrice(1_000)
    tx.setGasPayment([{ objectId: FIXTURE.gas, version: "1", digest: FIXTURE.objectDigest }])
    tx.setExpiration({ Epoch: 0 })
    return tx
  }
  const campaign = (tx: Transaction, mutable: boolean) => tx.sharedObjectRef({ objectId: metadata.campaign.objectId, initialSharedVersion: metadata.campaign.initialSharedVersion, mutable })
  const clock = (tx: Transaction) => tx.sharedObjectRef({ objectId: "0x6", initialSharedVersion: 1, mutable: false })
  const bytes32 = (tx: Transaction, hex: string) => tx.pure.vector("u8", Array.from(Buffer.from(hex.slice(2), "hex")))
  const issue = base(metadata.issuer)
  issue.moveCall({ target: `${target}::issue`, arguments: [campaign(issue, true), bytes32(issue, hashes.intent), issue.pure.address(FIXTURE.user), issue.pure.u64(FIXTURE.expiresAtMs), clock(issue)] })
  const delegation = base(FIXTURE.user)
  const grant = delegation.moveCall({ target: `${target}::delegate`, arguments: [campaign(delegation, true), delegation.objectRef({ objectId: FIXTURE.entitlement, version: "1", digest: FIXTURE.objectDigest }), delegation.pure.address(FIXTURE.user), bytes32(delegation, hashes.action), delegation.pure.u64(FIXTURE.expiresAtMs), clock(delegation)] })
  delegation.moveCall({ target: `${target}::attest_consent`, arguments: [campaign(delegation, false), grant, bytes32(delegation, hashes.consent)] })
  const execution = base(metadata.agent)
  const record = execution.moveCall({ target: `${target}::consume`, arguments: [campaign(execution, true), execution.sharedObjectRef({ objectId: FIXTURE.grant, initialSharedVersion: 1, mutable: true }), bytes32(execution, hashes.decision), clock(execution)] })
  execution.moveCall({ target: `${target}::attest_execution`, arguments: [campaign(execution, false), record, bytes32(execution, hashes.manifest)] })
  const output: Array<{ step: "issue" | "delegation" | "execution"; commands: string[]; bytes: Uint8Array }> = []
  for (const [step, tx, commands] of [["issue", issue, ["issue"]], ["delegation", delegation, ["delegate", "attest_consent"]], ["execution", execution, ["consume", "attest_execution"]]] as const) {
    if (!tx.isFullyResolved()) throw new Error("sui_rehearsal_unresolved")
    output.push({ step, commands: [...commands], bytes: await tx.build() })
  }
  return output
}

function evidenceFixture(metadata: PublicMetadata, mode: "delegation" | "execution", digest: string) {
  const module = `${metadata.packageId}::entitlement`
  const expected: ExecutionExpectation = {
    campaignId: metadata.campaign.objectId, grantType: `${module}::Grant`, grantId: FIXTURE.grant, recordId: FIXTURE.record,
    owner: FIXTURE.user, agent: metadata.agent, recipient: FIXTURE.user,
    intentRef: hashes.intent, actionCommitment: hashes.action, consentCommitment: hashes.consent,
    decisionCommitment: hashes.decision, manifestCommitment: hashes.manifest,
    expiresAtMs: FIXTURE.expiresAtMs, policyVersion: metadata.campaign.policyVersion,
    events: { granted: `${module}::GrantCreated`, consent: `${module}::ConsentAttested`, consumed: `${module}::GrantConsumed`, attested: `${module}::ExecutionAttested` },
  }
  const grant: GrantEvidence = { objectId: FIXTURE.grant, type: expected.grantType, initialSharedVersion: "1", json: {
    campaign: expected.campaignId, owner: expected.owner, agent: expected.agent, recipient: expected.recipient,
    intent_ref: expected.intentRef, action_commitment: expected.actionCommitment, expires_at_ms: String(expected.expiresAtMs),
    policy_version: expected.policyVersion, max_uses: 1, uses: mode === "delegation" ? 0 : 1, revoked: false,
  } }
  const tx: ChainTransaction = { digest, success: true, createdObjectIds: [mode === "delegation" ? FIXTURE.grant : FIXTURE.record], events: mode === "delegation" ? [
    { type: expected.events.granted, sender: expected.owner, json: { campaign: expected.campaignId, grant: FIXTURE.grant, owner: expected.owner, agent: expected.agent, recipient: expected.recipient, intent_ref: expected.intentRef, action_commitment: expected.actionCommitment, expires_at_ms: String(expected.expiresAtMs) } },
    { type: expected.events.consent, sender: expected.owner, json: { campaign: expected.campaignId, grant: FIXTURE.grant, owner: expected.owner, consent_commitment: expected.consentCommitment } },
  ] : [
    { type: expected.events.consumed, sender: expected.agent, json: { campaign: expected.campaignId, grant: FIXTURE.grant, record: FIXTURE.record, agent: expected.agent, recipient: expected.recipient, intent_ref: expected.intentRef, decision_commitment: expected.decisionCommitment, executed_at_ms: String(expected.expiresAtMs - 1) } },
    { type: expected.events.attested, sender: expected.agent, json: { campaign: expected.campaignId, record: FIXTURE.record, agent: expected.agent, manifest_commitment: expected.manifestCommitment } },
  ] }
  return { tx, grant, expected }
}

function verifySyntheticEvidence(metadata: PublicMetadata, delegationDigest: string, executionDigest: string) {
  const delegation = evidenceFixture(metadata, "delegation", delegationDigest)
  const execution = evidenceFixture(metadata, "execution", executionDigest)
  verifyDelegationEvidence(delegation.tx, delegation.grant, delegation.expected, delegationDigest)
  verifyExecutionEvidence(execution.tx, execution.grant, execution.expected, executionDigest)
  const rejected: string[] = []
  const mustReject = (name: string, work: () => unknown) => {
    try { work() } catch (error) {
      if (isRecord(error) && error.code === "sui_evidence_mismatch") { rejected.push(name); return }
      throw new Error("sui_rehearsal_unexpected_error")
    }
    throw new Error("sui_rehearsal_failed_to_reject")
  }
  mustReject("foreign_sender", () => verifyDelegationEvidence({ ...delegation.tx, events: delegation.tx.events.map(event => ({ ...event, sender: FIXTURE.record })) }, delegation.grant, delegation.expected, delegationDigest))
  mustReject("foreign_digest", () => verifyExecutionEvidence(execution.tx, execution.grant, execution.expected, "fixture-not-the-journaled-digest"))
  mustReject("changed_consent", () => verifyDelegationEvidence(delegation.tx, delegation.grant, { ...delegation.expected, consentCommitment: hashes.manifest }, delegationDigest))
  mustReject("changed_manifest", () => verifyExecutionEvidence(execution.tx, execution.grant, { ...execution.expected, manifestCommitment: hashes.intent }, executionDigest))
  mustReject("replayed_consumption", () => verifyExecutionEvidence(execution.tx, { ...execution.grant, json: { ...execution.grant.json, uses: 2 } }, execution.expected, executionDigest))
  mustReject("missing_creation_effect", () => verifyExecutionEvidence({ ...execution.tx, createdObjectIds: [] }, execution.grant, execution.expected, executionDigest))
  return { acceptedFixtures: 2, rejectedCases: rejected, actualChainEvidence: false }
}

/** No credential presence checks: unmet gates stay unverified even if env is populated. */
export async function runOfflineReadiness(input: unknown, signer: SignerPlan = "demo") {
  if (signer !== "demo" && signer !== "zklogin") throw invalid()
  const metadata = publicMetadata(input)
  const transactions = await unsignedRehearsal(metadata)
  const steps = transactions.map(({ step, commands, bytes }) => ({ step, commands, syntheticBcsDigest: transactionDigest(bytes), byteLength: bytes.length, signatures: 0 }))
  return {
    ok: true, mode: "offline-synthetic-rehearsal", liveExecutionReady: false, network: "testnet", signerPlan: signer,
    identity: "explicit-mock-only-not-verified", credential: "explicit-mock-only-not-OpenDID", walletProofVerified: false,
    metadata, steps, evidence: verifySyntheticEvidence(metadata, steps[1].syntheticBcsDigest, steps[2].syntheticBcsDigest),
    safety: { rpcCalls: 0, secretReads: 0, generatedKeys: 0, signatures: 0, broadcasts: 0, faucetCalls: 0, ledgerWrites: 0, syntheticGas: true, expirationEpoch: 0 },
    unverifiedGates: ["separate-protected-Sui-scope", "authorized-issuer-agent-sponsor", "signer-address-role-match", "sponsor-gas-budget", "explicit-test-approval", "durable-dispatch-and-reconciliation", ...(signer === "zklogin" ? ["authorized-Google-login", "registered-callback", "network-compatible-proof", "epoch-and-wallet-proof"] : [])],
    requiredEnvironmentNames: {
      public: ["HK_SUI_NETWORK", "HK_SUI_GRPC_URL", "HK_SUI_PACKAGE_ID", "HK_SUI_CAMPAIGN_ID", "HK_SUI_CAMPAIGN_INITIAL_VERSION"],
      serverSigners: ["HK_SUI_ISSUER_SECRET_KEY", "HK_SUI_AGENT_SECRET_KEY"],
      optionalSponsor: "HK_SUI_SPONSOR_SECRET_KEY (currently defaults to issuer)",
      zkLogin: signer === "zklogin" ? ["NEXT_PUBLIC_GOOGLE_CLIENT_ID", "HK_ZKLOGIN_SALT_SEED", "ENOKI_API_KEY or approved HK_ZKLOGIN_PROVER_URL"] : [],
    },
    limitations: ["Not an RPC simulation, dry execution, signature, gas estimate, or live transaction proof.", "Synthetic BCS uses fake gas/object references and epoch zero; never sign or submit it.", "Demo Ed25519 and real Google zkLogin are separate verification targets.", "Do not disable CX-only/isolation flags on the existing Preview to run this plan.", "Existing historical digests are not re-queried. No CX, OpenDID, OAuth, Gemini, or OmniOne calls."],
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const originalFetch = globalThis.fetch
  let attempts = 0
  globalThis.fetch = async () => { attempts += 1; throw new Error("sui_rehearsal_network_forbidden") }
  try {
    const signer = parseReadinessArgs(process.argv.slice(2))
    const input: unknown = JSON.parse(await readFile(new URL("../../move/ondo_entitlement/deploy-info.testnet.json", import.meta.url), "utf8"))
    const result = await runOfflineReadiness(input, signer)
    if (attempts !== 0) throw new Error("sui_rehearsal_network_attempt")
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch {
    process.stdout.write(`${JSON.stringify({ ok: false, mode: "offline-synthetic-rehearsal", liveExecutionReady: false, error: "offline_rehearsal_failed", networkAttempts: attempts })}\n`)
    process.exitCode = 1
  } finally { globalThis.fetch = originalFetch }
}
