const productionSecurityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      process.env.NODE_ENV === "production"
        ? "script-src 'self' 'unsafe-inline'"
        : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com https://tiles.openfreemap.org",
      "img-src 'self' data: blob: https:",
      // cx.raonsecure.co.kr is called from the browser: the CX verifier refuses cloud
      // egress, so the QR handoff is fetched by the visitor's own network.
      "connect-src 'self' https://tiles.openfreemap.org https://openfreemap.org https://cx.raonsecure.co.kr:18543",
      "worker-src 'self' blob:",
    ].join("; "),
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=(), payment=(), usb=()" },
  { key: "X-Frame-Options", value: "DENY" },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  images: {
    unoptimized: true,
  },
  // Hackathon demo deploys build the full app with `next build`. If a type-only regression
  // blocks a Vercel build, HK_BUILD_IGNORE_TS=1 lets the demo ship while it is fixed;
  // `pnpm typecheck` remains the source of truth locally.
  typescript: { ignoreBuildErrors: process.env.HK_BUILD_IGNORE_TS === "1" },
  async headers() {
    return [
      { source: "/", headers: productionSecurityHeaders },
      { source: "/ondo-b", headers: productionSecurityHeaders },
      { source: "/ondo-a", headers: productionSecurityHeaders },
      { source: "/ondo", headers: productionSecurityHeaders },
      { source: "/api/ondo/venues/:path*", headers: productionSecurityHeaders },
    ]
  },
}

export default nextConfig
