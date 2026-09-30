// Server policy over an authenticated CX completion-token birth claim.
// Never an interpretation of AdultVerify, CI, a client DOB, or ZKP=true.
import { HkError } from "./util"
import type { IdentityEvidence } from "./types"
import { CX_AGE19_POLICY } from "./jit-identity-contract"

export { CX_AGE19_POLICY } from "./jit-identity-contract"
export function cxAge19FromClaims(claims: Record<string, unknown>, now = Date.now()): boolean | null {
  const birth = claims.birth
  // Only the documented canonical field can create authority. Known aliases
  // cannot contradict it or silently become a fallback source.
  for (const key of ["birthDate", "birthdate", "dateOfBirth", "dob"]) {
    if (birth !== undefined && claims[key] !== undefined && claims[key] !== birth) throw new HkError("cx_age_claim_conflict", "Identity age information is inconsistent", 502)
  }
  if (typeof birth !== "string" || !/^\d{8}$/.test(birth) || !Number.isFinite(now)) return null
  const year = Number(birth.slice(0, 4)), month = Number(birth.slice(4, 6)), day = Number(birth.slice(6, 8))
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return null
  const calendar = new Date(Date.UTC(year, month - 1, day))
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return null
  const current = new Date(now + 9 * 60 * 60_000)
  if (!Number.isFinite(current.getTime())) return null
  const currentDate = current.getUTCFullYear() * 10_000 + (current.getUTCMonth() + 1) * 100 + current.getUTCDate()
  if (Number(birth) > currentDate) return null
  // Comparing MMDD makes 29-Feb reach the threshold on 1-Mar in non-leap
  // years. This conservative product rule is explicit, not a legal claim.
  return currentDate >= (year + 19) * 10_000 + month * 100 + day
}

export function currentCxAge19(e: Pick<IdentityEvidence, "mode" | "age19Verified" | "age19Policy"> | null | undefined) {
  return e?.mode === "cx" && e.age19Verified === true && e.age19Policy === CX_AGE19_POLICY
}
