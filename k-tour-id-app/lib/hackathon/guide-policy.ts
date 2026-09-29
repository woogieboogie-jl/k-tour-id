import { hkConfig, HK_SERVICE_ACCESS } from "./config"
import { GUIDE_SAVE_V2, isGuideJourney, type GuideReadiness, type GuideReadinessCheck } from "./guide-contract"
import { isHostedSuiProfile } from "./hosted-sui-profile"
import { assertIntegrationSuiActivation, requiresIntegrationSuiLimits } from "./integration-sui-limits"
import { providerIntegrationAvailable } from "./provider-operation"
import type { OperationRecord } from "./store"
import { selectZkLoginProvider } from "./zklogin-provider-selection"
import { HkError } from "./util"

/** Public configuration assessment only; never contacts providers or creates a session. */
export function guideReadiness(now = Date.now()): GuideReadiness {
  const c = hkConfig()
  const provider = !c.isolatedMock && !c.cxPreview && !isHostedSuiProfile()
  let execution = false
  if (provider && requiresIntegrationSuiLimits()) {
    try { assertIntegrationSuiActivation(); execution = true } catch { /* Not migrated: never spend a fresh budget. */ }
  }
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
  return { supported: true, ready: blockers.length === 0, verification: "configuration_only", venueId: GUIDE_SAVE_V2.venueId, guideId: GUIDE_SAVE_V2.guideId,
    campaignId: GUIDE_SAVE_V2.campaignId, action: GUIDE_SAVE_V2.action, consentVersion: GUIDE_SAVE_V2.consentVersion, checks, blockers,
    identityCheckAvailable: configured.identity && isHostedSuiProfile() }
}

export function assertGuideReady() {
  if (!guideReadiness().ready) throw new HkError("guide_setup_required", "Guide saving is not connected yet. You can keep reading this guide.", 503, true)
}

export function operationCampaign(op: Pick<OperationRecord, "journey" | "venueId" | "campaignId" | "policyVersion">) {
  return isGuideJourney(op) ? { ...GUIDE_SAVE_V2, purpose: GUIDE_SAVE_V2.action } : hkConfig().campaign
}
export function operationAction(op: Pick<OperationRecord, "journey" | "venueId" | "campaignId" | "policyVersion">) {
  return isGuideJourney(op) ? GUIDE_SAVE_V2.action : HK_SERVICE_ACCESS
}
