import { JIT_AUTHORIZATION_ID, JIT_REQUEST_ID } from "./jit-identity-contract"
import { assert } from "./util"

/** Exact additive route/body boundary; profile origin/access checks still run. */
export function jitIdentityRouteAllowed(method: string, p: readonly string[]) {
  if (!Array.isArray(p) || p.length > 4 || p.some(v => typeof v !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(v))) return false
  if (p[0] !== "identity") return false
  if (method === "GET") return (p.length === 2 && p[1] === "eligibility") ||
    ((p.length === 3 || (p.length === 4 && p[3] === "receipt")) && p[1] === "requests" && JIT_REQUEST_ID.test(p[2]))
  if (method !== "POST") return false
  return (p.length === 2 && p[1] === "requests") ||
    (p.length === 4 && p[1] === "requests" && JIT_REQUEST_ID.test(p[2]) && ["start", "complete", "cancel"].includes(p[3])) ||
    (p.length === 4 && p[1] === "authorizations" && JIT_AUTHORIZATION_ID.test(p[2]) && p[3] === "consume")
}
export function assertJitIdentityBody(p: readonly string[], body: unknown): asserts body is Record<string, unknown> {
  assert(jitIdentityRouteAllowed("POST", p) && body && typeof body === "object" && !Array.isArray(body), "bad_request", "Invalid identity action")
  const b = body as Record<string, unknown>
  const contextFields = ["action", "purpose", "venueId", "tableId", "contextDigest"]
  const fields = p.length === 2 ? [...contextFields, "consentVersion"] : p[1] === "authorizations" ? contextFields : p[3] === "start" ? ["mobile"] : []
  assert(Object.keys(b).length === fields.length && Object.keys(b).every(k => fields.includes(k)), "bad_request", "Unexpected identity claims")
  if (p[3] === "start") assert(typeof b.mobile === "boolean", "bad_request", "Invalid handoff type")
}
