import { withSumsubSandboxHeaders } from "./lib/kyc/sumsub-security.mjs"
import { withQaOutputIgnored } from "./lib/dev-qa-watch.mjs"
import { fileURLToPath } from "node:url"

// Tailwind's directory dependencies reach artifacts even when its content
// scanner respects .gitignore. Next watches those directories recursively,
// so recording QA video/trace there must not trigger a dev rebuild loop.
const qaOutputDirectory = fileURLToPath(new URL("./artifacts/qa", import.meta.url))
const localNativeRequested = Object.hasOwn(process.env, "HK_LOCAL_NATIVE") || Object.hasOwn(process.env, "NEXT_PUBLIC_HK_LOCAL_NATIVE")
if (localNativeRequested && (process.env.HK_LOCAL_NATIVE !== "local-native-20260930-v1" || process.env.NEXT_PUBLIC_HK_LOCAL_NATIVE !== "local-native-20260930-v1"
  || process.env.NODE_ENV !== "development" || Object.keys(process.env).some(k => k === "VERCEL" || k.startsWith("VERCEL_")))) throw new Error("Local native profile is development-only")

const productionSecurityHeaders = withSumsubSandboxHeaders([
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
])

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(localNativeRequested ? { distDir: ".next-native3183", typescript: { tsconfigPath: "tsconfig.native-local.json" } } : {}),
  turbopack: {
    root: process.cwd(),
  },
  images: {
    unoptimized: true,
  },
  webpack(config, { dev }) {
    if (dev) config.watchOptions = {
      ...config.watchOptions,
      ignored: withQaOutputIgnored(config.watchOptions?.ignored, qaOutputDirectory),
    }
    return config
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
