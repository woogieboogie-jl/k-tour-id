import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { expect, test } from "@playwright/test"

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")

test("B-PREFERENCE-VIS-001 onboarding choices keep state semantics with neutral and black visual states", () => {
  const component = source("features/ondo/onboarding/official-directory-onboarding.tsx")
  const styles = source("features/ondo/onboarding/official-directory-onboarding.module.css")

  expect(component).toContain("aria-pressed={preferences.includes(item.id)}")
  expect(component).toContain("preferences.filter((item) => item !== choice)")
  expect(styles).toMatch(/\.chips button\[aria-pressed="true"\]\s*\{[^}]*background:var\(--ondo-control, #181716\);/s)
  expect(styles).toMatch(/\.chips button\[aria-pressed="true"\]\s*\{[^}]*color:var\(--ondo-control-ink, #fff\);/s)
  expect(styles).toMatch(/\.chips button\s*\{[^}]*min-height:52px;/s)
  expect(styles).not.toMatch(/data-onboarding-step="intent"[^}]*min-height:44px/s)
  expect(component).toContain('personalization: { intent: intent ?? "short_trip", preferences: nextPreferences }')
  expect(component).not.toContain('data-testid="onboarding-map-preview"')
  expect(component).not.toContain("CanonicalVenueCapsuleB")
  expect(component).not.toMatch(/pulseScore\s*:|temperature\s*:|setPulse|setTemperature|recordLocalPulseEvidence|dispatchCommerce/)
})

test("B-SETTINGS-VIS-002 device persistence moves to a compact row and shared detail sheet without an eyebrow", () => {
  const settings = source("features/ondo/settings/settings-entry-b.tsx")

  expect(settings).not.toContain("eyebrow:")
  expect(settings).not.toContain("copy.eyebrow")
  expect(settings).toContain('data-testid="ondo-b-device-data-settings"')
  expect(settings).toContain('sheetPresence.value === "privacy" ? <SheetB')
  expect(settings).not.toContain("<details")
  for (const truth of [
    "Saved only on this device",
    "이 기기에만 저장",
    "この端末にのみ保存",
  ]) {
    expect(settings).toContain(truth)
  }
})
