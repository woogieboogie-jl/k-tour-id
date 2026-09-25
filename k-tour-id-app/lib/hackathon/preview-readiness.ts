// Public build flag, deliberately accessed statically so Next freezes it in
// BOTH browser and server bundles. Runtime credentials cannot enable this lane.
export function isReadinessPreview(): boolean {
  return process.env.NEXT_PUBLIC_HK_PREVIEW_READ_ONLY === "1"
}

/** A separate frozen profile: real CX only, never the complete chain journey. */
export function isCxPreview(): boolean {
  return process.env.NEXT_PUBLIC_HK_CX_PREVIEW === "1"
}

export function previewReadOnlyResponse(): Response {
  return Response.json({
    error: {
      code: "preview_read_only",
      message: "Readiness preview only. Identity, AI, signing and chain execution are disabled.",
      retryable: false,
    },
  }, { status: 503, headers: { "cache-control": "no-store" } })
}
