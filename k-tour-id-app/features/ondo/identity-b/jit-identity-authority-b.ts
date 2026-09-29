import type { JitIdentityContext, JitIdentityReceipt, JitIdentityRequest } from "@/lib/hackathon/jit-identity-contract"
import { jitIdentityCall, parseJitReceipt, sameJitContext } from "./jit-identity-client-b"

type Entry = { snapshot: string; request: JitIdentityRequest; receipt: JitIdentityReceipt | null }
// Deliberately process-memory only. Persisted browser state never grants identity.
const grants = new Map<string, Entry>()
const inflight = new Set<string>()
export const JIT_IDENTITY_CHANGED = "ondo-jit-identity-changed"
function notify() { if (typeof window !== "undefined") window.dispatchEvent(new Event(JIT_IDENTITY_CHANGED)) }
export function rememberJitAuthorization(token: string, snapshot: string, request: JitIdentityRequest) {
  if (request.status !== "authorized" || !request.authorizationRef || !request.authorizationExpiresAt || Date.parse(request.authorizationExpiresAt) <= Date.now()) return false
  grants.set(token, { snapshot, request, receipt: null }); notify(); return true
}
export function forgetJitAuthorization(token: string) { grants.delete(token); notify() }
export function clearJitAuthorizations() { grants.clear(); notify() }
export function hasJitAuthorization(token: string, snapshot: string | null, now = Date.now()) {
  const entry = grants.get(token)
  return Boolean(entry && snapshot === entry.snapshot && Date.parse(entry.request.expiresAt) > now && Date.parse(entry.request.authorizationExpiresAt ?? "") > now && entry.request.context.purpose === "person")
}
export function jitAuthorizationExpiresAt(token: string, snapshot: string | null) {
  const entry = grants.get(token)
  return entry && hasJitAuthorization(token, snapshot) ? Math.min(Date.parse(entry.request.expiresAt), Date.parse(entry.request.authorizationExpiresAt!)) : null
}
export function hasJitConsumedReceipt(token: string, snapshot: string | null, now = Date.now()) {
  const entry = grants.get(token)
  return Boolean(entry && snapshot === entry.snapshot && entry.receipt && Date.parse(entry.receipt.expiresAt) > now && Date.parse(entry.receipt.evidenceExpiresAt) > now && sameJitContext(entry.receipt.context, entry.request.context))
}
/** Called at the action's last boundary, never by the status UI. */
export async function consumeJitAuthorization(token: string, snapshot: string | null, isCurrent: () => boolean): Promise<boolean> {
  const entry = grants.get(token)
  if (!entry || !hasJitAuthorization(token, snapshot) || inflight.has(token) || !isCurrent()) return false
  if (hasJitConsumedReceipt(token, snapshot)) return isCurrent()
  inflight.add(token)
  try {
    let value: unknown
    try { value = await jitIdentityCall(`identity/authorizations/${entry.request.authorizationRef}/consume`, entry.request.context) }
    catch {
      // Lost writes are reconciled via GET, not retried as another approval.
      value = await jitIdentityCall(`identity/requests/${entry.request.requestId}/receipt`)
    }
    const receipt = parseJitReceipt(value, entry.request.context)
    if (grants.get(token) !== entry || !isCurrent() || !hasJitAuthorization(token, snapshot)) return false
    entry.receipt = receipt; return true
  } catch { return false } finally { inflight.delete(token) }
}
export function jitAuthorizationContext(token: string): JitIdentityContext | null { return grants.get(token)?.request.context ?? null }
