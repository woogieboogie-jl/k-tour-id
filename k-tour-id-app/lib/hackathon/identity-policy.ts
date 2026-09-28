import { hkConfig } from "./config"
import type { IdentityEvidence } from "./types"
import { assert } from "./util"

/** A persisted identity is authority from its original mode/provider, not the
 * deployment currently reading it. Missing evidence is rejected by the
 * existing phase/eligibility checks; this check never creates evidence. */
export function identityPolicyChanged(identity: Pick<IdentityEvidence, "mode" | "provider"> | null | undefined): boolean {
  const current = hkConfig().cx
  return !!identity && (identity.mode !== current.mode || identity.provider !== current.provider)
}

export function assertCurrentIdentityPolicy(identity: Pick<IdentityEvidence, "mode" | "provider"> | null | undefined): void {
  assert(!identityPolicyChanged(identity), "cx_mode_changed", "Identity configuration changed; cancel and restart.", 409)
}
