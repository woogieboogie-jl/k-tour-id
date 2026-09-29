import { hkConfig, HK_SERVICE_ACCESS } from "./config"
import { GUIDE_SAVE_V2, isGuideJourney, type GuideReadiness, type GuideReadinessCheck } from "./guide-contract"
import { isHostedSuiProfile } from "./hosted-sui-profile"
import { requiresIntegrationSuiLimits, integrationSuiPreflightIssues } from "./integration-sui-limits"
import { readIntegrationSuiActivation } from "./store"
import { isGuideProductionProfile, guideProductionPreflightIssues } from "./guide-production-profile"
import { requiresIntegrationPreviewAccess } from "./integration-preview-access"
import { providerIntegrationAvailable } from "./provider-operation"
import type { OperationRecord } from "./store"
import { selectZkLoginProvider } from "./zklogin-provider-selection"
import { HkError } from "./util"

/** Never contacts providers or creates a session. An otherwise eligible profile
 * checks durable cutover state read-only; configuration is not real E2E evidence. */
export async function guideReadiness(now = Date.now()): Promise<GuideReadiness> {
  const c = hkConfig()
  const provider = !c.isolatedMock && !c.cxPreview && !isHostedSuiProfile()
  let execution = false
  if (provider && requiresIntegrationSuiLimits() && integrationSuiPreflightIssues(process.env, now).length === 0) {
    try { await readIntegrationSuiActivation(); execution = true } catch { /* Not migrated: never spend a fresh budget. */ }
  }
  const accessProfile = isGuideProductionProfile() ? guideProductionPreflightIssues(process.env, now).length === 0 ? "guide-production" : "unavailable"
    : requiresIntegrationPreviewAccess() ? "integration-preview" : "unavailable"
  const configured: Record<GuideReadinessCheck, boolean> = {
    identity: c.cx.mode === "cx" && !c.isolatedMock,
    credential: provider && c.opendid.mode === "opendid" && providerIntegrationAvailable(),
    execution,
    audit: provider && Boolean(c.omnione.rpcUrl && c.omnione.privateKey && c.omnione.registryAddress),
    login: provider && Boolean(c.sui.googleClientId && c.sui.zkSaltSeed && selectZkLoginProvider(process.env)),
    ai: provider && c.ai.mode === "gemini",
    campaign: Number.isFinite(now) && now < Date.parse(GUIDE_SAVE_V2.endsAt),
  }
  const checks = (Object.keys(configured) as GuideReadinessCheck[]).map(id => ({ id, status: configured[id] ? "configured" as const : id === "campaign" ? "expired" as const : "setup_required" as const }))
  const blockers = checks.filter(c => c.status !== "configured").map(c => c.id)
  return { supported: true, ready: blockers.length === 0 && accessProfile !== "unavailable", verification: "configuration_only", venueId: GUIDE_SAVE_V2.venueId, guideId: GUIDE_SAVE_V2.guideId,
    campaignId: GUIDE_SAVE_V2.campaignId, action: GUIDE_SAVE_V2.action, consentVersion: GUIDE_SAVE_V2.consentVersion, checks, blockers,
    identityCheckAvailable: configured.identity && isHostedSuiProfile(), accessProfile }
}

export async function assertGuideReady() {
  if (!(await guideReadiness()).ready) throw new HkError("guide_setup_required", "Guide saving is not connected yet. You can keep reading this guide.", 503, true)
}

export function operationCampaign(op: Pick<OperationRecord, "journey" | "venueId" | "campaignId" | "policyVersion">) {
  return isGuideJourney(op) ? { ...GUIDE_SAVE_V2, purpose: GUIDE_SAVE_V2.action } : hkConfig().campaign
}
export function operationAction(op: Pick<OperationRecord, "journey" | "venueId" | "campaignId" | "policyVersion">) {
  return isGuideJourney(op) ? GUIDE_SAVE_V2.action : HK_SERVICE_ACCESS
}
