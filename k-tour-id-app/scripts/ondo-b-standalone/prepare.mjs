import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { dirname, extname, relative, resolve } from "node:path"
import {
  APP_ROOT,
  HISTORICAL_B_PROJECT_ID,
  LEGACY_DISCOVERY_QUERY_KEYS,
  LOCAL_ONLY_PROJECT_ID,
  PUBLIC_FILES,
  SOURCE_FILES,
  STAGE_ROOT,
} from "./policy.mjs"

const ROOT_LAYOUT = `import type React from "react"
import type { Metadata, Viewport } from "next"
import "./globals.css"
import { ONDO_B_APPEARANCE_BOOTSTRAP_SCRIPT } from "@/features/ondo/shared/state/ondo-b-appearance"

const metadataOrigin = process.env.VERCEL_ENV === "production"
  ? "https://ktour-id.vercel.app"
  : process.env.NEXT_PUBLIC_ONDO_B_ORIGIN ?? "https://ktour-id.vercel.app"

export const metadata: Metadata = {
  metadataBase: new URL(metadataOrigin),
  applicationName: "K-Tour ID",
  title: "K-Tour ID",
  description: "Find your next food stop in Korea with K-Tour ID—discover restaurants, cafés and bars on the map, and keep your travel pass close.",
  generator: "K-Tour ID",
  icons: {
    icon: [
      { url: "/brand/ktour-id-mono-v1-16.png", type: "image/png", sizes: "16x16" },
      { url: "/brand/ktour-id-mono-v1-32.png", type: "image/png", sizes: "32x32" },
      { url: "/brand/ktour-id-mono-v1-192.png", type: "image/png", sizes: "192x192" },
      { url: "/brand/ktour-id-mono-v1.svg", type: "image/svg+xml", sizes: "any" },
    ],
    apple: [{ url: "/brand/ktour-id-mono-v1-180.png", type: "image/png", sizes: "180x180" }],
  },
  openGraph: {
    siteName: "K-Tour ID",
    title: "K-Tour ID",
    description: "Find your next food stop in Korea with K-Tour ID—discover restaurants, cafés and bars on the map, and keep your travel pass close.",
    type: "website",
    images: [{ url: "/og-ktour-korea-v3.png", width: 1200, height: 630, alt: "K-Tour ID — Korean hanok alley, barbecue and a café with yakgwa" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "K-Tour ID",
    description: "Find your next food stop in Korea with K-Tour ID—discover restaurants, cafés and bars on the map, and keep your travel pass close.",
    images: ["/og-ktour-korea-v3.png"],
  },
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="ko"
      className="antialiased"
      data-ondo-theme="light"
      data-ondo-theme-preference="system"
      suppressHydrationWarning
    >
      <head>
        <script
          id="ondo-appearance-bootstrap"
          dangerouslySetInnerHTML={{ __html: ONDO_B_APPEARANCE_BOOTSTRAP_SCRIPT }}
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
`

const GLOBALS = `@import "maplibre-gl/dist/maplibre-gl.css";

:root {
  --focus: #1d66d1;
  color-scheme: light;
  --ondo-canvas: #ffffff;
  --ondo-surface: #ffffff;
  --ondo-surface-raised: #ffffff;
  --ondo-surface-soft: #f3f3f1;
  --ondo-ink: #171717;
  --ondo-muted: #626262;
  --ondo-quiet: #737373;
  --ondo-line: rgb(23 23 23 / 11%);
  --ondo-line-strong: rgb(23 23 23 / 34%);
  --ondo-shadow: 0 14px 36px rgb(0 0 0 / 8%), 0 2px 7px rgb(0 0 0 / 3%);
  --ondo-control: #171717;
  --ondo-control-ink: #ffffff;
  --ondo-accent: #8c244f;
  --ondo-focus: #1d66d1;
  --success: #326451;
  --success-surface: #e8eee9;
}
.dark,
:root[data-ondo-theme="dark"] {
  color-scheme: dark;
  --ondo-canvas: #111214;
  --ondo-surface: #18191d;
  --ondo-surface-raised: #202126;
  --ondo-surface-soft: #25262b;
  --ondo-ink: #f4f4f5;
  --ondo-muted: #b7b6bc;
  --ondo-quiet: #918f98;
  --ondo-line: rgb(255 255 255 / 13%);
  --ondo-line-strong: rgb(255 255 255 / 34%);
  --ondo-shadow: 0 18px 42px rgb(0 0 0 / 38%), 0 2px 8px rgb(0 0 0 / 24%);
  --ondo-control: #f4f4f5;
  --ondo-control-ink: #111214;
  --ondo-accent: #ff87bf;
  --ondo-focus: #8fb8ff;
  --success: #78c9a4;
  --success-surface: #183429;
}
* { box-sizing: border-box; }
html, body { min-height: 100%; margin: 0; }
body { background: var(--ondo-canvas); color: var(--ondo-ink); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; }
button, input, textarea, select { font: inherit; }
button, a { -webkit-tap-highlight-color: transparent; }
button { cursor: pointer; }
`

