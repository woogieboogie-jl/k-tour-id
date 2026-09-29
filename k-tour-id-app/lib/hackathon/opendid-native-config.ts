/** Server-only configuration for the implemented native bridge-v1 protocol.
 * Validation is not provider verification and never enables a capability.
 */
import type { OpenDidBridgeConfig } from "./adapters/opendid-provider"
import { HkError } from "./util"

const LOOPBACK = new Set(["127.0.0.1", "[::1]", "localhost"])
const invalid = () => new HkError("opendid_provider_configuration", "OpenDID bridge configuration is invalid", 503)
const printable = (v: unknown, min: number, max: number): v is string => typeof v === "string" && v.length >= min && v.length <= max && /^[\x21-\x7e]+$/.test(v)

export function validateOpenDidNativeBridgeConfig(input: OpenDidBridgeConfig): OpenDidBridgeConfig & { timeoutMs: number; maxResponseBytes: number } {
  if (typeof window !== "undefined") throw new Error("OpenDID native configuration is server-only")
  if (!input || typeof input !== "object") throw invalid()
  const cfg = { ...input }
  let base: URL, trusted: URL, schema: URL
  try { base = new URL(cfg.baseUrl); trusted = new URL(cfg.trustedOrigin); schema = new URL(cfg.schemaId) } catch { throw invalid() }
  const allowedUrl = (url: URL) => !url.username && !url.password && !url.hash
    && (url.protocol === "https:" || (cfg.allowLoopback === true && LOOPBACK.has(url.hostname) && url.protocol === "http:"))
    && (!LOOPBACK.has(url.hostname) || cfg.allowLoopback === true)
  if (!allowedUrl(base) || !allowedUrl(schema) || base.origin !== trusted.origin || trusted.href !== `${trusted.origin}/`
    || base.pathname !== "/" || base.search || !printable(cfg.baseUrl, 1, 2048) || !printable(cfg.trustedOrigin, 1, 2048)
    || !printable(cfg.schemaId, 1, 2048)) throw invalid()
  // Pins come from the provider configuration, not from response data or the browser.
  if (!printable(cfg.serviceToken, 32, 4096) || !printable(cfg.ownerBindingSecret, 32, 4096)
    || !printable(cfg.issuerDid, 7, 2048) || !/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+(?::[A-Za-z0-9._:%-]+)*$/.test(cfg.issuerDid)
    || (cfg.allowLoopback !== undefined && typeof cfg.allowLoopback !== "boolean")) throw invalid()
  const timeoutMs = cfg.timeoutMs ?? 5000, maxResponseBytes = cfg.maxResponseBytes ?? 32768
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 10000
    || !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 256 || maxResponseBytes > 131072) throw invalid()
  return { ...cfg, timeoutMs, maxResponseBytes }
}

/** Environment names already used by the main provider factory. Never logs values.
 * A hosted runtime cannot opt into Mac loopback, even if a copied .env requests it.
 */
export function resolveOpenDidNativeBridgeConfig(env: NodeJS.ProcessEnv = process.env): OpenDidBridgeConfig {
  if (env.VERCEL && env.HK_OPENDID_BRIDGE_ALLOW_LOOPBACK === "1") throw invalid()
  return validateOpenDidNativeBridgeConfig({
    baseUrl: env.HK_OPENDID_BRIDGE_URL ?? "",
    trustedOrigin: env.HK_OPENDID_TRUSTED_ORIGIN ?? "",
    serviceToken: env.HK_OPENDID_BRIDGE_TOKEN ?? "",
    ownerBindingSecret: env.HK_OPENDID_OWNER_BINDING_SECRET ?? "",
    issuerDid: env.HK_OPENDID_ISSUER_DID ?? "",
    schemaId: env.HK_OPENDID_SCHEMA_ID ?? "",
    allowLoopback: env.HK_OPENDID_BRIDGE_ALLOW_LOOPBACK === "1" && !env.VERCEL,
  })
}
