// Synchronous signing boundary: no Sui/prover/Google adapter imports or I/O.
import type { OperationRecord } from "./store"
import { assert, digestOf } from "./util"
import { hkConfig } from "./config"
import { isHostedSuiProfile, hostedZkLoginEnabled, hostedSuiPreflightIssues } from "./hosted-sui-profile"
import { selectZkLoginProvider } from "./zklogin-provider-selection"

export const zkLoginOperationBinding = (op: OperationRecord) => digestOf({ operationId: op.operationId, sessionId: op.sessionId, venueId: op.venueId, campaignId: op.campaignId, policyVersion: op.policyVersion, identity: op.identity, credential: op.credential, presentation: op.presentation, proposal: op.proposal?.proposalDigest, consent: op.consent?.digest })
export function currentZkLoginConfig() {
  const config = hkConfig(), c = config.sui
  assert(!config.isolatedMock && !config.cxPreview && (!isHostedSuiProfile() || (hostedZkLoginEnabled() && !hostedSuiPreflightIssues().length)) && c.googleClientId && c.zkSaltSeed && selectZkLoginProvider(process.env), "zklogin_unconfigured", "Google sign-in is unavailable", 503)
  return { googleClientId: c.googleClientId, binding: digestOf({ audience: c.googleClientId, salt: c.zkSaltSeed, prover: c.zkProverUrl, network: c.network, packageId: c.packageId, campaignId: c.campaignId, enoki: process.env.ENOKI_API_KEY ?? "", enokiUrl: process.env.ENOKI_API_URL ?? "" }) }
}
/** Every new attempt and every connected-hosted signing mutation must retain
 * the current proof authority. Historical non-hosted rows keep their previous
 * cryptographic signature checks; this function does not grant them authority. */
export function assertZkLoginSigningAttempt(op: OperationRecord, userAddress: string, now = Date.now()) {
  const a = op.secrets.zkLoginAttempt
  if (!isHostedSuiProfile() && !a) return
  assert(a?.status === "proved" && a.operationId === op.operationId && a.address === userAddress && a.inputs && a.binding === zkLoginOperationBinding(op) && a.configBinding === currentZkLoginConfig().binding &&
    Date.parse(a.expiresAt) > now && Date.parse(op.expiresAt) > now && op.status === "pending" && op.phase === "delegation" && !op.secrets.identityImportInvalid && op.identity?.sourceCurrent !== false,
    "zklogin_attempt_inactive", "The sign-in approval is no longer current", 409)
}
