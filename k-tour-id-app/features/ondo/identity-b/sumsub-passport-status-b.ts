/** Pure, browser-safe status policy. This module carries no provider credentials. */
export type SumsubPassportStatus = "not_started" | "access_required" | "in_progress" | "pending" | "approved" | "retry" | "rejected" | "expired" | "unavailable"
export type SumsubPassportSnapshot = { status: SumsubPassportStatus; environment: "sandbox"; configured: boolean }

const STATUSES: readonly string[] = ["not_started", "access_required", "in_progress", "pending", "approved", "retry", "rejected", "expired", "unavailable"]

export function readSumsubPassportSnapshot(value: unknown): SumsubPassportSnapshot {
  if (!value || typeof value !== "object") throw new Error("INVALID_STATUS")
  const candidate = value as Record<string, unknown>
  if (candidate.environment !== "sandbox" || typeof candidate.configured !== "boolean" || !STATUSES.includes(String(candidate.status))) throw new Error("INVALID_STATUS")
  return { status: candidate.configured ? candidate.status as SumsubPassportStatus : "unavailable", configured: candidate.configured, environment: "sandbox" }
}

export type SumsubStatusFailure = {
  source: "transport" | "http" | "invalid_response"
  httpStatus?: number
  errorCode?: string
  snapshot?: SumsubPassportSnapshot
}

/** A failed status read must never invent an approval or discard an active
 * capture because the provider briefly timed out. Explicit security/config
 * failures still end the SDK, even if the HTTP response is otherwise retryable.
 */
export function resolveSumsubStatusFailure(current: SumsubPassportSnapshot | null, failure: SumsubStatusFailure): {
  snapshot: SumsubPassportSnapshot | null
  stopSdk: boolean
  issue: "connection" | "rate"
} {
  const remote = failure.snapshot
  const hardFailure = remote?.configured === false
    || remote?.status === "expired" || remote?.status === "access_required"
    || failure.httpStatus === 401 || failure.httpStatus === 403
    || ["provider_binding_mismatch", "invalid_provider_response", "request_not_allowed", "session_expired"].includes(failure.errorCode ?? "")
  const transient = !hardFailure && (failure.source === "transport"
    || failure.httpStatus === 429
    || failure.httpStatus === 502 || failure.httpStatus === 504
    || failure.httpStatus === 503 && ["provider_unavailable", "store_unavailable", "store_conflict", "status_changed_retry"].includes(failure.errorCode ?? ""))
  if (transient) return { snapshot: current, stopSdk: false, issue: failure.httpStatus === 429 ? "rate" : "connection" }

  // Even a malformed error body that says approved cannot become a result.
  const status = remote?.status === "expired" ? "expired" : remote?.status === "access_required" ? "access_required" : "unavailable"
  return {
    snapshot: { status, configured: remote?.configured ?? current?.configured ?? false, environment: "sandbox" },
    stopSdk: true,
    issue: "connection",
  }
}
