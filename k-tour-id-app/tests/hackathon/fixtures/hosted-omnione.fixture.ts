import { PIN, CONNECTED_PIN, type HostedSuiEnv } from "../../../lib/hackathon/hosted-sui-profile"
import { omnioneTargetSnapshot } from "../../../lib/hackathon/omnione-targets"
import type { OperationRecord, OutboxRecord, Db } from "../../../lib/hackathon/store"
import { digestOf, sha256Hex } from "../../../lib/hackathon/util"

// Synthetic policy fixtures only. Never reads a credential or invokes a provider.
export const now = Date.parse("2026-09-30T02:00:00Z"), stamp = new Date(now).toISOString()
const target = omnioneTargetSnapshot("stage-20260930")
export function env(): HostedSuiEnv {
  return { NODE_ENV: "test", HK_HOSTED_SUI_LOCAL_TEST: "1", NEXT_PUBLIC_HK_HOSTED_SUI: "1", HK_HOSTED_SUI_ENABLED: "1",
    NEXT_PUBLIC_HK_CX_PREVIEW: "0", NEXT_PUBLIC_HK_PREVIEW_READ_ONLY: "0", NEXT_PUBLIC_HK_INTEGRATION_PREVIEW: "0",
    NEXT_PUBLIC_HK_ENABLED: "1", HK_API_ENABLED: "1", HK_ISOLATED_MOCK: "0", HK_HOSTED_SUI_EXPIRES_AT: PIN.maxExpiresAt,
    HK_MODE_CX: "cx", HK_CX_BASE_URL: "https://cx.raonsecure.co.kr:18543", HK_CX_PROVIDER: "comdl", HK_CX_ZKP_TYPE: "AdultVerify",
    HK_MODE_OPENDID: "mock", HK_AI_MODE: "rule", HK_SUI_NETWORK: PIN.network, HK_SUI_GRPC_URL: PIN.rpc,
    HK_SUI_PACKAGE_ID: PIN.packageId, HK_SUI_CAMPAIGN_ID: PIN.campaignId, HK_SUI_CAMPAIGN_INITIAL_VERSION: PIN.campaignInitialVersion,
    HK_SUI_ISSUER_SECRET_KEY: "fixture-issuer-".padEnd(48, "x"), HK_SUI_AGENT_SECRET_KEY: "fixture-agent-".padEnd(48, "x"),
    HK_ISSUER_SIGNING_SEED: "fixture-credential-".padEnd(48, "x"), HK_HOSTED_SUI_ACCESS_SECRET: "a".repeat(64), HK_HOSTED_SUI_ACCESS_CODE: "b".repeat(40),
    HK_STORE_KEY: PIN.storeKey, KV_REST_API_URL: "https://fixture.upstash.io", KV_REST_API_TOKEN: "fixture-kv-token",
    NEXT_PUBLIC_HK_HOSTED_PROVIDERS: "connected-20260930-v1", HK_HOSTED_PROVIDERS: "connected-20260930-v1", HK_HOSTED_OMNIONE_ENABLED: "1",
    HK_OMNIONE_TARGET_ID: target.targetId, HK_OMNIONE_CHAIN_ID: String(target.chainId), HK_OMNIONE_REGISTRY_ADDRESS: CONNECTED_PIN.registry,
    HK_OMNIONE_RECORDER_ADDRESS: CONNECTED_PIN.recorder, HK_OMNIONE_RPC_URL: "https://stage-chainapi.omnione.net/?token=fixture-token",
    HK_OMNIONE_PRIVATE_KEY: "0x" + "1".repeat(64), HK_OMNIONE_GAS_LIMIT: "300000" }
}
export function fixture() {
  const op: OperationRecord = { operationId: "op_fixture_001", sessionId: "ses_fixture_001", kind: "demo_entitlement", venueId: PIN.venueId,
    campaignId: PIN.campaignRef, policyVersion: PIN.policyVersion, status: "succeeded", phase: "done", revision: 1, createdAt: stamp, updatedAt: stamp,
    expiresAt: PIN.maxExpiresAt, execution: "sample", allowedActions: ["return"], safeNextAction: "return", returnContext: null,
    omnioneTarget: target, consent: null, identity: { evidenceId: "id_fixture", subjectRef: "fixture-subject", source: "cx_mobile_id", mode: "cx", provider: "comdl",
      personVerified: true, adultVerified: null, verifiedAt: stamp, expiresAt: PIN.maxExpiresAt, providerTransactionRef: "fixture-tx", handoff: null },
    credential: { credentialRef: "fixture-vc", vcId: "fixture-vc", schema: "fixture", mode: "mock", issuerDid: "did:fixture", holderBinding: "fixture-holder", serviceAccess: ["redeem_demo_entitlement"],
      validFrom: stamp, validUntil: PIN.maxExpiresAt, statusRef: "fixture-status", status: "active", holderAckAt: stamp },
    presentation: { presentationId: "fixture-pres", nonce: "fixture", requestDigest: "fixture", requestedClaims: [], expiresAt: PIN.maxExpiresAt,
      submittedAt: stamp, verifiedAt: stamp, decision: "allow", decisionRef: "fixture-decision", decisionExpiresAt: PIN.maxExpiresAt, decisionConsumedAt: stamp, denyReason: null },
    proposal: null, delegation: null, agent: { dispatchId: "fixture-dispatch", status: "executed", decisionCommitment: "fixture-decision", manifestCommitment: "fixture-manifest", manifest: {},
      txDigest: "fixture-executed-tx", recordId: "fixture-record", verified: { effectsOk: true, eventOk: true, grantUses: 1, checkedAt: stamp }, error: null },
    fulfillment: { status: "redeemed", reason: null, redemptionRef: "rdm_fixture", redeemedAt: stamp, recheck: null }, chain: null, error: null, secrets: {}, audit: [] }
  const payload = { kind: "DemoEntitlementRedeemed", campaignRef: op.campaignId, policyVersion: op.policyVersion, salt: "fixture-salt", suiDigestCommitment: sha256Hex(op.agent!.txDigest!), manifestCommitment: op.agent!.manifestCommitment }
  const row: OutboxRecord = { target, outboxId: "obx_fixture", operationId: op.operationId, eventKey: "0x" + "2".repeat(64), payloadCommitment: digestOf(payload), payload,
    status: "pending", txHash: null, blockNumber: null, attempts: 0, lastError: null, createdAt: stamp, updatedAt: stamp, confirmedAt: null }
  op.chain = { target, outboxId: row.outboxId, eventKey: row.eventKey, payloadCommitment: row.payloadCommitment, status: "pending", txHash: null, blockNumber: null, attempts: 0, lastError: null, confirmedAt: null }
  const db: Db = { version: 1, sessions: {}, operations: { [op.operationId]: op }, redemptions: { [`${op.identity!.subjectRef}::${op.campaignId}`]: {
    operationId: op.operationId, campaignId: op.campaignId, subjectRef: op.identity!.subjectRef, redemptionRef: "rdm_fixture", redeemedAt: stamp } }, outbox: { [row.outboxId]: row }, idempotency: {}, nonces: {} }
  return { op, row, db }
}
