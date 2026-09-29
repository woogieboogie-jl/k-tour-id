// Fixed Google key origin; JWTs never enter a URL or a log. Injected fetch is for offline tests.
import { createPublicKey, verify } from "node:crypto"
import { HkError } from "./util"
const JWKS = "https://www.googleapis.com/oauth2/v3/certs"
const invalid = () => new HkError("zklogin_jwt", "The Google sign-in token could not be verified", 400)
const unavailable = () => new HkError("zklogin_prover", "Sign-in verification is unavailable. Check this attempt before restarting.", 503, false)
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
const parse = (v: string) => { if (!/^[A-Za-z0-9_-]+$/.test(v)) throw invalid(); const b = Buffer.from(v, "base64url"); if (b.toString("base64url") !== v) throw invalid(); return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(b)) as unknown }
export function createGoogleTokenVerifier(fetcher: typeof fetch = fetch, clock = Date.now) {
  let cache: { expires: number; keys: Record<string, unknown>[] } | null = null
  return async (jwt: string, expected: { audience: string; nonce: string }): Promise<{ sub: string; aud: string; iss: string; exp: number }> => {
    let header: Record<string, unknown>, claims: Record<string, unknown>, signature: Buffer, parts: string[]
    try {
      if (jwt.length > 8192) throw invalid()
      parts = jwt.split("."); if (parts.length !== 3) throw invalid()
      const h = parse(parts[0]), c = parse(parts[1]); signature = Buffer.from(parts[2], "base64url")
      if (!record(h) || !record(c) || h.alg !== "RS256" || typeof h.kid !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(h.kid) || (h.typ !== undefined && h.typ !== "JWT") || Object.keys(h).some(k => !["alg", "kid", "typ"].includes(k)) || signature.length < 128 || signature.length > 512 || signature.toString("base64url") !== parts[2]) throw invalid()
      const now = Math.floor(clock() / 1000)
      if (!/^https:\/\/accounts\.google\.com$|^accounts\.google\.com$/.test(String(c.iss)) || c.aud !== expected.audience || (c.azp !== undefined && c.azp !== expected.audience) || c.nonce !== expected.nonce ||
        typeof c.sub !== "string" || !/^[A-Za-z0-9_-]{1,255}$/.test(c.sub) || !Number.isSafeInteger(c.exp) || Number(c.exp) <= now || Number(c.exp) > now + 3700 ||
        !Number.isSafeInteger(c.iat) || Number(c.iat) > now + 60 || Number(c.iat) < now - 3700 || (c.nbf !== undefined && (!Number.isSafeInteger(c.nbf) || Number(c.nbf) > now + 60))) throw invalid()
      header = h; claims = c
    } catch { throw invalid() }
    if (!cache || cache.expires <= clock() || !cache.keys.some(k => k.kid === header.kid)) {
      const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(unavailable()) }, 8000) })
      try {
        const work = async () => {
          const response = await fetcher(JWKS, { method: "GET", redirect: "error", cache: "no-store", credentials: "omit", signal: controller.signal })
          if (controller.signal.aborted || !response.ok || response.redirected || (response.url && response.url !== JWKS)) { void response.body?.cancel().catch(() => {}); throw unavailable() }
          const reader = response.body?.getReader(); if (!reader) throw unavailable()
          const chunks: Uint8Array[] = []; let size = 0
          try { for (;;) { const { done, value } = await reader.read(); if (controller.signal.aborted) throw unavailable(); if (done) break; size += value.byteLength; if (size > 32768) { void reader.cancel().catch(() => {}); throw unavailable() } chunks.push(value) } } finally { reader.releaseLock() }
          const body: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)))
          if (!record(body) || Object.keys(body).length !== 1 || !Array.isArray(body.keys) || body.keys.length < 1 || body.keys.length > 10 || !body.keys.every(k => record(k) && k.kty === "RSA" && k.use === "sig" && k.alg === "RS256" && typeof k.kid === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(k.kid) && typeof k.n === "string" && /^[A-Za-z0-9_-]{128,1024}$/.test(k.n) && k.e === "AQAB") || new Set(body.keys.map(k => k.kid)).size !== body.keys.length) throw unavailable()
          return body.keys as Record<string, unknown>[]
        }
        const keys = await Promise.race([work(), timeout]); if (controller.signal.aborted) throw unavailable()
        cache = { expires: clock() + 5 * 60_000, keys }
      } catch { throw unavailable() } finally { if (timer) clearTimeout(timer); controller.abort() }
    }
    try {
      const jwk = cache.keys.find(k => k.kid === header.kid); if (!jwk) throw invalid()
      const key = createPublicKey({ key: { kty: "RSA", n: String(jwk.n), e: String(jwk.e) }, format: "jwk" })
      const bits = key.asymmetricKeyDetails?.modulusLength
      if (!bits || bits < 2048 || bits > 4096) throw invalid()
      if (!verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), key, signature)) throw invalid()
      return { sub: claims.sub as string, aud: claims.aud as string, iss: claims.iss as string, exp: claims.exp as number }
    } catch { throw invalid() }
  }
}
export const verifyGoogleToken = createGoogleTokenVerifier()
