import { isGuideJourney } from "@/lib/hackathon/guide-contract"
import type { OperationResult } from "@/lib/hackathon/types"
import { nativeBindingAppBridge, nativeAppOfferText, nativeAppUi, boundedNativeAppCall, parseNativeAppFlow, cancelNativeAppRequest, type NativeAppUi, type NativeBindingAppBridge } from "./native-app-v1-transport-b"

const MAIN_ORIGIN = "https://ktour-id.vercel.app"
const OFFER_WINDOW_MS = 120_000
type NativeBridge = { available: true; platform: "ios"; openOffer(qr: string): void; showWallet(): void }
export type NativeEnvironment = { origin: string; isTopLevel: boolean; bridge: unknown }
export type NativeOfferContext = Pick<OperationResult, "operationId" | "venueId" | "campaignId" | "policyVersion" | "phase" | "revision" | "expiresAt" | "status" | "execution"> & { providerSupported: boolean }
export type NativeOfferAttempt = "sent" | "stale" | "already_sent" | "unavailable" | "failed"

function value(object: unknown, key: string): unknown {
  if (!object || typeof object !== "object") return undefined
  const descriptor = Object.getOwnPropertyDescriptor(object, key)
  return descriptor && "value" in descriptor ? descriptor.value : undefined
}
function bridgeFor(env: NativeEnvironment): NativeBridge | null {
  // This is a UI transport capability, NOT native attestation or identity proof.
  // Same-origin script can imitate an object; only the server decides permission.
  try {
    if (env.origin !== MAIN_ORIGIN || !env.isTopLevel || !env.bridge || !Object.isFrozen(env.bridge)) return null
    if (value(env.bridge, "available") !== true || value(env.bridge, "platform") !== "ios" ||
      typeof value(env.bridge, "openOffer") !== "function" || typeof value(env.bridge, "showWallet") !== "function") return null
    return env.bridge as NativeBridge
  } catch { return null }
}
export function nativeEnvironment(): NativeEnvironment {
  if (typeof window === "undefined") return { origin: "", isTopLevel: false, bridge: null }
  return { origin: window.location.origin, isTopLevel: window.top === window, bridge: value(window, "ktourNative") }
}
export const canUseNativeOfferHandoff = (env: NativeEnvironment): boolean => bridgeFor(env) !== null || nativeBindingAppBridge(env) !== null

/** Matches the server's implemented bridge-v1 policy. Guide V2 is deliberately
 * NOT added here merely because its web preparation screen exists. */
export function nativeV1Policy(op: OperationResult): boolean {
  return !op.journey && op.kind === "demo_entitlement" && op.policyVersion === 1
}
export function providerStepPolicy(op: OperationResult): "v1" | "guide" | null {
  return nativeV1Policy(op) ? "v1" : isGuideJourney(op) ? "guide" : null
}
export function nativeOfferContext(op: OperationResult): NativeOfferContext {
  const identityExpiry = Date.parse(op.identity?.expiresAt ?? "")
  const expiresAt = Number.isFinite(identityExpiry) && identityExpiry < Date.parse(op.expiresAt) ? op.identity!.expiresAt : op.expiresAt
  return { operationId: op.operationId, venueId: op.venueId, campaignId: op.campaignId, policyVersion: op.policyVersion,
    phase: op.phase, revision: op.revision, expiresAt, status: op.status, execution: op.execution,
    providerSupported: nativeV1Policy(op) && op.execution === "provider" && op.identity?.mode === "cx" && op.identity.source === "cx_mobile_id" && op.identity.personVerified === true && op.identity.sourceCurrent !== false && !op.identity.handoff && Number.isFinite(identityExpiry) && op.credential?.mode !== "mock" }
}
export function nativeOfferContextKey(context: NativeOfferContext): string {
  return JSON.stringify([context.operationId, context.venueId, context.campaignId, context.policyVersion, context.phase, context.revision, context.expiresAt, context.status, context.execution, context.providerSupported])
}
function current(context: NativeOfferContext, now: number): boolean {
  return context.providerSupported && context.policyVersion === 1 && context.execution === "provider" && context.status === "pending" &&
    (context.phase === "issuance" || context.phase === "presentation") &&
    typeof context.operationId === "string" && /^op_[A-Za-z0-9_-]{8,100}$/.test(context.operationId) &&
    Number.isSafeInteger(context.revision) && context.revision >= 0 && Number.isFinite(now) && Date.parse(context.expiresAt) > now
}

/** In-memory, single-send offer bound to one server response. It grants nothing;
 * there is deliberately no success callback, storage, event or auto-poll here. */
export function createNativeOfferHandoff(context: NativeOfferContext, qrPayload: string, receivedAt = Date.now(), bindingId?: string) {
  if (!current(context, receivedAt) || typeof qrPayload !== "string" || !qrPayload.trim() ||
    new TextEncoder().encode(qrPayload).byteLength > 8192 || qrPayload.includes("\0")) return null
  const key = nativeOfferContextKey(context)
  const expiresAt = Math.min(Date.parse(context.expiresAt), receivedAt + OFFER_WINDOW_MS)
  let payload: string | null = qrPayload
  let sent = false
  let appRequest: { bridge: NativeBindingAppBridge; requestId: string; controller: AbortController } | null = null
  const matches = (next: NativeOfferContext, now: number) => payload !== null && now < expiresAt && current(next, now) && nativeOfferContextKey(next) === key
  return {
    expiresAt,
    matches,
    invalidate() { payload = null; if (appRequest) { appRequest.controller.abort(); void cancelNativeAppRequest(appRequest.bridge, appRequest.requestId); appRequest = null } },
    async openApp(next: NativeOfferContext, env: NativeEnvironment, ui: NativeAppUi, now = Date.now()): Promise<NativeOfferAttempt> {
      if (!matches(next, now)) { payload = null; return "stale" }
      if (sent) return "already_sent"
      const bridge = nativeBindingAppBridge(env)
      if (!bridge || !bindingId || !/^nhb_[A-Za-z0-9_-]{24}$/.test(bindingId) || !nativeAppUi(ui) || !nativeAppOfferText(payload)) return "unavailable"
      sent = true
      const requestId = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("")
      const controller = new AbortController(); appRequest = { bridge, requestId, controller }
      const method = next.phase === "issuance" ? "issue" : "present"
      const result = await boundedNativeAppCall(() => bridge[method]({ requestId, qr: payload!, ui, bindingId }), v => parseNativeAppFlow(v, requestId), { timeoutMs: Math.max(1, Math.min(210_000, expiresAt - now)), signal: controller.signal })
      appRequest = null
      if (!matches(next, Date.now())) return "stale"
      // Even 'submitted' is only a transport acknowledgement. BFF refresh is
      // the sole authority; all outcomes consume this one-shot affordance.
      return result.status === "reply" && result.reply.outcome === "submitted" ? "sent" : "failed"
    },
    open(next: NativeOfferContext, env: NativeEnvironment, now = Date.now()): NativeOfferAttempt {
      if (!matches(next, now)) { payload = null; return "stale" }
      if (sent) return "already_sent"
      const bridge = bridgeFor(env)
      if (!bridge) return "unavailable"
      // Mark before invoking potentially reentrant native code. A throw has an
      // unknown outcome too: never repeat without a fresh explicit server check.
      sent = true
      try { bridge.openOffer(payload!); return "sent" } catch { return "failed" }
    },
  }
}
