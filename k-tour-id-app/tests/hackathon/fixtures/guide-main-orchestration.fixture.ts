/**
 * SYNTHETIC orchestration, NOT native OpenDID / CX / zkLogin / chain E2E.
 * Actual: service, durable file store, CX + Gemini parsers, strict bridge DTO
 * client, provider lifecycle, collection atomicity, Sui scope/event verifier,
 * Omni receipt verifier and durable retry/outbox orchestration.
 * Replaced: readiness for this child only; a PROPOSED V2 provider projection
 * (native V2/CX→CAS contract is still absent); wallet cryptography and external
 * transaction transport. No secret, real network or real signing is used.
 */
import assert from "node:assert/strict"
import { after, mock, test } from "node:test"
import { createRequire } from "node:module"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { digestOf, HkError, nowIso, sha256Hex } from "../../../lib/hackathon/util"
import { GUIDE_SAVE_V2 } from "../../../lib/hackathon/guide-contract"
import { createOpenDidBridgeClient, resolveOpenDidCxSubject, type OpenDidIssuance, type OpenDidPresentation } from "../../../lib/hackathon/adapters/opendid-provider"
import { createOpenDidProviderLifecycle, assertOpenDidPermissionSnapshot, type OpenDidProviderState } from "../../../lib/hackathon/opendid-provider-lifecycle"
import { verifyDelegationEvidence, verifyExecutionEvidence, type GrantEvidence, type GrantExpectation, type ExecutionExpectation, type ChainTransaction } from "../../../lib/hackathon/sui-evidence"
import { readOmnioneReceiptEvidence } from "../../../lib/hackathon/omnione-readonly"
import { OMNIONE_STAGE, omnioneReadAbi as abi } from "../../../lib/hackathon/omnione-evidence"
import type { OperationRecord } from "../../../lib/hackathon/store"
import type { CredentialSummary, PresentationSummary } from "../../../lib/hackathon/types"

const require = createRequire(import.meta.url)
const originalProvider = require("../../../lib/hackathon/provider-operation.ts") as typeof import("../../../lib/hackathon/provider-operation")
const originalPolicy = require("../../../lib/hackathon/guide-policy.ts") as typeof import("../../../lib/hackathon/guide-policy")
const root = await mkdtemp(join(tmpdir(), "ktour-guide-orchestration-"))
Object.assign(process.env, { HK_DATA_DIR: root, HK_ISOLATED_MOCK: "0", HK_MODE_CX: "cx", HK_MODE_OPENDID: "opendid", HK_CX_BASE_URL: "https://cx.fixture.invalid", HK_CX_PROVIDER: "comdl", HK_AI_MODE: "gemini", GEMINI_API_KEY: "fixture-not-a-key", HK_ISSUER_SIGNING_SEED: "fixture-only-subject-hmac-seed" })
mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-09-29T06:00:00.000Z") })
after(async () => { mock.restoreAll(); mock.timers.reset(); await rm(root, { recursive: true, force: true }) })
const iso = (offset = 0) => new Date(Date.now() + offset).toISOString()
const id = (label: string) => sha256Hex(label)
const OWNER = id("fixture owner"), AGENT = id("fixture agent"), CAMPAIGN = id("fixture campaign")
const EVENTS = { granted: "fixture::GrantCreated", consent: "fixture::ConsentAttested", consumed: "fixture::GrantConsumed", attested: "fixture::ExecutionAttested" }
const counters = { cx: 0, status: 0, issue: 0, delegate: 0, agent: 0, omni: 0, executionRead: 0 }
const control = { ci: "", revoked: false, badAi: false, omniPending: false, omniMismatch: false, loseAgentResponse: false, loseDelegateResponse: false, loseOmniResponse: false, issueFailure: false }
const network: string[] = []
const cxRequests = new Map<string, { txId: string; cxId: string; ci: string }>()
const issuances = new Map<string, OpenDidIssuance>(), presentations = new Map<string, OpenDidPresentation>()
const grants = new Map<string, GrantEvidence>(), transactions = new Map<string, ChainTransaction>()
const omni = new Map<string, { eventKey: string; payloadCommitment: string; txHash: string }>()
const json = (value: unknown) => Response.json(value)
let pauseIssue: (() => Promise<void>) | null = null

