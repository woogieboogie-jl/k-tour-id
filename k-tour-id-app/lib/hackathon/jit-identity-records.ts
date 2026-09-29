import type { IdentityHandoff } from "./types"
import type { JitIdentityContext, JitIdentityReceipt, JitIdentityRequest } from "./jit-identity-contract"

/** Private ledger rows, never spread into public responses. */
export type JitIdentityRequestRecord = {
  requestId: string; sessionId: string; context: JitIdentityContext; consentDigest: string
  status: JitIdentityRequest["status"]; createdAt: string; expiresAt: string
  policyDigest: string; operationId: string | null; evidenceOperationId: string | null
  authorizationRef: string | null; reason: string | null
  handoff: IdentityHandoff | null
  cxToken?: string; cxTxId?: string; cxCxId?: string
  claim?: { id: string; expiresAt: string }
  started: boolean; polls: number; lastPollAt: number
}
export type JitIdentityAuthorizationRecord = {
  authorizationRef: string; requestId: string; sessionId: string
  context: JitIdentityContext; consentDigest: string; evidenceOperationId: string
  evidenceId: string; subjectRef: string; policyDigest: string
  createdAt: string; expiresAt: string; receipt: JitIdentityReceipt | null
  operationId?: string // A consumed designated-perk approval may bind once.
}
export type JitIdentityLedger = {
  version: 1
  requests: Record<string, JitIdentityRequestRecord>
  authorizations: Record<string, JitIdentityAuthorizationRecord>
}
