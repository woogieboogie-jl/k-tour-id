// Offline, allowlisted evidence export. No service/config/store runtime imports:
// importing this module cannot load credentials, connect, sign or mutate a ledger.
import { digestOf, sha256Hex } from "./util"
import { verifyOmnioneReceiptEvidence } from "./omnione-evidence"
import { sameOmnioneTarget, storedOmnioneTarget } from "./omnione-targets"

export const SUBMISSION_INPUT_SCHEMA = "ktour-submission-input/v1"
export const SUBMISSION_SCHEMA = "ktour-submission-evidence/v1"
export const SUBMISSION_MAX_BYTES = 1024 * 1024
const ACTION = "redeem_demo_entitlement"
const KNOWN_FRONTEND_SHA = "7127f19fbe608b914870b08bbbadfe1f5a06974b"
const KNOWN_FRONTEND_DEPLOYMENT = "dpl_4fqExVqqrx27YP8j2LmnCUp4henK"
type Row = Record<string, unknown>
const row = (value: unknown): Row => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {}
const str = (value: unknown): value is string => typeof value === "string"
const hex32 = (value: unknown): value is string => str(value) && /^0x[0-9a-f]{64}$/i.test(value) && !/^0x0+$/i.test(value)
const evmAddress = (value: unknown): value is string => str(value) && /^0x[0-9a-f]{40}$/i.test(value) && !/^0x0+$/i.test(value)
const tx = (value: unknown): value is string => {
  if (!str(value) || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return false
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
  let number = 0n
  for (const char of value) number = number * 58n + BigInt(alphabet.indexOf(char))
  return number > 0n && Math.ceil(number.toString(16).length / 2) + (value.match(/^1*/)?.[0].length ?? 0) === 32
}
const sha = (value: unknown): value is string => str(value) && /^[0-9a-f]{40}$/.test(value) && !/^0+$/.test(value)
const deployment = (value: unknown): value is string => str(value) && /^dpl_[A-Za-z0-9]{12,64}$/.test(value)
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0
const identifier = (value: unknown): value is string => str(value) && /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value)
const oneOf = (value: unknown, allowed: readonly string[]) => str(value) && allowed.includes(value)
const iso = (value: unknown): value is string => {
  if (!str(value) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false
  const n = Date.parse(value)
  return Number.isFinite(n) && new Date(n).toISOString() === value
}
const time = (value: unknown) => iso(value) ? Date.parse(value) : NaN
const pick = (value: Row, keys: string[]) => Object.fromEntries(keys.map(key => [key, value[key]]))
const equal = (left: unknown, right: unknown) => digestOf(left ?? null) === digestOf(right ?? null)
const safe = <T>(value: unknown, predicate: (v: unknown) => v is T): T | null => predicate(value) ? value : null
const publicRef = (value: unknown) => identifier(value) ? sha256Hex(value) : null

/** JSON-shaped, bounded input only. Reject prototype keys/accessors before any
 * digest helper visits them. Unknown ordinary fields are ignored, not copied. */
function boundedInput(value: unknown) {
  let nodes = 0, textBytes = 0
  const seen = new Set<object>()
  function visit(v: unknown, depth: number): void {
    if (++nodes > 20000 || depth > 24) throw new Error("submission_input_invalid")
    if (str(v)) { textBytes += Buffer.byteLength(v); if (textBytes > SUBMISSION_MAX_BYTES) throw new Error("submission_input_invalid"); return }
    if (v === null || typeof v === "boolean" || typeof v === "number" && Number.isFinite(v)) return
    if (!v || typeof v !== "object" || seen.has(v)) throw new Error("submission_input_invalid")
    const proto = Object.getPrototypeOf(v)
    if (proto !== Object.prototype && proto !== null && !Array.isArray(v)) throw new Error("submission_input_invalid")
    seen.add(v)
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(v))) {
      if (key === "__proto__" || key === "constructor" || key === "prototype" || !Object.hasOwn(descriptor, "value")) throw new Error("submission_input_invalid")
      textBytes += Buffer.byteLength(key)
      visit(descriptor.value, depth + 1)
    }
    seen.delete(v)
  }
  visit(value, 0)
  if (Buffer.byteLength(JSON.stringify(value)) > SUBMISSION_MAX_BYTES) throw new Error("submission_input_invalid")
}