globalThis.fetch = (async (raw: string | URL | Request, init?: RequestInit) => {
  const url = new URL(raw instanceof Request ? raw.url : raw), body = init?.body ? JSON.parse(String(init.body)) : {}
  network.push(`${url.origin}${url.pathname}`)
  if (url.origin === "https://cx.fixture.invalid") {
    counters.cx++
    if (url.pathname.endsWith("/trans")) {
      const n = cxRequests.size + 1, token = `request-token-${n}`, txId = `transaction-${n}`, cxId = `cx-request-${n}`
      cxRequests.set(token, { txId, cxId, ci: control.ci || `synthetic-ci-${n}` })
      return json({ code: 200, token, txId })
    }
    const token = String(body.token ?? "").replace("completion-", ""), item = cxRequests.get(token)
    assert.ok(item, "CX result must use the request-bound token")
    if (url.pathname.endsWith("/qr/request")) return json({ code: 200, token, txId: item.txId, cxId: item.cxId, data: { qrBase64: Buffer.from("89504e470d0a1a0a", "hex").toString("base64") } })
    if (url.pathname.endsWith("/qr/result")) return json({ code: 200, oacxStatus: "AFTER_RESULT", token: `completion-${token}`, txId: item.txId, reqTxId: item.txId, cxId: item.cxId, data: { verified: true } })
    if (url.pathname.endsWith("/trans/token")) { assert.ok(String(body.token).startsWith("completion-")); return json({ code: 200, data: { ci: item.ci, sub: "AFTER_RESULT", adult: "Y" } }) }
  }
  if (url.origin === "https://graphql.testnet.sui.io" && url.pathname === "/graphql") return json({ data: { verifySignature: { success: false } } })
  if (url.origin === "https://generativelanguage.googleapis.com") {
    const input = JSON.parse(body.contents.at(-1).parts[0].text)
    return json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ action: control.badAi ? "transfer" : GUIDE_SAVE_V2.action, target: { venueId: input.venue.id, campaignId: input.campaign.id }, title: "街歩きガイド", summary: "旅のパスにガイドを保存します。", rationale: "次の街歩きに役立つガイドです。", language: "ja" }) }] } }] })
  }
  if (url.origin === "https://bridge.fixture.invalid") {
    assert.match(new Headers(init?.headers).get("x-ktour-owner") ?? "", /^[a-f0-9]{64}$/)
    if (url.pathname === "/bridge/v1/issuances") {
      const key = `issue_${body.operationId}`
      const value: OpenDidIssuance = { issuanceId: key, operationId: body.operationId, state: "offered", revision: 1, offer: { qrPayload: `fixture-issuance:${key}` }, credential: null, error: null, expiresAt: iso(300_000) }
      issuances.set(key, value); return json(value)
    }
    if (url.pathname.startsWith("/bridge/v1/issuances/")) {
      const key = url.pathname.split("/")[4], value = issuances.get(key)!
      assert.ok(value)
      if (url.pathname.endsWith("/status")) { counters.status++; return json({ issuanceId: key, active: !control.revoked, reason: control.revoked ? "status_revoked" : null, checkedAt: iso() }) }
      if (url.pathname.endsWith("/cancel")) { value.state = "cancelled"; value.offer = null; value.credential = null; return json(value) }
      value.state = "issued"; value.revision++; value.offer = null
      value.credential = { vcId: `urn:fixture:${key}`, issuerDid: "did:fixture:issuer", schemaId: "fixture-proposed-guide-v2", validFrom: iso(-1000), validUntil: iso(600_000), holderBinding: id(key) }
      return json(value)
    }
    if (url.pathname === "/bridge/v1/presentations") {
      const source = issuances.get(body.issuanceId)!, key = `present_${source.operationId}`
      const value: OpenDidPresentation = { presentationId: key, operationId: source.operationId, state: "offered", revision: 1, offer: { qrPayload: `fixture-presentation:${key}` }, decision: null, denyReason: null, expiresAt: iso(300_000) }
      presentations.set(key, value); return json(value)
    }
    if (url.pathname.startsWith("/bridge/v1/presentations/")) {
      const value = presentations.get(url.pathname.split("/")[4])!
      assert.ok(value); value.revision++; value.offer = null
      if (url.pathname.endsWith("/deny")) { value.state = "denied"; value.decision = null; value.denyReason = "user_denied" }
      else { value.state = "allowed"; value.decision = { decisionRef: `decision_${value.operationId}`, decisionExpiresAt: iso(240_000) } }
      return json(value)
    }
  }
  throw new Error(`External network forbidden in orchestration fixture: ${url.origin}${url.pathname}`)
}) as typeof fetch

