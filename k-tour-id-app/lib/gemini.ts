// Shared Gemini (Generative Language API) caller. Prefers smarter models, falls
// back if a key lacks one (404), caches the first working model, supports
// multi-turn history, and passes the key in a header (not the URL). Server-only.

const CANDIDATES = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash", "gemini-flash-latest", "gemini-1.5-pro", "gemini-1.5-flash"]
let cachedModel: string | null = null

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

export async function geminiGenerate(opts: {
  key: string
  /** Explicit preference takes precedence over the shared caller default/cache. */
  model?: string
  system: string
  message: string
  history?: GeminiTurn[]
  maxOutputTokens?: number
  temperature?: number
}): Promise<GeminiResult> {
  const preferredModel = opts.model ?? (process.env.GEMINI_MODEL || undefined)
  // A model is a single public API resource identifier, never a URL/query or
  // arbitrary provider diagnostic. Invalid configuration must not be echoed.
  if (preferredModel !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(preferredModel)) {
    return { error: "gemini_provider_model_invalid" }
  }
  const models = [preferredModel, cachedModel, ...CANDIDATES].filter((m): m is string => !!m)
  const seen = new Set<string>()
  const contents = [
    ...(opts.history ?? []).map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
    { role: "user", parts: [{ text: opts.message }] },
  ]
  let lastErr = "no model tried"

  for (const model of models) {
    if (seen.has(model)) continue
    seen.add(model)
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": opts.key },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: opts.system }] },
          contents,
          generationConfig: {
            maxOutputTokens: opts.maxOutputTokens ?? 700,
            temperature: opts.temperature ?? 0.4,
          },
        }),
      })
      if (res.ok) {
        const data = await res.json()
        const reply: string =
          data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text).join("") ?? ""
        if (reply.trim()) {
          cachedModel = model // retain the working fallback; explicit preferences still win
          return { reply, model }
        }
        lastErr = providerError("empty")
        continue
      }
      // Do not read or propagate provider bodies: they may echo the API key,
      // request URL, prompt, or vendor-internal diagnostics.
      lastErr = providerError("http", res.status)
      discardProviderBody(res)
      if (res.status !== 404) break // 400/403/429/5xx won't be fixed by another model
    } catch (e) {
      void e
      lastErr = providerError("network")
    }
  }
  return { error: lastErr }
}