const REJECTIONS = ["not_object", "action_not_allowed", "target_mismatch", "text_invalid", "guard_tripped", "provenance_missing"]
function aiModel(mode: unknown, value: unknown) {
  if (mode === "gemini" && str(value) && /^(?:gemini-\d[a-z0-9.-]{0,79}|gemini-flash-latest)$/.test(value)) return { actualModel: value, origin: "provider" as const, fallback: null }
  if (mode !== "rule") return null
  if (value === "rule-v1") return { actualModel: null, origin: "rule" as const, fallback: "configured_or_unavailable" }
  if (value === "rule-v1 (gemini unavailable)") return { actualModel: null, origin: "rule" as const, fallback: "provider_unavailable" }
  for (const reason of REJECTIONS) if (value === `rule-v1 (gemini rejected: ${reason})`) return { actualModel: null, origin: "rule" as const, fallback: `provider_rejected_${reason}` }
  return null
}
function backendProjection(value: unknown) {
  const b = row(value)
  return { role: b.role === "protected-backend" ? b.role : null,
    environment: b.environment === "local" || b.environment === "preview" ? b.environment : null,
    sourceSha: safe(b.sourceSha, sha), deploymentId: safe(b.deploymentId, deployment) }
}

/** The input is an operator-supplied snapshot, NOT an authenticated RPC response.
 * `complete` means structurally consistent export, never live authentication. */