const { withStore, readStore } = await import("../../../lib/hackathon/store")
const bridge = createOpenDidBridgeClient({ baseUrl: "https://bridge.fixture.invalid", trustedOrigin: "https://bridge.fixture.invalid", serviceToken: "fixture-token-".padEnd(40, "x"), ownerBindingSecret: "fixture-owner-binding-".padEnd(40, "x"), issuerDid: "did:fixture:issuer", schemaId: "fixture-proposed-guide-v2" })
const opBinding = (op: OperationRecord) => digestOf({ operationId: op.operationId, sessionId: op.sessionId, identity: op.identity, consent: op.consent, journey: op.journey, expiresAt: op.expiresAt })
function projection(op: OperationRecord, s: OpenDidProviderState) {
  const c = s.issuance?.credential, p = s.presentation
  if (c) op.credential = { credentialRef: id(s.issuance!.issuanceId), vcId: id(c.vcId), schema: c.schemaId, mode: "opendid", issuerDid: c.issuerDid, holderBinding: id(c.holderBinding), serviceAccess: [GUIDE_SAVE_V2.action], validFrom: c.validFrom, validUntil: c.validUntil, statusRef: id(`status:${s.issuance!.issuanceId}`), status: s.lastStatus && !s.lastStatus.active ? "revoked" : "active", holderAckAt: op.credential?.holderAckAt ?? iso() } satisfies CredentialSummary
  if (p) op.presentation = { presentationId: p.presentationId, nonce: id(p.presentationId), requestDigest: id(s.operationBinding), requestedClaims: [GUIDE_SAVE_V2.action], expiresAt: p.expiresAt, submittedAt: p.decision ? iso() : null, verifiedAt: p.decision ? op.presentation?.verifiedAt ?? iso() : null, decision: p.decision ? "allow" : null, decisionRef: p.decision?.decisionRef ?? null, decisionExpiresAt: p.decision?.decisionExpiresAt ?? null, decisionConsumedAt: op.presentation?.decisionConsumedAt ?? null, denyReason: p.denyReason } satisfies PresentationSummary
  if (["issuance", "presentation"].includes(op.phase)) op.phase = s.phase === "allowed" ? "proposal" : c ? "presentation" : "issuance"
}
const lifecycle = createOpenDidProviderLifecycle({ bridge, store: {
  read: operationId => readStore(db => db.operations[operationId]?.secrets.openDidProvider ?? null),
  compareAndSet: (operationId, revision, state) => withStore(db => {
    const op = db.operations[operationId], old = op?.secrets.openDidProvider
    if (!op || op.status !== "pending" || Date.parse(op.expiresAt) <= Date.now() || opBinding(op) !== state.operationBinding || (old?.revision ?? null) !== revision) return false
    op.secrets.openDidProvider = state; op.revision++; projection(op, state); return true
  }),
} })
async function owned(sessionId: string, operationId: string) {
  const op = await readStore(db => db.operations[operationId])
  if (!op || op.sessionId !== sessionId) throw new HkError("not_found", "fixture ownership", 404)
  return op
}
const context = (op: OperationRecord) => ({ operationId: op.operationId, sessionId: op.sessionId, expiresAt: op.expiresAt, operationBinding: opBinding(op) })
function credentialReason(op: OperationRecord) {
  const s = op.secrets.openDidProvider
  if (op.status !== "pending" || !s || s.operationBinding !== opBinding(op) || op.credential?.mode !== "opendid" || op.credential.status !== "active" || op.credential.serviceAccess[0] !== GUIDE_SAVE_V2.action) return "fixture_provider_credential"
  return null
}
function presentationReason(op: OperationRecord) {
  return credentialReason(op) ?? (op.presentation?.decision !== "allow" || op.presentation.decisionConsumedAt ? "fixture_provider_permission" : null)
}
function permission(op: OperationRecord, revision?: number) {
  if (revision !== undefined && op.revision !== revision) throw new HkError("operation_changed", "fixture revision changed", 409)
  const reason = presentationReason(op); if (reason) throw new HkError(reason, reason, 409)
  assertOpenDidPermissionSnapshot(op.secrets.openDidProvider!)
}
async function refresh(sessionId: string, operationId: string) {
  const op = await owned(sessionId, operationId)
  await lifecycle.assertFreshPermission(context(op))
  const current = await owned(sessionId, operationId); permission(current)
  return { revision: current.revision, binding: opBinding(current) }
}
mock.module(require.resolve("../../../lib/hackathon/guide-policy.ts"), { namedExports: { ...originalPolicy, assertGuideReady: async () => undefined } })
mock.module(require.resolve("../../../lib/hackathon/provider-operation.ts"), { namedExports: { ...originalProvider, refreshProviderPermission: refresh, assertProviderPermissionForOperation: permission, providerCredentialReason: credentialReason, providerPresentationReason: presentationReason } })
mock.module("@mysten/sui/cryptography", { namedExports: { ...require("@mysten/sui/cryptography"), parseSerializedSignature: (signature: string) => ({ signatureScheme: signature.startsWith("fixture-zk:") ? "ZkLogin" : "ED25519" }) } })
mock.module("@mysten/sui/verify", { namedExports: { ...require("@mysten/sui/verify"), verifyPersonalMessageSignature: async (bytes: Uint8Array, signature: string, options: { address: string }) => {
  assert.equal(signature, `fixture-zk:${sha256Hex(bytes)}`); assert.equal(options.address, OWNER); return {}
} } })

