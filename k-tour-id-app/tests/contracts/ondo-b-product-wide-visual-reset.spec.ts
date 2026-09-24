import { expect, test } from "@playwright/test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  B_MAP_PAINT_CANVAS_RECEIPTS,
  B_MAP_PAINT_EDGE_RECEIPTS,
  B_MAP_PAINT_MIN_COMPONENT_PIXELS,
  B_MAP_PAINT_MIN_HEAT_PIXELS,
} from "../helpers/ondo-b-visual-evidence"

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")

test.describe("ONDO B product-wide white/ink visual reset", () => {
  test("RESET-001 shared shell owns neutral tokens and concise localized wayfinding", () => {
    const app = source("features/ondo/app/ondo-app-b.tsx")
    const css = source("features/ondo/app/ondo-shell.module.css")
    const globals = source("app/globals.css")

    expect(css).toContain("--ondo-paper: var(--ondo-surface-soft)")
    expect(css).toContain("background: var(--ondo-surface-soft)")
    expect(css).toContain("color: var(--ondo-ink)")
    expect(css).toContain("--ondo-phone-edge: 16px")
    expect(app).toContain('data-nav-presentation="icon-only-mobile-labeled-desktop"')
    expect(app).toContain("B_NAV_DISPLAY_COPY[state.locale][id]")
    expect(app).toContain('aria-hidden="true"')
    expect(css).toContain(".nav button[data-state=\"selected\"]")
    expect(css).toContain(".stage[data-variant=\"B\"] .navLabel")
    expect(css).toContain(".navLabel {\n    display: none;")
    expect(css).toContain("opacity: 1")
    expect(css).toContain("@media (prefers-reduced-motion: reduce)")
    expect(globals).toContain('body:has([data-testid="ondo-b-root"])')
    expect(globals).toContain("--ondo-canvas: #ffffff")
    expect(globals).toContain(':root[data-ondo-theme="dark"]')
    expect(globals).toContain("background: var(--ondo-canvas)")
  })

  test("RESET-002 city chrome removes visible active-status copy and keeps heat aura-first", () => {
    const map = source("features/ondo/map/map-entry-b.tsx")

    expect(map).toContain('data-testid="ondo-b-pulse-city-status"')
    expect(map).toContain('className={styles.srOnly}')
    expect(map).toContain('data-pulse-visual-grammar="aura-scale-selection-capsule"')
    expect(map).toContain('data-temperature-visual-grammar="shared-field-aura-core-scale-selection-capsule"')
    expect(map).not.toContain("pulseMarkerLabel:")
    expect(map).not.toContain('id: "ondo-pulse-labels"')
    expect(map).toContain('"text-field": ["get", "selectedMarkerLabel"]')
    expect(map).toContain('data-testid="ondo-b-pulse-marker-accessible-detail"')
    expect(map).toContain('data-testid="ondo-b-list-pulse"')
    expect(map).toContain('data-testid="ondo-b-selected-marker-status"')
  })

  test("RESET-003 count, view, Pulse key, location, and legal credits form compact truth chrome", () => {
    const map = source("features/ondo/map/map-entry-b.tsx")
    const css = source("features/ondo/map/map-b.module.css")

    expect(map).toContain('data-chrome-role="view-action"')
    expect(map).toContain('data-testid="ondo-b-result-truth"')
    expect(map).toContain('data-pulse-key-presentation={city === "jeju" ? "compact-coverage" : "compact-gradient"}')
    expect(map).toContain('data-editorial-temperature-key={city === "jeju" ? "unscored" : undefined}')
    expect(map).toContain('data-testid="ondo-b-pulse-methodology"')
    expect(map).toContain('data-attribution-presentation="visible-legal"')
    expect(map).toContain("OpenFreeMap")
    expect(map).toContain("OpenMapTiles")
    expect(map).toContain('href="https://www.openstreetmap.org/copyright"')
    expect(map).toContain("© OpenStreetMap")
    expect(map).not.toContain('<summary aria-label={copy.mapCredits}>')
    expect(css).toContain(".mapCredits")
    expect(css).toContain('grid-template-areas:\n    "message message locate"\n    ". . ."\n    "key result attribution"')
    expect(css).toContain(".methodologyDisclosure")
    expect(css).toContain("--map-edge: var(--ondo-phone-edge, 16px)")
  })

  test("RESET-004 atlas and Place keep source truth in nonvisual metadata while facts remain progressive", () => {
    const map = source("features/ondo/map/map-entry-b.tsx")
    const place = source("features/ondo/place/canonical-place-overlay.tsx")

    expect(map).toContain("cityNodes.map")
    expect(map).toContain("data-official-count={cityNode.officialCount}")
    expect(map).toContain("data-editorial-count={cityNode.editorialCount}")
    expect(map).toContain("accessibleTruth")
    expect(place).toContain('data-testid="canonical-place-source-summary"')
    expect(place).toContain('data-source-presentation="nonvisual-metadata"')
    expect(place).toContain("data-detail-source={venue.sourceRefId}")
    expect(place).toContain('data-testid="canonical-source-evidence"')
    expect(place).toContain('data-testid="canonical-evidence-drawer"')
    expect(place).toContain("copy.sourceBoundary")
    expect(place).not.toContain("<details className={styles.sourceEvidence}")
  })

  test("RESET-005 personal settings and the offer canvas finish in neutral ONDO material", () => {
    const settings = source("features/ondo/settings/settings-entry-b.tsx")
    const settingsCss = source("features/ondo/settings/settings-entry-b.module.css")
    const personal = source("features/ondo/shared/ui/production-local.module.css")
    const commerce = source("features/ondo/commerce-b/id-wallet-commerce-b.module.css")

    expect(settings).not.toMatch(/ondo-mark|brandMark|<img/)
    expect(settings).toContain('data-visual-direction="quiet-mobile-settings"')
    expect(settings).toContain('data-testid="settings-language-control"')
    expect(settingsCss).toContain("background: var(--ondo-canvas)")
    expect(personal).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))')
    expect(personal).toContain('background: var(--ondo-canvas, #fff)')
    expect(commerce).toContain("background: var(--ondo-surface-raised, var(--ondo-surface, #fff))")
    expect(commerce).toContain("color: var(--ondo-ink, #171717)")
  })

  test("RESET-006 map paint receipts follow the redesigned mobile occlusion contract", () => {
    const receipts = new Set<string>([...B_MAP_PAINT_CANVAS_RECEIPTS, ...B_MAP_PAINT_EDGE_RECEIPTS])
    const opaqueMobileCases = [
      "B-PX-GATE-ACCOUNT-FAIL-KO",
      "B-PX-GATE-PAYMENT-EN",
      "B-PX-GATE-PAYMENT-FAIL-KO",
      "B-PX-GATE-PERSON-CX-KO",
      "B-PX-GATE-PERSON-PASSPORT-EN",
      "B-PX-GATE-RESIDENCE-UNSUPPORTED-EN",
    ]
    for (const caseId of opaqueMobileCases) {
      for (const viewport of ["360x800", "390x844", "430x932"]) {
        expect(receipts.has(`${caseId}:${viewport}`), `${caseId} is opaque at ${viewport}`).toBe(false)
      }
    }

    expect(B_MAP_PAINT_MIN_COMPONENT_PIXELS).toBe(12)
    expect(B_MAP_PAINT_MIN_HEAT_PIXELS).toBe(24)
    expect(B_MAP_PAINT_EDGE_RECEIPTS).toEqual([])
    expect(B_MAP_PAINT_CANVAS_RECEIPTS).toContain("B-PX-PLACE-PEEK-EN:360x800")
    expect(B_MAP_PAINT_CANVAS_RECEIPTS).toContain("B-PX-PLACE-PEEK-EN:390x844")
    for (const viewport of ["360x800", "390x844", "430x932", "768x1024", "801x1000", "1440x1000"]) {
      expect(B_MAP_PAINT_CANVAS_RECEIPTS).toContain(`B-PX-CITY-LIVE-EN:${viewport}`)
      expect(B_MAP_PAINT_CANVAS_RECEIPTS).toContain(`B-PX-CITY-LIVE-KO:${viewport}`)
    }
    for (const caseId of [
      "B-PX-AFTER19-PROMPT-EN",
      "B-PX-GATE-AGE-FAIL-KO",
      "B-PX-GATE-PAYMENT-EN",
      "B-PX-GATE-PAYMENT-FAIL-KO",
    ]) {
      for (const viewport of ["360x800", "390x844", "430x932", "768x1024", "801x1000", "1440x1000"]) {
        expect(receipts.has(`${caseId}:${viewport}`), `${caseId} is deliberately isolated at ${viewport}`).toBe(false)
      }
    }
    expect(receipts.has("B-PX-GATE-ACCOUNT-FAIL-KO:801x1000"), "the 801px place overlay covers the mapped background").toBe(false)
    for (const viewport of ["768x1024", "801x1000"]) {
      expect(
        receipts.has(`B-PX-GATE-PERSON-PASSPORT-EN:${viewport}`),
        `nested Local Signal eligibility overlays cover every visible Pulse core at ${viewport}`,
      ).toBe(false)
    }
    expect(B_MAP_PAINT_CANVAS_RECEIPTS).toContain("B-PX-GATE-ACCOUNT-FAIL-KO:768x1024")
    expect(B_MAP_PAINT_CANVAS_RECEIPTS).toContain("B-PX-GATE-ACCOUNT-FAIL-KO:1440x1000")
  })

  test("RESET-007 the legacy pixel census owns deterministic network and chat framing", () => {
    const evidence = source("tests/helpers/ondo-b-visual-evidence.ts")

    expect(evidence).toContain('Object.defineProperty(Navigator.prototype, "onLine"')
    expect(evidence).toContain("get: () => true")
    expect(evidence).toContain('["CHAT", "CHAT-IMAGE-FAIL", "FEEDBACK", "REPORT"].includes(item.state)')
    expect(evidence).toContain('const chat = page.getByTestId("table-chat")')
    expect(evidence).toContain('stabilizeMobileEvidenceScroll(page, chat, { kind: "top", offset: 80 })')
    expect(evidence).toContain('stabilizeMobileEvidenceScroll(page, chat, { kind: "scrollTop", value: 0 })')
    expect(evidence).toContain('stabilizeMobileEvidenceScroll(page, chat, { kind: "scrollTop", value: 10 })')
  })
})
