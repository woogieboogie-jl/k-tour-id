// Shared Gemini (Generative Language API) caller. Prefers smarter models, falls
// back if a key lacks one (404), caches the first working model, supports
// multi-turn history, and passes the key in a header (not the URL). Server-only.

// Stable IDs verified against Google's model catalog and the project's models
// list on 2026-09-30. No moving alias or implicit downgrade to a 2.x model.
const CANDIDATES = ["gemini-3.8-flash", "gemini-3.5-flash-lite"]
let cachedModel: string | null = null
// One deadline covers the whole call, including missing-model fallbacks and
// response consumption. A stalled stream must not outlive the caller's budget.
export const GEMINI_TIMEOUT_MS = 20_000
export const GEMINI_MAX_RESPONSE_BYTES = 128 * 1024

export interface GeminiTurn {
  role: "user" | "model"
  text: string
}
export interface GeminiResult {
  reply?: string
  /** Successful request target, not an unverified provider-reported version. */
  model?: string
  error?: string
}

// Provider responses can contain credentials, request URLs, prompts, or other
// sensitive diagnostics. Keep the public result deliberately code-like; the
// server route and rule fallback only need to know that generation failed.
function providerError(code: "http" | "network" | "empty", status?: number): string {
  if (code === "http") return `gemini_provider_http_${status ?? "unknown"}`
  if (code === "empty") return "gemini_provider_empty_response"
  return "gemini_provider_unavailable"
}

function discardProviderBody(res: Response): void {
  // Do not await cancellation: a broken provider stream may never settle.
  void res.body?.cancel().catch(() => undefined)
}

class BoundedProviderError extends Error {
  constructor(readonly publicCode: "gemini_provider_timeout" | "gemini_provider_response_too_large") {
    super(publicCode)
  }
}

async function readProviderJson(res: Response, signal: AbortSignal, deadline: Promise<never>): Promise<unknown> {
  const declaredLength = res.headers.get("content-length")
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > GEMINI_MAX_RESPONSE_BYTES) {
    discardProviderBody(res)
    throw new BoundedProviderError("gemini_provider_response_too_large")
  }
  if (!res.body) throw new Error("missing_body")
  const reader = res.body.getReader()
  const cancel = () => { void reader.cancel().catch(() => undefined) }
  signal.addEventListener("abort", cancel, { once: true })
  const decoder = new TextDecoder("utf-8", { fatal: true })
  let bytes = 0
  let text = ""
  try {
    for (;;) {
      if (signal.aborted) throw new BoundedProviderError("gemini_provider_timeout")
      const chunk = await Promise.race([reader.read(), deadline])
      if (signal.aborted) throw new BoundedProviderError("gemini_provider_timeout")
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > GEMINI_MAX_RESPONSE_BYTES) throw new BoundedProviderError("gemini_provider_response_too_large")
      text += decoder.decode(chunk.value, { stream: true })
    }
    text += decoder.decode()
    return JSON.parse(text) as unknown
  } finally {
    signal.removeEventListener("abort", cancel)
    // Cancellation is intentionally not awaited: a provider can stall it too.
    cancel()
  }
}

function replyText(data: unknown, structured: boolean): string {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("invalid_response")
  const candidates = (data as { candidates?: unknown }).candidates
  if (candidates === undefined || (Array.isArray(candidates) && candidates.length === 0)) return ""
  if (!Array.isArray(candidates)) throw new Error("invalid_candidates")
  const first = candidates[0]
  if (!first || typeof first !== "object" || Array.isArray(first)) throw new Error("invalid_candidate")
  // A parseable prefix is not a completed proposal. Never accept truncated,
  // safety-blocked or otherwise unconfirmed structured output.
  if (structured && (first as { finishReason?: unknown }).finishReason !== "STOP") throw new Error("incomplete_response")
  const content = (first as { content?: unknown }).content
  if (content === undefined) return ""
  if (!content || typeof content !== "object" || Array.isArray(content)) throw new Error("invalid_content")
  const parts = (content as { parts?: unknown }).parts
  if (parts === undefined) return ""
  if (!Array.isArray(parts)) throw new Error("invalid_parts")
  return parts.map((part: unknown) => {
    if (!part || typeof part !== "object" || Array.isArray(part)) throw new Error("invalid_part")
    if ((part as { thought?: unknown }).thought === true) return ""
    const text = (part as { text?: unknown }).text
    if (text !== undefined && typeof text !== "string") throw new Error("invalid_text")
    return text ?? ""
  }).join("")
}