const txDigest = (bytes: Uint8Array) => sha256Hex(bytes)
function grantFixture(e: GrantExpectation, grantId: string): GrantEvidence {
  return { objectId: grantId, type: e.grantType, initialSharedVersion: "1", json: { campaign: e.campaignId, owner: e.owner, agent: e.agent, recipient: e.recipient, intent_ref: e.intentRef, action_commitment: e.actionCommitment, expires_at_ms: e.expiresAtMs, policy_version: e.policyVersion, max_uses: 1, uses: 0, revoked: false } }
}
async function readExecution(digest: string, expected: ExecutionExpectation) {
  counters.executionRead++
  const tx = transactions.get(digest)!, g = grants.get(expected.grantId)!
  const checked = verifyExecutionEvidence(tx, g, expected, digest)
  return { txDigest: digest, ...checked, grantUses: Number(g.json.uses) }
}
mock.module(require.resolve("../../../lib/hackathon/adapters/sui.ts"), { namedExports: {
  suiClient: () => ({ core: { verifyZkLoginSignature: async () => { throw new Error("fixture invalid signature") } } }),
  suiKeys: () => ({ agentAddress: AGENT }), suiTargets: () => ({ campaign: { objectId: CAMPAIGN }, types: { grant: "fixture::Grant" }, events: EVENTS }),
  transactionDigest: txDigest, explorerTx: (v: string) => `https://explorer.fixture.invalid/tx/${v}`, explorerObject: (v: string) => `https://explorer.fixture.invalid/object/${v}`,
  issueEntitlement: async (opts: { intentRefHex: string; beforeBroadcast?: (digest: string) => Promise<void> }) => {
    counters.issue++; await pauseIssue?.(); const digest = id(`issue:${opts.intentRefHex}`); await opts.beforeBroadcast?.(digest)
    if (control.issueFailure) throw new HkError("sui_timeout", "fixture lost issue response", 503, true)
    return { entitlement: { objectId: id(opts.intentRefHex), version: "1", digest: id("entitlement object") }, txDigest: digest }
  },
  buildDelegationPtb: async (opts: unknown) => { const bytes = Buffer.from(JSON.stringify(opts)); return { txBytesB64: bytes.toString("base64"), txBytesDigest: txDigest(bytes), sponsorSignature: "fixture-sponsor-not-cryptographic" } },
  executeDelegation: async (opts: { txBytesB64: string; userSignature: string; expected: GrantExpectation; beforeBroadcast?: (digest: string) => Promise<void> }) => {
    assert.equal(opts.userSignature, "fixture-user-approved"); const digest = txDigest(Buffer.from(opts.txBytesB64, "base64")); await opts.beforeBroadcast?.(digest); counters.delegate++
    const e = opts.expected, g = grantFixture(e, id(`grant:${digest}`)), base = { grant: g.objectId, campaign: e.campaignId, owner: e.owner }
    const tx: ChainTransaction = { digest, success: true, createdObjectIds: [g.objectId], events: [
      { type: EVENTS.granted, sender: e.owner, json: { ...base, agent: e.agent, recipient: e.recipient, intent_ref: e.intentRef, action_commitment: e.actionCommitment, expires_at_ms: e.expiresAtMs } },
      { type: EVENTS.consent, sender: e.owner, json: { ...base, consent_commitment: e.consentCommitment } },
    ] }
    verifyDelegationEvidence(tx, g, e, digest); transactions.set(digest, tx); grants.set(g.objectId, g)
    if (control.loseDelegateResponse) throw new HkError("sui_timeout", "fixture lost delegation response", 503, true)
    return { txDigest: digest, grant: { objectId: g.objectId, initialSharedVersion: "1" } }
  },
  readGrant: async (key: string) => { const g = grants.get(key)!; return { ...g, uses: Number(g.json.uses), revoked: g.json.revoked, expiresAtMs: Number(g.json.expires_at_ms) } },
  agentConsume: async (opts: { expected: ExecutionExpectation; beforeBroadcast?: (digest: string) => Promise<void> }) => {
    const e = opts.expected, digest = id(`agent:${e.grantId}`), recordId = id(`record:${digest}`)
    await opts.beforeBroadcast?.(digest); counters.agent++
    const g = grants.get(e.grantId)!; g.json.uses = 1
    const base = { campaign: e.campaignId, agent: e.agent, record: recordId }
    transactions.set(digest, { digest, success: true, createdObjectIds: [recordId], events: [
      { type: EVENTS.consumed, sender: e.agent, json: { ...base, grant: e.grantId, recipient: e.recipient, intent_ref: e.intentRef, decision_commitment: e.decisionCommitment, executed_at_ms: Date.now() } },
      { type: EVENTS.attested, sender: e.agent, json: { ...base, manifest_commitment: e.manifestCommitment } },
    ] })
    if (control.loseAgentResponse) throw new HkError("sui_timeout", "fixture lost agent response", 503, true)
    return readExecution(digest, e)
  },
  verifyReadExecution: readExecution,
  verifyReadDelegation: async (digest: string, e: GrantExpectation) => {
    const tx = transactions.get(digest)!, g = grants.get(tx.createdObjectIds[0])!
    verifyDelegationEvidence(tx, g, e, digest); return { txDigest: digest, grant: { objectId: g.objectId, initialSharedVersion: "1" } }
  },
} })
mock.module(require.resolve("../../../lib/hackathon/adapters/omnione.ts"), { namedExports: {
  omnioneConfigured: () => true,
  getRedemption: async (eventKey: string) => { const row = [...omni.values()].find(r => r.eventKey === eventKey); return { exists: !!row, payloadCommitment: row?.payloadCommitment ?? id("empty"), recordedAt: row ? 10 : 0, recorder: OMNIONE_STAGE.recorder } },
  submitRedemption: async (options: { eventKeyHex: string; payloadCommitmentHex: string; onPrepared?: (hash: string) => Promise<void> }) => {
    const eventKey = options.eventKeyHex, payloadCommitment = options.payloadCommitmentHex
    const txHash = id(`omni:${eventKey}`); await options.onPrepared?.(txHash); counters.omni++; omni.set(txHash, { txHash, eventKey, payloadCommitment })
    if (control.loseOmniResponse) throw new HkError("omnione_timeout", "fixture lost Omni response", 503, true)
    return { txHash, matches: true, alreadyRecorded: false }
  },
  receiptStatus: async (txHash: string, binding: { eventKey: string; payloadCommitment: string }) => {
    const expected = { ...OMNIONE_STAGE, txHash, ...binding }, row = omni.get(txHash), blockHash = id("block")
    return readOmnioneReceiptEvidence({ call: async (method, params) => {
      if (method === "eth_chainId") return `0x${expected.chainId.toString(16)}`
      if (method === "eth_getTransactionReceipt") return control.omniPending || !row ? null : { status: "0x1", transactionHash: txHash, blockNumber: "0x7b", blockHash, to: expected.registry, from: expected.recorder, logs: [{ address: expected.registry, transactionHash: txHash, blockHash, blockNumber: "0x7b", removed: false, ...abi.encodeEventLog(abi.getEvent("DemoEntitlementRedeemed")!, [row.eventKey, control.omniMismatch ? id("foreign") : row.payloadCommitment, 10n, expected.recorder]) }] }
      const data = (params[0] as { data: string }).data
      if (data.startsWith(abi.getFunction("recorders")!.selector)) return abi.encodeFunctionResult("recorders", [true])
      return abi.encodeFunctionResult("getRedemption", [!!row, row?.payloadCommitment ?? id("empty"), row ? 10n : 0n, expected.recorder])
    } }, expected)
  },
} })

