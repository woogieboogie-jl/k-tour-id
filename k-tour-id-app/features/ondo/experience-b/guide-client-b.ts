import { GUIDE_SAVE_V2, type GuideCollection, type GuideReadiness } from "@/lib/hackathon/guide-contract"
import type { OperationResult } from "@/lib/hackathon/types"

export const GUIDE_COLLECTION_CHANGED_B = "ktour:guide-collection:changed"
export async function guideRead<T>(path: "readiness" | "collection", signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/hackathon/v1/guide/${path}`, { credentials: "same-origin", cache: "no-store", signal })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { code?: string } } | null
    const access = response.status === 401 || response.status === 403 && ["hosted_sui_access_denied", "integration_preview_access_denied"].includes(body?.error?.code ?? "")
    throw new Error(access ? "guide_access_required" : "guide_unavailable")
  }
  return response.json() as Promise<T>
}
export const readGuideReadinessB = (signal?: AbortSignal) => guideRead<GuideReadiness>("readiness", signal)
export const readGuideCollectionB = (signal?: AbortSignal) => guideRead<GuideCollection>("collection", signal)
export function validGuideReadinessB(value: GuideReadiness): boolean {
  const ids = ["identity", "credential", "execution", "audit", "login", "ai", "campaign"]
  return value?.supported === true && value.verification === "configuration_only" && value.venueId === GUIDE_SAVE_V2.venueId
    && value.guideId === GUIDE_SAVE_V2.guideId && value.campaignId === GUIDE_SAVE_V2.campaignId && value.action === GUIDE_SAVE_V2.action
    && value.consentVersion === GUIDE_SAVE_V2.consentVersion && typeof value.ready === "boolean"
    && Array.isArray(value.checks) && value.checks.length === ids.length && ids.every(id => value.checks.filter(check => check.id === id).length === 1)
    && value.checks.every(check => ["configured", "setup_required", "expired"].includes(check.status))
    && Array.isArray(value.blockers) && value.blockers.every(id => ids.includes(id))
    && (!value.ready || value.checks.every(check => check.status === "configured") && value.blockers.length === 0)
}
export async function createGuideOperationB(locale: "ko" | "en" | "ja"): Promise<OperationResult> {
  const response = await fetch("/api/hackathon/v1/guide/operations", { method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ venueId: GUIDE_SAVE_V2.venueId, consentVersion: GUIDE_SAVE_V2.consentVersion, locale }) })
  const result = await response.json()
  if (!response.ok) throw new Error(typeof result.error?.code === "string" ? result.error.code : "guide_unavailable")
  return result as OperationResult
}
