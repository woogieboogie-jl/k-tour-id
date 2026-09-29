import { canonicalMapVenueById } from "../ondo/venues/map-data"
import { ondoBTablePolicyById } from "../../features/ondo/connect/table-policy-b"
import { hkConfig } from "./config"
import { currentCxPolicyDigest } from "./identity-policy"
import { isHostedSuiProfile, hostedSuiPreflightIssues, PIN } from "./hosted-sui-profile"
import { requiresIntegrationSuiLimits, integrationSuiPreflightIssues, claimIntegrationSuiOperation, INTEGRATION_SUI_LIMITS } from "./integration-sui-limits"
import { HkError, assert } from "./util"
import { JIT_IDENTITY_CONSENT, type JitIdentityContext } from "./jit-identity-contract"
import type { Db, OperationRecord } from "./store"

export type JitRuntimePolicy = { enabled: boolean; digest: string; provider: string; expiresAt: string; campaignVenueId: string }
export function jitRuntimePolicy(now = Date.now()): JitRuntimePolicy {
  const c = hkConfig(), hosted = isHostedSuiProfile(), integration = requiresIntegrationSuiLimits()
  const expiry = hosted ? process.env.HK_HOSTED_SUI_EXPIRES_AT : process.env.HK_GUIDE_EXPIRES_AT ?? process.env.HK_INTEGRATION_PREVIEW_EXPIRES_AT
  const enabled = c.cx.mode === "cx" && !c.isolatedMock && !c.cxPreview &&
    (hosted ? hostedSuiPreflightIssues(process.env, now).length === 0 : integration && integrationSuiPreflightIssues(process.env, now).length === 0)
  return { enabled, digest: currentCxPolicyDigest(), provider: c.cx.provider,
    expiresAt: expiry && Number.isFinite(Date.parse(expiry)) ? expiry : INTEGRATION_SUI_LIMITS.maxExpiresAt, campaignVenueId: c.campaign.venueId }
}

/** No new budget. Each new provider transaction occupies the existing pool. */
export function reserveJitIdentityOperation(db: Db, op: OperationRecord) {
  if (requiresIntegrationSuiLimits()) claimIntegrationSuiOperation(db, op.operationId)
  else if (isHostedSuiProfile()) assert(Object.keys(db.operations).length < PIN.maxOperations, "hosted_sui_limit", "Identity request limit reached", 429)
  else throw new HkError("jit_identity_unavailable", "Identity checking is unavailable", 503)
  db.operations[op.operationId] = op
}

export function validateJitContext(value: unknown, policy: JitRuntimePolicy, consent = false): JitIdentityContext {
  assert(value && typeof value === "object" && !Array.isArray(value), "bad_request", "Invalid identity action")
  const b = value as Record<string, unknown>
  const fields = ["action", "purpose", "venueId", "tableId", "contextDigest", ...(consent ? ["consentVersion"] : [])]
  assert(Object.keys(b).length === fields.length && Object.keys(b).every(k => fields.includes(k)), "bad_request", "Invalid identity action")
  assert(!consent || b.consentVersion === JIT_IDENTITY_CONSENT, "consent_version", "Identity consent changed")
  assert(typeof b.contextDigest === "string" && /^0x[0-9a-f]{64}$/.test(b.contextDigest), "bad_request", "Invalid pending action")
  assert(["person", "adult", "age19"].includes(String(b.purpose)), "bad_request", "Invalid identity purpose")
  if (b.action === "pass_setup") {
    assert(b.venueId === null && b.tableId === null && ["person", "adult"].includes(String(b.purpose)), "jit_identity_scope", "Invalid pass check", 403)
  } else if (b.action === "table_request") {
    const table = ondoBTablePolicyById(b.tableId)
    assert(table && table.venueId === b.venueId && b.purpose === (table.alcohol ? "age19" : "person"), "jit_identity_scope", "Table policy changed", 403)
  } else {
    assert(["local_moment", "designated_perk"].includes(String(b.action)) && b.tableId === null && b.purpose === "person" &&
      typeof b.venueId === "string" && canonicalMapVenueById(b.venueId), "jit_identity_scope", "Invalid action place", 403)
    if (b.action === "designated_perk") assert(b.venueId === policy.campaignVenueId, "jit_identity_scope", "This place has no designated perk", 403)
  }
  return { action: b.action, purpose: b.purpose, venueId: b.venueId, tableId: b.tableId, contextDigest: b.contextDigest } as JitIdentityContext
}

/** Current, completed provider evidence only. A browser status, self-declaration,
 * sample, expired/cancelled operation, or changed provider is never authority. */
export function jitEvidence(db: Db, sessionId: string, op: OperationRecord | undefined, policy: JitRuntimePolicy, now: number) {
  const e = op?.identity, session = db.sessions[sessionId]
  if (!policy.enabled || !session || !op || op.secrets?.identityImport || op.sessionId !== sessionId || !["pending", "succeeded"].includes(op.status) ||
    !e || e.handoff || e.mode !== "cx" || e.source !== "cx_mobile_id" || e.provider !== policy.provider ||
    e.providerPolicyDigest !== policy.digest || e.personVerified !== true || !/^subj_[A-Za-z0-9_-]+$/.test(e.subjectRef) ||
    session.subjectRef !== e.subjectRef || !e.evidenceId || !e.providerTransactionRef ||
    !Number.isFinite(Date.parse(e.verifiedAt)) || Date.parse(e.verifiedAt) > now || Date.parse(e.expiresAt) <= now ||
    !Number.isFinite(Date.parse(e.expiresAt)) || (op.status === "pending" && Date.parse(op.expiresAt) <= now) || Date.parse(policy.expiresAt) <= now) return null
  return e
}