const service = await import("../../../lib/hackathon/service")
type Flow = { sessionId: string; operationId: string }
async function create(sessionId = `session_fixture_${Math.random().toString(36).slice(2)}`): Promise<Flow> {
  await withStore(db => { db.sessions[sessionId] ??= { sessionId, createdAt: nowIso(), lastSeenAt: nowIso(), subjectRef: null } })
  const op = await service.createOperation({ sessionId, venueId: GUIDE_SAVE_V2.venueId, consentVersion: GUIDE_SAVE_V2.consentVersion, locale: "ja", venueName: "ロバ" }, true)
  return { sessionId, operationId: op.operationId }
}
async function identity(f: Flow) { await service.identityStart(f.sessionId, f.operationId, false); return service.identityComplete(f.sessionId, f.operationId) }
async function provider(f: Flow) {
  const op = await owned(f.sessionId, f.operationId), i = op.identity!
  assert.equal(i.mode, "cx"); assert.equal(i.source, "cx_mobile_id")
  const subject = await resolveOpenDidCxSubject({ ...i, source: "cx_mobile_id", mode: "cx", evidenceRef: i.evidenceId }, async e => ({ evidenceRef: e.evidenceRef, mappingVersion: "cx-cas-v1", kycRef: id(`PROPOSED-V2-FIXTURE-ONLY:${i.subjectRef}`).slice(2) }))
  const ctx = context(op)
  await lifecycle.startIssuance(ctx, subject); await lifecycle.refreshIssuance(ctx); await lifecycle.startPresentation(ctx); await lifecycle.refreshPresentation(ctx)
}
async function proposed() { const f = await create(); await identity(f); await provider(f); await service.proposalCreate(f.sessionId, f.operationId, { locale: "ja", venueName: "ロバ", category: "食堂", district: "ソウル" }); return f }
async function prepare(f: Flow) {
  const op = await owned(f.sessionId, f.operationId), message = `ondo-hk-wallet-proof:${f.operationId}:${op.presentation!.decisionRef}`
  return service.delegationPrepare(f.sessionId, f.operationId, { userAddress: OWNER, signer: "zklogin", approvedProposalDigest: op.proposal!.proposalDigest, walletProof: { message, signature: `fixture-zk:${sha256Hex(new TextEncoder().encode(message))}` } })
}
async function delegated() { const f = await proposed(); const p = await prepare(f); await service.delegationSubmit(f.sessionId, f.operationId, { txBytesDigest: p.result.delegation!.txBytesDigest!, userSignature: "fixture-user-approved" }); return f }
async function executed() { const f = await delegated(); await service.agentRun(f.sessionId, f.operationId); return f }
const redeem = (f: Flow, key = "fixture-redemption") => service.redeem(f.sessionId, f.operationId, { idempotencyKey: key, bodyDigest: id("empty body") })
const hasCode = (code: string) => (error: unknown) => !!error && typeof error === "object" && "code" in error && error.code === code
function reset() { Object.assign(control, { ci: "", revoked: false, badAi: false, omniPending: false, omniMismatch: false, loseAgentResponse: false, loseDelegateResponse: false, loseOmniResponse: false, issueFailure: false }); pauseIssue = null }

