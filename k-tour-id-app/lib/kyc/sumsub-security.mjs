// SDK embedding is opt-in and is forbidden on the Vercel Production target.
// This helper contains no credentials and is shared by source/staged builds.
export function withSumsubSandboxHeaders(headers, env = process.env) {
  if (env.NEXT_PUBLIC_ONDO_SUMSUB_SANDBOX !== "1" || env.VERCEL_ENV === "production") return headers
  return headers.map((header) => {
    if (header.key === "Content-Security-Policy") return { ...header, value: header.value
      .replace(/connect-src ([^;]+)/, "connect-src $1 https://api.sumsub.com https://static.sumsub.com")
      + "; frame-src https://api.sumsub.com" }
    if (header.key === "Permissions-Policy") return { ...header, value: header.value
      .replace("camera=()", 'camera=(self "https://api.sumsub.com")')
      .replace("microphone=()", 'microphone=(self "https://api.sumsub.com")') }
    return header
  })
}