const QA_CONTROLS_STUB = `"use client"

import { useEffect, useState } from "react"
import { SAMPLE_ENVIRONMENT_ENABLED } from "../../contracts/sample-environment"

const REVIEW_ENABLED_KEY = "ondo.review.flow.v1"
export const REVIEW_FLOW_CHANGE_EVENT = "ondo-review-flow-change"
let capturedForDocument = false
let capturedPath: string | null = null

export const QA_RUNTIME_ENABLED = false
export function hasReviewSessionOptIn() {
  if (typeof window === "undefined") return false
  const requested = new URLSearchParams(window.location.search).get("review")
  if (requested === "0") return false
  if (requested === "1") return true
  try {
    const stored = window.sessionStorage.getItem(REVIEW_ENABLED_KEY)
    if (stored === "1") return true
    if (stored === "0") return false
  } catch {}
  return SAMPLE_ENVIRONMENT_ENABLED
}
export function hasQaSessionOptIn() { return hasReviewSessionOptIn() }
export function qaReviewFixtureOptions() { return { allowReviewFixture: hasQaSessionOptIn() } as const }
export function enterReviewSample() {
  if (typeof window === "undefined") return false
  try {
    window.sessionStorage.setItem(REVIEW_ENABLED_KEY, "1")
    const url = new URL(window.location.href)
    url.searchParams.set("review", "1")
    window.history.replaceState(window.history.state, "", \`\${url.pathname}\${url.search}\${url.hash}\`)
    window.dispatchEvent(new Event(REVIEW_FLOW_CHANGE_EVENT))
    return true
  } catch { return false }
}
export function exitReviewSample() {
  if (typeof window === "undefined") return false
  try {
    window.sessionStorage.setItem(REVIEW_ENABLED_KEY, "0")
    const url = new URL(window.location.href)
    url.searchParams.set("review", "0")
    window.dispatchEvent(new Event(REVIEW_FLOW_CHANGE_EVENT))
    window.location.replace(\`\${url.pathname}\${url.search}\${url.hash}\`)
    return true
  } catch { return false }
}
export function captureQaControls(search: string) {
  if (typeof window === "undefined") return
  const params = new URLSearchParams(search)
  const currentPath = window.location.pathname
  if (capturedForDocument && capturedPath === currentPath && !params.has("review")) return
  capturedForDocument = true
  capturedPath = currentPath
  try {
    const requestedReview = params.get("review")
    if (requestedReview === "1") window.sessionStorage.setItem(REVIEW_ENABLED_KEY, "1")
    else if (requestedReview !== null) window.sessionStorage.setItem(REVIEW_ENABLED_KEY, "0")
  } catch {}
}
export function readQaScenario() { return null }
export function useQaControls() {
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    captureQaControls(window.location.search)
    const sync = () => setEnabled(hasQaSessionOptIn())
    sync()
    window.addEventListener(REVIEW_FLOW_CHANGE_EVENT, sync)
    window.addEventListener("popstate", sync)
    return () => {
      window.removeEventListener(REVIEW_FLOW_CHANGE_EVENT, sync)
      window.removeEventListener("popstate", sync)
    }
  }, [])
  return enabled
}
export function useReviewSampleSession() {
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    const sync = () => setEnabled(hasReviewSessionOptIn())
    sync()
    window.addEventListener(REVIEW_FLOW_CHANGE_EVENT, sync)
    window.addEventListener("popstate", sync)
    return () => {
      window.removeEventListener(REVIEW_FLOW_CHANGE_EVENT, sync)
      window.removeEventListener("popstate", sync)
    }
  }, [])
  return enabled
}
export function readQaRuntime<T extends object>(): T | undefined { return undefined }
`

