import { HkError } from "./util"

export type RedisConnection = { url: string; token: string }
export type StoreCanaryOwnership = { ownerKey: string; ownerToken: string; ttlMs: 120000 }
export type PreviewRedisConfig = RedisConnection & { key: string; canary?: StoreCanaryOwnership }
type Env = Record<string, string | undefined>
export const STORE_CANARY_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const invalid = () => new HkError("store_configuration", "Journey storage is not safely configured.", 503)

/** Pure validation: no network, directory creation, or credential output. */
export function previewRedisConfig(env: Env): PreviewRedisConfig {
  const upstashUrl = env.UPSTASH_REDIS_REST_URL ?? ""
  const upstashToken = env.UPSTASH_REDIS_REST_TOKEN ?? ""
  const kvUrl = env.KV_REST_API_URL ?? ""
  const kvToken = env.KV_REST_API_TOKEN ?? ""
  const upstashAny = Boolean(upstashUrl || upstashToken)
  const kvAny = Boolean(kvUrl || kvToken)
  if (upstashAny === kvAny || (upstashAny && (!upstashUrl || !upstashToken)) ||
    (kvAny && (!kvUrl || !kvToken))) throw invalid()
  const url = upstashUrl || kvUrl
  const token = upstashToken || kvToken
  try {
    const parsed = new URL(url)
    if (url !== url.trim() || parsed.protocol !== "https:" || parsed.username || parsed.password ||
      parsed.search || parsed.hash || parsed.pathname !== "/" || (parsed.port && parsed.port !== "443")) throw invalid()
  } catch { throw invalid() }
  if (token !== token.trim() || !token) throw invalid()
  const key = env.HK_STORE_KEY ?? ""
  const seed = env.HK_ISSUER_SIGNING_SEED ?? ""
  if (!/^ktour:cx-preview:[A-Za-z0-9:_-]{1,180}$/.test(key) || seed.length < 32 ||
    seed !== seed.trim() || /sample|change[\s_-]*me|placeholder|sentinel/i.test(seed)) throw invalid()
  const canaryFields = [env.HK_STORE_CANARY_UUID, env.HK_STORE_CANARY_OWNER]
  let canary: StoreCanaryOwnership | undefined
  if (canaryFields.some(Boolean) || key.startsWith("ktour:cx-preview:canary:")) {
    const uuid = env.HK_STORE_CANARY_UUID ?? ""
    const ownerToken = env.HK_STORE_CANARY_OWNER ?? ""
    if (!STORE_CANARY_UUID.test(uuid) || !/^[a-f0-9]{64}$/.test(ownerToken) ||
      env.HK_STORE_CANARY_ALLOW_WRITE !== "1" || env.VERCEL_ENV === "production" ||
      key !== `ktour:cx-preview:canary:${uuid}:journey`) throw invalid()
    canary = { ownerKey: `${key}:owner`, ownerToken, ttlMs: 120000 }
  }
  return { url: url.replace(/\/+$/, ""), token, key, ...(canary ? { canary } : {}) }
}

/** Bounded transport shared by the real store and its own-key canary. */
export async function storeRedisCommand<T = unknown>(
  connection: RedisConnection, command: (string | number)[],
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<T> {
  const signal = AbortSignal.timeout(Math.max(1, Math.min(8000, options.timeoutMs ?? 8000)))
  const pending = (async () => {
    const response = await (options.fetchImpl ?? globalThis.fetch)(connection.url, {
      method: "POST", redirect: "error", cache: "no-store", signal,
      headers: { authorization: `Bearer ${connection.token}`, "content-type": "application/json" },
      body: JSON.stringify(command),
    })
    if (!response.ok) { await response.body?.cancel(); throw new Error("upstream") }
    const reader = response.body?.getReader()
    if (!reader) throw new Error("body")
    const chunks: Uint8Array[] = []
    let bytes = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > 8 * 1024 * 1024) { await reader.cancel(); throw new Error("size") }
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    if (!data || typeof data !== "object" || Object.hasOwn(data, "error") || !Object.hasOwn(data, "result")) throw new Error("envelope")
    return (data as { result: T }).result
  })()
  try {
    return await new Promise<T>((resolve, reject) => {
      const abort = () => reject(new Error("timeout"))
      signal.addEventListener("abort", abort, { once: true })
      pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
      if (signal.aborted) abort()
    })
  } catch {
    throw new HkError("store_unavailable", "Journey storage is temporarily unavailable. Check the result before retrying.", 503, true)
  }
}
