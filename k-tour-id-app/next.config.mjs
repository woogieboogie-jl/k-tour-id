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
      // Optional CX browser handoff. Reachability is environment-dependent;
      // a rendered QR does not prove that a server verified the identity result.
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
