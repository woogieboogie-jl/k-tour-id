/** The committed ac9c2d31 native app transport, not an identity/VC authority.
 * Native replies and events never authorize an operation. The main BFF does.
 * QR, request payloads and native errors are never persisted or logged here.
 */
export type NativeAppUi = { locale: "ko" | "en" | "ja"; theme: "light" | "dark" }
export type NativeAppEnvironment = { origin: string; isTopLevel: boolean; bridge: unknown }
export type NativeAppBridge = {
  available: true; version: 1; platform: "ios"
  wallet(options?: { include?: "passes" }): Promise<unknown>
  setup(args: { requestId: string; ui: NativeAppUi }): Promise<unknown>
  unlock(args: { requestId: string; ui: NativeAppUi }): Promise<unknown>
  issue(args: { requestId: string; qr: string; ui: NativeAppUi; bindingId?: string }): Promise<unknown>
  present(args: { requestId: string; qr: string; ui: NativeAppUi; bindingId?: string }): Promise<unknown>
  cancel(args: { requestId: string }): Promise<unknown>
}
export const NATIVE_APP_CODES = ["busy", "not_ready", "setup_not_configured", "offer_invalid", "offer_kind_mismatch", "offer_expired", "offer_untrusted", "verifier_untrusted", "credential_missing", "credential_inactive", "holder_not_registered", "pin_locked_out", "network", "provider_rejected", "provider_transient", "wallet_error", "timeout", "navigated"] as const
const METHODS = ["wallet", "setup", "unlock", "issue", "present", "cancel"] as const
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/
const REQUEST_ID = /^[0-9a-f]{32}$/
const MAIN_ORIGIN = "https://ktour-id.vercel.app"
/** The server separately requires both markers, isolated storage and the exact
 * request host. This build flag only exposes a transport; it is not authority. */
export function nativeAppOriginAllowed(origin: string, marker = process.env.NEXT_PUBLIC_HK_LOCAL_NATIVE, mode: string = process.env.NODE_ENV): boolean {
  return origin === MAIN_ORIGIN || origin === "http://127.0.0.1:3183" && marker === "local-native-20260930-v1" && mode === "development"
}
export type NativeAppFlowResult = { v: 1; requestId: string; outcome: "submitted" | "declined" | "cancelled" | "failed"; retryable: boolean; code?: typeof NATIVE_APP_CODES[number]; providerCode?: string }
export type NativeAppCancelResult = { v: 1; cancelled: boolean; reason?: "none_running" | "in_flight" | "other_request" }
export type NativeAppWalletResult = { v: 1; state: "needs_setup" | "setup_incomplete" | "locked" | "ready" | "unavailable"; biometric: "none" | "available" | "enrolled"; holder: "synthetic" | "cx_bound"; code?: typeof NATIVE_APP_CODES[number] }
export type NativeBindingLaunch = { version: "cx-holder-v1"; operationId: string; bindingId: string; token: string; authNonce: string; expiresAt: string; status: string }
export type NativeBindingAppBridge = NativeAppBridge & { bindingVersion: "cx-holder-v1"; bind(args: { requestId: string; binding: Omit<NativeBindingLaunch, "version" | "status">; ui: NativeAppUi }): Promise<unknown> }
export function nativeBindingAppBridge(env: NativeAppEnvironment): NativeBindingAppBridge | null {
  const bridge = nativeAppBridge(env)
  return bridge && nativeDataValue(bridge, "bindingVersion") === "cx-holder-v1" && typeof nativeDataValue(bridge, "bind") === "function" ? bridge as NativeBindingAppBridge : null
}
export function parseNativeBindingLaunch(value: unknown, operationId: string, now = Date.now()): NativeBindingLaunch | null {
  const d = exact(value, ["version", "operationId", "bindingId", "token", "authNonce", "expiresAt", "status"])
  if (!d || d.version !== "cx-holder-v1" || d.operationId !== operationId || typeof d.bindingId !== "string" || !/^nhb_[A-Za-z0-9_-]{24}$/.test(d.bindingId) || typeof d.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(d.token) || typeof d.authNonce !== "string" || !/^[0-9a-f]{64}$/.test(d.authNonce) || typeof d.expiresAt !== "string" || !Number.isFinite(Date.parse(d.expiresAt)) || Date.parse(d.expiresAt) <= now || Date.parse(d.expiresAt) > now + 600_000 || d.status !== "challenge") return null
  return Object.freeze(d) as NativeBindingLaunch
}
export type NativeAppCallResult<T> = { status: "reply"; reply: T } | { status: "invalid_reply" | "timeout" | "cancelled" | "unavailable" }

/** Never invoke accessor properties on page-supplied capability objects/DTOs. */
export function nativeDataValue(object: unknown, key: string): unknown {
  try {
    if (!object || typeof object !== "object") return undefined
    const descriptor = Object.getOwnPropertyDescriptor(object, key)
    return descriptor && "value" in descriptor ? descriptor.value : undefined
  } catch { return undefined }
}
function exact(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    const descriptors = Object.getOwnPropertyDescriptors(value)
    if (Reflect.ownKeys(descriptors).some(key => typeof key !== "string" || ![...required, ...optional].includes(key))) return null
    if (required.some(key => !Object.prototype.hasOwnProperty.call(descriptors, key))) return null
    const result: Record<string, unknown> = {}
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!("value" in descriptor)) return null
      result[key] = descriptor.value
    }
    return result
  } catch { return null }
}
const includes = (values: readonly string[], value: unknown): value is string => typeof value === "string" && values.includes(value)