const NEXT_CONFIG = `const securityHeaders = [
  { key: "Content-Security-Policy", value: "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' data: https://tiles.openfreemap.org; img-src 'self' data: blob: https:; connect-src 'self' https://tiles.openfreemap.org https://openfreemap.org; worker-src 'self' blob:" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=(), payment=(), usb=()" },
  { key: "X-Frame-Options", value: "DENY" },
]

export default {
  images: { unoptimized: true },
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/", headers: securityHeaders },
      { source: "/ondo-b", headers: securityHeaders },
      { source: "/api/ondo/venues/:path*", headers: securityHeaders },
    ]
  },
}
`

const VITE_CONFIG = `import vinext from "vinext"
import { defineConfig } from "vite"
import { sites } from "./build/sites-vite-plugin"

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: [],
  r2_buckets: [],
}

export default defineConfig(async () => {
  process.env.WRANGLER_WRITE_LOGS ??= "false"
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs"
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry"
  const { cloudflare } = await import("@cloudflare/vite-plugin")
  return {
    plugins: [
      vinext(),
      sites(),
      cloudflare({ viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] }, config: localBindingConfig }),
    ],
  }
})
`

const WORKER = `import {
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
  handleImageOptimization,
} from "vinext/server/image-optimization"
import handler from "vinext/server/app-router-entry"

interface Fetcher { fetch(request: Request): Promise<Response> }
interface Env {
  ASSETS: Fetcher
  IMAGES: { input(stream: ReadableStream): { transform(options: Record<string, unknown>): { output(options: { format: string; quality: number }): Promise<{ response(): Response }> } } }
}
interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void }

const securityHeaders = {
  "Content-Security-Policy": "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' data: https://tiles.openfreemap.org; img-src 'self' data: blob: https:; connect-src 'self' https://tiles.openfreemap.org https://openfreemap.org; worker-src 'self' blob:",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(self), camera=(), microphone=(), payment=(), usb=()",
  "X-Frame-Options": "DENY",
}

const allowedPublicAssetPaths = new Set(${JSON.stringify(PUBLIC_FILES.map((path) => `/${path.replace(/^public\//, "")}`))})
const legacyDiscoveryQueryKeys = ${JSON.stringify(LEGACY_DISCOVERY_QUERY_KEYS)} as const

function secure(response: Response) {
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(securityHeaders)) headers.set(key, value)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

function isAllowed(pathname: string) {
  return pathname === "/"
    || pathname === "/ondo-b"
    || /^\\/api\\/ondo\\/venues\\/[^/]+$/.test(pathname)
    || pathname === "/_vinext/image"
    || allowedPublicAssetPaths.has(pathname)
    || pathname.startsWith("/_next/")
    || pathname.startsWith("/assets/")
}

function legacyDiscoveryRedirect(url: URL) {
  const canonical = new URL("/", url)
  for (const key of legacyDiscoveryQueryKeys) {
    const values = url.searchParams.getAll(key)
    if (values.length === 1 && values[0].length <= 160) canonical.searchParams.set(key, values[0])
  }
  return secure(new Response(null, {
    status: 308,
    headers: {
      "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate",
      Location: canonical.toString(),
    },
  }))
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    if (!isAllowed(url.pathname)) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } })
    // Vinext does not currently pass App Router searchParams to redirect-only
    // pages consistently. Own this compatibility redirect at the HTTP boundary
    // so old bookmarks retain only the public discovery context.
    if (url.pathname === "/ondo-b") return legacyDiscoveryRedirect(url)
    if (url.pathname === "/_vinext/image") {
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality })
          return result.response()
        },
      }, [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES])
    }
    const response = await handler.fetch(request, env, ctx)
    return url.pathname === "/" || url.pathname === "/ondo-b" || url.pathname.startsWith("/api/ondo/venues/")
      ? secure(response)
      : response
  },
}

