import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { expect, test } from "@playwright/test"

const APP_ROOT = process.cwd()
const PROTECTED_A_PROJECT = "appgprj_6a69e0a4fff48191892ff4022ebf08b2"
const PROTECTED_HISTORICAL_B_PROJECT = "appgprj_6a85de65d6148191aa042ae9c2787dd2"
const PERSONAL_VERCEL_PROJECT = "prj_w5rckTz9B1DO55fvVRXjQRy9L5RM"
const PERSONAL_VERCEL_ORG = "team_6kJAloQ9WlswvMtbbCmGI7Er"
const PERSONAL_VERCEL_NAME = "ondo"
const STAGE_ROOT = resolve(APP_ROOT, ".ondo-b-standalone")
const BRAND_DESCRIPTION = "Find your next food stop in Korea with K-Tour ID—discover restaurants, cafés and bars on the map, and keep your travel pass close."
// Resolve the already-pinned Next dependency rather than an unrelated global Sharp installation.
const appRequire = createRequire(resolve(APP_ROOT, "package.json"))
const sharp = createRequire(appRequire.resolve("next/package.json"))("sharp")

function filesBelow(root: string, prefix = ""): string[] {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    return entry.isDirectory()
      ? filesBelow(resolve(root, entry.name), relative)
      : [relative]
  }).sort()
}

