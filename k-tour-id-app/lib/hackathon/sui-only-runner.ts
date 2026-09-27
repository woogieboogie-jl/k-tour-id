// Operator-only Sui Testnet lane. Never imported by an HTTP route or consumer UI.
// Identity/VC are fixtures, not provider verification. Sui consume is NOT fulfilment.
import { createHash, timingSafeEqual } from "node:crypto"
import { constants, open, realpath, stat, rename, unlink } from "node:fs/promises"
import { isAbsolute, join, resolve } from "node:path"
import { chainId, commitment, verifyGrantEvidence, type GrantExpectation, type ExecutionExpectation } from "./sui-evidence"
import { digestOf } from "./util"
import type { ObjRef } from "./adapters/sui"

export const SUI_ONLY_PIN = Object.freeze({
  network: "testnet", rpc: "https://fullnode.testnet.sui.io:443",
  chain: "69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD",
  package: "0xc5d26326ffd5267bb5b54625c1e2b9c03f7cca4753232d0b042c62ee74fd975d",
  campaign: "0xe3fce96c9c9e1086ff20dd7453e16ff2c52d3d3324e6e4e34446c7d0dc2ecf16", version: 349181955,
  issuer: "0x8d88f750b8bb8f0e63e6617821e3d2a03fda22b9a7841215689da66c79664c45",
  agent: "0xad9340861c08c87c388108f13bde6fd6e27d2604c39d0f6d201e00d6ee161a05",
  policy: 1, hardExpiry: Date.parse("2026-09-30T14:59:59Z"), maxGasMIST: 20_000_000,
})
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const DIGEST = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/
const STAGES = ["issue", "delegation", "execution"] as const
type Stage = typeof STAGES[number]
type Env = Record<string, string | undefined>
type Grant = { objectId: string; initialSharedVersion: string }
type Scope = { operationId: string; holder: string; expiresAtMs: number; gasBudgetMIST: number; intentRef: string; actionCommitment: string; consentCommitment: string; decisionCommitment: string; manifestCommitment: string }
type Step = { state: "new" | "preparing" | "submitted" | "unknown" | "confirmed"; digest: string | null }
export type SuiOnlyJournal = { schema: "sui-only/v1"; scope: Scope; revision: number; steps: Record<Stage, Step>; entitlement?: ObjRef; grant?: Grant; recordId?: string }
export type SuiOnlyProof = { digest: string; entitlement?: ObjRef; grant?: Grant; recordId?: string }
export type SuiOnlyOptions = {
  mode: "preflight" | "inspect" | "execute" | "resume" | "reconcile";
  operationId?: string; operatorExpiresAt?: string; gasBudgetMIST?: number;
  acknowledgeFixture?: boolean; accessToken?: string; signal?: AbortSignal;
}
export interface SuiOnlyRepository {
  exclusive<T>(operationId: string, work: (read: () => Promise<SuiOnlyJournal | null>, save: (journal: SuiOnlyJournal) => Promise<void>) => Promise<T>): Promise<T>
}
export interface SuiOnlyServices {
  inspect(options?: { includeGas: boolean }): Promise<{ chain: string; campaign: string; type: string; version: string; issuer: string; agent: string; active: boolean; policy: number; sponsorCoinBalance: string }>;
  roles(): Promise<{ issuer: string; agent: string; sponsor: string; holder: string }>;
  submit(stage: Stage, journal: SuiOnlyJournal, beforeBroadcast: (digest: string) => Promise<void>): Promise<SuiOnlyProof>;
  recover(stage: Stage, digest: string, journal: SuiOnlyJournal): Promise<SuiOnlyProof>;
}
function fail(code: string): never { throw new Error(`sui_only_${code}`) }
function requireThat(value: unknown, code: string): asserts value { if (!value) fail(code) }
function publicConfig(env: Env) {
  return env.HK_SUI_NETWORK === "testnet" && env.HK_SUI_GRPC_URL === SUI_ONLY_PIN.rpc && env.HK_SUI_PACKAGE_ID === SUI_ONLY_PIN.package && env.HK_SUI_CAMPAIGN_ID === SUI_ONLY_PIN.campaign && env.HK_SUI_CAMPAIGN_INITIAL_VERSION === String(SUI_ONLY_PIN.version)
}
function gate(env: Env, options: SuiOnlyOptions, now: number) {
  requireThat(!env.VERCEL && env.NODE_ENV !== "production", "local_operator_only")
  requireThat(env.NEXT_PUBLIC_HK_CX_PREVIEW !== "1" && env.NEXT_PUBLIC_HK_PREVIEW_READ_ONLY !== "1" && env.HK_ISOLATED_MOCK === "0", "profile")
  requireThat(publicConfig(env), "target")
  requireThat(options.acknowledgeFixture === true, "fixture_acknowledgment")
  const expiry = Date.parse(options.operatorExpiresAt ?? "")
  requireThat(Number.isFinite(expiry) && expiry > now && expiry <= now + 30 * 60_000 && expiry <= SUI_ONLY_PIN.hardExpiry, "operator_expiry")
  const expected = env.HK_SUI_ONLY_OPERATOR_TOKEN ?? "", given = options.accessToken ?? ""
  requireThat(expected.length >= 32 && expected.length <= 256 && given.length >= 32 && given.length <= 256 && timingSafeEqual(createHash("sha256").update(expected).digest(), createHash("sha256").update(given).digest()), "access")
  requireThat(!options.signal?.aborted, "cancelled")
  return expiry
}
function gas(options: SuiOnlyOptions) {
  const value = options.gasBudgetMIST ?? 10_000_000
  requireThat(Number.isSafeInteger(value) && value >= 1_000_000 && value <= SUI_ONLY_PIN.maxGasMIST, "gas_cap")
  return value
}
function scope(operationId: string, holder: string, expiresAtMs: number, gasBudgetMIST: number): Scope {
  const base = { lane: "sui-only-fixture/v1", operationId, network: SUI_ONLY_PIN.network, campaign: SUI_ONLY_PIN.campaign, holder, expiresAtMs, gasBudgetMIST, identity: "fixture", credential: "fixture", signer: "demo-ed25519", maxUses: 1, fulfillment: false }
  return { operationId, holder, expiresAtMs, gasBudgetMIST, intentRef: digestOf({ ...base, kind: "intent" }), actionCommitment: digestOf({ ...base, kind: "action" }), consentCommitment: digestOf({ ...base, kind: "consent" }), decisionCommitment: digestOf({ ...base, kind: "decision" }), manifestCommitment: digestOf({ ...base, kind: "manifest" }) }
}
export function suiOnlyExpectation(journal: SuiOnlyJournal): GrantExpectation {
  const s = journal.scope, mod = `${SUI_ONLY_PIN.package}::entitlement`
  return { campaignId: SUI_ONLY_PIN.campaign, grantType: `${mod}::Grant`, owner: s.holder, recipient: s.holder, agent: SUI_ONLY_PIN.agent, intentRef: s.intentRef, actionCommitment: s.actionCommitment, consentCommitment: s.consentCommitment, expiresAtMs: s.expiresAtMs, policyVersion: SUI_ONLY_PIN.policy, events: { granted: `${mod}::GrantCreated`, consent: `${mod}::ConsentAttested`, consumed: `${mod}::GrantConsumed`, attested: `${mod}::ExecutionAttested` } }
}
function validateJournal(journal: SuiOnlyJournal, operationId: string, holder: string, budget: number) {
  requireThat(journal?.schema === "sui-only/v1" && journal.scope?.operationId === operationId && journal.scope.holder === holder && journal.scope.gasBudgetMIST === budget, "journal_binding")
  requireThat(JSON.stringify(journal.scope) === JSON.stringify(scope(operationId, holder, journal.scope.expiresAtMs, budget)) && Number.isSafeInteger(journal.scope.expiresAtMs) && journal.scope.expiresAtMs <= SUI_ONLY_PIN.hardExpiry, "journal_scope")
  requireThat(Number.isSafeInteger(journal.revision) && journal.revision >= 0 && journal.steps, "journal_shape")
  let pending = false
  for (const stage of STAGES) {
    const step = journal.steps[stage]
    requireThat(step && ["new", "preparing", "submitted", "unknown", "confirmed"].includes(step.state) && (step.digest === null || DIGEST.test(step.digest)), "journal_step")
    requireThat(!["submitted", "confirmed"].includes(step.state) || Boolean(step.digest), "journal_digest")
    requireThat(!pending || step.state === "new", "journal_order")
    if (step.state !== "confirmed") pending = true
  }
  if (journal.steps.issue.state === "confirmed") requireThat(chainId(journal.entitlement?.objectId) && /^\d+$/.test(journal.entitlement?.version ?? "") && DIGEST.test(journal.entitlement?.digest ?? ""), "entitlement")
  if (journal.steps.delegation.state === "confirmed") requireThat(chainId(journal.grant?.objectId) && /^[1-9]\d*$/.test(journal.grant?.initialSharedVersion ?? ""), "grant")
  if (journal.steps.execution.state === "confirmed") requireThat(chainId(journal.recordId), "record")
}
function applyProof(j: SuiOnlyJournal, stage: Stage, proof: SuiOnlyProof) {
  requireThat(proof.digest === j.steps[stage].digest && DIGEST.test(proof.digest), "proof_digest")
  if (stage === "issue") {
    requireThat(chainId(proof.entitlement?.objectId) && /^[1-9]\d*$/.test(proof.entitlement?.version ?? "") && DIGEST.test(proof.entitlement?.digest ?? ""), "proof_entitlement")
    j.entitlement = proof.entitlement
  } else if (stage === "delegation") {
    requireThat(chainId(proof.grant?.objectId) && /^[1-9]\d*$/.test(proof.grant?.initialSharedVersion ?? ""), "proof_grant")
    j.grant = proof.grant
  } else { requireThat(chainId(proof.recordId), "proof_record"); j.recordId = proof.recordId }
  j.steps[stage].state = "confirmed"
}
function summary(j: SuiOnlyJournal) {
  return { mode: "sui-only-fixture" as const, operationId: j.scope.operationId, complete: j.steps.execution.state === "confirmed", identityVerified: false, zkLoginVerified: false, benefitRedeemed: false, gasBudgetMIST: j.scope.gasBudgetMIST, maxTotalGasMIST: j.scope.gasBudgetMIST * 3, steps: structuredClone(j.steps) }
}
async function bounded<T>(work: () => Promise<T>, ms: number, stop: () => void = () => {}) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([work(), new Promise<never>((_, reject) => { timer = setTimeout(() => { stop(); reject(new Error("sui_only_timeout")) }, ms) })]) }
  finally { if (timer) clearTimeout(timer) }
}

