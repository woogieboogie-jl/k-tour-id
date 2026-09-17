import fs from "node:fs"
import path from "node:path"
import { expect, test } from "@playwright/test"

const root = process.cwd()
const source = fs.readFileSync(path.join(root, "features/ondo/onboarding/official-directory-onboarding.tsx"), "utf8")
const css = fs.readFileSync(path.join(root, "features/ondo/onboarding/official-directory-onboarding.module.css"), "utf8")
const shell = fs.readFileSync(path.join(root, "features/ondo/app/ondo-app-b.tsx"), "utf8")

test.describe("Wave 2 onboarding UI contract", () => {
  test("uses the shared content-fit sheet over the live map with one question at a time", () => {
    expect(source).toContain("<SheetB")
    expect(source).toContain('variant="decision"')
    expect(source).toContain('type Step = "intent" | "area" | "preferences"')
    expect(source).not.toMatch(/hero|EDITORIAL_ALT|stepper|fullscreen/i)
    expect(css).toContain("background:rgb(16 16 16 / 20%)")
    expect(css).toContain("backdrop-filter:none")
    expect(source).not.toContain("<SheetB key={step}")
    expect(source).toContain("useLayoutEffect(() =>")
    expect(source).toContain("?.focus({ preventScroll: true })")
    expect(source).toContain('data-onboarding-heading={step}')
    // Optional steps share their sheet and type scale. A short viewport gets
    // more scrollable room, not an intent-only miniature first step.
    expect(css).toContain("max-height:min(72dvh, 620px)")
    expect(css).toContain("max-height:86dvh")
    expect(css).not.toContain('data-onboarding-step="intent"')
    expect(css).not.toContain("56dvh")
    expect(css).toMatch(/\.stageHeading h1\s*\{[^}]*font-size:clamp\(28px, 8vw, 32px\);[^}]*line-height:1\.08;/s)
  })

  test("collects canonical intent, conditional area and preferences as a local draft", () => {
    for (const value of ["short_trip", "nearby", "living", "seoul", "busan", "jeju"]) expect(source).toContain(`\"${value}\"`)
    expect(source).toContain('intent === "short_trip" || Boolean(area)')
    expect(source).toContain("actions.completeOnboarding({ intent, area, preferences })")
    expect(source).not.toContain("actions.setPersona")
    expect(source).not.toContain("actions.setDiscoveryPreferences")
  })

  test("fails closed on atomic save while keeping draft and exposes a guest escape", () => {
    expect(source).toContain("if (!result.ok) {")
    expect(source).toContain("setExiting(false)")
    expect(source).toContain("setSaveError(true)")
    expect(source).toContain("actions.cancelOnboarding()")
    expect(source).toContain('data-testid="onboarding-save-status"')
    expect(source).toContain('data-testid="onboarding-guest-skip"')
  })

  test("hands the selected city to the mounted map and never hard-codes Seoul", () => {
    expect(source).toContain("requestBDiscoveryFocus({ city: area, source: \"onboarding\", motion: \"standard\" })")
    expect(source).toContain('requestBDiscoveryFocus({ city, source: "onboarding", motion: "standard", personalization:')
    expect(source).toContain('requestBDiscoveryFocus({ city: area, source: "onboarding", motion: "standard", personalization:')
    expect(source).toContain('requestBDiscoveryFocus({ city: null, source: "onboarding", motion: "standard" })')
    expect(source).not.toContain("mapShape")
    expect(css).not.toContain(".mapShape")
    expect(source).not.toContain("city: \"seoul\"")
  })

  test("collects presentation preferences without selecting or previewing a place", () => {
    expect(source).not.toContain("orderBCanonicalDiscoveryPlaces")
    expect(source).not.toContain("<CanonicalVenueCapsuleB")
    expect(source).not.toContain('data-testid="onboarding-map-preview"')
    expect(source).not.toMatch(/setSelectedVenue|openBDiscoveryVenue|dispatchCommerce|completeIdentity/)
    expect(source).toContain('personalization: { intent: intent ?? "short_trip", preferences: nextPreferences }')
    expect(source).toContain("Check dietary needs with each place.")
    expect(source).toContain('data-testid="onboarding-dietary-disclosure"')
    expect(source).toContain('<PreferenceGroup group="meal"')
    // Current official directory data has no source-backed late/lively/calm
    // evidence. Keep those persisted types for compatibility, but do not ask
    // a no-op survey question in onboarding.
    expect(source).not.toContain('<PreferenceGroup group="mood"')
  })

  test("keeps consumer copy compact and excludes premature identity and payment setup", () => {
    const consumerCopy = source.slice(source.indexOf("const COPY"), source.indexOf("const INTENTS"))
    expect(consumerCopy).not.toMatch(/eKYC|provider|wallet|account|on-device|20 seconds|official source/i)
    expect(source).toContain("어떤 한국을 찾고 있나요?")
    expect(source).toContain("どんな韓国を探しますか？")
  })

  test("supports compact phones, landscape, reduced motion and forced colors", () => {
    expect(css).toContain("max-width:360px")
    expect(css).toContain("max-height:650px")
    expect(css).toMatch(/@media \(max-height:650px\)\s*\{\s*\.root :global\(section\[data-sheet-variant="decision"\]\)\s*\{\s*max-height:86dvh;/s)
    expect(css).toMatch(/\.content\s*\{[^}]*padding:20px 20px 8px;/s)
    expect(css).toMatch(/@media \(max-width:360px\)\s*\{\s*\.content\s*\{\s*padding-inline:16px;/s)
    expect(css).toContain("prefers-reduced-motion:reduce")
    expect(css).toContain("forced-colors:active")
    expect(css).not.toMatch(/text-overflow\s*:\s*ellipsis|white-space\s*:\s*nowrap/)
    expect(css).toContain("min-width:44px; min-height:44px")
    expect(css).toContain(".primary { min-height:52px")
    expect(css).toMatch(/\.primary,\.secondary\s*\{[^}]*min-height:48px;/s)
    expect(css).toMatch(/\.choice\s*\{[^}]*min-height:68px;/s)
    expect(css).toMatch(/\.areaChoice\s*\{[^}]*min-height:52px;/s)
    expect(css).toMatch(/\.footer\s*\{[^}]*display:grid;/s)
    expect(css).not.toMatch(/\.footer\s*\{[^}]*grid-template-columns:/s)
  })

  test("lets the shared modal owner release the dock cleanly after the retained exit", () => {
    const contentStart = shell.indexOf('data-testid="ondo-scroll-region"')
    const navigationStart = shell.indexOf('<nav id="ondo-main-nav"')
    const navigationEnd = shell.indexOf("</nav>", navigationStart)

    expect(contentStart).toBeGreaterThan(-1)
    expect(navigationStart).toBeGreaterThan(-1)
    expect(shell.slice(contentStart, navigationStart)).not.toContain("inert={onboardingActive")
    expect(shell.slice(navigationStart, navigationEnd)).not.toContain("inert={onboardingActive")
    expect(shell).toContain("SheetB owns inert/aria-hidden while onboarding is present")
  })
})