test("production V2 remains unavailable: no invented CX mapping or policy flag", async () => {
  assert.equal(originalProvider.providerIntegrationAvailable(), false)
  await assert.rejects(Promise.resolve().then(() => originalPolicy.assertGuideReady()), hasCode("guide_setup_required"))
  const f = await create(); await identity(f); const op = await owned(f.sessionId, f.operationId)
  assert.equal(originalProvider.providerCredentialReason(op), "opendid_policy_unsupported")
  assert.equal(op.identity!.mode, "cx")
  await assert.rejects(resolveOpenDidCxSubject({ ...op.identity!, source: "cx_mobile_id", mode: "cx", evidenceRef: op.identity!.evidenceId }), hasCode("opendid_cx_mapping_unavailable"))
  await service.cancel(f.sessionId, f.operationId)
})

test("synthetic full flow binds actual CX, proposed V2 VP, user approval, Sui evidence, collection and Omni receipt", async () => {
  reset(); const before = { ...counters }, f = await executed(), result = await redeem(f)
  assert.equal(result.status, "succeeded"); assert.equal(result.phase, "done"); assert.equal(result.chain?.status, "confirmed")
  assert.equal(result.chain?.blockNumber, 123); assert.equal(result.agent?.verified?.grantUses, 1)
  assert.equal(counters.issue - before.issue, 1); assert.equal(counters.delegate - before.delegate, 1); assert.equal(counters.agent - before.agent, 1); assert.equal(counters.omni - before.omni, 1)
  assert.ok(counters.status - before.status >= 5); assert.ok(counters.executionRead - before.executionRead >= 2)
  const collection = await service.guideCollection(f.sessionId)
  assert.equal(collection.items.length, 1); assert.equal(collection.items[0].chain.status, "confirmed")
  assert.equal(collection.pendingOperation, null)
  const publicResult = JSON.stringify(result)
  for (const secret of ["synthetic-ci-", "request-token-", "urn:fixture:", "fixture-issuance:", "kycRef", "ownerBinding", "openDidProvider"]) assert.ok(!publicResult.includes(secret), `${secret} leaked`)
  const finalCounts = { ...counters }; control.revoked = true
  assert.equal((await redeem(f)).fulfillment?.redemptionRef, result.fulfillment?.redemptionRef)
  assert.deepEqual(counters, finalCounts, "committed retry must not contact any provider")
  await assert.rejects(service.redeem(f.sessionId, f.operationId, { idempotencyKey: "fixture-redemption", bodyDigest: id("different") }), hasCode("idempotency_conflict"))
  reset()
})

test("same-session create is reused; another session's operation is inaccessible", async () => {
  reset(); const f = await create(); assert.equal((await create(f.sessionId)).operationId, f.operationId)
  await assert.rejects(service.loadOperation("session_other_fixture", f.operationId), hasCode("not_found"))
})

test("CX duplicate-subject lock prevents a second guide before any chain spend", async () => {
  reset(); control.ci = "synthetic-same-person"; const first = await create(); await identity(first)
  const second = await create(), before = counters.issue
  const blocked = await identity(second)
  assert.equal(blocked.status, "failed"); assert.equal(blocked.error?.code, "guide_save_in_progress")
  assert.equal(counters.issue, before); reset()
})

test("provider guide cannot enter the legacy sample credential path", async () => {
  reset(); const f = await create(); await identity(f)
  await assert.rejects(service.credentialIssue(f.sessionId, f.operationId, { publicKeyPem: "not-a-key", alg: "Ed25519" }), hasCode("opendid_provider_required"))
})

test("unapproved AI action never enables delegation or chain issuance", async () => {
  reset(); const f = await create(); await identity(f); await provider(f); control.badAi = true
  const before = counters.issue
  await assert.rejects(service.proposalCreate(f.sessionId, f.operationId, { locale: "ja", venueName: "ロバ", category: "食堂", district: "ソウル" }), hasCode("guide_ai_unavailable"))
  assert.equal((await owned(f.sessionId, f.operationId)).phase, "proposal"); assert.equal(counters.issue, before); reset()
})

