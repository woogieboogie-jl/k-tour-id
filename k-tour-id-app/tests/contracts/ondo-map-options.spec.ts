import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { expect, test } from "@playwright/test"

const source = readFileSync(resolve("features/ondo/map/map-options-b.tsx"), "utf8")
const css = readFileSync(resolve("features/ondo/map/map-options-b.module.css"), "utf8")
const policy = readFileSync(resolve("scripts/ondo-b-standalone/policy.mjs"), "utf8")

test("map options presents the map owner's actions in the existing modal frame", () => {
  expect(source).toContain('import { SheetB } from "../shared/ui/sheet-b"')
  expect(source).toContain('variant="decision"')
  expect(source).toContain('data-testid="ondo-b-map-options-done" onClick={onClose}')
  expect(source).toContain("onClick={() => onCategory(category.id)}")
  for (const handler of ["onTogglePerspective", "onLocate", "onPreferences", "onLanguage", "onDemo"]) {
    expect(source).toContain(`onClick={${handler}}`)
  }
  expect(source).toContain("onClick={openStories}")
  expect(source).toContain("onStories?.()")
  expect(source).not.toContain("useState")
  expect(source).not.toContain("localStorage")
  expect(source).not.toContain("GlobalAfter19B")
})

test("guide and After19 handoffs retain their own focus without delayed sheet refocus", () => {
  const frame = readFileSync(resolve("features/ondo/shared/ui/sheet-b.tsx"), "utf8")
  const mapCss = readFileSync(resolve("features/ondo/map/map-b.module.css"), "utf8")
  expect(source).toContain("guideOwnsFocus.current = true")
  expect(source).toContain("after19OwnsFocus.current = true")
  expect(source).toContain("onAfter19?.()")
  expect(source).toContain("shouldRestoreFocus={() => !guideOwnsFocus.current && !after19OwnsFocus.current}")
  expect(frame).toContain("if (shouldRestoreFocusRef.current?.() === false) return")
  expect(source).not.toContain("setTimeout")
  const scopedGuide = mapCss.slice(mapCss.indexOf("The legacy disclosure owns important offsets."))
  expect(scopedGuide).toContain("top: 0 !important")
  expect(scopedGuide).toContain("bottom: 0 !important")
  expect(scopedGuide).toContain("width: 100% !important")
})

test("unified map header ships controlled components without importing the Lab", () => {
  for (const stem of ["map-header-b", "map-header-spectrum-b"]) {
    expect(policy).toContain(`"features/ondo/map/${stem}.tsx"`)
    expect(policy).toContain(`"features/ondo/map/${stem}.module.css"`)
    const component = readFileSync(resolve(`features/ondo/map/${stem}.tsx`), "utf8")
    expect(component).not.toMatch(/(?:from|import).*app\/labs/)
    expect(component).not.toContain("localStorage")
    expect(component).not.toContain("fetch(")
  }
})

test("After19 locks only category choices; localization, map/privacy controls and exit remain", () => {
  expect(source).toContain('{categoryLocked ? <div className={styles.nightNotice}')
  expect(source).toContain('data-testid="ondo-b-map-options-location-privacy"')
  expect(source).toContain('<p>{locationMessage}</p>')
  expect(source).toContain('{canTilt ? <button')
  for (const title of ["Map options", "지도 설정", "地図設定"]) expect(source).toContain(title)
  expect(source).toContain('aria-pressed={category.selected}')
})

test("map options wraps narrow-screen content, keeps touch targets and ships in the standalone app", () => {
  expect(css).toContain("flex-wrap: wrap")
  expect(css).toContain("min-height: 44px")
  expect(css).toContain("min-height: 52px")
  expect(css).toContain("grid-template-columns: 20px minmax(0, 1fr) auto")
  expect(css).toContain("background: var(--ondo-surface-soft)")
  expect(css).toContain("background: var(--ondo-control)")
  expect(css).toContain("@media (forced-colors: active)")
  expect(policy).toContain('"features/ondo/map/map-options-b.tsx"')
  expect(policy).toContain('"features/ondo/map/map-options-b.module.css"')
})
