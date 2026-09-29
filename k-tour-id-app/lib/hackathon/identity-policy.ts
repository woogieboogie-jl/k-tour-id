import { hkConfig } from "./config"
import type { IdentityEvidence } from "./types"
import { assert, digestOf, sha256Hex } from "./util"

export function currentCxPolicyDigest(): string {
  const c = hkConfig()
  return digestOf({ version: 1, mode: c.cx.mode, provider: c.cx.provider, origin: c.cx.baseUrl,
    zkpType: c.cx.zkpType, subjectKey: sha256Hex(c.opendid.signingSeed) })
}

/** A persisted identity is authority from its original mode/provider, not the
 * deployment currently reading it. Missing evidence is rejected by the
 * existing phase/eligibility checks; this check never creates evidence. */
export function identityPolicyChanged(identity: Pick<IdentityEvidence, "mode" | "provider" | "sourceCurrent"> | null | undefined): boolean {
  const current = hkConfig().cx
  return !!identity && (identity.mode !== current.mode || identity.provider !== current.provider || identity.sourceCurrent === false)
}

export function assertCurrentIdentityPolicy(identity: Pick<IdentityEvidence, "mode" | "provider" | "sourceCurrent"> | null | undefined): void {
  assert(!identityPolicyChanged(identity), "cx_mode_changed", "Identity configuration changed; cancel and restart.", 409)
}