test("revoked credential is refreshed and blocks chain issue, not cached allow", async () => {
  reset(); const f = await proposed(), before = counters.issue; control.revoked = true
  await assert.rejects(prepare(f), hasCode("opendid_status_required")); assert.equal(counters.issue, before); reset()
})

test("prepared delegation retry reuses exact bytes and never remints entitlement", async () => {
  reset(); const f = await proposed(), before = counters.issue, first = await prepare(f), second = await prepare(f)
  assert.equal(first.txBytesB64, second.txBytesB64); assert.equal(counters.issue - before, 1)
})

test("forged proposal, wrong signer and invalid wallet signature cannot authorize issuance", async () => {
  reset(); const f = await proposed(), op = await owned(f.sessionId, f.operationId), before = counters.issue
  const message = `ondo-hk-wallet-proof:${f.operationId}:${op.presentation!.decisionRef}`
  const valid = { userAddress: OWNER, signer: "zklogin" as const, approvedProposalDigest: op.proposal!.proposalDigest, walletProof: { message, signature: `fixture-zk:${sha256Hex(new TextEncoder().encode(message))}` } }
  await assert.rejects(service.delegationPrepare(f.sessionId, f.operationId, { ...valid, approvedProposalDigest: id("unapproved") }), hasCode("proposal_digest"))
  await assert.rejects(service.delegationPrepare(f.sessionId, f.operationId, { ...valid, signer: "demo" }), hasCode("zklogin_required"))
  await assert.rejects(service.delegationPrepare(f.sessionId, f.operationId, { ...valid, walletProof: { message, signature: "fixture-zk:forged" } }), hasCode("wallet_proof"))
  assert.equal(counters.issue, before)
})

test("changed transaction bytes cannot reach delegation broadcast", async () => {
  reset(); const f = await proposed(); await prepare(f); const before = counters.delegate
  await assert.rejects(service.delegationSubmit(f.sessionId, f.operationId, { txBytesDigest: id("replaced bytes"), userSignature: "fixture-user-approved" }), hasCode("tx_mismatch"))
  assert.equal(counters.delegate, before)
})

test("expired decision cannot issue even with a newly active status response", async () => {
  reset(); const f = await proposed(), before = counters.issue
  await withStore(db => { const op = db.operations[f.operationId]; op.secrets.openDidProvider!.presentation!.decision!.decisionExpiresAt = iso(-1); op.presentation!.decisionExpiresAt = iso(-1) })
  await assert.rejects(prepare(f), hasCode("opendid_permission_expired")); assert.equal(counters.issue, before)
})

test("concurrent preparation claims permit only one issuer attempt", async () => {
  reset(); const f = await proposed(), before = counters.issue
  const results = await Promise.allSettled([prepare(f), prepare(f)])
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1)
  assert.equal(counters.issue - before, 1)
})

test("unknown issuance is not retried or reminted", async () => {
  reset(); const f = await proposed(); control.issueFailure = true; const before = counters.issue
  await assert.rejects(prepare(f)); await assert.rejects(prepare(f)); assert.equal(counters.issue - before, 1); reset()
})

test("cancellation while issue transport is pending wins before broadcast", async () => {
  reset(); const f = await proposed(); let release!: () => void, entered!: () => void
  const started = new Promise<void>(r => { entered = r }), wait = new Promise<void>(r => { release = r })
  pauseIssue = async () => { entered(); await wait }
  const pending = prepare(f); await started; await service.cancel(f.sessionId, f.operationId); release()
  await assert.rejects(pending); assert.equal((await owned(f.sessionId, f.operationId)).status, "cancelled"); reset()
})

test("provider revocation during issuer preparation prevents the pending broadcast", async () => {
  reset(); const f = await proposed(); let release!: () => void, entered!: () => void
  const started = new Promise<void>(r => { entered = r }), wait = new Promise<void>(r => { release = r })
  pauseIssue = async () => { entered(); await wait }
  const pending = prepare(f); await started; control.revoked = true
  await assert.rejects(refresh(f.sessionId, f.operationId), hasCode("opendid_status_required")); release()
  await assert.rejects(pending)
  assert.equal((await owned(f.sessionId, f.operationId)).secrets.delegationPreparation?.issueTxDigest, null)
  reset()
})

test("unknown user delegation resolves from exact evidence without repeat submission", async () => {
  reset(); const f = await proposed(), p = await prepare(f); control.loseDelegateResponse = true; const before = counters.delegate
  const result = await service.delegationSubmit(f.sessionId, f.operationId, { txBytesDigest: p.result.delegation!.txBytesDigest!, userSignature: "fixture-user-approved" })
  assert.equal(result.delegation?.status, "unknown")
  await assert.rejects(service.cancel(f.sessionId, f.operationId), hasCode("cannot_cancel"))
  const recovered = await service.reconcile(f.sessionId, f.operationId); assert.equal(recovered.phase, "agent"); assert.equal(counters.delegate - before, 1); reset()
})

