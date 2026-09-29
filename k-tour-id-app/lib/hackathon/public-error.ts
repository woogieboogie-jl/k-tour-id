import { HkError } from "./util"

// A provider/SDK error can contain an authenticated URL, JWT, signature, or
// identity response. Do not redact with a regex: never publish its text at all.
// Only app-owned codes, HTTP statuses, and fixed copy cross this boundary.
const CODES = new Set(`
address bad_request campaign_closed cannot_cancel consent_version csrf
jit_identity_unavailable jit_identity_scope jit_identity_inactive jit_identity_expired jit_identity_proof jit_identity_limit jit_identity_start_used jit_identity_poll_limit
guide_setup_required guide_ai_unavailable guide_collection_invalid guide_already_saved guide_save_in_progress zklogin_required
guide_production_unavailable guide_access_denied guide_production_scope
opendid_provider_required opendid_permission_required opendid_permission_expired opendid_status_required
opendid_cx_mapping_unavailable opendid_configuration opendid_busy opendid_phase opendid_expired opendid_request_required
opendid_provider_binding opendid_credential_expired opendid_policy_unsupported
opendid_provider_configuration opendid_provider_response opendid_provider_timeout opendid_provider_unavailable opendid_provider_rejected
opendid_binding opendid_identity_required opendid_operation_binding opendid_operation_inactive
opendid_mode_changed opendid_mode_required opendid_cancel_after_execution opendid_credential_required opendid_credential_inactive
opendid_credential_binding opendid_presentation_binding opendid_action opendid_subject_mismatch decision_consumed
cx_error cx_handoff cx_http cx_mode_changed cx_preview_access_denied cx_preview_body
cx_preview_scope cx_preview_unavailable cx_request cx_response cx_sample_not_allowed
cx_state cx_subject_unavailable cx_transaction_mismatch cx_transaction_missing
credential_expired decision_expired delegation_pending delegation_preparation_unknown eligibility
evidence_expired grant_expired grant_revoked grant_window_expired holder_ack_invalid
holder_key holder_mismatch idempotency_conflict identity_start_pending identity_start_failed
identity_cancelled identity_failed identity_expired isolated_mock_external_disabled
integration_preview_unavailable integration_preview_access_denied integration_preview_scope
integration_sui_scope integration_sui_budget integration_sui_limit integration_sui_migration_required
integration_shared_budget integration_cutover_unverified integration_cutover_source_changed
integration_cutover_authority_unavailable integration_cutover_operator_configuration integration_cutover_outcome_unknown integration_cutover_conflict
hosted_sui_unavailable hosted_sui_access_denied hosted_sui_scope hosted_sui_limit
no_session nonce not_found omnione_evidence_unavailable omnione_submission_not_started
omnione_transaction_mismatch omnione_unconfigured opendid_provider_unimplemented
operation_changed operation_proof outbox_claim_lost phase presentation_mismatch
proposal_digest store_canary_ownership store_configuration store_corrupt store_lease_lost
store_unavailable sui_consume sui_delegate sui_delegate_verify sui_evidence_mismatch
sui_evidence_missing sui_execute sui_execute_failed sui_gas_budget sui_issue_verify
sui_read sui_unconfigured tx_mismatch venue_unsupported wallet_proof
zklogin_aud zklogin_enoki zklogin_exp zklogin_iss zklogin_jwt zklogin_prover zklogin_unconfigured
zklogin_attempt_inactive zklogin_attempt_used zklogin_attempt_limit zklogin_attempt_unknown zklogin_epoch zklogin_origin
ai_generation_already_requested
`.trim().split(/\s+/))
const STATUSES = new Set([400, 401, 403, 404, 409, 410, 413, 415, 422, 429, 500, 502, 503, 504])
type PublicFailure = { status: number; error: { code: string; message: string; retryable: boolean } }

const FIXED: Record<string, string> = {
  ai_generation_already_requested: "The assistant request was already sent. Check its current result; it will not be sent again.",
  zklogin_attempt_inactive: "This sign-in expired or its approval context changed. Return to the same operation.",
  zklogin_attempt_used: "Check or cancel the current sign-in before starting another.",
  zklogin_attempt_limit: "This operation has reached its sign-in attempt limit.",
  zklogin_attempt_unknown: "The sign-in result is uncertain. Check its status; do not resubmit.",
  zklogin_epoch: "The sign-in epoch changed. Refresh the operation before starting again.",
  zklogin_origin: "Open the main app to sign in with Google.",
  jit_identity_unavailable: "Identity checking is not available in this session.",
  jit_identity_scope: "This identity approval belongs to a different action.",
  jit_identity_inactive: "This identity request is no longer active.",
  jit_identity_expired: "This action approval has expired. Start the check again.",
  jit_identity_proof: "Current provider identity evidence is required for this action.",
  jit_identity_limit: "This session has reached its identity request limit.",
  jit_identity_start_used: "This identity attempt is already reserved. Check its current status.",
  jit_identity_poll_limit: "Please wait before checking the identity result again.",
  guide_production_unavailable: "Guide saving is not available yet. You can keep reading.",
  guide_access_denied: "Enter the journey access code to continue.",
  guide_production_scope: "This action is not available in the guide journey.",
  guide_setup_required: "Guide saving is not connected yet. You can keep reading this guide.",
  guide_already_saved: "This guide is already in your pass. Open it from your collection.",
  guide_save_in_progress: "A save is already in progress. Check its status instead of starting again.",
  guide_ai_unavailable: "The guide assistant is unavailable. No execution was approved.",
  opendid_provider_required: "Continue this step in the connected pass app.",
  opendid_cx_mapping_unavailable: "The identity-to-pass connection is not available yet.",
  opendid_policy_unsupported: "The pass connection does not support this action yet.",
  zklogin_required: "Sign in to approve this guide save.",
  hosted_sui_unavailable: "This journey is temporarily unavailable.",
  hosted_sui_access_denied: "Enter the journey access code to continue.",
  hosted_sui_scope: "This action is not enabled in this journey.",
  hosted_sui_limit: "This journey has reached its execution limit.",
  csrf: "Open this service directly to continue.",
  cx_preview_access_denied: "Enter the approved access code to continue.",
  cx_preview_scope: "Only Mobile ID verification is enabled in this preview.",
  cx_preview_unavailable: "Identity verification is temporarily unavailable.",
  integration_preview_unavailable: "This integration preview is not available yet.",
  integration_preview_access_denied: "Enter the approved access code to continue.",
  integration_preview_scope: "This action is not available in the integration preview.",
  integration_sui_scope: "The approved integration Testnet scope is unavailable.",
  integration_sui_budget: "The retained integration execution budget is unavailable.",
  integration_sui_limit: "This integration journey has reached its execution limit.",
  integration_sui_migration_required: "The shared execution budget migration is not prepared.",
  integration_shared_budget: "The shared execution budget is unavailable. No new execution is authorized.",
  integration_cutover_unverified: "Execution authorization is not ready. No new execution is authorized.",
  integration_cutover_source_changed: "Execution authorization changed. Check the current status; do not resubmit.",
  integration_cutover_authority_unavailable: "Execution authorization is unavailable. No new execution is authorized.",
  integration_cutover_operator_configuration: "Execution authorization is unavailable. No new execution is authorized.",
  integration_cutover_outcome_unknown: "The preparation result is unconfirmed. Check the saved state; do not resubmit.",
  integration_cutover_conflict: "Execution authorization changed. Check the current status; do not resubmit.",
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
