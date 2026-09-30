// Browser-safe DTOs only. A status flag is not permission to execute an action.
export const JIT_IDENTITY_VERSION = "ktour-jit-identity/v1" as const
export const JIT_IDENTITY_CONSENT = "ktour-identity-purpose-2026-09-29" as const
export const CX_AGE19_POLICY = "cx-birth-full19-kst-mar1/v1" as const
export const JIT_REQUEST_ID = /^idn_[A-Za-z0-9_-]{16,32}$/
export const JIT_AUTHORIZATION_ID = /^ida_[A-Za-z0-9_-]{16,32}$/
export type JitIdentityAction = "pass_setup" | "local_moment" | "table_request" | "designated_perk" | "after19_access"
export type JitIdentityPurpose = "person" | "adult" | "age19"
export type JitIdentityContext = {
  action: JitIdentityAction
  purpose: JitIdentityPurpose
  venueId: string | null
  tableId: string | null
  // SHA-256 of the exact pending action, including a fresh browser intent ID.
  // No table message, passport data, or other private action payload is sent.
  contextDigest: string
}
export type JitIdentityEligibility = {
  version: typeof JIT_IDENTITY_VERSION
  provider: "omnione_cx"
  execution: "provider" | "unavailable"
  person: { state: "verified" | "proof_required" | "unavailable"; expiresAt: string | null }
  // This is the provider's explicit adult claim, NOT an inferred 19+ assertion.
  adult: { state: "verified" | "proof_required" | "not_verified" | "unavailable"; expiresAt: string | null }
  age19: { state: "verified" | "proof_required" | "not_verified" | "unavailable"; expiresAt: string | null }
  paymentKyc: { state: "unsupported" }
  canStart: boolean
  consentVersion: typeof JIT_IDENTITY_CONSENT
}
export type JitIdentityRequest = {
  version: typeof JIT_IDENTITY_VERSION
  requestId: string
  status: "awaiting_identity" | "preparing" | "handoff" | "checking" | "authorized" | "completed" | "denied" | "cancelled" | "expired" | "unknown"
  context: JitIdentityContext
  expiresAt: string
  handoff: import("./types").IdentityHandoff | null
  authorizationRef: string | null
  authorizationExpiresAt: string | null
  reason: string | null
}
export type JitIdentityReceipt = {
  version: typeof JIT_IDENTITY_VERSION
  receiptId: string
  context: JitIdentityContext
  authorizedAt: string
  expiresAt: string
  evidenceExpiresAt: string
  provider: "omnione_cx"
  personVerified: true
  adultVerified: boolean
  age19Verified?: boolean
  age19Policy?: string
  paymentKycVerified: false
  // Authentication permits only resuming this pending action. It does not
  // confirm a merchant booking, payment, benefit, credential, or chain write.
}