export async function runSuiOnly(options: SuiOnlyOptions, dependencies: { env: Env; services: SuiOnlyServices; repository: SuiOnlyRepository; now?: () => number; stageTimeoutMs?: number }) {
  const { env, services, repository } = dependencies, now = dependencies.now ?? Date.now
  requireThat(["preflight", "inspect", "execute", "resume", "reconcile"].includes(options.mode), "mode")
  const presence = { issuer: Boolean(env.HK_SUI_ISSUER_SECRET_KEY), agent: Boolean(env.HK_SUI_AGENT_SECRET_KEY), sponsor: Boolean(env.HK_SUI_SPONSOR_SECRET_KEY || env.HK_SUI_ISSUER_SECRET_KEY), demoUser: Boolean(env.HK_SUI_ONLY_USER_SECRET_KEY) }
  if (options.mode === "preflight") return { mode: "preflight" as const, targetConfigured: publicConfig(env), keyPresence: presence,
    missingEnvironmentNames: ["HK_SUI_NETWORK", "HK_SUI_GRPC_URL", "HK_SUI_PACKAGE_ID", "HK_SUI_CAMPAIGN_ID", "HK_SUI_CAMPAIGN_INITIAL_VERSION", "HK_SUI_ISSUER_SECRET_KEY", "HK_SUI_AGENT_SECRET_KEY", "HK_SUI_ONLY_USER_SECRET_KEY", "HK_SUI_ONLY_USER_ADDRESS", "HK_SUI_ONLY_OPERATOR_TOKEN", "HK_SUI_ONLY_JOURNAL_DIR"].filter(name => !env[name]),
    liveExecutionVerified: false, identityVerified: false, zkLoginVerified: false, benefitRedeemed: false, rpcCalls: 0, signatures: 0, broadcasts: 0 }
  const approvalExpiry = gate(env, options, now()), budget = gas(options)
  if (options.mode === "execute" || options.mode === "resume") requireThat(Object.values(presence).every(Boolean), "keys_missing")
  const inspection = await bounded(() => services.inspect({ includeGas: options.mode !== "reconcile" }), 15_000)
  requireThat(inspection.chain === SUI_ONLY_PIN.chain && inspection.campaign === SUI_ONLY_PIN.campaign && inspection.type === `${SUI_ONLY_PIN.package}::entitlement::Campaign` && inspection.version === String(SUI_ONLY_PIN.version), "chain_binding")
  const campaignReady = inspection.active === true && inspection.policy === SUI_ONLY_PIN.policy && inspection.issuer === SUI_ONLY_PIN.issuer && inspection.agent === SUI_ONLY_PIN.agent
  const sponsorCanFund = (transactions: number) => /^\d+$/.test(inspection.sponsorCoinBalance) && BigInt(inspection.sponsorCoinBalance) >= BigInt(budget * transactions)
  gate(env, options, now())
  if (options.mode === "inspect") return { mode: "inspect" as const, chainVerified: true, campaignReady, sponsorGasSufficient: sponsorCanFund(3), liveExecutionVerified: false, identityVerified: false, zkLoginVerified: false, benefitRedeemed: false, signatures: 0, broadcasts: 0 }
  const operationId = options.operationId ?? "", holder = env.HK_SUI_ONLY_USER_ADDRESS ?? ""
  requireThat(UUID.test(operationId) && chainId(holder) === holder && holder !== SUI_ONLY_PIN.issuer && holder !== SUI_ONLY_PIN.agent, "operation")
  return repository.exclusive(operationId, async (read, save) => {
    let journal = await read()
    if (journal) validateJournal(journal, operationId, holder, budget)
    if (options.mode === "execute" && journal) return { ...summary(journal), duplicate: true }
    requireThat(options.mode === "execute" || journal, "journal_missing")
    if (!journal) journal = { schema: "sui-only/v1", scope: scope(operationId, holder, Math.min(now() + 10 * 60_000, approvalExpiry), budget), revision: 0, steps: { issue: { state: "new", digest: null }, delegation: { state: "new", digest: null }, execution: { state: "new", digest: null } } }
    const j = journal
    const persist = async () => { j.revision++; await save(structuredClone(j)) }
    if (options.mode === "reconcile") {
      const stage = STAGES.find(s => j.steps[s].state !== "confirmed")
      if (stage && j.steps[stage].digest) {
        let proof: SuiOnlyProof | undefined
        try { proof = await bounded(() => services.recover(stage, j.steps[stage].digest!, structuredClone(j)), 20_000) } catch { /* Read failures never authorize replay. */ }
        if (proof) {
          const candidate = structuredClone(j)
          try { applyProof(candidate, stage, proof) } catch { return summary(j) }
          gate(env, options, now())
          candidate.revision++
          await save(candidate) // A failed persistence must never return a confirmed summary.
          return summary(candidate)
        }
      }
      return summary(j)
    }
    requireThat(campaignReady, "campaign_not_ready")
    requireThat(sponsorCanFund(STAGES.filter(stage => j.steps[stage].state !== "confirmed").length), "sponsor_gas")
    requireThat(Object.values(presence).every(Boolean), "keys_missing")
    const roles = await bounded(() => services.roles(), 5_000)
    requireThat(roles.issuer === SUI_ONLY_PIN.issuer && roles.agent === SUI_ONLY_PIN.agent && roles.sponsor === SUI_ONLY_PIN.issuer && roles.holder === holder, "signer_roles")
    const runDeadline = now() + 140_000
    for (const stage of STAGES) {
      const step = j.steps[stage]
      if (step.state === "confirmed") continue
      // A claimed attempt, with or without a digest, is never retried.
      if (step.state !== "new") return summary(j)
      gate(env, options, now())
      requireThat(j.scope.expiresAtMs > now() && now() < runDeadline, "execution_expiry")
      step.state = "preparing"; await persist()
      let active = true
      try {
        const proof = await bounded(() => services.submit(stage, structuredClone(j), async digest => {
          requireThat(active && !options.signal?.aborted && now() < runDeadline && now() < j.scope.expiresAtMs, "cancelled")
          gate(env, options, now())
          requireThat(step.state === "preparing" && !step.digest && DIGEST.test(digest), "dispatch_once")
          step.digest = digest; step.state = "submitted"; await persist()
          requireThat(active && !options.signal?.aborted && now() < j.scope.expiresAtMs, "cancelled")
        }), Math.min(dependencies.stageTimeoutMs ?? 45_000, Math.max(1, runDeadline - now())), () => { active = false })
        active = false
        applyProof(j, stage, proof); await persist()
      } catch {
        active = false; step.state = "unknown"; await persist()
        return summary(j)
      }
    }
    return summary(j)
  })
}

