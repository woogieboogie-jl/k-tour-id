/** Explicit, server-only, read-only bridge-v1 transport/authentication check.
 * This is NOT a VC/VP, holder mapping, issuer/schema, or main-flow success check.
 * The native implementation allocates only iss_* ids; this reserved non-iss id
 * reaches owned() -> 404 before expiry updates or issuer/ledger calls.
 */
import { createOpenDidBridgeClient, type OpenDidBridgeConfig } from "./adapters/opendid-provider"
import { validateOpenDidNativeBridgeConfig } from "./opendid-native-config"
import { HkError } from "./util"

export const OPEN_DID_NATIVE_PROBE_PATH = "/bridge/v1/issuances/ktour_probe_v1"
export type OpenDidNativeTransportReadiness = {
  protocol: "bridge-v1"
  verification: "transport_authentication_only"
  unauthenticatedRejected: true
  authenticatedRouteRecognized: true
  providerIntegrationAvailable: false
  cxHolderMappingVerified: false
  nativeIssuanceVerified: false
  nativePresentationVerified: false
  signingAllowed: false
}

const failure = () => new HkError("opendid_native_preflight_failed", "OpenDID bridge transport or authentication could not be verified", 503)
const exact = (value: unknown, keys: string[]): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))

export async function checkOpenDidNativeTransport(config: OpenDidBridgeConfig, fetcher: typeof fetch = fetch): Promise<OpenDidNativeTransportReadiness> {
  const cfg = validateOpenDidNativeBridgeConfig(config)
  const url = new URL(OPEN_DID_NATIVE_PROBE_PATH, cfg.baseUrl)
  const owner = createOpenDidBridgeClient(cfg).ownerBinding({ sessionId: "ktour_native_transport_probe", operationId: "ktour_probe_v1" })
  // Neither the URL nor this owner refers to a real identity or operation.
  async function check(authenticated: boolean) {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(failure()) }, cfg.timeoutMs) })
    const work = async () => {
      const headers: Record<string, string> = { accept: "application/json" }
      if (authenticated) { headers.authorization = `Bearer ${cfg.serviceToken}`; headers["x-ktour-owner"] = owner }
      const response = await fetcher(url, { method: "GET", headers, cache: "no-store", redirect: "error", signal: controller.signal })
      if (controller.signal.aborted || response.redirected || (response.url && response.url !== url.href)
        || response.status !== (authenticated ? 404 : 401)
        || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) {
        void response.body?.cancel().catch(() => undefined); throw failure()
      }
      const maxBytes = Math.min(cfg.maxResponseBytes, 4096), length = response.headers.get("content-length")
      if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) { void response.body?.cancel().catch(() => undefined); throw failure() }
      const reader = response.body?.getReader()
      if (!reader) throw failure()
      const chunks: Uint8Array[] = []; let size = 0
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (controller.signal.aborted) throw failure()
          if (done) break
          size += value.byteLength
          if (size > maxBytes) { void reader.cancel().catch(() => undefined); throw failure() }
          chunks.push(value)
        }
      } finally { reader.releaseLock() }
      const body: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)))
      if (!exact(body, ["error"]) || !exact(body.error, ["code", "message"])
        || body.error.code !== (authenticated ? "not_found" : "unauthorized")
        || typeof body.error.message !== "string" || !body.error.message.length || body.error.message.length > 1024
        || /[\u0000-\u001f\u007f]/.test(body.error.message)) throw failure()
    }
    try { await Promise.race([work(), deadline]) } catch { throw failure() }
    finally { if (timer) clearTimeout(timer); controller.abort() }
  }
  await check(false)
  await check(true)
  return {
    protocol: "bridge-v1", verification: "transport_authentication_only", unauthenticatedRejected: true, authenticatedRouteRecognized: true,
    providerIntegrationAvailable: false, cxHolderMappingVerified: false, nativeIssuanceVerified: false, nativePresentationVerified: false, signingAllowed: false,
  }
}
