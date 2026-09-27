import { HkError } from "./util"

// A provider/SDK error can contain an authenticated URL, JWT, signature, or
// identity response. Do not redact with a regex: never publish its text at all.
// Only app-owned codes, HTTP statuses, and fixed copy cross this boundary.
const CODES = new Set(`
address bad_request campaign_closed cannot_cancel consent_version csrf
cx_error cx_handoff cx_http cx_mode_changed cx_preview_access_denied cx_preview_body
cx_preview_scope cx_preview_unavailable cx_request cx_response cx_sample_not_allowed
cx_state cx_subject_unavailable cx_transaction_mismatch cx_transaction_missing
credential_expired decision_expired delegation_pending delegation_preparation_unknown eligibility
evidence_expired grant_expired grant_revoked grant_window_expired holder_ack_invalid
holder_key holder_mismatch idempotency_conflict identity_start_pending identity_start_failed
identity_cancelled identity_failed identity_expired isolated_mock_external_disabled
integration_preview_unavailable integration_preview_access_denied integration_preview_scope
no_session nonce not_found omnione_evidence_unavailable omnione_submission_not_started
omnione_transaction_mismatch omnione_unconfigured opendid_provider_unimplemented
operation_changed operation_proof outbox_claim_lost phase presentation_mismatch
proposal_digest store_canary_ownership store_configuration store_corrupt store_lease_lost
store_unavailable sui_consume sui_delegate sui_delegate_verify sui_evidence_mismatch
sui_evidence_missing sui_execute sui_execute_failed sui_gas_budget sui_issue_verify
sui_read sui_unconfigured tx_mismatch venue_unsupported wallet_proof
zklogin_aud zklogin_enoki zklogin_exp zklogin_iss zklogin_jwt zklogin_prover zklogin_unconfigured
`.trim().split(/\s+/))
const STATUSES = new Set([400, 401, 403, 404, 409, 410, 413, 415, 422, 429, 500, 502, 503, 504])
type PublicFailure = { status: number; error: { code: string; message: string; retryable: boolean } }

const FIXED: Record<string, string> = {
  csrf: "Open this service directly to continue.",
  cx_preview_access_denied: "Enter the approved access code to continue.",
  cx_preview_scope: "Only Mobile ID verification is enabled in this preview.",
  cx_preview_unavailable: "Identity verification is temporarily unavailable.",
  integration_preview_unavailable: "This integration preview is not available yet.",
  integration_preview_access_denied: "Enter the approved access code to continue.",
  integration_preview_scope: "This action is not available in the integration preview.",
  no_session: "Your session is unavailable. Start again to continue.",
  not_found: "The requested item could not be found.",
  operation_changed: "This request changed. Check its current status before continuing.",
  phase: "This step is no longer available. Check the current status.",
  cannot_cancel: "This action cannot be cancelled now. Check its current status.",
  wallet_proof: "Your wallet approval could not be verified.",
  isolated_mock_external_disabled: "External services are disabled in isolated mock mode.",
  opendid_provider_unimplemented: "Pass verification is not available yet.",
  sui_execute_failed: "The chain rejected this transaction. No success has been confirmed.",
  sui_delegate: "The delegation result is unavailable. Check its status before trying again.",
  sui_consume: "The execution result is unavailable. Check its status before trying again.",
  omnione_evidence_unavailable: "The record is not confirmed yet. Check again without resubmitting.",
  omnione_transaction_mismatch: "The broadcast response does not match the prepared transaction. Check the saved transaction status.",
  store_lease_lost: "This request changed while saving. Check its current status before continuing.",
  store_unavailable: "Journey storage is temporarily unavailable. Check the result before trying again.",
}

/** No logging, provider inspection, secret/environment reads, or cause traversal. */
export function safeHkError(error: unknown, options: { cxPreview?: boolean } = {}): PublicFailure {
  const fallback = (): PublicFailure => options.cxPreview
    ? { status: 503, error: { code: "cx_preview_unavailable", message: FIXED.cx_preview_unavailable, retryable: true } }
    : { status: 500, error: { code: "internal", message: "The request could not be completed. Check its status before trying again.", retryable: true } }
  try {
    if (!(error instanceof HkError)) return fallback()
    const fields = ["code", "status", "retryable"].map(name => Object.getOwnPropertyDescriptor(error, name))
    if (fields.some(field => !field || !("value" in field))) return fallback()
    // Snapshot data properties once. Accessors cannot change a code/status
    // between allowlist validation and response construction.
    const [code, status, retryable] = fields.map(field => field!.value)
    if (!CODES.has(code) || !STATUSES.has(status) || typeof retryable !== "boolean") return fallback()
    const message = Object.hasOwn(FIXED, code) ? FIXED[code]
      : /(?:expired|zklogin_exp)$/.test(code) ? "This request has expired. Start again to continue."
      : code === "identity_cancelled" ? "Identity verification was cancelled."
      : status >= 500 ? "This service is temporarily unavailable. Check the current status before trying again."
      : status === 429 ? "Please wait before trying again."
      : "This request could not be verified. Check the current step and try again."
    return { status, error: { code, message, retryable } }
  } catch { return fallback() }
}