export default worker
`

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    lib: ["dom", "dom.iterable", "esnext"],
    target: "ES2020",
    skipLibCheck: true,
    strict: true,
    noEmit: true,
    esModuleInterop: true,
    module: "esnext",
    moduleResolution: "bundler",
    resolveJsonModule: true,
    isolatedModules: true,
    jsx: "react-jsx",
    paths: { "@/*": ["./*"] },
  },
  include: ["**/*.ts", "**/*.tsx"],
  // Next/Vercel and vinext/Cloudflare share this isolated source tree but do
  // not share build-time configuration modules. Keep the Next typecheck on
  // every product file while leaving the alternate builder entry points to
  // their own compiler.
  exclude: ["node_modules", "dist", "vite.config.ts", "worker"],
}, null, 2) + "\n"

const PACKAGE = JSON.stringify({
  name: "ondo-b-production-site",
  private: true,
  type: "module",
  scripts: { build: "next build" },
  dependencies: {
    "lucide-react": "^0.454.0",
    "maplibre-gl": "^5.7.1",
    "qrcode-generator": "2.0.4",
    next: "16.2.6",
    react: "19.2.6",
    "react-dom": "19.2.6",
    vinext: "0.0.50",
    vite: "8.0.13",
  },
  devDependencies: {
    "@types/node": "^22",
    "@types/react": "19.2.14",
    "@types/react-dom": "19.2.3",
    typescript: "5.9.3",
  },
}, null, 2) + "\n"

const VENUE_INDEX = `export type {
  CanonicalMapVenue,
  CanonicalVenue,
  FieldEvidence,
  SourceTruth,
  VenueCityId,
  VenuePrimaryCategory,
} from "./contracts"
export {
  CANONICAL_PRIVATE_NOTE_MAX_LENGTH,
  isCanonicalVenueId,
  sanitizeCanonicalVenueIds,
  sanitizeCanonicalVenueNotes,
  type CanonicalVenueId,
} from "./canonical-allowlist"
`

const LOCAL_SOURCE_EXTENSIONS = Object.freeze([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css"])
const SCANNED_SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"])

async function stagedFilesBelow(root, prefix = "") {
  const entries = await readdir(resolve(root, prefix), { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    return entry.isDirectory() ? stagedFilesBelow(root, path) : [path]
  }))
  return files.flat()
}

function localImportSpecifiers(source) {
  const specifiers = []
  const staticPattern = /\b(?:import|export)\s+(?:type\s+)?(?:[^"'`;]*?\s+from\s+)?["']([^"']+)["']/g
  const dynamicPattern = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g
  for (const pattern of [staticPattern, dynamicPattern]) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1].split(/[?#]/, 1)[0]
      if (specifier.startsWith(".") || specifier.startsWith("@/")) specifiers.push(specifier)
    }
  }
  return specifiers
}

function stagedImportCandidates(stageRoot, importer, specifier) {
  const base = specifier.startsWith("@/")
    ? resolve(stageRoot, specifier.slice(2))
    : resolve(dirname(resolve(stageRoot, importer)), specifier)
  const paths = extname(base)
    ? [base]
    : [
        base,
        ...LOCAL_SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
        ...LOCAL_SOURCE_EXTENSIONS.map((extension) => resolve(base, `index${extension}`)),
      ]
  return paths.map((path) => relative(stageRoot, path).replaceAll("\\", "/"))
}

export async function assertStandaloneLocalImportClosure(stageRoot = STAGE_ROOT) {
  const files = await stagedFilesBelow(stageRoot)
  const staged = new Set(files)
  const scanned = files.filter((file) => SCANNED_SOURCE_EXTENSIONS.has(extname(file)))
  let localImportCount = 0
  for (const importer of scanned) {
    const source = await readFile(resolve(stageRoot, importer), "utf8")
    for (const specifier of localImportSpecifiers(source)) {
      localImportCount += 1
      const candidates = stagedImportCandidates(stageRoot, importer, specifier)
      if (!candidates.some((candidate) => staged.has(candidate))) {
        throw new Error(`Standalone source closure is missing local import ${specifier} from ${importer}`)
      }
    }
  }
  return { scannedFileCount: scanned.length, localImportCount }
}