export async function geminiGenerate(opts: {
  key: string
  /** Explicit preference takes precedence over the shared caller default/cache. */
  model?: string
  system: string
  /** Bounded paid lanes can prohibit even missing-model fallback requests. */
  allowModelFallback?: boolean
  message: string
  history?: GeminiTurn[]
  maxOutputTokens?: number
  temperature?: number
  /** Provider shape constraint only; the caller must still validate semantics. */
  responseJsonSchema?: Record<string, unknown>
}): Promise<GeminiResult> {
  const preferredModel = opts.model ?? (process.env.GEMINI_MODEL || undefined)
  // A model is a single public API resource identifier, never a URL/query or
  // arbitrary provider diagnostic. Invalid configuration must not be echoed.
  if (preferredModel !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(preferredModel)) {
    return { error: "gemini_provider_model_invalid" }
  }
  const models = (opts.allowModelFallback === false ? [preferredModel ?? CANDIDATES[0]] : [preferredModel, cachedModel, ...CANDIDATES]).filter((m): m is string => !!m)
  const seen = new Set<string>()
  const contents = [
    ...(opts.history ?? []).map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
    { role: "user", parts: [{ text: opts.message }] },
  ]
  let lastErr = providerError("network")
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout>
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new BoundedProviderError("gemini_provider_timeout"))
    }, GEMINI_TIMEOUT_MS)
  })

  try {
    for (const model of models) {
      if (seen.has(model)) continue
      seen.add(model)
      try {
        const request = fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST",
          redirect: "error",
          cache: "no-store",
          credentials: "omit",
          signal: controller.signal,
          headers: { "content-type": "application/json", "x-goog-api-key": opts.key },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: opts.system }] },
            contents,
            generationConfig: {
              maxOutputTokens: opts.maxOutputTokens ?? 700,
              temperature: opts.temperature ?? (model === "gemini-3.8-flash" ? 1 : 0.4),
              // The small, bounded proposal does not need the model's default
              // medium reasoning. `minimal` is unsupported by 3.8 Flash.
              ...(model === "gemini-3.8-flash" ? { thinkingConfig: { thinkingLevel: "low" } } : {}),
              ...(opts.responseJsonSchema ? { responseMimeType: "application/json", responseJsonSchema: opts.responseJsonSchema } : {}),
            },
          }),
        }).then((res) => {
          // Even a fetch implementation ignoring abort cannot publish/cache a
          // late success or leave its response body open after the timeout.
          if (controller.signal.aborted) {
            discardProviderBody(res)
            throw new BoundedProviderError("gemini_provider_timeout")
          }
          return res
        })
        const res = await Promise.race([request, deadline])
        if (res.ok) {
          const data = await readProviderJson(res, controller.signal, deadline)
          const reply = replyText(data, Boolean(opts.responseJsonSchema))
          if (reply.trim()) {
            cachedModel = model // retain the working fallback; explicit preferences still win
            return { reply, model }
          }
          lastErr = providerError("empty")
          break // A successful request may already be billed; do not resubmit.
        }
        // Do not read or propagate provider bodies: they may echo the API key,
        // request URL, prompt, or vendor-internal diagnostics.
        lastErr = providerError("http", res.status)
        discardProviderBody(res)
        if (res.status !== 404) break // 400/403/429/5xx won't be fixed by another model
      } catch (e) {
        lastErr = e instanceof BoundedProviderError ? e.publicCode : providerError("network")
        break // Unknown transport/malformed outcomes must not trigger another model.
      }
    }
    return { error: lastErr }
  } finally {
    clearTimeout(timer!)
    controller.abort()
  }
}
