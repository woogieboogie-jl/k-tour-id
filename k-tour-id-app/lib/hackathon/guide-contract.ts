// Public, non-secret contract shared by the guide reader, Pass and BFF.
// V1 experience approvals never authorize this V2 collection action.
import type { ChainStatus, OperationResult } from "./types"

export const GUIDE_SAVE_V2 = {
  guideId: "roba-neighborhood-guide-v2",
  venueId: "mois-0021cd596bc5b2a922ad",
  campaignId: "ktour-neighborhood-guide-save-v2",
  action: "save-neighborhood-guide-to-pass",
  consentVersion: "ktour-guide-save-consent-2026-09-29-v2",
  policyVersion: 1,
  endsAt: "2026-09-30T14:59:59.000Z",
} as const

export type GuideReadinessCheck = "identity" | "credential" | "execution" | "audit" | "login" | "ai" | "campaign"
export type GuideReadiness = {
  supported: true
  ready: boolean
  verification: "configuration_only"
  venueId: string
  guideId: string
  campaignId: string
  action: typeof GUIDE_SAVE_V2.action
  consentVersion: string
  checks: Array<{ id: GuideReadinessCheck; status: "configured" | "setup_required" | "expired" }>
  blockers: GuideReadinessCheck[]
  identityCheckAvailable: boolean
  accessProfile: "guide-production" | "integration-preview" | "unavailable"
}

export type GuideCollectionEntry = {
  guideId: string
  venueId: string
  campaignId: string
  operationId: string
  savedAt: string
  chain: { status: ChainStatus; txHash: string | null; confirmedAt: string | null }
}
export type GuideCollection = { items: GuideCollectionEntry[]; pendingOperation: OperationResult | null }

export type GuideJourney = { version: 2; kind: "guide_save"; guideId: typeof GUIDE_SAVE_V2.guideId; action: typeof GUIDE_SAVE_V2.action }
export const guideJourney = (): GuideJourney => ({ version: 2, kind: "guide_save", guideId: GUIDE_SAVE_V2.guideId, action: GUIDE_SAVE_V2.action })

export function isGuideJourney(op: { journey?: GuideJourney; venueId: string; campaignId: string; policyVersion: number }): boolean {
  const j = op.journey
  return j?.version === 2 && j.kind === "guide_save" && j.guideId === GUIDE_SAVE_V2.guideId && j.action === GUIDE_SAVE_V2.action &&
    op.venueId === GUIDE_SAVE_V2.venueId && op.campaignId === GUIDE_SAVE_V2.campaignId && op.policyVersion === GUIDE_SAVE_V2.policyVersion
}
