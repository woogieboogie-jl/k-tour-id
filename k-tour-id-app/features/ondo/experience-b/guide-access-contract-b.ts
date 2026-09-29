import { GUIDE_SAVE_V2 } from "@/lib/hackathon/guide-contract"
import type { PublicConfig } from "../hackathon-b/hackathon-client"

export type GuideAccessProfileB = "guide-production" | "integration-preview"
export const guideAccessEndpointB = (profile: GuideAccessProfileB) => profile === "guide-production" ? "/api/hackathon/v1/guide/access" : "/api/hackathon/v1/integration/access"

/** The server selects the profile. Public flags, a cookie response, or real-mode
 * names alone do not prove this is the guide deployment the user opened. */
export function validGuideConfigB(value: unknown, profile: GuideAccessProfileB): value is PublicConfig {
  if (!value || typeof value !== "object") return false
  const c = value as Record<string, unknown>, guide = c.guide as Record<string, unknown> | undefined
  const modes = c.modes as Record<string, unknown> | undefined
  if (c.guideProfile !== profile || c.isolatedMock !== false || !guide || !modes ||
    Object.entries(GUIDE_SAVE_V2).some(([key, expected]) => guide[key] !== expected) ||
    modes.cx !== "cx" || modes.opendid !== "opendid" || modes.sui !== "testnet" || modes.omnione !== "stage" || modes.ai !== "gemini" || modes.zklogin !== "google") return false
  if (profile === "guide-production") {
    const campaign = c.campaign as Record<string, unknown> | undefined
    if (!campaign || campaign.venueId !== GUIDE_SAVE_V2.venueId || campaign.campaignId !== GUIDE_SAVE_V2.campaignId || campaign.purpose !== GUIDE_SAVE_V2.action || campaign.policyVersion !== GUIDE_SAVE_V2.policyVersion || campaign.endsAt !== GUIDE_SAVE_V2.endsAt || c.consentVersion !== GUIDE_SAVE_V2.consentVersion) return false
  }
  return true
}
