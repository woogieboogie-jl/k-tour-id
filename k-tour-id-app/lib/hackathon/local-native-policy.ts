/** An isolated developer lane, never a hosted-profile fallback. No credentials
 * or endpoints are taken from a request. Importing this module performs no I/O. */
import { HkError } from "./util"
export const LOCAL_NATIVE_MARKER = "local-native-20260930-v1"
export const LOCAL_NATIVE_ORIGIN = "http://127.0.0.1:3183"
export const LOCAL_NATIVE_DATA_DIR = ".data/native-binding-3183"
export const LOCAL_NATIVE_STORE_KEY = "ktour:local-native:3183:v1"
export const LOCAL_NATIVE_PINS = {
  HK_CX_BASE_URL: "https://cx.raonsecure.co.kr:18543", HK_CX_PROVIDER: "comdl", HK_CX_ZKP_TYPE: "AdultVerify",
  HK_OPENDID_HOLDER_BINDING_ENABLED: "1", HK_OPENDID_BRIDGE_ALLOW_LOOPBACK: "1",
  HK_OPENDID_BRIDGE_URL: "http://127.0.0.1:3193", HK_OPENDID_TRUSTED_ORIGIN: "http://127.0.0.1:3193",
  HK_OPENDID_CAS_URL: "http://127.0.0.1:19403", HK_OPENDID_TA_URL: "http://127.0.0.1:19400", HK_OPENDID_DID_API_URL: "http://127.0.0.1:19405",
  HK_OPENDID_ISSUER_DID: "did:omn:issuer", HK_OPENDID_SCHEMA_ID: "http://127.0.0.1:19401/issuer/api/v1/vc/vcschema?name=vc.schema.ktour.pass",
  HK_CAMPAIGN_ID: "ktour-local-native-3183-v1",
} as const
type Env = Record<string, string | undefined>
const bad = () => new HkError("native_binding_unavailable", "The isolated native connection is not configured", 503)
export function localNativeRequested(env: Env = process.env): boolean {
  return Object.hasOwn(env, "HK_LOCAL_NATIVE") || Object.hasOwn(env, "NEXT_PUBLIC_HK_LOCAL_NATIVE")
}
export function assertLocalNativeProfile(env: Env = process.env): void {
  if (Object.entries(LOCAL_NATIVE_PINS).some(([key, value]) => env[key] !== value)
    || ["HK_OPENDID_BRIDGE_TOKEN", "HK_OPENDID_OWNER_BINDING_SECRET", "HK_OPENDID_ADMIN_TOKEN", "HK_ISSUER_SIGNING_SEED"].some(key => !/^[\x21-\x7e]{32,4096}$/.test(env[key] ?? ""))) throw bad()
  if (env.HK_LOCAL_NATIVE !== LOCAL_NATIVE_MARKER || env.NEXT_PUBLIC_HK_LOCAL_NATIVE !== LOCAL_NATIVE_MARKER || env.NODE_ENV !== "development"
    || Object.keys(env).some(key => key === "VERCEL" || key.startsWith("VERCEL_") || /^(UPSTASH_|KV_|ENOKI_)/.test(key))
    || env.HK_STORE_KEY !== LOCAL_NATIVE_STORE_KEY || env.HK_DATA_DIR !== LOCAL_NATIVE_DATA_DIR
    || env.HK_API_ENABLED !== "1" || env.NEXT_PUBLIC_HK_ENABLED !== "1" || env.HK_ISOLATED_MOCK !== "0"
    || env.HK_MODE_CX !== "cx" || env.HK_MODE_OPENDID !== "opendid" || env.HK_AI_MODE !== "rule") throw bad()
  // No copied deployed profile, paid model/chain keys, ledger cutover, or salt.
  if (Object.keys(env).some(key => /^(?:HK_SUI_|HK_ZKLOGIN_|HK_OMNIONE_|HK_HOSTED_|HK_INTEGRATION_|HK_STORE_(?:CANARY|CUTOVER)|NEXT_PUBLIC_HK_(?:HOSTED|INTEGRATION|PUBLIC_CX|GUIDE|CX_PREVIEW)|GEMINI_|GOOGLE_)/.test(key)
    || key === "NEXT_PUBLIC_GOOGLE_CLIENT_ID")) throw bad()
}
export function localNativeEnabled(env: Env = process.env): boolean {
  try { assertLocalNativeProfile(env); return true } catch { return false }
}
export function assertLocalNativeTarget(req: Request, env: Env = process.env): void {
  assertLocalNativeProfile(env)
  const url = new URL(req.url)
  // Next dev canonicalizes its internal Request URL to localhost even when
  // listening on 127.0.0.1. Admit that representation only with all three
  // exact external headers; this never admits browsing localhost as an alias.
  const internalNext = url.origin === "http://localhost:3183" && req.headers.get("host") === "127.0.0.1:3183" && req.headers.get("x-forwarded-host") === "127.0.0.1:3183" && req.headers.get("x-forwarded-proto") === "http"
  if ((!internalNext && url.origin !== LOCAL_NATIVE_ORIGIN) || url.username || url.password || url.search || url.hash
    || req.headers.has("forwarded")
    || req.headers.has("x-forwarded-host") && req.headers.get("x-forwarded-host") !== "127.0.0.1:3183"
    || req.headers.has("x-forwarded-proto") && req.headers.get("x-forwarded-proto") !== "http"
    || (req.headers.has("host") && req.headers.get("host") !== "127.0.0.1:3183")) throw bad()
}
/** Only the identity → native VC/VP portion is exposed. No local shortcut to
 * signing, agent execution, redemption, AI, JIT samples, or guide v2. */
export function localNativeRouteAllowed(method: string, path: string[]): boolean {
  const op = path[0] === "operations" && /^op_[A-Za-z0-9_-]{8,100}$/.test(path[1] ?? "")
  if (method === "GET") return path.length === 1 && ["config", "me"].includes(path[0])
    || path.length === 3 && path[0] === "places" && path[2] === "demo-entitlements"
    || op && (path.length === 2 || path.length === 3 && path[2] === "evidence" || path.length === 4 && path[2] === "native-binding" && path[3] === "status")
  if (method !== "POST") return false
  return path.length === 1 && ["sessions", "operations"].includes(path[0])
    || op && (path.length === 3 && path[2] === "cancel"
      || path.length === 4 && path[2] === "identity" && ["start", "complete"].includes(path[3])
      || path.length === 4 && path[2] === "native-binding" && ["start", "begin", "prove", "confirm", "cancel"].includes(path[3])
      || path.length === 5 && path[2] === "provider" && ["issuance", "presentation"].includes(path[3]) && ["start", "refresh"].includes(path[4])
      || path.length === 4 && path[2] === "provider" && path[3] === "cancel")
}
export function assertLocalNativeBody(path: string[], value: Record<string, unknown>): void {
  const keys = path.length === 1 && path[0] === "operations" ? ["venueId", "consentVersion", "locale"]
    : path.length === 4 && path[2] === "identity" && path[3] === "start" ? ["mobile"] : []
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))
    || keys.includes("mobile") && typeof value.mobile !== "boolean"
    || keys.includes("venueId") && (typeof value.venueId !== "string" || value.venueId.length > 128 || typeof value.consentVersion !== "string" || value.consentVersion.length > 80 || !["ko", "en", "ja"].includes(String(value.locale)))) throw bad()
}
