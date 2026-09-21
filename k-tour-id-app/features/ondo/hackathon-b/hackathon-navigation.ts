import type { OperationResult } from "@/lib/hackathon/types"

const STEP_OF_PHASE: Record<string, number> = { consent: 0, identity: 1, issuance: 2, presentation: 3, proposal: 4, delegation: 5, agent: 6, fulfillment: 7, done: 8 }

/** Terminal states retain the reached boundary; cancelling never rewinds identity. */
export function journeyStepIndex(op: OperationResult | null): number {
  if (!op) return 0
  if (op.phase in STEP_OF_PHASE) return STEP_OF_PHASE[op.phase]
  if (op.fulfillment) return 7
  if (op.agent || op.delegation?.status === "delegated") return 6
  if (op.proposal) return 5
  if (op.presentation?.decision === "allow") return 4
  if (op.credential?.holderAckAt) return 3
  if (op.credential || op.identity?.personVerified) return 2
  return op.consent ? 1 : 0
}