test("unknown agent execution is check-only; exact receipt recovers then service commits once", async () => {
  reset(); const f = await delegated(); control.loseAgentResponse = true; const before = counters.agent
  assert.equal((await service.agentRun(f.sessionId, f.operationId)).agent?.status, "unknown")
  assert.equal((await service.agentRun(f.sessionId, f.operationId)).agent?.status, "unknown")
  assert.equal((await service.reconcile(f.sessionId, f.operationId)).phase, "fulfillment")
  assert.equal((await redeem(f)).status, "succeeded"); assert.equal(counters.agent - before, 1); reset()
})

test("tampered execution event cannot commit the saved guide or Omni outbox", async () => {
  reset(); const f = await executed(), op = await owned(f.sessionId, f.operationId), tx = transactions.get(op.agent!.txDigest!)!
  ;(tx.events[0].json as Record<string, unknown>).recipient = id("foreign recipient")
  const before = counters.omni; await assert.rejects(redeem(f), hasCode("sui_evidence_mismatch"))
  assert.equal((await service.guideCollection(f.sessionId)).items.length, 0); assert.equal(counters.omni, before)
})

test("pending Omni receipt keeps guide saved; reconciliation confirms without rebroadcast", async () => {
  reset(); const f = await executed(); control.omniPending = true; const before = counters.omni
  const saved = await redeem(f); assert.equal(saved.status, "succeeded"); assert.equal(saved.chain?.status, "submitted")
  assert.equal((await service.guideCollection(f.sessionId)).items[0].chain.status, "submitted")
  control.omniPending = false; const recovered = await service.reconcile(f.sessionId, f.operationId)
  assert.equal(recovered.chain?.status, "confirmed"); assert.equal(counters.omni - before, 1)
})

test("concurrent Omni recovery workers confirm one existing submission only", async () => {
  reset(); const f = await executed(); control.omniPending = true; const before = counters.omni
  const saved = await redeem(f); control.omniPending = false
  await Promise.all([service.processOutbox(saved.chain!.outboxId), service.processOutbox(saved.chain!.outboxId)])
  const latest = await service.loadOperation(f.sessionId, f.operationId)
  assert.equal(latest.chain?.status, "confirmed"); assert.equal(counters.omni - before, 1)
})

test("unknown Omni submission without a digest remains check-only, never a retry", async () => {
  reset(); const f = await executed(); control.omniPending = true; const saved = await redeem(f)
  await withStore(db => { const row = db.outbox[saved.chain!.outboxId]; row.txHash = null; row.status = "unknown" })
  omni.delete(saved.chain!.txHash!); const before = counters.omni
  await service.processOutbox(saved.chain!.outboxId)
  assert.equal((await service.loadOperation(f.sessionId, f.operationId)).chain?.status, "unknown"); assert.equal(counters.omni, before); reset()
})

test("saved guide is visible only to the verified subject and blocks a second saved result", async () => {
  reset(); control.ci = "synthetic-already-saved-person"; const f = await executed(); await redeem(f)
  assert.equal((await service.guideCollection("unrelated_fixture_session")).items.length, 0)
  await assert.rejects(create(f.sessionId), hasCode("guide_already_saved"))
  const second = await create(); const result = await identity(second)
  assert.equal(result.error?.code, "guide_already_saved"); assert.equal((await service.guideCollection(second.sessionId)).items.length, 1); reset()
})

test("Omni response lost after persisted hash is recovered check-only", async () => {
  reset(); const f = await executed(); control.loseOmniResponse = true; const before = counters.omni
  const saved = await redeem(f); assert.equal(saved.status, "succeeded"); assert.ok(saved.chain?.txHash)
  control.loseOmniResponse = false; const recovered = await service.reconcile(f.sessionId, f.operationId)
  assert.equal(recovered.chain?.status, "confirmed"); assert.equal(counters.omni - before, 1)
})

test("mismatched Omni event never produces a confirmed collection badge", async () => {
  reset(); const f = await executed(); control.omniMismatch = true; const saved = await redeem(f)
  assert.equal(saved.status, "succeeded"); assert.equal(saved.chain?.status, "failed")
  assert.equal((await service.guideCollection(f.sessionId)).items[0].chain.status, "failed"); reset()
})

test("fixture transport allowlist saw no real provider request", () => {
  assert.ok(network.length > 0)
  for (const target of network) assert.ok(target.startsWith("https://cx.fixture.invalid/") || target.startsWith("https://bridge.fixture.invalid/") || target.startsWith("https://generativelanguage.googleapis.com/v1beta/models/") || target === "https://graphql.testnet.sui.io/graphql")
})
