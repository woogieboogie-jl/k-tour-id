import { isReadinessPreview } from "./preview-readiness"

// Temporary, credential-free network diagnostic, NOT a CX authentication flow.
// Fixed public catalogue only: no token, identity transaction, claims or redirect.
const CATALOG = "https://cx.raonsecure.co.kr:18543/oacx/api/v1.0/provider/list"
export const CX_PREFLIGHT_END = Date.parse("2026-09-25T06:00:00Z")
const IDS = new Set(["comdl", "coidentitydocument", "comrc", "coresidence"])
const MAX_BYTES = 256 * 1024
type Result = { status: number; body: Record<string, unknown> }
let cached: { until: number; result: Promise<Result> } | undefined

async function readCatalogue(): Promise<Result> {
  const base = {
    observedAt: new Date().toISOString(),
    region: process.env.VERCEL_REGION ?? "local",
    revision: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
    authenticated: false, identityVerified: false,
  }
  let upstreamStatus: number | undefined
  try {
    const response = await fetch(CATALOG, {
      method: "GET", redirect: "error", cache: "no-store",
      headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000),
    })
    upstreamStatus = response.status
    if (!response.ok) {
      await response.body?.cancel()
      return { status: 502, body: { ...base, reachable: true, httpStatus: response.status, error: "cx_catalog_http" } }
    }
    const reader = response.body?.getReader()
    if (!reader) return { status: 502, body: { ...base, error: "cx_catalog_empty" } }
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > MAX_BYTES) {
          await reader.cancel()
          return { status: 502, body: { ...base, error: "cx_catalog_size" } }
        }
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
    const raw: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    if (!Array.isArray(raw)) return { status: 502, body: { ...base, error: "cx_catalog_shape" } }
    const providers = raw.flatMap(row => {
      if (!row || typeof row !== "object" || !IDS.has(row.provider_id)) return []
      if (!["y", "n"].includes(row.status_code) || !["dev", "prod"].includes(row.oper_sort) || row.version !== "v1.5") return []
      return [{ provider: row.provider_id, environment: row.oper_sort, available: row.status_code === "y", version: row.version }]
    })
    if (!providers.length) return { status: 502, body: { ...base, error: "cx_catalog_no_known_provider" } }
    return { status: 200, body: { ...base, reachable: true, httpStatus: 200, providers } }
  } catch {
    // Do not log/return provider bodies, exception messages, URLs or headers.
    return { status: 502, body: { ...base, reachable: upstreamStatus !== undefined, httpStatus: upstreamStatus, error: "cx_catalog_network_or_response" } }
  }
}

export async function cxReadinessResponse(request: Request): Promise<Response> {
  if (!isReadinessPreview() || process.env.VERCEL_ENV !== "preview" || Date.now() >= CX_PREFLIGHT_END) {
    return Response.json({ error: { code: "cx_preflight_disabled" } }, { status: 404, headers: { "cache-control": "no-store" } })
  }
  const length = request.headers.get("content-length")
  if (request.method !== "GET" || new URL(request.url).search || request.body !== null ||
    request.headers.has("transfer-encoding") || (length !== null && length !== "0")) {
    return Response.json({ error: { code: "cx_preflight_request" } }, { status: 400, headers: { "cache-control": "no-store" } })
  }
  // Coalesce parallel calls and retain even failed probes for a minute.
  if (!cached || cached.until <= Date.now()) cached = { until: Date.now() + 60_000, result: readCatalogue() }
  const result = await cached.result
  if (Date.now() >= CX_PREFLIGHT_END) {
    return Response.json({ error: { code: "cx_preflight_disabled" } }, { status: 404, headers: { "cache-control": "no-store" } })
  }
  return Response.json(result.body, { status: result.status, headers: { "cache-control": "no-store" } })
}