async function copyFile(relativePath) {
  const source = resolve(APP_ROOT, relativePath)
  const target = resolve(STAGE_ROOT, relativePath)
  await mkdir(dirname(target), { recursive: true })
  await cp(source, target)
}

async function assertProjectIsolation(projectId) {
  const protectedHosting = JSON.parse(await readFile(resolve(APP_ROOT, ".openai/hosting.json"), "utf8"))
  if (projectId === protectedHosting.project_id || projectId === HISTORICAL_B_PROJECT_ID) {
    throw new Error("Refusing to package ONDO B with an existing protected project identity")
  }
}

async function writeProductionVenueDetails() {
  const path = resolve(STAGE_ROOT, "data/ondo-venues/canonical-venues.json")
  const source = JSON.parse(await readFile(path, "utf8"))
  const venues = source.venues.map((venue) => ({
    id: venue.id,
    sourceIds: venue.sourceIds,
    sourceSnapshotAt: venue.sourceSnapshotAt,
    primaryCategory: venue.primaryCategory,
    name: venue.name,
    address: venue.address,
    sourceCategory: venue.sourceCategory,
    licenseStatus: venue.licenseStatus,
    licenseOpenedAt: venue.licenseOpenedAt,
    sourceModifiedAt: venue.sourceModifiedAt,
    facts: {
      openingHours: venue.facts.openingHours,
      foreignCardAccepted: venue.facts.foreignCardAccepted,
      menu: venue.facts.menu,
      englishSupport: venue.facts.englishSupport,
    },
  }))
  await writeFile(path, `${JSON.stringify({
    generatedAt: source.generatedAt,
    truthNotice: source.truthNotice,
    venues,
  })}\n`)
}

export async function prepareStandaloneSource({ projectId = process.env.ONDO_B_SITE_PROJECT_ID ?? LOCAL_ONLY_PROJECT_ID } = {}) {
  await assertProjectIsolation(projectId)
  await rm(STAGE_ROOT, { recursive: true, force: true })
  await Promise.all([...SOURCE_FILES, ...PUBLIC_FILES].map(copyFile))
  await writeProductionVenueDetails()
  const generated = new Map([
    ["app/layout.tsx", ROOT_LAYOUT],
    ["app/globals.css", GLOBALS],
    ["next.config.mjs", NEXT_CONFIG],
    ["vite.config.ts", VITE_CONFIG],
    ["worker/index.ts", WORKER],
    ["tsconfig.json", TSCONFIG],
    ["package.json", PACKAGE],
    ["lib/ondo/venues/index.ts", VENUE_INDEX],
    ["features/ondo/shared/ui/use-qa-controls.ts", QA_CONTROLS_STUB],
    // The public discovery artifact remains provider-free. The full-app
    // integration lane keeps Harvey's real implementations and API routes.
    // Never copy provider SDKs or credentials into this standalone build.
    ["features/ondo/hackathon-b/hackathon-layer-b.tsx", 'export function HackathonEntitlementLayerB() { return null }\n'],
    ["features/ondo/hackathon-b/hackathon-cta-b.tsx", 'export function HackathonEntitlementCtaB(_props: { venueId: string; locale: "en" | "ko" | "ja" }) { return null }\n'],
    [".openai/hosting.json", `${JSON.stringify({ project_id: projectId, d1: null, r2: null }, null, 2)}\n`],
  ])
  await Promise.all([...generated].map(async ([relativePath, contents]) => {
    const target = resolve(STAGE_ROOT, relativePath)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, contents)
  }))
  await assertStandaloneLocalImportClosure(STAGE_ROOT)
  return STAGE_ROOT
}

if (process.argv[1] === import.meta.filename) {
  const stage = await prepareStandaloneSource()
  process.stdout.write(`Prepared isolated ONDO B source at ${stage}\n`)
}
