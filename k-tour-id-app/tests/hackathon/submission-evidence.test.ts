import assert from "node:assert/strict"
import test from "node:test"
import { mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { toBase58 } from "@mysten/sui/utils"
import { buildSubmissionEvidence, SUBMISSION_INPUT_SCHEMA, SUBMISSION_MAX_BYTES } from "../../lib/hackathon/submission-evidence"
import { OMNIONE_STAGE, omnioneReadAbi } from "../../lib/hackathon/omnione-evidence"
import { digestOf, sha256Hex } from "../../lib/hackathon/util"
import { cleanupSubmissionPartial, runSubmissionEvidence, submissionEvidenceArguments } from "../../scripts/hackathon-submission-evidence"
import type { OperationRecord } from "../../lib/hackathon/store"

const at = (second: number) => `2026-09-27T01:00:${String(second).padStart(2, "0")}.000Z`
const NOW = Date.parse(at(30)), h = (n: number) => "0x" + n.toString(16).padStart(2, "0").repeat(32)
const suiTx = (n: number) => toBase58(new Uint8Array(32).fill(n))
const PRIVATE = "PRIVATE_SENTINEL_PASSPORT_CI_PROVIDER_TOKEN"
const backend = { role: "protected-backend", environment: "preview", sourceSha: "a".repeat(40), deploymentId: "dpl_BackendFixture123456789" }

function fixture() {
  const operation = {
    operationId: "op_fixture_12345678", kind: "demo_entitlement", sessionId: PRIVATE,
    venueId: "fixture-venue", campaignId: "fixture-campaign", policyVersion: 1,
    revision: 20, status: "succeeded", phase: "done", execution: "sample", createdAt: at(0), updatedAt: at(11), expiresAt: at(25), error: null,
    secrets: { cxToken: PRIVATE, vcDocument: { credentialSubject: { passport: PRIVATE, ci: PRIVATE } }, sponsorSignature: PRIVATE },
    audit: [{ at: at(1), event: "identity.verified", detail: { raw: PRIVATE } }],
    consent: { version: "hk-consent-2026-09-14", digest: "", acceptedAt: at(0) },
    identity: { mode: "mock", provider: "comdl", evidenceId: "evd_fixture", subjectRef: PRIVATE, personVerified: true, adultVerified: null, verifiedAt: at(1), expiresAt: at(25), handoff: null },
    credential: { mode: "mock", credentialRef: "cred_fixture", vcId: "urn:vc:fixture", issuerDid: "did:omn:fixture", schema: "KPassHackathonCredential/v1", holderBinding: h(1), status: "active", validFrom: at(2), validUntil: at(25), holderAckAt: at(3) },
    presentation: { presentationId: "vp_fixture", requestDigest: h(2), decision: "allow", decisionRef: "decision_fixture", verifiedAt: at(4), decisionExpiresAt: at(24), decisionConsumedAt: at(10), nonce: PRIVATE },
    proposal: { proposalId: "prop_fixture", mode: "gemini", model: "gemini-2.5-flash", promptVersion: "perk-proposal-v1", policyVersion: 1, inputDigest: h(3),
      output: { action: "redeem_demo_entitlement", target: { venueId: "fixture-venue", campaignId: "fixture-campaign" }, title: "Fixture title", summary: "Fixture summary", rationale: "Fixture rationale", language: "en" },
      outputDigest: "", proposalDigest: "", createdAt: at(5), guard: { schemaValid: true, injectionSuspected: false } },
    delegation: { status: "delegated", intentRef: h(4), actionCommitment: "", consentCommitment: "", userAddress: h(5), recipient: h(5), signer: "demo", expiresAtMs: Date.parse(at(23)),
      entitlement: { objectId: h(6), version: "1", digest: suiTx(1), txDigest: suiTx(2) },
      grant: { objectId: h(7), initialSharedVersion: "1", txDigest: suiTx(3) }, txBytesDigest: h(8), userTxDigest: suiTx(3), error: null },
    agent: { status: "executed", decisionCommitment: "", manifestCommitment: "", manifest: {} as Record<string, unknown>, txDigest: suiTx(4), recordId: h(9), verified: { effectsOk: true, eventOk: true, grantUses: 1, checkedAt: at(9) }, error: null },
    fulfillment: { status: "redeemed", redemptionRef: "rdm_fixture", redeemedAt: at(10), reason: null, recheck: { credential: "active", presentation: "allow", sui: "verified", campaign: "open" } },
    chain: {} as Record<string, unknown>,
  }
  const input = {
    schema: SUBMISSION_INPUT_SCHEMA, operation,
    expectedContext: { venueId: operation.venueId, campaignId: operation.campaignId, policyVersion: 1, consentVersion: operation.consent.version,
      sui: { network: "testnet", packageId: h(10), campaignId: h(11), agentAddress: h(12) },
      omnione: { chainId: Number(OMNIONE_STAGE.chainId), registry: OMNIONE_STAGE.registry, recorder: OMNIONE_STAGE.recorder } },
    provenance: { producer: "fixture", executionSources: { identity: "fixture", credential: "fixture", ai: "fixture", sui: "fixture", omnione: "fixture" },
      expectedBackend: { ...backend }, capture: { operationId: operation.operationId, operationRevision: operation.revision, capturedAt: at(12), backend: { ...backend } },
      frontend: { role: "public-frontend", sourceSha: "7127f19fbe608b914870b08bbbadfe1f5a06974b", deploymentId: "dpl_4fqExVqqrx27YP8j2LmnCUp4henK" } },
    approval: { operationId: operation.operationId, proposalDigest: "", consentDigest: "", userTxDigest: suiTx(3), approvedAt: at(6) },
    outbox: { outboxId: "obx_fixture", operationId: operation.operationId, status: "confirmed", receiptEvidenceVersion: 1,
      eventKey: h(13), payloadCommitment: "", txHash: h(14), blockNumber: 400, createdAt: at(10), updatedAt: at(11), confirmedAt: at(11), lastError: null,
      payload: {} as Record<string, unknown> },
    serviceEvidence: {} as Record<string, unknown>,
  }
  rebind(input)
  return input
}
type Input = ReturnType<typeof fixture>
function serviceProjection(input: Input) {
  const o = input.operation, d = o.delegation, a = o.agent, i = o.identity, c = o.credential, p = o.proposal
  return { operationId: o.operationId, status: o.status, phase: o.phase,
    identity: { mode: i.mode, provider: i.provider, evidenceId: i.evidenceId, verifiedAt: i.verifiedAt },
    credential: { mode: c.mode, schema: c.schema, vcId: c.vcId, issuerDid: c.issuerDid, holderBinding: c.holderBinding, status: c.status, validUntil: c.validUntil, holderAckAt: c.holderAckAt },
    presentation: { ...o.presentation }, proposal: { ...p },
    sui: { network: input.expectedContext.sui.network, packageId: input.expectedContext.sui.packageId, campaignId: input.expectedContext.sui.campaignId,
      signer: d.signer, intentRef: d.intentRef, actionCommitment: d.actionCommitment, consentCommitment: d.consentCommitment,
      entitlement: { objectId: d.entitlement.objectId, issueTx: d.entitlement.txDigest }, grant: { objectId: d.grant.objectId, tx: d.grant.txDigest },
      agent: { status: a.status, tx: a.txDigest, recordId: a.recordId, decisionCommitment: a.decisionCommitment, manifestCommitment: a.manifestCommitment, manifest: a.manifest, verified: a.verified } },
    fulfillment: o.fulfillment,
    omnione: { chainId: input.expectedContext.omnione.chainId, registry: input.expectedContext.omnione.registry, ...o.chain },
    provenanceCheck: { matches: true, recomputedManifestCommitment: a.manifestCommitment, storedManifestCommitment: a.manifestCommitment },
    boundaries: { mock: { cx: i.mode === "mock", opendid: c.mode === "mock" } } }
}
function rebind(input: Input) {
  const o = input.operation, d = o.delegation, p = o.proposal, a = o.agent
  o.consent.digest = digestOf({ version: o.consent.version, campaignId: o.campaignId, venueId: o.venueId, purpose: "redeem_demo_entitlement", policyVersion: o.policyVersion })
  p.outputDigest = digestOf(p.output)
  p.proposalDigest = digestOf({ proposalId: p.proposalId, inputDigest: p.inputDigest, outputDigest: p.outputDigest, promptVersion: p.promptVersion, policyVersion: p.policyVersion, model: p.model })
  d.actionCommitment = digestOf({ action: p.output.action, target: p.output.target, proposalDigest: p.proposalDigest, decisionRef: o.presentation.decisionRef, policyVersion: o.policyVersion })
  d.consentCommitment = digestOf({ consentDigest: o.consent.digest, proposalDigest: p.proposalDigest, userAddress: d.userAddress, recipient: d.recipient, expiresAtMs: d.expiresAtMs, maxUses: 1 })
  a.manifest = { schema: "ondo-agent-manifest/v1", operationRef: sha256Hex(o.operationId), campaignId: o.campaignId, venueId: o.venueId, policyVersion: o.policyVersion,
    proposal: { proposalId: p.proposalId, model: p.model, promptVersion: p.promptVersion, inputDigest: p.inputDigest, outputDigest: p.outputDigest, proposalDigest: p.proposalDigest },
    consentCommitment: d.consentCommitment, actionCommitment: d.actionCommitment, intentRef: d.intentRef, grant: d.grant.objectId, agent: input.expectedContext.sui.agentAddress, tool: "redeem_demo_entitlement", decidedAt: at(8) }
  a.manifestCommitment = digestOf(a.manifest)
  a.decisionCommitment = digestOf({ action: p.output.action, target: p.output.target, grant: d.grant.objectId, actionCommitment: d.actionCommitment })
  input.approval.proposalDigest = p.proposalDigest; input.approval.consentDigest = o.consent.digest
  input.outbox.payload = { kind: "DemoEntitlementRedeemed", schemaVersion: "KPassHackathonCredential/v1", campaignRef: o.campaignId, policyVersion: o.policyVersion, salt: h(15), suiDigestCommitment: sha256Hex(a.txDigest), manifestCommitment: a.manifestCommitment }
  input.outbox.payloadCommitment = digestOf(input.outbox.payload)
  o.chain = Object.fromEntries(["outboxId", "eventKey", "payloadCommitment", "status", "txHash", "blockNumber", "confirmedAt"].map(k => [k, (input.outbox as Record<string, unknown>)[k]]))
  input.serviceEvidence = serviceProjection(input)
}
function complete(input = fixture()) {
  const result = buildSubmissionEvidence(input, NOW)
  assert.equal(result.complete, true, result.failedChecks.join(","))
  return result
}
function rejected(change: (input: Input) => void, code: string) {
  const input = fixture(); change(input)
  const result = buildSubmissionEvidence(input, NOW)
  assert.equal(result.complete, false)
  assert.ok(result.failedChecks.includes(code), result.failedChecks.join(","))
  assert.equal(result.verification.remoteVerificationPerformed, false)
}

test("complete fixture is deterministic, non-mutating and never a live certificate", () => {
  const input = fixture(), before = structuredClone(input), result = complete(input)
  assert.equal(result.suppliedExecutionLevel, "fixture")
  assert.equal(result.verification.attestation, "none")
  assert.equal(result.verification.liveExecutionCertified, false)
  assert.equal(result.verification.sourceAuthenticityVerified, false)
  assert.deepEqual(buildSubmissionEvidence(input, NOW), result)
  assert.deepEqual(input, before)
  const { bundleDigest, ...body } = result
  assert.equal(bundleDigest, digestOf(body))
  assert.notEqual(complete({ ...input, provenance: { ...input.provenance, capture: { ...input.provenance.capture, capturedAt: at(13) } } }).bundleDigest, bundleDigest)
})

test("actual service.evidence JSON with explicit fixture configuration needs no provider or store call", async () => {
  const input = fixture(), saved = process.env, savedFetch = globalThis.fetch
  process.env = { NODE_ENV: "test", HK_MODE_CX: "mock", HK_MODE_OPENDID: "mock", HK_SUI_NETWORK: "testnet", HK_SUI_PACKAGE_ID: input.expectedContext.sui.packageId,
    HK_SUI_CAMPAIGN_ID: input.expectedContext.sui.campaignId, HK_OMNIONE_CHAIN_ID: String(OMNIONE_STAGE.chainId), HK_OMNIONE_REGISTRY_ADDRESS: OMNIONE_STAGE.registry }
  globalThis.fetch = async () => { assert.fail("export must not call a provider") }
  try {
    const { evidence } = await import("../../lib/hackathon/service")
    input.serviceEvidence = JSON.parse(JSON.stringify(evidence(input.operation as unknown as OperationRecord)))
    complete(input)
  } finally { process.env = saved; globalThis.fetch = savedFetch }
})

test("all private structures and arbitrary output text are dropped even when digest-bound", () => {
  const input = fixture()
  input.operation.proposal.output.title = PRIVATE
  input.operation.proposal.output.summary = "eyJhbGciOiJIUzI1NiJ9.PRIVATE.signature"
  input.operation.proposal.output.rationale = "https://stage-chainapi.omnione.net/?token=SECRET_QUERY"
  rebind(input)
  Object.assign(input.serviceEvidence, { error: PRIVATE, passport: PRIVATE, providerPayload: { raw: PRIVATE } })
  Object.assign(input.provenance.frontend, { token: PRIVATE })
  const encoded = JSON.stringify(complete(input))
  for (const secret of [PRIVATE, "eyJhbGci", "SECRET_QUERY", "sponsorSignature", "vcDocument", "subjectRef", "providerPayload", "nonce"]) assert.equal(encoded.includes(secret), false, secret)
  for (const part of ["identity", "credential", "proposal", "sui", "omnione"]) assert.ok(encoded.includes(part))
})

test("actual model is bound to proposal and manifest; rule fallback never claims model success", () => {
  const input = fixture()
  input.operation.proposal.model = "gemini-2.0-flash"
  rebind(input)
  assert.equal(complete(input).proposal.actualModel, "gemini-2.0-flash")
  input.operation.proposal.model = "gemini-flash-latest"; rebind(input)
  assert.equal(complete(input).proposal.actualModel, "gemini-flash-latest")
  rejected(i => { i.operation.proposal.model = "gemini-2.5-pro" }, "proposal_digests")
  for (const [label, reason] of [["rule-v1", "configured_or_unavailable"], ["rule-v1 (gemini unavailable)", "provider_unavailable"], ["rule-v1 (gemini rejected: guard_tripped)", "provider_rejected_guard_tripped"]]) {
    const i = fixture(); i.operation.proposal.mode = "rule"; i.operation.proposal.model = label; i.operation.proposal.guard.schemaValid = false; i.provenance.executionSources.ai = "rule"; rebind(i)
    const result = complete(i)
    assert.equal(result.proposal.origin, "rule"); assert.equal(result.proposal.actualModel, null); assert.equal(result.proposal.ruleFallback, reason)
  }
  const malicious = fixture(); malicious.operation.proposal.model = `gemini-${PRIVATE}`; rebind(malicious)
  const result = buildSubmissionEvidence(malicious, NOW)
  assert.ok(result.failedChecks.includes("proposal_model")); assert.equal(JSON.stringify(result).includes(PRIVATE), false)
})

test("trusted-looking wrong revision/deployment/context and public frontend substitution fail", () => {
  rejected(i => { i.provenance.capture.backend.sourceSha = "b".repeat(40) }, "backend_provenance")
  rejected(i => { i.provenance.capture.backend.deploymentId = "dpl_WrongDeployment123456" }, "backend_provenance")
  rejected(i => { i.provenance.frontend.sourceSha = i.provenance.capture.backend.sourceSha }, "frontend_provenance")
  rejected(i => { i.provenance.capture.operationRevision++ }, "capture_binding")
  rejected(i => { i.provenance.capture.operationId = "op_foreign_12345678" }, "capture_binding")
  rejected(i => { i.expectedContext.venueId = "foreign-venue" }, "operation_context")
  rejected(i => { i.expectedContext.sui.packageId = h(40) }, "sui_context")
  rejected(i => { i.provenance.capture.backend.sourceSha = i.provenance.frontend.sourceSha; i.provenance.expectedBackend.sourceSha = i.provenance.frontend.sourceSha }, "backend_provenance")
  rejected(i => { i.provenance.capture.backend.deploymentId = i.provenance.frontend.deploymentId; i.provenance.expectedBackend.deploymentId = i.provenance.frontend.deploymentId }, "backend_provenance")
  rejected(i => { i.provenance.capture.capturedAt = at(31) }, "capture_time")
})

test("missing approvals, changed proposal target and consent scope cannot be called complete", () => {
  rejected(i => { i.approval.proposalDigest = h(31) }, "approval_record")
  rejected(i => { i.approval.userTxDigest = suiTx(31) }, "approval_record")
  rejected(i => { i.approval.approvedAt = at(3) }, "approval_record")
  rejected(i => { i.operation.consent.digest = h(32) }, "consent_binding")
  rejected(i => { i.operation.proposal.output.target.venueId = "other-venue"; rebind(i) }, "proposal_target")
  rejected(i => { i.operation.delegation.recipient = h(32); rebind(i) }, "delegation_scope")
  rejected(i => { i.operation.delegation.consentCommitment = h(33) }, "approval_commitments")
  rejected(i => { i.operation.agent.manifest.operationRef = h(34) }, "agent_manifest")
  rejected(i => { i.operation.agent.manifestCommitment = h(34) }, "agent_manifest")
})

test("Sui requires distinct bound transactions and actual service verification flags", () => {
  rejected(i => { i.operation.delegation.entitlement.txDigest = "" }, "sui_issue_record")
  rejected(i => { i.operation.delegation.entitlement.txDigest = "1".repeat(44) }, "sui_issue_record")
  rejected(i => { i.operation.delegation.userTxDigest = suiTx(20) }, "sui_delegation_record")
  rejected(i => { i.operation.agent.txDigest = i.operation.delegation.grant.txDigest; rebind(i) }, "agent_service_verified")
  rejected(i => { i.operation.agent.verified.eventOk = false }, "agent_service_verified")
  rejected(i => { i.operation.agent.verified.grantUses = 0 }, "agent_service_verified")
  rejected(i => { i.operation.fulfillment.recheck.sui = "pending" }, "fulfillment_redeemed")
  rejected(i => { (i.serviceEvidence.sui as Record<string, unknown>).grant = { objectId: h(35), tx: suiTx(3) } }, "sui_delegation_record")
})

test("future consumption and stale operation/outbox snapshots cannot claim completed chronology", () => {
  rejected(i => { i.operation.presentation.decisionConsumedAt = "2099-01-01T00:00:00.000Z"; i.serviceEvidence = serviceProjection(i) }, "presentation_allowed")
  rejected(i => { i.operation.updatedAt = i.operation.createdAt }, "fulfillment_redeemed")
  rejected(i => { i.outbox.updatedAt = at(10) }, "outbox_binding")
  rejected(i => { i.outbox.updatedAt = at(13) }, "outbox_binding")
  rejected(i => { i.outbox.createdAt = at(9) }, "outbox_binding")
  const delayedReceipt = fixture()
  delayedReceipt.operation.updatedAt = at(10) // mirror updates chain, not operation.updatedAt
  assert.equal(complete(delayedReceipt).omnione.confirmedAt, at(11))
})

test("OmniOne unknown/legacy/wrong-operation/receipt or commitment mismatch fails closed", () => {
  for (const status of ["pending", "submitted", "unknown", "failed"]) rejected(i => { i.outbox.status = status }, "outbox_binding")
  rejected(i => { i.outbox.receiptEvidenceVersion = 0 }, "outbox_binding")
  rejected(i => { i.outbox.operationId = "op_foreign_12345678" }, "outbox_binding")
  rejected(i => { i.outbox.txHash = h(40) }, "outbox_binding")
  rejected(i => { i.outbox.blockNumber = 0 }, "outbox_binding")
  rejected(i => { i.outbox.payloadCommitment = h(40) }, "outbox_payload")
  rejected(i => { i.outbox.payload.suiDigestCommitment = h(40) }, "outbox_payload")
  rejected(i => { i.outbox.payload.campaignRef = "other-campaign"; i.outbox.payloadCommitment = digestOf(i.outbox.payload) }, "outbox_payload")
  rejected(i => { i.expectedContext.omnione.chainId = 1 }, "omnione_service_binding")
})

test("optional supplied receipt is checked by the same verifier but not authenticated as live", () => {
  const input = fixture(), event = omnioneReadAbi.encodeEventLog(omnioneReadAbi.getEvent("DemoEntitlementRedeemed")!, [input.outbox.eventKey, input.outbox.payloadCommitment, 100n, OMNIONE_STAGE.recorder])
  const proof = { chainId: Number(OMNIONE_STAGE.chainId), authorizedRecorder: true,
    entry: { exists: true, payloadCommitment: input.outbox.payloadCommitment, recordedAt: "100", recorder: OMNIONE_STAGE.recorder },
    receipt: { status: "0x1", transactionHash: input.outbox.txHash, to: OMNIONE_STAGE.registry, from: OMNIONE_STAGE.recorder,
      blockHash: h(50), blockNumber: "0x190", logs: [{ address: OMNIONE_STAGE.registry, ...event }] } }
  const withProof = { ...input, omnioneReceipt: proof }
  const result = complete(withProof)
  assert.equal(result.verification.suppliedOmnioneReceiptChecked, true)
  assert.equal(result.verification.remoteVerificationPerformed, false)
  assert.equal(JSON.stringify(result).includes("logs"), false)
  for (const mutate of [
    (p: typeof proof) => { p.receipt.transactionHash = h(51) },
    (p: typeof proof) => { p.receipt.status = "0x0" },
    (p: typeof proof) => { p.authorizedRecorder = false },
    (p: typeof proof) => { p.receipt.logs = [] },
    (p: typeof proof) => { p.entry.payloadCommitment = h(51) },
    (p: typeof proof) => { p.chainId = 1 },
  ]) {
    const p = structuredClone(proof); mutate(p)
    assert.ok(buildSubmissionEvidence({ ...input, omnioneReceipt: p }, NOW).failedChecks.includes("supplied_omnione_receipt"))
  }
})

test("producer fixture and mixed taint cannot be upgraded to certified live", () => {
  const mixed = fixture(); mixed.provenance.producer = "mixed"; mixed.provenance.executionSources.ai = "provider"; mixed.provenance.executionSources.sui = "provider"; mixed.provenance.executionSources.omnione = "provider"
  assert.equal(complete(mixed).suppliedExecutionLevel, "mixed")
  mixed.provenance.producer = "live"
  assert.ok(buildSubmissionEvidence(mixed, NOW).failedChecks.includes("producer_taint"))
  const claimedLive = fixture(); claimedLive.provenance.producer = "live"; claimedLive.operation.identity.mode = "cx"; claimedLive.operation.credential.mode = "opendid"; claimedLive.operation.execution = "provider"
  for (const key of Object.keys(claimedLive.provenance.executionSources) as Array<keyof typeof claimedLive.provenance.executionSources>) claimedLive.provenance.executionSources[key] = "provider"
  rebind(claimedLive)
  const result = buildSubmissionEvidence(claimedLive, NOW)
  assert.equal(result.suppliedExecutionLevel, "live")
  assert.equal(result.complete, false)
  assert.ok(result.failedChecks.includes("credential_supported_verifier"))
  assert.equal(result.verification.liveExecutionCertified, false)
  claimedLive.provenance.producer = "fixture"
  assert.equal(buildSubmissionEvidence(claimedLive, NOW).suppliedExecutionLevel, "fixture")
})

test("incomplete and hostile JSON have bounded, value-free failures", () => {
  const incomplete = buildSubmissionEvidence({}, NOW)
  assert.equal(incomplete.complete, false)
  assert.ok(incomplete.failedChecks.includes("approval_record"))
  for (const input of [JSON.parse('{"__proto__":{"polluted":true}}'), { extra: "x".repeat(SUBMISSION_MAX_BYTES + 1) }, { date: new Date() }, { value: Infinity }]) assert.throws(() => buildSubmissionEvidence(input, NOW), { message: "submission_input_invalid" })
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic
  assert.throws(() => buildSubmissionEvidence(cyclic, NOW), { message: "submission_input_invalid" })
  assert.throws(() => buildSubmissionEvidence(Object.defineProperty({}, "token", { get() { throw new Error(PRIVATE) } }), NOW), { message: "submission_input_invalid" })
})

test("CLI exports only an explicit new file at 0600, never overwrites, and prints no raw capture", () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "ktour-submission-test-")))
  try {
    const input = join(directory, "capture.json"), output = join(directory, "bundle.json")
    writeFileSync(input, JSON.stringify(fixture()), { mode: 0o600 })
    const result = runSubmissionEvidence(["--input", input, "--output", output], NOW)
    assert.equal(result.ok, true); assert.equal(result.exported, true)
    assert.equal(statSync(output).mode & 0o777, 0o600)
    assert.equal(JSON.stringify(result).includes(PRIVATE), false)
    const content = readFileSync(output, "utf8")
    assert.equal(content.includes(PRIVATE), false)
    assert.equal(runSubmissionEvidence(["--input", input, "--output", output], NOW).exported, false)
    assert.equal(readFileSync(output, "utf8"), content)
    const incomplete = join(directory, "incomplete.json"), incompleteOut = join(directory, "incomplete-bundle.json")
    writeFileSync(incomplete, "{}")
    const failed = runSubmissionEvidence(["--input", incomplete, "--output", incompleteOut], NOW)
    assert.equal(failed.ok, false); assert.equal(failed.exported, true)
    assert.equal(JSON.parse(readFileSync(incompleteOut, "utf8")).complete, false)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test("CLI rejects symlinks, oversized inputs, unsafe paths/flags without exporting or exposing values", () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "ktour-submission-test-")))
  try {
    const input = join(directory, "capture.json"), link = join(directory, "link.json"), output = join(directory, "bundle.json")
    writeFileSync(input, JSON.stringify(fixture()))
    symlinkSync(input, link)
    assert.equal(runSubmissionEvidence(["--input", link, "--output", output], NOW).exported, false)
    assert.equal(existsSync(output), false)
    const parentLink = join(directory, "linked-parent")
    symlinkSync(directory, parentLink)
    assert.equal(runSubmissionEvidence(["--input", input, "--output", join(parentLink, "parent-output.json")], NOW).exported, false)
    assert.equal(existsSync(join(directory, "parent-output.json")), false)
    symlinkSync(input, output)
    assert.equal(runSubmissionEvidence(["--input", input, "--output", output], NOW).exported, false)
    assert.equal(readFileSync(input, "utf8").includes(PRIVATE), true)
    const large = join(directory, "large.json"), largeOutput = join(directory, "large-output.json")
    writeFileSync(large, " ".repeat(SUBMISSION_MAX_BYTES + 1))
    assert.equal(runSubmissionEvidence(["--input", large, "--output", largeOutput], NOW).exported, false)
    assert.equal(existsSync(largeOutput), false)
    for (const args of [[], ["--live"], ["--input", input, "--output", input], ["--input", input, "--output", output, "--force"],
      ["--input", "https://private.invalid/capture.json", "--output", output], ["--input", join(directory, "auth.json"), "--output", output], ["--input", join(directory, ".env.json"), "--output", output]]) {
      assert.throws(() => submissionEvidenceArguments(args), { message: "submission_evidence_arguments_invalid" })
      assert.equal(JSON.stringify(runSubmissionEvidence(args, NOW)).includes("private.invalid"), false)
    }
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test("failed-write cleanup deletes only the exact file inode it created", () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "ktour-submission-test-")))
  try {
    const output = join(directory, "bundle.json"), moved = join(directory, "old-bundle.json")
    writeFileSync(output, "partial", { mode: 0o600 })
    const owned = { path: output, dev: statSync(output).dev, ino: statSync(output).ino }
    renameSync(output, moved)
    writeFileSync(output, "replacement-owned-by-someone-else", { mode: 0o600 })
    assert.equal(cleanupSubmissionPartial(owned), false)
    assert.equal(readFileSync(output, "utf8"), "replacement-owned-by-someone-else")
    assert.equal(cleanupSubmissionPartial({ ...owned, path: moved }), true)
    assert.equal(existsSync(moved), false)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