/** Dedicated operator ledger, not the app store. An abandoned lock needs operator review;
 * it is never stolen by age. Journal files contain no private keys, signatures or BCS. */
export function fileSuiOnlyRepository(directory: string): SuiOnlyRepository {
  return { async exclusive(operationId, work) {
    requireThat(UUID.test(operationId) && isAbsolute(directory) && resolve(directory) === directory && directory !== "/", "journal_path")
    const info = await stat(directory)
    requireThat(info.isDirectory() && (info.mode & 0o077) === 0 && info.uid === process.getuid?.() && await realpath(directory) === directory, "journal_directory")
    const path = join(directory, `${operationId}.json`), lockPath = `${path}.lock`
    const lock = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
    const dir = await open(directory, constants.O_RDONLY)
    try {
      await lock.writeFile(JSON.stringify({ schema: "sui-only-lock/v1", operationId, pid: process.pid, startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString() })); await lock.sync(); await dir.sync()
      return await work(async () => {
        let file
        try { file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW) } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error }
        try { const s = await file.stat(); requireThat(s.isFile() && s.size <= 32_768 && (s.mode & 0o077) === 0 && s.uid === process.getuid?.(), "journal_file"); return JSON.parse(await file.readFile("utf8")) as SuiOnlyJournal }
        finally { await file.close() }
      }, async journal => {
        const temp = `${path}.${process.pid}.tmp`
        const file = await open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
        try { await file.writeFile(JSON.stringify(journal)); await file.sync() } finally { await file.close() }
        await rename(temp, path); await dir.sync()
      })
    } finally { await lock.close(); await unlink(lockPath); await dir.sync(); await dir.close() }
  } }
}