export function buildSubmissionEvidence(input: unknown, now = Date.now()) {
  boundedInput(input)
  if (!Number.isSafeInteger(now) || !Number.isFinite(new Date(now).getTime())) throw new Error("submission_input_invalid")
  const root = row(input), o = row(root.operation), e = row(root.serviceEvidence), ob = row(root.outbox)
  const provenance = row(root.provenance), capture = row(provenance.capture), expected = row(root.expectedContext)
  const expectedSui = row(expected.sui), expectedOmni = row(expected.omnione), approval = row(root.approval)
  const consent = row(o.consent), identity = row(o.identity), credential = row(o.credential), presentation = row(o.presentation)
  const proposal = row(o.proposal), output = row(proposal.output), guard = row(proposal.guard)
  const delegation = row(o.delegation), entitlement = row(delegation.entitlement), grant = row(delegation.grant)
  const agent = row(o.agent), verified = row(agent.verified), manifest = row(agent.manifest)
  const fulfillment = row(o.fulfillment), chain = row(o.chain), payload = row(ob.payload)
  const serviceSui = row(e.sui), serviceOmni = row(e.omnione)
  const checks: Array<{ code: string; ok: boolean }> = []
  const check = (code: string, ok: unknown) => { checks.push({ code, ok: Boolean(ok) }); return Boolean(ok) }
  const matches = (actual: unknown, reference: Row) => equal(pick(row(actual), Object.keys(reference)), reference)

  check("input_schema", root.schema === SUBMISSION_INPUT_SCHEMA)
  check("operation_identity", str(o.operationId) && /^op_[A-Za-z0-9_-]{8,64}$/.test(o.operationId) && o.kind === "demo_entitlement" && integer(o.revision))
  check("operation_completed", o.status === "succeeded" && o.phase === "done" && o.error === null)
  check("operation_context", identifier(o.campaignId) && identifier(o.venueId) && integer(o.policyVersion) &&
    o.campaignId === expected.campaignId && o.venueId === expected.venueId && o.policyVersion === expected.policyVersion)
  check("capture_binding", capture.operationId === o.operationId && capture.operationRevision === o.revision &&
    e.operationId === o.operationId && e.status === o.status && e.phase === o.phase)
  check("capture_time", iso(capture.capturedAt) && time(capture.capturedAt) <= now && iso(o.createdAt) && iso(o.updatedAt) && iso(o.expiresAt) &&
    time(o.createdAt) <= time(o.updatedAt) && time(o.updatedAt) <= time(capture.capturedAt))
  const backend = backendProjection(capture.backend), expectedBackend = backendProjection(provenance.expectedBackend)
  check("backend_provenance", backend.role && backend.environment && backend.sourceSha &&
    (backend.environment === "local" ? row(capture.backend).deploymentId === null : backend.deploymentId) && equal(backend, expectedBackend) &&
    backend.sourceSha !== KNOWN_FRONTEND_SHA && backend.deploymentId !== KNOWN_FRONTEND_DEPLOYMENT)
  const frontendInput = row(provenance.frontend)
  const frontend = provenance.frontend === undefined ? null : { role: "public-frontend" as const, sourceSha: safe(frontendInput.sourceSha, sha), deploymentId: safe(frontendInput.deploymentId, deployment) }
  check("frontend_provenance", !frontend || frontendInput.role === "public-frontend" && frontend.sourceSha && frontend.deploymentId &&
    frontend.sourceSha !== backend.sourceSha && frontend.deploymentId !== backend.deploymentId)

  check("consent_binding", identifier(consent.version) && consent.version === expected.consentVersion && hex32(consent.digest) && iso(consent.acceptedAt) &&
    time(consent.acceptedAt) >= time(o.createdAt) && consent.digest === digestOf({ version: consent.version, campaignId: o.campaignId, venueId: o.venueId, purpose: ACTION, policyVersion: o.policyVersion }))
  check("identity_verified", oneOf(identity.mode, ["mock", "cx"]) && identifier(identity.evidenceId) && identifier(identity.provider) && identity.personVerified === true && iso(identity.verifiedAt) &&
    time(identity.verifiedAt) >= time(consent.acceptedAt) && time(identity.expiresAt) > time(fulfillment.redeemedAt))
  check("identity_service_binding", matches(e.identity, pick(identity, ["mode", "provider", "evidenceId", "verifiedAt"])))
  check("credential_acknowledged", oneOf(credential.mode, ["mock", "opendid"]) && identifier(credential.credentialRef) && credential.schema === "KPassHackathonCredential/v1" &&
    str(credential.vcId) && credential.vcId.length > 0 && str(credential.issuerDid) && credential.issuerDid.startsWith("did:") && credential.status === "active" && iso(credential.holderAckAt) && hex32(credential.holderBinding) &&
    time(credential.validFrom) >= time(identity.verifiedAt) && time(credential.holderAckAt) >= time(credential.validFrom) && time(credential.validUntil) > time(fulfillment.redeemedAt))
  // Existing credentialEligibility rejects provider OpenDID: summary metadata
  // alone cannot turn its still-unimplemented verification path into evidence.
  check("credential_supported_verifier", credential.mode === "mock")
  check("credential_service_binding", matches(e.credential, pick(credential, ["mode", "schema", "vcId", "issuerDid", "holderBinding", "status", "validUntil", "holderAckAt"])))
  check("presentation_allowed", presentation.decision === "allow" && identifier(presentation.presentationId) && identifier(presentation.decisionRef) && hex32(presentation.requestDigest) &&
    time(presentation.verifiedAt) >= time(credential.holderAckAt) && iso(presentation.decisionConsumedAt) &&
    time(presentation.decisionConsumedAt) >= time(verified.checkedAt) && time(presentation.decisionConsumedAt) <= time(fulfillment.redeemedAt) &&
    time(presentation.decisionExpiresAt) > time(manifest.decidedAt))
  check("presentation_service_binding", matches(e.presentation, pick(presentation, ["presentationId", "requestDigest", "decision", "verifiedAt", "decisionConsumedAt"])))

  const model = aiModel(proposal.mode, proposal.model)
  check("proposal_model", model && (model.origin === "rule" || guard.schemaValid === true && guard.injectionSuspected === false))
  check("proposal_target", output.action === ACTION && matches(output.target, { venueId: o.venueId, campaignId: o.campaignId }) && proposal.policyVersion === o.policyVersion &&
    identifier(proposal.proposalId) && identifier(proposal.promptVersion) && hex32(proposal.inputDigest) && iso(proposal.createdAt) && time(proposal.createdAt) >= time(presentation.verifiedAt))
  check("proposal_digests", hex32(proposal.outputDigest) && hex32(proposal.proposalDigest) && proposal.outputDigest === digestOf(output) &&
    proposal.proposalDigest === digestOf(pick(proposal, ["proposalId", "inputDigest", "outputDigest", "promptVersion", "policyVersion", "model"])))
  check("proposal_service_binding", matches(e.proposal, pick(proposal, ["mode", "model", "promptVersion", "inputDigest", "outputDigest", "proposalDigest", "guard"])))
  check("approval_record", approval.operationId === o.operationId && approval.proposalDigest === proposal.proposalDigest && approval.consentDigest === consent.digest &&
    approval.userTxDigest === delegation.userTxDigest && iso(approval.approvedAt) && time(approval.approvedAt) >= time(proposal.createdAt) && time(approval.approvedAt) <= time(manifest.decidedAt))
  check("delegation_scope", delegation.status === "delegated" && delegation.error === null && hex32(delegation.userAddress) && delegation.recipient === delegation.userAddress &&
    oneOf(delegation.signer, ["demo", "zklogin"]) && hex32(delegation.intentRef) && integer(delegation.expiresAtMs) &&
    Number(delegation.expiresAtMs) > time(manifest.decidedAt) && Number(delegation.expiresAtMs) <= time(presentation.decisionExpiresAt) &&
    Number(delegation.expiresAtMs) <= time(credential.validUntil) && Number(delegation.expiresAtMs) <= time(o.expiresAt))
  check("approval_commitments", hex32(delegation.actionCommitment) && hex32(delegation.consentCommitment) &&
    delegation.actionCommitment === digestOf({ action: output.action, target: output.target, proposalDigest: proposal.proposalDigest, decisionRef: presentation.decisionRef, policyVersion: o.policyVersion }) &&
    delegation.consentCommitment === digestOf({ consentDigest: consent.digest, proposalDigest: proposal.proposalDigest, userAddress: delegation.userAddress, recipient: delegation.recipient, expiresAtMs: delegation.expiresAtMs, maxUses: 1 }))
  check("sui_context", oneOf(expectedSui.network, ["testnet", "devnet", "localnet"]) && hex32(expectedSui.packageId) && hex32(expectedSui.campaignId) && hex32(expectedSui.agentAddress) &&
    matches(serviceSui, { network: expectedSui.network, packageId: expectedSui.packageId, campaignId: expectedSui.campaignId, signer: delegation.signer,
      intentRef: delegation.intentRef, actionCommitment: delegation.actionCommitment, consentCommitment: delegation.consentCommitment }))
  check("sui_issue_record", hex32(entitlement.objectId) && tx(entitlement.txDigest) && str(entitlement.version) && /^[1-9]\d{0,19}$/.test(entitlement.version) && tx(entitlement.digest) &&
    matches(serviceSui.entitlement, { objectId: entitlement.objectId, issueTx: entitlement.txDigest }))
  check("sui_delegation_record", hex32(grant.objectId) && tx(grant.txDigest) && tx(delegation.userTxDigest) && hex32(delegation.txBytesDigest) &&
    grant.txDigest === delegation.userTxDigest && str(grant.initialSharedVersion) && /^[1-9]\d{0,19}$/.test(grant.initialSharedVersion) &&
    matches(serviceSui.grant, { objectId: grant.objectId, tx: grant.txDigest }))
  const expectedManifest = { schema: "ondo-agent-manifest/v1", operationRef: str(o.operationId) ? sha256Hex(o.operationId) : null,
    campaignId: o.campaignId, venueId: o.venueId, policyVersion: o.policyVersion,
    proposal: pick(proposal, ["proposalId", "model", "promptVersion", "inputDigest", "outputDigest", "proposalDigest"]),
    consentCommitment: delegation.consentCommitment, actionCommitment: delegation.actionCommitment, intentRef: delegation.intentRef,
    grant: grant.objectId, agent: expectedSui.agentAddress, tool: ACTION, decidedAt: manifest.decidedAt }
  check("agent_manifest", iso(manifest.decidedAt) && hex32(agent.manifestCommitment) && equal(manifest, expectedManifest) &&
    agent.manifestCommitment === digestOf(manifest) && agent.decisionCommitment === digestOf({ action: output.action, target: output.target, grant: grant.objectId, actionCommitment: delegation.actionCommitment }))
  check("agent_service_verified", agent.status === "executed" && agent.error === null && tx(agent.txDigest) && hex32(agent.recordId) && verified.effectsOk === true && verified.eventOk === true && verified.grantUses === 1 &&
    iso(verified.checkedAt) && time(verified.checkedAt) >= time(manifest.decidedAt) && time(verified.checkedAt) <= time(capture.capturedAt) &&
    new Set([entitlement.txDigest, grant.txDigest, agent.txDigest]).size === 3)
  check("agent_service_binding", matches(serviceSui.agent, { status: agent.status, tx: agent.txDigest, recordId: agent.recordId, decisionCommitment: agent.decisionCommitment,
    manifestCommitment: agent.manifestCommitment, manifest: agent.manifest, verified: agent.verified }) &&
    matches(e.provenanceCheck, { matches: true, recomputedManifestCommitment: agent.manifestCommitment, storedManifestCommitment: agent.manifestCommitment }))
  check("fulfillment_redeemed", fulfillment.status === "redeemed" && fulfillment.reason === null && identifier(fulfillment.redemptionRef) && iso(fulfillment.redeemedAt) &&
    time(fulfillment.redeemedAt) >= time(verified.checkedAt) && time(fulfillment.redeemedAt) <= time(o.updatedAt) && time(fulfillment.redeemedAt) < time(o.expiresAt) &&
    equal(fulfillment.recheck, { credential: "active", presentation: "allow", sui: "verified", campaign: "open" }))
  check("fulfillment_service_binding", matches(e.fulfillment, pick(fulfillment, ["status", "redemptionRef", "redeemedAt", "recheck"])))

  check("outbox_binding", identifier(ob.outboxId) && ob.operationId === o.operationId && matches(chain, pick(ob, ["outboxId", "eventKey", "payloadCommitment", "status", "txHash", "blockNumber", "confirmedAt"])) &&
    ob.status === "confirmed" && ob.lastError === null && ob.receiptEvidenceVersion === 1 && hex32(ob.eventKey) && hex32(ob.payloadCommitment) && hex32(ob.txHash) && integer(ob.blockNumber) &&
    iso(ob.confirmedAt) && time(ob.createdAt) >= time(fulfillment.redeemedAt) && time(ob.createdAt) <= time(ob.confirmedAt) &&
    time(ob.confirmedAt) <= time(ob.updatedAt) && time(ob.updatedAt) <= time(capture.capturedAt))
  check("outbox_payload", equal(Object.keys(payload).sort(), ["kind", "schemaVersion", "campaignRef", "policyVersion", "salt", "suiDigestCommitment", "manifestCommitment"].sort()) &&
    payload.kind === "DemoEntitlementRedeemed" && payload.schemaVersion === "KPassHackathonCredential/v1" && payload.campaignRef === o.campaignId &&
    payload.policyVersion === o.policyVersion && hex32(payload.salt) && payload.suiDigestCommitment === (str(agent.txDigest) ? sha256Hex(agent.txDigest) : null) &&
    payload.manifestCommitment === agent.manifestCommitment && ob.payloadCommitment === digestOf(payload))
  let pinnedOmnione = false
  try {
    const target = storedOmnioneTarget(ob.target)
    pinnedOmnione = sameOmnioneTarget(chain.target, target) && (o.omnioneTarget === undefined || sameOmnioneTarget(o.omnioneTarget, target)) &&
      expectedOmni.chainId === target.chainId && expectedOmni.registry === target.registry && expectedOmni.recorder === target.recorder
  } catch { /* Invalid/unregistered targets cannot produce a complete evidence export. */ }
  check("omnione_service_binding", pinnedOmnione &&
    matches(serviceOmni, { chainId: expectedOmni.chainId, registry: expectedOmni.registry, ...pick(ob, ["eventKey", "payloadCommitment", "status", "txHash", "blockNumber", "confirmedAt"]) }))
  let suppliedReceiptChecked = false
  if (root.omnioneReceipt !== undefined) {
    try {
      const supplied = row(root.omnioneReceipt), entry = row(supplied.entry)
      if (!str(entry.recordedAt) || !/^[1-9]\d{0,19}$/.test(entry.recordedAt)) throw new Error("invalid")
      const result = verifyOmnioneReceiptEvidence(supplied.receipt,
        { exists: entry.exists === true, payloadCommitment: String(entry.payloadCommitment), recordedAt: BigInt(entry.recordedAt), recorder: String(entry.recorder) }, supplied.authorizedRecorder === true,
        { txHash: String(ob.txHash), eventKey: String(ob.eventKey), payloadCommitment: String(ob.payloadCommitment), registry: String(expectedOmni.registry), recorder: String(expectedOmni.recorder), chainId: Number(expectedOmni.chainId) })
      suppliedReceiptChecked = result.blockNumber === ob.blockNumber && supplied.chainId === expectedOmni.chainId
    } catch { /* Never include SDK/parser errors or supplied RPC payloads. */ }
    check("supplied_omnione_receipt", suppliedReceiptChecked)
  }

  const sources = row(provenance.executionSources), stages = ["identity", "credential", "ai", "sui", "omnione"] as const
  const safeSources = Object.fromEntries(stages.map(stage => [stage, sources[stage] === "fixture" || sources[stage] === "provider" || stage === "ai" && sources[stage] === "rule" ? sources[stage] : null]))
  check("execution_sources", stages.every(stage => safeSources[stage]) && oneOf(provenance.producer, ["fixture", "mixed", "live"]))
  check("execution_modes", oneOf(o.execution, ["sample", "provider"]) &&
    (identity.mode !== "mock" || sources.identity === "fixture") && (credential.mode !== "mock" || sources.credential === "fixture") &&
    (proposal.mode !== "rule" || sources.ai !== "provider") && (proposal.mode !== "gemini" || sources.ai !== "rule") &&
    matches(row(e.boundaries).mock, { cx: identity.mode === "mock", opendid: credential.mode === "mock" }))
  const allFixture = stages.every(stage => safeSources[stage] === "fixture" || stage === "ai" && safeSources[stage] === "rule")
  const allProvider = stages.every(stage => safeSources[stage] === "provider") && identity.mode === "cx" && credential.mode === "opendid" && proposal.mode === "gemini" && o.execution === "provider"
  check("producer_taint", provenance.producer !== "live" || allProvider)
  // A fixture producer can never be upgraded by provider-looking fields.
  const level = provenance.producer === "fixture" || allFixture ? "fixture" : allProvider && provenance.producer === "live" ? "live" : "mixed"
  const failedChecks = checks.filter(result => !result.ok).map(result => result.code)
  const bundle = {
    schema: SUBMISSION_SCHEMA, complete: failedChecks.length === 0,
    suppliedExecutionLevel: level,
    verification: { scope: "offline_snapshot_consistency", remoteVerificationPerformed: false, attestation: "none",
      liveExecutionCertified: false, sourceAuthenticityVerified: false, suppliedOmnioneReceiptChecked: suppliedReceiptChecked },
    generatedAt: new Date(now).toISOString(), capturedAt: safe(capture.capturedAt, iso),
    provenance: { backend, frontend, executionSources: safeSources, producer: oneOf(provenance.producer, ["fixture", "mixed", "live"]) ? provenance.producer : null },
    operation: { operationRef: publicRef(o.operationId), revision: safe(o.revision, integer), venueRef: publicRef(o.venueId), campaignRef: publicRef(o.campaignId),
      policyVersion: safe(o.policyVersion, integer), completed: o.status === "succeeded" && o.phase === "done" },
    consent: { versionRef: publicRef(consent.version), digest: safe(consent.digest, hex32), acceptedAt: safe(consent.acceptedAt, iso) },
    identity: { mode: identity.mode === "mock" || identity.mode === "cx" ? identity.mode : null, personVerified: identity.personVerified === true,
      adultVerified: identity.adultVerified === true ? true : identity.adultVerified === false ? false : null, verifiedAt: safe(identity.verifiedAt, iso) },
    credential: { mode: credential.mode === "mock" || credential.mode === "opendid" ? credential.mode : null, acknowledgedAt: safe(credential.holderAckAt, iso) },
    presentation: { requestDigest: safe(presentation.requestDigest, hex32), allowed: presentation.decision === "allow", verifiedAt: safe(presentation.verifiedAt, iso), consumedAt: safe(presentation.decisionConsumedAt, iso) },
    proposal: { origin: model?.origin ?? null, actualModel: model?.actualModel ?? null, ruleFallback: model?.fallback ?? null,
      proposalRef: publicRef(proposal.proposalId), promptVersionRef: publicRef(proposal.promptVersion), inputDigest: safe(proposal.inputDigest, hex32), outputDigest: safe(proposal.outputDigest, hex32), proposalDigest: safe(proposal.proposalDigest, hex32) },
    approval: { suppliedApprovedAt: safe(approval.approvedAt, iso), actionCommitment: safe(delegation.actionCommitment, hex32), consentCommitment: safe(delegation.consentCommitment, hex32), maxUses: 1 },
    sui: { network: oneOf(expectedSui.network, ["testnet", "devnet", "localnet"]) ? expectedSui.network : null,
      packageId: safe(expectedSui.packageId, hex32), campaignId: safe(expectedSui.campaignId, hex32), signer: delegation.signer === "demo" || delegation.signer === "zklogin" ? delegation.signer : null,
      issue: { objectId: safe(entitlement.objectId, hex32), txDigest: safe(entitlement.txDigest, tx), basis: "service_stored_record" },
      delegation: { grantId: safe(grant.objectId, hex32), txDigest: safe(grant.txDigest, tx), basis: "service_stored_record" },
      agent: { txDigest: safe(agent.txDigest, tx), recordId: safe(agent.recordId, hex32), decisionCommitment: safe(agent.decisionCommitment, hex32), manifestCommitment: safe(agent.manifestCommitment, hex32),
        serviceReportedVerified: verified.effectsOk === true && verified.eventOk === true && verified.grantUses === 1, checkedAt: safe(verified.checkedAt, iso), basis: "supplied_service_verification_flags" } },
    fulfillment: { redeemed: fulfillment.status === "redeemed", redemptionRef: publicRef(fulfillment.redemptionRef), redeemedAt: safe(fulfillment.redeemedAt, iso) },
    omnione: { chainId: safe(expectedOmni.chainId, integer), registry: safe(expectedOmni.registry, evmAddress), recorder: safe(expectedOmni.recorder, evmAddress),
      eventKey: safe(ob.eventKey, hex32), payloadCommitment: safe(ob.payloadCommitment, hex32), txHash: safe(ob.txHash, hex32), blockNumber: safe(ob.blockNumber, integer),
      confirmedAt: safe(ob.confirmedAt, iso), serviceReportedReceiptEvidenceVersion: ob.receiptEvidenceVersion === 1 ? 1 : null,
      basis: "supplied_service_receipt_marker" },
    checks, failedChecks,
    boundaries: ["Local JSON is not an authenticated chain or provider source.", "Completeness is structural; no signatures or current RPC state are verified by this export.",
      "Sui consume is not benefit redemption. The service ledger records redemption; OmniOne is its audit anchor.",
      "No identity payload, subject reference, VC, JWT, passport, prompt/output text, key, token, RPC URL, raw receipt or provider error is exported."],
  }
  return { ...bundle, bundleDigest: digestOf(bundle) }
}
