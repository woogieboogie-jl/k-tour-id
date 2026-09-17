// Shared DTOs for the hackathon journey. Safe to import from client code (types only).

export type OperationStatus = "pending" | "succeeded" | "failed" | "cancelled" | "expired" | "unknown"
export type Phase =
  | "consent" | "identity" | "issuance" | "presentation" | "proposal"
  | "delegation" | "agent" | "fulfillment" | "done" | "cancelled" | "failed" | "expired"
export type Decision = "allow" | "proof_required" | "deny" | "expired"
export type NextAction = "wait" | "check_status" | "retry" | "return"
export type AllowedAction =
  | "open_handoff" | "complete_handoff" | "issue" | "ack_holder" | "present"
  | "propose" | "approve" | "sign_delegation" | "run_agent" | "redeem"
  | "revoke" | "cancel" | "check_status" | "reconcile" | "return"

export type ChainStatus = "pending" | "submitted" | "confirmed" | "failed" | "unknown"

export type IdentityHandoff =
  | { kind: "mock"; label: string; expiresAt: string }
  | { kind: "qr"; qrBase64: string; cxId: string; expiresAt: string }
  | { kind: "app"; androidLink?: string; iosLink?: string; ssPayLink?: string; cxId: string; expiresAt: string }

export type IdentityEvidence = {
  evidenceId: string
  subjectRef: string
  source: "cx_mobile_id"
  mode: "mock" | "cx"
  provider: string
  personVerified: boolean
  adultVerified: boolean | null
  verifiedAt: string
  expiresAt: string
  providerTransactionRef: string
}

export type CredentialSummary = {
  credentialRef: string
  vcId: string
  schema: string
  mode: "mock" | "opendid"
  issuerDid: string
  holderBinding: string
  serviceAccess: string[]
  validFrom: string
  validUntil: string
  statusRef: string
  status: "active" | "revoked" | "expired" | "unknown"
  holderAckAt: string | null
}

export type PresentationSummary = {
  presentationId: string
  nonce: string
  requestDigest: string
  requestedClaims: string[]
  expiresAt: string
  submittedAt: string | null
  verifiedAt: string | null
  decision: Decision | null
  decisionRef: string | null
  decisionExpiresAt: string | null
  decisionConsumedAt: string | null
  denyReason: string | null
}

export type ProposalOutput = {
  action: "redeem_demo_entitlement"
  target: { venueId: string; campaignId: string }
  title: string
  summary: string
  rationale: string
  language: "ko" | "en" | "ja"
}

export type ProposalSummary = {
  proposalId: string
  mode: "gemini" | "rule"
  model: string
  promptVersion: string
  policyVersion: number
  inputDigest: string
  output: ProposalOutput
  outputDigest: string
  proposalDigest: string
  createdAt: string
  guard: { injectionSuspected: boolean; schemaValid: boolean }
}

export type DelegationSummary = {
  delegationId: string
  status: "prepared" | "entitled" | "awaiting_signature" | "delegated" | "revoked" | "failed" | "unknown"
  intentRef: string
  actionCommitment: string
  consentCommitment: string
  userAddress: string
  signer: "zklogin" | "demo"
  recipient: string
  expiresAtMs: number
  entitlement: { objectId: string; version: string; digest: string; txDigest: string } | null
  grant: { objectId: string; initialSharedVersion: string; txDigest: string } | null
  txBytesDigest: string | null
  userTxDigest: string | null
  error: string | null
}

export type AgentSummary = {
  dispatchId: string
  status: "queued" | "executed" | "failed" | "unknown"
  decisionCommitment: string
  manifestCommitment: string
  manifest: Record<string, unknown> | null
  txDigest: string | null
  recordId: string | null
  verified: { effectsOk: boolean; eventOk: boolean; grantUses: number | null; checkedAt: string } | null
  error: string | null
}

export type FulfillmentSummary = {
  status: "pending" | "blocked" | "redeemed"
  reason: string | null
  redemptionRef: string | null
  redeemedAt: string | null
  recheck: { credential: string; presentation: string; sui: string; campaign: string } | null
}

export type ChainRecord = {
  outboxId: string
  eventKey: string
  payloadCommitment: string
  status: ChainStatus
  txHash: string | null
  blockNumber: number | null
  attempts: number
  lastError: string | null
  confirmedAt: string | null
}

export type OperationResult = {
  operationId: string
  kind: "demo_entitlement"
  venueId: string
  campaignId: string
  policyVersion: number
  status: OperationStatus
  phase: Phase
  revision: number
  createdAt: string
  updatedAt: string
  expiresAt: string
  execution: "provider" | "sample"
  safeNextAction: NextAction
  allowedActions: AllowedAction[]
  returnContext: { venueId: string; focus: "offer" } | null
  consent: { version: string; digest: string; acceptedAt: string } | null
  identity: (IdentityEvidence & { handoff: IdentityHandoff | null }) | null
  credential: CredentialSummary | null
  presentation: PresentationSummary | null
  proposal: ProposalSummary | null
  delegation: DelegationSummary | null
  agent: AgentSummary | null
  fulfillment: FulfillmentSummary | null
  chain: ChainRecord | null
  error: { code: string; message: string; retryable: boolean } | null
}