export function nativeAppBridge(env: NativeAppEnvironment): NativeAppBridge | null {
  try {
    if (!nativeAppOriginAllowed(env.origin) || !env.isTopLevel || !env.bridge || !Object.isFrozen(env.bridge)) return null
    if (nativeDataValue(env.bridge, "available") !== true || nativeDataValue(env.bridge, "version") !== 1 || nativeDataValue(env.bridge, "platform") !== "ios") return null
    if (!METHODS.every(method => typeof nativeDataValue(env.bridge, method) === "function")) return null
    return env.bridge as NativeAppBridge
  } catch { return null }
}
export function parseNativeAppFlow(value: unknown, requestId: string): NativeAppFlowResult | null {
  const d = exact(value, ["v", "requestId", "outcome", "retryable"], ["code", "providerCode"])
  if (!REQUEST_ID.test(requestId) || !d || d.v !== 1 || d.requestId !== requestId || !includes(["submitted", "declined", "cancelled", "failed"], d.outcome) || typeof d.retryable !== "boolean") return null
  if ("code" in d && !includes(NATIVE_APP_CODES, d.code)) return null
  if ("providerCode" in d && (typeof d.providerCode !== "string" || !/^(MSDK|SSRV)[A-Z]{3}[0-9]{5}$/.test(d.providerCode))) return null
  return Object.freeze(d) as NativeAppFlowResult
}
export function parseNativeAppCancel(value: unknown): NativeAppCancelResult | null {
  const d = exact(value, ["v", "cancelled"], ["reason"])
  if (!d || d.v !== 1 || typeof d.cancelled !== "boolean" || ("reason" in d && !includes(["none_running", "in_flight", "other_request"], d.reason))) return null
  if (d.cancelled && "reason" in d) return null
  return Object.freeze(d) as NativeAppCancelResult
}
export function parseNativeAppWallet(value: unknown): NativeAppWalletResult | null {
  // wallet() is called without include:passes. No credential/display data crosses this port.
  const d = exact(value, ["v", "state", "biometric", "holder"], ["code"])
  if (!d || d.v !== 1 || !includes(["synthetic", "cx_bound"], d.holder) || !includes(["needs_setup", "setup_incomplete", "locked", "ready", "unavailable"], d.state) || !includes(["none", "available", "enrolled"], d.biometric)) return null
  if ("code" in d && !includes(NATIVE_APP_CODES, d.code)) return null
  return Object.freeze(d) as NativeAppWalletResult
}
export function nativeAppOfferText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !CONTROL.test(value) && new TextEncoder().encode(value).byteLength <= 8192
}
export function nativeAppUi(value: unknown): value is NativeAppUi {
  const d = exact(value, ["locale", "theme"])
  return !!d && includes(["ko", "en", "ja"], d.locale) && includes(["light", "dark"], d.theme)
}

/** Bounded transport only. Cancellation/timeout invalidates any late reply;
 * it cannot undo a provider request already sent by the native app. */
export function boundedNativeAppCall<T>(call: () => Promise<unknown>, parse: (reply: unknown) => T | null, options: { timeoutMs: number; signal?: AbortSignal }): Promise<NativeAppCallResult<T>> {
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 240_000) return Promise.resolve({ status: "unavailable" })
  return new Promise(resolve => {
    let settled = false
    const finish = (result: NativeAppCallResult<T>) => {
      if (settled) return
      settled = true; clearTimeout(timer); options.signal?.removeEventListener("abort", abort); resolve(result)
    }
    const abort = () => finish({ status: "cancelled" })
    const timer = setTimeout(() => finish({ status: "timeout" }), options.timeoutMs)
    options.signal?.addEventListener("abort", abort, { once: true })
    if (options.signal?.aborted) { abort(); return }
    try {
      Promise.resolve(call()).then(value => {
        if (settled) return
        try { const reply = parse(value); finish(reply ? { status: "reply", reply } : { status: "invalid_reply" }) } catch { finish({ status: "invalid_reply" }) }
      }, () => finish({ status: "unavailable" }))
    } catch { finish({ status: "unavailable" }) }
  })
}
export const readNativeAppWallet = (bridge: NativeAppBridge, signal?: AbortSignal) => boundedNativeAppCall(() => bridge.wallet(), parseNativeAppWallet, { timeoutMs: 5000, signal })
export function cancelNativeAppRequest(bridge: NativeAppBridge, requestId: string): Promise<NativeAppCallResult<NativeAppCancelResult>> {
  if (!REQUEST_ID.test(requestId)) return Promise.resolve({ status: "unavailable" })
  return boundedNativeAppCall(() => bridge.cancel({ requestId }), parseNativeAppCancel, { timeoutMs: 5000 })
}