test.describe("ONDO B standalone Sites packaging contract", () => {
  test.describe.configure({ mode: "serial" })

  test("B-STANDALONE-001 declares a deterministic build, scan, and probe lane", () => {
    const manifest = JSON.parse(readFileSync(resolve(APP_ROOT, "package.json"), "utf8")) as { packageManager?: string; scripts?: Record<string, string> }
    const buildRunner = readFileSync(resolve(APP_ROOT, "scripts/ondo-b-standalone/build.mjs"), "utf8")
    const sourcePreparer = readFileSync(resolve(APP_ROOT, "scripts/ondo-b-standalone/prepare.mjs"), "utf8")
    expect(manifest.scripts).toMatchObject({
      "prepare:sites:ondo-b": "node scripts/ondo-b-standalone/prepare.mjs",
      "build:sites:ondo-b": "node scripts/ondo-b-standalone/build.mjs",
      "scan:sites:ondo-b": "node scripts/ondo-b-standalone/scan-artifact.mjs",
      "probe:sites:ondo-b": "node scripts/ondo-b-standalone/probe-http.mjs",
      "guard:deploy:ondo-b": "node scripts/ondo-b-standalone/assert-deploy-target.mjs",
      "build:vercel:ondo-b": "pnpm prepare:sites:ondo-b && cd .ondo-b-standalone && ../node_modules/.bin/next build --webpack && cd .. && pnpm scan:vercel:ondo-b",
      "scan:vercel:ondo-b": "ONDO_B_NEXT_SOURCE_ROOT=.ondo-b-standalone ONDO_B_NEXT_ROOT=.ondo-b-standalone/.next node scripts/ondo-b-next-client-artifact.mjs",
    })
    const vercel = JSON.parse(readFileSync(resolve(APP_ROOT, "vercel.json"), "utf8"))
    expect(vercel).toMatchObject({
      framework: "nextjs",
      buildCommand: "pnpm build:vercel:ondo-b",
      outputDirectory: ".ondo-b-standalone/.next",
    })
    expect(manifest.packageManager).toBe("pnpm@10.8.0")
    const vercelIgnore = readFileSync(resolve(APP_ROOT, "../.vercelignore"), "utf8")
    expect(vercelIgnore).toContain("k-tour-id-app/public/og-modern-atlas.png")
    expect(vercelIgnore).toContain("k-tour-id-app/public/og-ondo.png")
    expect(vercelIgnore).toContain("k-tour-id-app/tests")
    expect(manifest.scripts?.["test:visual:b"]).toContain("test:visual:b:current && pnpm test:visual:b:production && pnpm test:visual:b:legacy")
    expect(manifest.scripts?.["test:visual:b:production"]).toContain("playwright.production-visual.config.ts")
    expect(manifest.scripts?.["qa:b"]).toContain("test:e2e:a-regression")
    expect(manifest.scripts?.["qa:b"]).toContain("probe:sites:ondo-b")
    expect(buildRunner).toContain('child.once("close"')
    expect(buildRunner).not.toContain('child.once("exit"')
    expect(sourcePreparer).toContain("metadataBase: new URL(metadataOrigin)")
    expect(sourcePreparer).toContain("https://ktour-id.vercel.app")
  })

  test("B-STANDALONE-001B isolated source declares its remote-build runtime", () => {
    const sourcePreparer = readFileSync(resolve(APP_ROOT, "scripts/ondo-b-standalone/prepare.mjs"), "utf8")
    expect(sourcePreparer).toContain('scripts: { build: "next build" }')
    for (const dependency of ["next", "react", "react-dom", "maplibre-gl", "lucide-react", "typescript", "@types/node", "@types/react", "@types/react-dom"]) {
      expect(sourcePreparer).toContain(dependency)
    }
    expect(sourcePreparer).toContain('exclude: ["node_modules", "dist", "vite.config.ts", "worker"]')
  })

  test("B-STANDALONE-001A Vercel uploads every public asset required by the isolated build", async () => {
    const { PUBLIC_FILES } = await import("../../scripts/ondo-b-standalone/policy.mjs")
    const ignoredPaths = readFileSync(resolve(APP_ROOT, "../.vercelignore"), "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/\/$/, ""))
      .filter((line) => line && !line.startsWith("#") && !line.startsWith("!"))
    const blockedInputs = PUBLIC_FILES.filter((asset) => {
      const uploadPath = `k-tour-id-app/${asset}`
      return ignoredPaths.some((ignored) => uploadPath === ignored || uploadPath.startsWith(`${ignored}/`))
    })

    expect(blockedInputs).toEqual([])
  })

  test("B-STANDALONE-002 keeps both existing hosting identities protected", async () => {
    const hosting = JSON.parse(readFileSync(resolve(APP_ROOT, ".openai/hosting.json"), "utf8"))
    expect(hosting).toEqual({ project_id: PROTECTED_A_PROJECT, d1: null, r2: null })
    const scripts = ["prepare.mjs", "build.mjs", "scan-artifact.mjs", "probe-http.mjs", "policy.mjs"]
      .map((file) => readFileSync(resolve(APP_ROOT, "scripts/ondo-b-standalone", file), "utf8"))
      .join("\n")
    expect(scripts).toContain("ONDO_B_SITE_PROJECT_ID")
    expect(scripts).not.toContain(PROTECTED_A_PROJECT)
    expect(scripts).toContain(PROTECTED_HISTORICAL_B_PROJECT)

    const { prepareStandaloneSource } = await import("../../scripts/ondo-b-standalone/prepare.mjs")
    await expect(prepareStandaloneSource({ projectId: PROTECTED_A_PROJECT })).rejects.toThrow("existing protected project identity")
    await expect(prepareStandaloneSource({ projectId: PROTECTED_HISTORICAL_B_PROJECT })).rejects.toThrow("existing protected project identity")
  })

  test("B-STANDALONE-002A deployment guard allows only the exact approved personal Vercel target", async () => {
    const { assertStandaloneDeploymentTarget } = await import("../../scripts/ondo-b-standalone/assert-deploy-target.mjs")
    await expect(assertStandaloneDeploymentTarget({ provider: "sites", owner: "organization", sitesProjectId: "appgprj_new" })).rejects.toThrow("personal woogieboogie-jl owner boundary")
    await expect(assertStandaloneDeploymentTarget({ provider: "sites", owner: "woogieboogie-jl", sitesProjectId: "appgprj_local_only_ondo_b_artifact" })).rejects.toThrow("local-only placeholder")
    await expect(assertStandaloneDeploymentTarget({ provider: "sites", owner: "woogieboogie-jl", sitesProjectId: PROTECTED_A_PROJECT })).rejects.toThrow("protected A or historical-B")
    await expect(assertStandaloneDeploymentTarget({ provider: "sites", owner: "woogieboogie-jl", sitesProjectId: PROTECTED_HISTORICAL_B_PROJECT })).rejects.toThrow("protected A or historical-B")

    const fixtureRoot = await mkdtemp(resolve(tmpdir(), "ondo-b-vercel-target-"))
    try {
      const approved = resolve(fixtureRoot, "approved.json")
      await writeFile(approved, JSON.stringify({ projectId: PERSONAL_VERCEL_PROJECT, orgId: PERSONAL_VERCEL_ORG, projectName: PERSONAL_VERCEL_NAME }))
      await expect(assertStandaloneDeploymentTarget({ provider: "vercel", owner: "woogieboogie-jl", vercelUser: "wrong-user", vercelConfigPath: approved })).rejects.toThrow("personal jaewook-9643 user boundary")
      await expect(assertStandaloneDeploymentTarget({ provider: "vercel", owner: "woogieboogie-jl", vercelUser: "jaewook-9643", vercelScope: "some-team", vercelConfigPath: approved })).rejects.toThrow("with --scope")
      await expect(assertStandaloneDeploymentTarget({ provider: "vercel", owner: "woogieboogie-jl", vercelUser: "jaewook-9643", vercelConfigPath: approved })).resolves.toEqual({
        provider: "vercel",
        owner: "woogieboogie-jl",
        user: "jaewook-9643",
        projectId: PERSONAL_VERCEL_PROJECT,
        orgId: PERSONAL_VERCEL_ORG,
        projectName: PERSONAL_VERCEL_NAME,
      })

      for (const [name, identity] of [
        ["other-project", { projectId: "prj_other", orgId: PERSONAL_VERCEL_ORG, projectName: PERSONAL_VERCEL_NAME }],
        ["other-owner", { projectId: PERSONAL_VERCEL_PROJECT, orgId: "team_other", projectName: PERSONAL_VERCEL_NAME }],
        ["renamed-project", { projectId: PERSONAL_VERCEL_PROJECT, orgId: PERSONAL_VERCEL_ORG, projectName: "other-name" }],
      ] as const) {
        const candidate = resolve(fixtureRoot, `${name}.json`)
        await writeFile(candidate, JSON.stringify(identity))
        await expect(assertStandaloneDeploymentTarget({ provider: "vercel", owner: "woogieboogie-jl", vercelUser: "jaewook-9643", vercelConfigPath: candidate })).rejects.toThrow("outside the approved personal ondo project identity")
      }

      const protectedVercel = resolve(fixtureRoot, "protected.json")
      await writeFile(protectedVercel, JSON.stringify({ projectId: PROTECTED_A_PROJECT, orgId: PERSONAL_VERCEL_ORG, projectName: PERSONAL_VERCEL_NAME }))
      await expect(assertStandaloneDeploymentTarget({ provider: "vercel", owner: "woogieboogie-jl", vercelUser: "jaewook-9643", vercelConfigPath: protectedVercel })).rejects.toThrow("separate unprotected project identity")
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true })
    }
  })

  test("B-STANDALONE-003 prepared source contains the complete canonical / closure and legacy redirect", async () => {
    const { assertStandaloneLocalImportClosure, prepareStandaloneSource } = await import("../../scripts/ondo-b-standalone/prepare.mjs")
    await prepareStandaloneSource({ projectId: "appgprj_local_ondo_b_artifact" })
    const closure = await assertStandaloneLocalImportClosure()
    expect(closure.scannedFileCount).toBeGreaterThan(0)
    expect(closure.localImportCount).toBeGreaterThan(0)

    const routeFiles = filesBelow(resolve(STAGE_ROOT, "app"))
      .filter((file) => /(?:page|route|layout)\.(?:ts|tsx)$/.test(file))
    expect(routeFiles).toEqual([
      "api/ondo/venues/[venueId]/route.ts",
      "layout.tsx",
      "ondo-b/page.tsx",
      "page.tsx",
    ])

    const files = filesBelow(STAGE_ROOT)
    for (const file of [
      "features/ondo/map/discovery-collection-model-b.ts",
      "features/ondo/map/discovery-collection-b.tsx",
      "features/ondo/map/discovery-collection-b.module.css",
      "features/ondo/discovery-preview/fixtures.ts",
    ]) expect(files, `${file} is required by the integrated discovery closure`).toContain(file)
    expect(files).not.toContain("features/ondo/discovery-preview/discovery-preview.tsx")
    expect(files).not.toContain("app/ondo-b/labs/discovery/page.tsx")
    expect(files).toContain("public/og-ktour-korea-v3.png")
    expect(files).toContain("features/ondo/onboarding/official-directory-onboarding.tsx")
    expect(files).toContain("features/ondo/onboarding/official-directory-onboarding.module.css")
    expect(files.filter((file) => file.startsWith("public/"))).toEqual([
      "public/brand/ktour-id-mono-v1-16.png",
      "public/brand/ktour-id-mono-v1-180.png",
      "public/brand/ktour-id-mono-v1-192.png",
      "public/brand/ktour-id-mono-v1-32.png",
      "public/brand/ktour-id-mono-v1-512.png",
      "public/brand/ktour-id-mono-v1.svg",
      "public/editorial/food/coffee-croissant-illustration-v1.jpg",
      "public/editorial/food/ondo-category-casual-v1.jpg",
      "public/editorial/food/ondo-category-chinese-v1.jpg",
      "public/editorial/food/ondo-category-global-v1.jpg",
      "public/editorial/food/ondo-category-japanese-v1.jpg",
      "public/editorial/food/ondo-category-korean-v1.jpg",
      "public/editorial/food/ondo-category-night-v1.jpg",
      "public/editorial/food/ondo-category-night-v2.jpg",
      "public/editorial/food/ondo-category-night-v3.jpg",
      "public/editorial/food/ondo-category-specialty-v1.jpg",
      "public/editorial/food/perilla-noodles-illustration-v1.jpg",
      "public/editorial/food/tteokgalbi-illustration-v1.jpg",
      "public/editorial/japan-first-c01-sesame-oil.jpg",
      "public/editorial/japan-first-c03-seoul-eight-hours.jpg",
      "public/editorial/japan-first-c06-beauty-research.jpg",
      "public/editorial/japan-first-c18-jeju-screen-route.jpg",
      "public/editorial/japan-first-c20-jeju-kpop-route.jpg",
      "public/editorial/people/ondo-my-korea-inspiration-v2-landscape.jpg",
      "public/editorial/people/ondo-onboarding-travelers-v2-landscape.jpg",
      "public/editorial/people/ondo-tables-dinner-v2-landscape.jpg",
      "public/media/venues/onion-anguk-christopher-phua-20250301.jpg",
      "public/media/venues/research-jeju-sinseoloreum/momguk-gong-seokbae-20190723-v1.jpg",
      "public/media/venues/research-seoul-hakrim-dabang/exterior-seefooddiet-20250110-v1.jpg",
      "public/og-ktour-korea-v3.png",
    ])
    expect(files).toContain("features/ondo/identity-b/local-check-walkthrough-b.tsx")
    expect(files).toContain("features/ondo/identity-b/traveler-id-entry-b.tsx")
    expect(files).toContain("features/ondo/local-signal-b/local-signal-layer-b.tsx")
    expect(files).toContain("features/ondo/shared/state/ondo-b-window.d.ts")
    expect(files).toContain("features/ondo/shared/state/ondo-b-appearance.ts")
    const stagedLayout = readFileSync(resolve(STAGE_ROOT, "app/layout.tsx"), "utf8")
    const stagedGlobals = readFileSync(resolve(STAGE_ROOT, "app/globals.css"), "utf8")
    const stagedRoot = readFileSync(resolve(STAGE_ROOT, "app/page.tsx"), "utf8")
    const stagedLegacy = readFileSync(resolve(STAGE_ROOT, "app/ondo-b/page.tsx"), "utf8")
    expect(stagedRoot).toContain("<OndoProductB />")
    expect(stagedLegacy).toContain("permanentRedirect(query ?")
    expect(stagedLayout).toContain('applicationName: "K-Tour ID"')
    expect(stagedLayout).toContain('title: "K-Tour ID"')
    expect(stagedLayout).toContain('siteName: "K-Tour ID"')
    expect(stagedLayout).toContain('generator: "K-Tour ID"')
    expect(stagedLayout).toContain('url: "/brand/ktour-id-mono-v1.svg"')
    expect(stagedLayout).toContain('url: "/brand/ktour-id-mono-v1-32.png"')
    expect(stagedLayout).toContain('url: "/og-ktour-korea-v3.png"')
    expect(stagedLayout).toContain("robots: { index: false, follow: false }")
    expect(stagedLayout).toContain("ONDO_B_APPEARANCE_BOOTSTRAP_SCRIPT")
    expect(stagedLayout).toContain('data-ondo-theme="light"')
    expect(stagedLayout).toContain('data-ondo-theme-preference="system"')
    expect(stagedGlobals).toContain("--ondo-canvas: #ffffff")
    expect(stagedGlobals).toContain(':root[data-ondo-theme="dark"]')
    for (const file of [
      "features/ondo/contracts/execution-mode.ts",
      "features/ondo/after19/after19-global-b-model.ts",
      "features/ondo/after19/after19-global-b.tsx",
      "features/ondo/after19/after19-global-b.module.css",
      "features/ondo/after19/after19-place-return-b-model.ts",
      "features/ondo/identity-b/action-gate-contract-b.ts",
      "features/ondo/identity-b/action-gate-coordinator-b.tsx",
      "features/ondo/identity-b/action-gate-coordinator-b.module.css",
      "features/ondo/identity-b/activity-profile-b-provider.tsx",
      "features/ondo/identity-b/profile-reputation-b.tsx",
      "features/ondo/identity-b/profile-reputation-b.module.css",
      "features/ondo/local-signal-b/local-signal-model-b.ts",
      "features/ondo/pulse-b/pulse-model-b.ts",
      "features/ondo/commerce-b/stable-commerce-model-b.ts",
      "features/ondo/commerce-b/funding-rail-model-b.ts",
      "features/ondo/commerce-b/stablecoin-funding-b.tsx",
      "features/ondo/commerce-b/stablecoin-funding-b.module.css",
      "features/ondo/commerce-b/id-wallet-commerce-b.tsx",
      "features/ondo/commerce-b/id-wallet-commerce-b.module.css",
      "features/ondo/commerce-b/visit-stamp-receipt-b.tsx",
      "features/ondo/commerce-b/visit-stamp-receipt-b.module.css",
      "features/ondo/labs/labs-entry.tsx",
      "features/ondo/labs/labs-review-truth-b.ts",
      "features/ondo/labs/labs-model.ts",
      "features/ondo/labs/labs.module.css",
      "features/ondo/shared/ui/modal-layer-priority.ts",
      "features/ondo/shared/ui/use-sheet-presence.ts",
      "features/ondo/shared/state/private-note-draft-memory.ts",
      "features/ondo/shared/state/ondo-b-appearance.ts",
      "features/ondo/settings/settings-entry-b.module.css",
      "features/ondo/settings/settings-model-b.ts",
      "features/ondo/place/editorial-place-mount-b.tsx",
      "features/ondo/place/editorial-place-overlay-b.tsx",
      "features/ondo/place/editorial-place-overlay-b.module.css",
    ]) expect(files, `${file} is required positive standalone content`).toContain(file)
  })

  test("B-STANDALONE-004 generated package stays isolated from retired providers and routes", async () => {
    await (await import("../../scripts/ondo-b-standalone/prepare.mjs")).prepareStandaloneSource({ projectId: "appgprj_local_ondo_b_artifact" })
    const sourceFiles = filesBelow(STAGE_ROOT)
      .filter((file) => /\.(?:ts|tsx|js|mjs|json)$/.test(file))
    const source = sourceFiles
      .map((file) => `${file}\n${readFileSync(resolve(STAGE_ROOT, file), "utf8")}`)
      .join("\n")
    const visibleSource = sourceFiles
      .filter((file) => file.endsWith(".tsx"))
      .map((file) => readFileSync(resolve(STAGE_ROOT, file), "utf8"))
      .join("\n")

    expect(sourceFiles).not.toContain("features/ondo/connect/table-fixtures.ts")
    // Full-stack hackathon integration is opt-in, not part of the public map build.
    expect(sourceFiles.some((file) => file.startsWith("lib/hackathon/"))).toBe(false)
    expect(sourceFiles.some((file) => file.startsWith("app/api/hackathon/"))).toBe(false)
    expect(readFileSync(resolve(STAGE_ROOT, "features/ondo/hackathon-b/hackathon-layer-b.tsx"), "utf8"))
      .toBe("export function HackathonEntitlementLayerB() { return null }\nexport function HackathonDemoEntryB() { return null }\n")
    expect(readFileSync(resolve(STAGE_ROOT, "features/ondo/hackathon-b/hackathon-cta-b.tsx"), "utf8"))
      .toContain("{ return null }")
    expect(source).not.toContain("@mysten/sui")
    expect(source).not.toContain("HK_SUI_ISSUER_SECRET_KEY")
    expect(source).not.toContain("table-fixtures")
    expect(source).not.toMatch(/AppProvider|LangProvider|LocationProvider|WalletProvider|useOndo\b|ondo-provider|demo-journey|mock-data|features\/ondo\/(?:commerce\/|identity\/|rewards\/|trust\/|fixtures\/)/i)
    expect(source).toMatch(/export function LabsEntryB\s*\(/)
    expect(source).not.toContain("export function LabsEntry()")
    expect(source).toContain("export function SheetB(")
    expect(source).not.toContain("export function Sheet(")
    expect(source).not.toMatch(/(?:^|["'`])\/(?:demo|wallet|ondo|ask|chat|connect|partner|profile|services|pass|present|journey|benefits|architecture|evidence)(?:[/?"'`]|$)/im)
    expect(visibleSource).toContain("The device ledger uses OOKRW internally")
    expect(visibleSource).toContain("No wallet, merchant, stablecoin network or payment provider is currently connected")
    expect(visibleSource).toContain('demoOffer: "Meal benefit"')
  })

  test("B-STANDALONE-005 scanner rejects exact compiled legacy UI identifiers while source-only truth types remain allowed", async () => {
    const { LEGACY_ARTIFACT_TEXT } = await import("../../scripts/ondo-b-standalone/policy.mjs")
    const blocked = [
      "{\"simulation\":null}",
      "CheckoutOverlay",
      "ChatOverlay",
      "RewardsEntry",
      "LabsEntry",
      "demo-journey",
      "WalletProvider",
      "k-tour-id.wallet",
      "ondo-after19-layer",
    ]
    for (const sample of blocked) {
      expect(LEGACY_ARTIFACT_TEXT.some((pattern: RegExp) => pattern.test(sample)), sample).toBe(true)
    }
    for (const requiredTruth of ["K-Tour ID ready", "Passport eKYC", "ondo-after19-lens"]) {
      expect(LEGACY_ARTIFACT_TEXT.some((pattern: RegExp) => pattern.test(requiredTruth)), requiredTruth).toBe(false)
    }

    const contracts = readFileSync(resolve(APP_ROOT, "lib/ondo/venues/contracts.ts"), "utf8")
    expect(contracts).toContain("simulation: null")
  })

  test("B-STANDALONE-005A production package keeps the public sample path while QA injection remains disabled", async () => {
    const { FORBIDDEN_QA_ARTIFACT_TEXT } = await import("../../scripts/ondo-b-standalone/policy.mjs")
    await (await import("../../scripts/ondo-b-standalone/prepare.mjs")).prepareStandaloneSource({ projectId: "appgprj_local_ondo_b_artifact" })
    const stub = readFileSync(resolve(STAGE_ROOT, "features/ondo/shared/ui/use-qa-controls.ts"), "utf8")
    expect(stub).toContain("QA_RUNTIME_ENABLED = false")
    expect(stub).toContain("readQaScenario() { return null }")
    expect(stub).toContain("export function enterReviewSample()")
    expect(stub).toContain("export function exitReviewSample()")
    expect(stub).toContain("export function useReviewSampleSession()")
    expect(stub).toContain("window.sessionStorage.setItem(REVIEW_ENABLED_KEY, \"1\")")
    expect(stub).toContain("export function useQaControls()")
    expect(stub).toContain("readQaRuntime<T extends object>(): T | undefined { return undefined }")
    for (const pattern of FORBIDDEN_QA_ARTIFACT_TEXT as readonly RegExp[]) {
      expect(pattern.test(stub), `${pattern} must not survive in the production stub`).toBe(false)
    }
  })

  test("B-STANDALONE-006 prepared onboarding CSS contains the B-native guest setup and no false-provider surface", async () => {
    await (await import("../../scripts/ondo-b-standalone/prepare.mjs")).prepareStandaloneSource({ projectId: "appgprj_local_ondo_b_artifact" })
    const css = readFileSync(resolve(STAGE_ROOT, "features/ondo/onboarding/official-directory-onboarding.module.css"), "utf8")
    expect(css).toContain('.root :global([data-sheet-layer="true"])')
    // R1 intentionally removed the first-step-only compressed layout. The
    // packaged guest setup must retain the same shared scale as its source.
    expect(css).toBe(readFileSync(resolve(process.cwd(), "features/ondo/onboarding/official-directory-onboarding.module.css"), "utf8"))
    expect(css).not.toContain('data-onboarding-step="intent"')
    expect(css).toMatch(/\.stageHeading h1\s*\{[^}]*font-size:clamp\(28px, 8vw, 32px\);[^}]*line-height:1\.08;/)
    expect(css).toMatch(/\.primary,\.secondary\s*\{[^}]*min-height:48px;/)
    expect(css).toMatch(/\.primary\s*\{[^}]*min-height:52px;/)
    expect(css).toContain('.choice[aria-checked="true"]')
    expect(css).toContain(".group")
    expect(css).not.toMatch(/(?:KYC|payment|chat|reward|Labs|After19|demo|simulation)/i)
    const details = readFileSync(resolve(STAGE_ROOT, "data/ondo-venues/canonical-venues.json"), "utf8")
    expect(details).not.toMatch(/"simulation"\s*:/i)
    const shell = readFileSync(resolve(STAGE_ROOT, "features/ondo/app/ondo-shell.module.css"), "utf8")
    expect(shell).toContain('.content[data-active-tab="tables"]')
    expect(shell).toContain('.content[data-active-tab="settings"]')
    expect(shell).toContain("grid-template-columns: repeat(5, 1fr)")
  })

  test("B-STANDALONE-007 policy preserves legacy rejection without denying P0 journey modules", async () => {
    const policy = await import("../../scripts/ondo-b-standalone/policy.mjs") as Record<string, unknown>
    expect(policy).not.toHaveProperty("BANNED_ARTIFACT_PATH")
    expect(policy).not.toHaveProperty("BANNED_ARTIFACT_TEXT")

    const { LEGACY_ARTIFACT_PATH, LEGACY_ARTIFACT_TEXT } = policy as {
      LEGACY_ARTIFACT_PATH: RegExp
      LEGACY_ARTIFACT_TEXT: readonly RegExp[]
    }
    for (const path of [
      "features/ondo/after19/after19-layer.tsx",
      "features/ondo/connect/tables-entry.tsx",
      "features/ondo/identity/identity-entry.tsx",
      "features/ondo/identity-b/profile-reputation-b.tsx",
      "features/ondo/identity-b/profile-reputation-b.module.css",
      "features/ondo/pulse-b/pulse-model-b.ts",
      "features/ondo/commerce-b/stable-commerce-model-b.ts",
    ]) {
      expect(LEGACY_ARTIFACT_PATH.test(path), path).toBe(false)
    }
    for (const symbol of [
      "After19Layer",
      "TablesEntry",
      "ConnectOverlays",
      "GateOverlay",
      "IdentityEntry",
      "Pulse",
      "Too Hot",
      "ID Wallet",
      "payment",
      "benefit",
      "voucher",
      "refund",
      "settlement",
      "OOKRW",
      "ONDO demo meal offer",
      "truthful preview",
    ]) {
      expect(LEGACY_ARTIFACT_TEXT.some((pattern) => pattern.test(symbol)), symbol).toBe(false)
    }
  })

  test("B-STANDALONE-008 current closure ships B-native Pulse Table, After19, and exact return modules", async () => {
    const { SOURCE_FILES } = await import("../../scripts/ondo-b-standalone/policy.mjs")
    for (const path of [
      "features/ondo/contracts/execution-mode.ts",
      "features/ondo/connect/tables-entry-b.tsx",
      "features/ondo/connect/pulse-table-b.module.css",
      "features/ondo/after19/after19-global-b-model.ts",
      "features/ondo/after19/after19-guest-memory-b.ts",
      "features/ondo/after19/after19-global-b.tsx",
      "features/ondo/after19/after19-place-return-b-model.ts",
      "features/ondo/map/place-return-ui-snapshot-b.ts",
      "features/ondo/identity-b/action-gate-contract-b.ts",
      "features/ondo/identity-b/action-gate-coordinator-b.tsx",
      "features/ondo/identity-b/action-gate-coordinator-b.module.css",
      "features/ondo/contracts/return-to-b.ts",
      "features/ondo/contracts/return-to.ts",
      "features/ondo/contracts/return-to-integrity.ts",
    ]) expect(SOURCE_FILES, `${path} must ship with /ondo-b`).toContain(path)
  })

  test("B-STANDALONE-009 current closure also ships B-native Local Signal and Traveler ID modules", async () => {
    const { SOURCE_FILES } = await import("../../scripts/ondo-b-standalone/policy.mjs")
    for (const path of [
      "features/ondo/identity-b/local-check-walkthrough-b.tsx",
      "features/ondo/identity-b/local-check-walkthrough-b.module.css",
      "features/ondo/identity-b/traveler-id-entry-b.tsx",
      "features/ondo/identity-b/traveler-id-entry-b.module.css",
      "features/ondo/identity-b/traveler-id-status-b.ts",
      "features/ondo/local-signal-b/local-signal-layer-b.tsx",
      "features/ondo/local-signal-b/local-signal-layer-b.module.css",
      "features/ondo/after19/after19-global-b-model.ts",
      "features/ondo/after19/after19-global-b.tsx",
      "features/ondo/after19/after19-global-b.module.css",
      "features/ondo/after19/after19-place-return-b-model.ts",
      "features/ondo/identity-b/action-gate-contract-b.ts",
      "features/ondo/identity-b/action-gate-coordinator-b.tsx",
      "features/ondo/identity-b/action-gate-coordinator-b.module.css",
    ]) expect(SOURCE_FILES, `${path} must ship with /ondo-b`).toContain(path)
  })

  test("B-STANDALONE-010 current closure positively ships Pulse and B-native commerce state/UI/CSS", async () => {
    const { SOURCE_FILES } = await import("../../scripts/ondo-b-standalone/policy.mjs")
    for (const path of [
      "features/ondo/pulse-b/pulse-model-b.ts",
      "features/ondo/commerce-b/stable-commerce-model-b.ts",
      "features/ondo/commerce-b/id-wallet-commerce-b.tsx",
      "features/ondo/commerce-b/id-wallet-commerce-b.module.css",
    ]) expect(SOURCE_FILES, `${path} must ship with /ondo-b`).toContain(path)
  })

  test("B-STANDALONE-011 ships current monochrome branding and preserves archived sources only in Git", async () => {
    const { PUBLIC_FILES, SOURCE_FILES } = await import("../../scripts/ondo-b-standalone/policy.mjs")
    for (const path of [
      "features/ondo/identity-b/ktour-id-setup-b.tsx",
      "features/ondo/identity-b/ktour-id-setup-b.module.css",
      "features/ondo/identity-b/ktour-id-setup-model-b.ts",
      "features/ondo/shared/ui/ktour-id-mark.tsx",
    ]) expect(SOURCE_FILES, `${path} must ship with /ondo-b`).toContain(path)
    for (const path of [
      "public/editorial/people/ondo-my-korea-inspiration-v2-landscape.jpg",
      "public/editorial/people/ondo-onboarding-travelers-v2-landscape.jpg",
      "public/editorial/people/ondo-tables-dinner-v2-landscape.jpg",
    ]) expect(PUBLIC_FILES, `${path} is referenced by the shipped UI`).toContain(path)
    expect(PUBLIC_FILES.filter(path => /\/brand\/(?:ondo-|ktour-id-(?:mark|lockup|logo|wordmark))/.test(path))).toEqual([])
    expect(PUBLIC_FILES).toContain("public/brand/ktour-id-mono-v1.svg")
    const suppliedMarkHash = createHash("sha256")
      .update(readFileSync(resolve(APP_ROOT, "public/brand/ktour-id-mark.png")))
      .digest("hex")
    expect(suppliedMarkHash).toBe("2f7467cb8efe5640489f8387e7b7f842b56b45a53619f61268b864fb9cd9b38d")
  })

  test("B-STANDALONE-BRAND-001 ships the versioned 1200x630 food discovery social card", async () => {
    const { PUBLIC_FILES } = await import("../../scripts/ondo-b-standalone/policy.mjs")
    expect(PUBLIC_FILES).toContain("public/og-ktour-korea-v3.png")
    expect(PUBLIC_FILES).not.toContain("public/og-ktour-food-v2.png")
    expect(PUBLIC_FILES).not.toContain("public/og-ktour-food-v1.png")
    expect(PUBLIC_FILES).not.toContain("public/og-map-first.png")
    const metadata = await sharp(resolve(APP_ROOT, "public/og-ktour-korea-v3.png")).metadata()
    expect(metadata).toMatchObject({ format: "png", width: 1200, height: 630 })
    for (const path of ["app/page.tsx", "app/layout.tsx", "scripts/ondo-b-standalone/prepare.mjs"]) {
      const source = readFileSync(resolve(APP_ROOT, path), "utf8")
      expect(source, path).toContain("/og-ktour-korea-v3.png")
      expect(source, path).not.toContain("/og-ktour-food-v1.png")
      expect(source, path).not.toContain("K-TOUR ID | ONDO")
      expect(source, path).toContain(BRAND_DESCRIPTION)
      expect(source, path).toContain("width: 1200")
      expect(source, path).toContain("height: 630")
      expect(source, path).not.toContain("/og-map-first.png")
    }
    const scanner = readFileSync(resolve(APP_ROOT, "scripts/ondo-b-standalone/scan-artifact.mjs"), "utf8")
    expect(scanner).toContain('const expectedOg = "public/og-ktour-korea-v3.png"')
    expect(scanner).toContain("for (const publicFile of PUBLIC_FILES)")
    expect(scanner).not.toContain("PUBLIC_FILES[0]")
    expect(scanner).not.toContain("PUBLIC_FILES.slice(1)")
  })

  test("B-STANDALONE-BRAND-002 ships monochrome browser icons at their declared sizes", async () => {
    const { PUBLIC_FILES } = await import("../../scripts/ondo-b-standalone/policy.mjs")
    const svgPath = "public/brand/ktour-id-mono-v1.svg"
    expect(PUBLIC_FILES).toContain(svgPath)
    const svg = readFileSync(resolve(APP_ROOT, svgPath), "utf8")
    expect(svg).toContain('viewBox="0 0 64 64"')
    expect(svg).not.toMatch(/<(?:image|script|linearGradient|radialGradient|filter)\b/i)
    const paints = [...svg.matchAll(/(?:fill|stroke)="(#[a-f\d]{3}(?:[a-f\d]{3})?)"/gi)].map((match) => match[1].slice(1))
    expect(paints.length).toBeGreaterThan(0)
    for (const paint of paints) {
      const rgb = paint.length === 3 ? [...paint].map((channel) => channel.repeat(2)).join("") : paint
      expect(rgb.slice(0, 2), `SVG paint #${paint} is monochrome`).toBe(rgb.slice(2, 4))
      expect(rgb.slice(2, 4), `SVG paint #${paint} is monochrome`).toBe(rgb.slice(4, 6))
    }
    for (const size of [16, 32, 180, 192, 512]) {
      const path = `public/brand/ktour-id-mono-v1-${size}.png`
      expect(PUBLIC_FILES).toContain(path)
      const metadata = await sharp(resolve(APP_ROOT, path)).metadata()
      expect(metadata, path).toMatchObject({ format: "png", width: size, height: size })
      const { data, info }: { data: Buffer; info: { channels: number } } = await sharp(resolve(APP_ROOT, path))
        .toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      expect(info.channels).toBe(4)
      let coloredPixels = 0
      let darkPixels = 0
      let lightOrTransparentPixels = 0
      for (let index = 0; index < data.length; index += 4) {
        if (data[index + 3] === 0) {
          lightOrTransparentPixels += 1
          continue
        }
        if (data[index] !== data[index + 1] || data[index + 1] !== data[index + 2]) coloredPixels += 1
        if (data[index] < 128) darkPixels += 1
        if (data[index] > 200) lightOrTransparentPixels += 1
      }
      expect(coloredPixels, `${path} visible pixels must be grayscale`).toBe(0)
      expect(darkPixels, `${path} must contain a visible mark`).toBeGreaterThan(0)
      expect(lightOrTransparentPixels, `${path} must preserve contrast`).toBeGreaterThan(0)
    }
    for (const path of ["app/layout.tsx", "scripts/ondo-b-standalone/prepare.mjs"]) {
      const source = readFileSync(resolve(APP_ROOT, path), "utf8")
      expect(source, path).toContain("/brand/ktour-id-mono-v1.svg")
      expect(source, path).toContain("/brand/ktour-id-mono-v1-32.png")
      expect(source, path).toContain("/brand/ktour-id-mono-v1-180.png")
      expect(source, path).not.toContain("/brand/ktour-id-mark-32.png")
      expect(source, path).not.toContain("/brand/ktour-id-mark-180.png")
    }
  })

  test("B-STANDALONE-015 generated worker owns the canonical legacy redirect and its exact query allowlist", async () => {
    const { LEGACY_DISCOVERY_QUERY_KEYS } = await import("../../scripts/ondo-b-standalone/policy.mjs")
    await (await import("../../scripts/ondo-b-standalone/prepare.mjs")).prepareStandaloneSource({ projectId: "appgprj_local_ondo_b_artifact" })
    const worker = readFileSync(resolve(STAGE_ROOT, "worker/index.ts"), "utf8")
    expect(worker).toContain('if (url.pathname === "/ondo-b") return legacyDiscoveryRedirect(url)')
    expect(worker).toContain("values.length === 1 && values[0].length <= 160")
    expect(worker).toContain(`const legacyDiscoveryQueryKeys = ${JSON.stringify(LEGACY_DISCOVERY_QUERY_KEYS)}`)
    for (const key of ["collection", "collectionSelection", "discoveryPlaceId"]) expect(LEGACY_DISCOVERY_QUERY_KEYS).toContain(key)
    for (const blocked of ["qa", "private", "after19", "foo", "lang", "tab"]) {
      expect(LEGACY_DISCOVERY_QUERY_KEYS).not.toContain(blocked)
    }
  })

  test("B-STANDALONE-012 positively ships B Labs while exact legacy Labs symbols remain denied", async () => {
    const { LEGACY_ARTIFACT_PATH, LEGACY_ARTIFACT_TEXT, REQUIRED_B_NATIVE_LABS_FILES, SOURCE_FILES } = await import("../../scripts/ondo-b-standalone/policy.mjs")
    const required = [
      "features/ondo/contracts/commerce.ts",
      "features/ondo/contracts/domain.ts",
      "features/ondo/contracts/evidence.ts",
      "features/ondo/labs/labs-entry.tsx",
      "features/ondo/labs/labs-review-truth-b.ts",
      "features/ondo/labs/labs-model.ts",
      "features/ondo/labs/labs.module.css",
      "features/ondo/shared/ui/sheet-b.tsx",
      "features/ondo/shared/ui/ui.module.css",
      "features/ondo/shared/ui/modal-layer-priority.ts",
      "features/ondo/shared/ui/use-sheet-presence.ts",
      "features/ondo/shared/ui/use-qa-controls.ts",
    ]
    expect(REQUIRED_B_NATIVE_LABS_FILES).toEqual(required)
    for (const path of required) expect(SOURCE_FILES, `${path} must ship with /ondo-b`).toContain(path)
    for (const path of required) expect(LEGACY_ARTIFACT_PATH.test(path), `${path} is positive closure, not a retired path`).toBe(false)
    for (const validProductTerm of ["Labs", "LabsEntryB", "LABS · SIMULATED"]) {
      expect(LEGACY_ARTIFACT_TEXT.some((pattern: RegExp) => pattern.test(validProductTerm)), validProductTerm).toBe(false)
    }
    expect(LEGACY_ARTIFACT_TEXT.some((pattern: RegExp) => pattern.test("LabsEntry"))).toBe(true)
  })

  test("B-STANDALONE-013 ships the My Korea cartographic memory without a parallel data source", async () => {
    const { SOURCE_FILES } = await import("../../scripts/ondo-b-standalone/policy.mjs")
    for (const path of [
      "features/ondo/my/korea-memory-map-b.tsx",
      "features/ondo/my/korea-memory-map-b.module.css",
    ]) expect(SOURCE_FILES, `${path} must ship with /ondo-b`).toContain(path)
  })

  test("B-STANDALONE-014 staged local-import closure rejects an unresolved dependency", async () => {
    const fixtureRoot = await mkdtemp(resolve(tmpdir(), "ondo-b-source-closure-"))
    try {
      await mkdir(resolve(fixtureRoot, "feature"))
      await writeFile(resolve(fixtureRoot, "feature/entry.ts"), 'import "./missing"\n')
      const { assertStandaloneLocalImportClosure } = await import("../../scripts/ondo-b-standalone/prepare.mjs")
      await expect(assertStandaloneLocalImportClosure(fixtureRoot)).rejects.toThrow("missing local import ./missing from feature/entry.ts")
      await writeFile(resolve(fixtureRoot, "feature/missing.ts"), "export const staged = true\n")
      await expect(assertStandaloneLocalImportClosure(fixtureRoot)).resolves.toMatchObject({ scannedFileCount: 2, localImportCount: 1 })
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true })
    }
  })
})