/** Live implementation is lazy: preflight never constructs signers or an RPC client. */
export function liveSuiOnlyServices(env: Env): SuiOnlyServices {
  let demo: import("@mysten/sui/keypairs/ed25519").Ed25519Keypair | undefined
  async function adapter() { return import("./adapters/sui") }
  async function issueEvidence(digest: string, j: SuiOnlyJournal): Promise<SuiOnlyProof> {
    const a = await adapter(), tx = await a.readTransaction(digest)
    const events = tx?.events.filter(e => e.type === `${SUI_ONLY_PIN.package}::entitlement::EntitlementIssued`) ?? []
    requireThat(tx?.success && tx.digest === digest && events.length === 1 && chainId(events[0].sender) === SUI_ONLY_PIN.issuer, "issue_evidence")
    const e = events[0].json as Record<string, unknown>, id = chainId(e?.entitlement)
    requireThat(id && tx.createdObjectIds.some(v => chainId(v) === id), "issue_created")
    const object = (await a.suiClient().getObject({ objectId: id, include: { json: true } })).object
    const data = object.json as Record<string, unknown>
    for (const value of [e, data]) requireThat(chainId(value.campaign) === SUI_ONLY_PIN.campaign && chainId(value.holder) === j.scope.holder && commitment(value.intent_ref) === j.scope.intentRef && String(value.expires_at_ms) === String(j.scope.expiresAtMs), "issue_binding")
    requireThat(object.type === `${SUI_ONLY_PIN.package}::entitlement::Entitlement` && object.owner.$kind === "AddressOwner" && chainId(object.owner.AddressOwner) === j.scope.holder, "issue_owner")
    return { digest, entitlement: { objectId: object.objectId, version: object.version, digest: object.digest } }
  }
  function execution(j: SuiOnlyJournal): ExecutionExpectation {
    requireThat(j.grant, "grant_missing")
    return { ...suiOnlyExpectation(j), grantId: j.grant.objectId, decisionCommitment: j.scope.decisionCommitment, manifestCommitment: j.scope.manifestCommitment }
  }
  return {
    async inspect(options) {
      const { SuiGrpcClient } = await import("@mysten/sui/grpc")
      const client = new SuiGrpcClient({ network: "testnet", baseUrl: SUI_ONLY_PIN.rpc }), signal = AbortSignal.timeout(12_000)
      const chain = await client.getChainIdentifier({ signal })
      const object = (await client.getObject({ objectId: SUI_ONLY_PIN.campaign, include: { json: true }, signal })).object
      const j = object.json as Record<string, unknown>
      let sponsorCoinBalance = ""
      if (options?.includeGas !== false) {
        try { sponsorCoinBalance = (await client.getBalance({ owner: SUI_ONLY_PIN.issuer, coinType: "0x2::sui::SUI", signal })).balance.coinBalance } catch { /* Read summaries remain available; writes fail closed on unknown gas. */ }
      }
      return { chain: chain.chainIdentifier, campaign: object.objectId, type: object.type, version: object.owner.$kind === "Shared" ? object.owner.Shared.initialSharedVersion : "", issuer: String(j.issuer), agent: String(j.agent), active: j.active === true, policy: Number(j.policy_version), sponsorCoinBalance }
    },
    async roles() {
      const a = await adapter(), { Ed25519Keypair } = await import("@mysten/sui/keypairs/ed25519")
      const keys = a.suiKeys(); demo = Ed25519Keypair.fromSecretKey(env.HK_SUI_ONLY_USER_SECRET_KEY!)
      return { issuer: keys.issuerAddress, agent: keys.agentAddress, sponsor: keys.sponsorAddress, holder: demo.toSuiAddress() }
    },
    async submit(stage, j, beforeBroadcast) {
      const a = await adapter(), s = j.scope
      if (stage === "issue") {
        const issued = await a.issueEntitlement({ intentRefHex: s.intentRef, holder: s.holder, expiresAtMs: s.expiresAtMs, gasBudgetMIST: s.gasBudgetMIST, beforeBroadcast })
        return issueEvidence(issued.txDigest, j)
      }
      if (stage === "delegation") {
        requireThat(j.entitlement && demo, "delegation_missing")
        const ptb = await a.buildDelegationPtb({ userAddress: s.holder, entitlement: j.entitlement, recipient: s.holder, actionCommitmentHex: s.actionCommitment, consentCommitmentHex: s.consentCommitment, expiresAtMs: s.expiresAtMs, gasBudgetMIST: s.gasBudgetMIST })
        const bytes = Buffer.from(ptb.txBytesB64, "base64")
        a.assertSerializedGasBudget(bytes, s.gasBudgetMIST)
        const signed = await demo.signTransaction(bytes)
        const result = await a.executeDelegation({ ...ptb, userSignature: signed.signature, expected: suiOnlyExpectation(j), gasBudgetMIST: s.gasBudgetMIST, beforeBroadcast })
        return { digest: result.txDigest, grant: result.grant }
      }
      requireThat(j.grant, "grant_missing")
      verifyGrantEvidence(await a.readGrant(j.grant.objectId), { ...suiOnlyExpectation(j), grantId: j.grant.objectId }, 0)
      const result = await a.agentConsume({ grant: j.grant, expected: execution(j), gasBudgetMIST: s.gasBudgetMIST, beforeBroadcast })
      return { digest: result.txDigest, recordId: result.recordId }
    },
    async recover(stage, digest, j) {
      const a = await adapter()
      if (stage === "issue") return issueEvidence(digest, j)
      if (stage === "delegation") { const result = await a.verifyReadDelegation(digest, suiOnlyExpectation(j)); return { digest: result.txDigest, grant: result.grant } }
      const result = await a.verifyReadExecution(digest, execution(j)); return { digest: result.txDigest, recordId: result.recordId }
    },
  }
}
