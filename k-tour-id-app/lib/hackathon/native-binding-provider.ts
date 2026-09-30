/** Private CAS/TA/DID transport. Endpoint selection is operator-owned configuration;
 * no endpoint, name, PII or URL is accepted from a browser/native request.
 * The CAS write is NEVER retried here. Its caller durably claims it first.
 */
import { fromBase58 } from "@mysten/bcs"
import { HkError, digestOf } from "./util"
import { assertRegisteredNativeHolder, type NativeHolderKey } from "./native-binding-did"
import { localNativeRequested, assertLocalNativeProfile, LOCAL_NATIVE_ORIGIN, LOCAL_NATIVE_MARKER } from "./local-native-policy"

export type NativeBindingProvider = {
  allocateCas(userId: string, kycRef: string): Promise<void>
  confirmCas(userId: string, kycRef: string): Promise<void>
  confirmHolder(holder: NativeHolderKey, kycRef: string): Promise<void>
}
export type NativeBindingProviderConfig = { casOrigin: string; taOrigin: string; didOrigin: string; adminToken: string }
const unavailable = () => new HkError("native_binding_provider_unavailable", "The holder connection could not be confirmed", 503)
const origin = (value: unknown, env: NodeJS.ProcessEnv): string => {
  if (typeof value !== "string") throw unavailable()
  const u = new URL(value)
  const local = !env.VERCEL && env.HK_OPENDID_BRIDGE_ALLOW_LOOPBACK === "1" && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)
  if ((u.protocol !== "https:" && !(local && u.protocol === "http:")) || u.username || u.password || u.search || u.hash || (u.pathname !== "/" && u.pathname !== "")) throw unavailable()
  // Public service origins are pinned to the same explicitly trusted deployment.
  // Loopback is only for the separately owned local integration environment.
  if (!local && u.origin !== env.HK_OPENDID_TRUSTED_ORIGIN) throw unavailable()
  return u.origin
}
export function nativeBindingProviderConfig(env: NodeJS.ProcessEnv = process.env): NativeBindingProviderConfig {
  try {
    if (env.HK_OPENDID_HOLDER_BINDING_ENABLED !== "1") throw unavailable()
    const adminToken = env.HK_OPENDID_ADMIN_TOKEN
    if (typeof adminToken !== "string" || !/^[\x21-\x7e]{32,512}$/.test(adminToken)) throw unavailable()
    return { casOrigin: origin(env.HK_OPENDID_CAS_URL, env), taOrigin: origin(env.HK_OPENDID_TA_URL, env), didOrigin: origin(env.HK_OPENDID_DID_API_URL, env), adminToken }
  } catch { throw unavailable() }
}
export function nativeBindingConfiguration(env: NodeJS.ProcessEnv = process.env) {
  if (localNativeRequested(env)) assertLocalNativeProfile(env)
  const provider = nativeBindingProviderConfig(env), secret = env.HK_OPENDID_OWNER_BINDING_SECRET ?? ""
  if (!/^[\x21-\x7e]{32,4096}$/.test(secret)) throw unavailable()
  const origin = localNativeRequested(env) ? LOCAL_NATIVE_ORIGIN : "https://ktour-id.vercel.app"
  const profile = localNativeRequested(env) ? LOCAL_NATIVE_MARKER : "main-native-v1"
  return { provider, secret, configBinding: digestOf({ version: "cx-holder-v1", origin, profile, ...provider, secret }) }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable()
  return value as Record<string, unknown>
}
function ids(userId: string, kycRef: string): void {
  if (!/^[A-Za-z0-9_-]{43}$/.test(userId) || !/^[0-9a-f]{64}$/.test(kycRef)) throw unavailable()
}
function decodeDidDoc(value: unknown): unknown {
  if (typeof value !== "string" || value.length > 100_000) throw unavailable()
  let bytes: Uint8Array
  if (/^m[A-Za-z0-9+/]+={0,2}$/.test(value)) bytes = Buffer.from(value.slice(1), "base64")
  else if (/^u[A-Za-z0-9_-]+$/.test(value)) bytes = Buffer.from(value.slice(1), "base64url")
  else if (/^z[1-9A-HJ-NP-Za-km-z]+$/.test(value)) bytes = fromBase58(value.slice(1))
  else throw unavailable()
  if (bytes.byteLength > 65_536) throw unavailable()
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown
}
export function createNativeBindingProvider(config: NativeBindingProviderConfig, fetcher: typeof fetch = fetch, timeoutMs = 8000): NativeBindingProvider {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 8000) throw unavailable()
  async function request(base: string, path: string, method: "GET" | "POST", body?: unknown): Promise<unknown> {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined
    try {
      const work = async () => {
      const r = await fetcher(base + path, { method, redirect: "error", credentials: "omit", cache: "no-store", signal: controller.signal,
        headers: { accept: "application/json", "content-type": "application/json", "X-KTour-Admin-Token": config.adminToken }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
      if (!r.ok || r.redirected || controller.signal.aborted || Number(r.headers.get("content-length") ?? 0) > 131_072) throw unavailable()
      let size = 0; const chunks: Uint8Array[] = [], reader = r.body?.getReader()
      activeReader = reader
      if (reader) {
        try { for (;;) { const x = await reader.read(); if (controller.signal.aborted) throw unavailable(); if (x.done) break; size += x.value.byteLength; if (size > 131_072) throw unavailable(); chunks.push(x.value) } }
        finally { void reader.cancel().catch(() => {}) }
      }
      if (controller.signal.aborted) throw unavailable()
      if (!size) return null
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
      }
      return await Promise.race([work(), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); void activeReader?.cancel().catch(() => {}); reject(unavailable()) }, timeoutMs) })])
    } catch { throw unavailable() } finally { clearTimeout(timer) }
  }
  const confirmCas = async (userId: string, kycRef: string) => {
    ids(userId, kycRef)
    const r = record(await request(config.casOrigin, "/cas/api/v1/retrieve-pii", "POST", { userId }))
    if (Object.keys(r).length !== 1 || r.pii !== kycRef) throw unavailable()
  }
  return {
    async allocateCas(userId, kycRef) {
      ids(userId, kycRef)
      await request(config.casOrigin, "/cas/api/v1/save-user-info", "POST", { userId, pii: kycRef })
      await confirmCas(userId, kycRef)
    },
    confirmCas,
    async confirmHolder(holder, kycRef) {
      if (!/^[0-9a-f]{64}$/.test(kycRef) || !/^did:omn:[A-Za-z0-9:_-]{8,160}$/.test(holder.did)) throw unavailable()
      const doc = record(await request(config.didOrigin, `/api-gateway/api/v1/did-doc?did=${encodeURIComponent(holder.did)}`, "GET"))
      if (Object.keys(doc).length !== 1) throw unavailable()
      assertRegisteredNativeHolder(decodeDidDoc(doc.didDoc), holder)
      const query = new URLSearchParams({ searchKey: "did", searchValue: holder.did, size: "2", page: "0" })
      const users = record(await request(config.taOrigin, `/tas/admin/v1/users/list?${query}`, "GET"))
      if (!Array.isArray(users.content) || users.content.length !== 1 || users.totalElements !== 1) throw unavailable()
      const row = record(users.content[0])
      if (row.did !== holder.did || row.pii !== kycRef || row.status !== "ACTIVATED") throw unavailable()
    },
  }
}
