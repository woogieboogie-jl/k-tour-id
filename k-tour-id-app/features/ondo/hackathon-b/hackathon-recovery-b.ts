import type { OperationResult } from "@/lib/hackathon/types"

/** The optional lane marker is server-derived, not permission to act. Pending
 * confirmation/reconciliation survives close even during a provider outage. */
export function clearJourneyOnCloseB(op: OperationResult | null, guide: boolean, hosted: boolean): boolean {
  return !!op && (op.status !== "pending" || (!guide && hosted && op.hostedTestRedemption !== true && op.phase === "fulfillment" && op.agent?.status === "executed"))
}
