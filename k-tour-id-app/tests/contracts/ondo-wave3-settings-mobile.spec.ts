import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { expect, test } from "@playwright/test"
import { createSimulatedCredentialB } from "../../features/ondo/identity-b/ktour-id-setup-model-b"
import {
  clearSettingsEditablePreferencesB,
  mergeSettingsPreferenceDraftB,
  readSettingsPrivacySnapshotB,
  SETTINGS_PREFERENCE_SECTIONS_B,
  settingsPreferenceSummaryB,
  settingsPreferencesEqualB,
  type SettingsPrivacyStateB,
} from "../../features/ondo/settings/settings-model-b"
import { ONDO_B_DISCOVERY_PREFERENCES } from "../../features/ondo/shared/state/ondo-b-preferences"
import {
  ONDO_B_APPEARANCE_BOOTSTRAP_SCRIPT,
  ONDO_B_DEVICE_STORAGE_KEY,
  readOndoBAppearanceSnapshot,
  resolveOndoBAppearance,
  sanitizeOndoBAppearancePreference,
} from "../../features/ondo/shared/state/ondo-b-appearance"
import { restoreBDeviceState } from "../../features/ondo/shared/state/ondo-b-provider"

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")

class MemoryStorage {
  #values = new Map<string, string>()
  constructor(values: Record<string, string> = {}) { Object.entries(values).forEach(([key, value]) => this.#values.set(key, value)) }
  getItem(key: string) { return this.#values.get(key) ?? null }
}

function state(overrides: Partial<SettingsPrivacyStateB> = {}): SettingsPrivacyStateB {
  return {
    locale: "en",
    onboarding: "ONB-COMPLETE",
    account: "ACC-ACTIVE",
    discoveryPreferences: ["classic", "late", "halal"],
    savedVenueIds: ["venue-1"],
    savedEditorialPlaceIds: [],
    privateNotesByVenue: { "venue-1": "private" },
    recentVenueIds: ["venue-1"],
    recentEditorialPlaceIds: [],
    plannedTableRefs: [{ tableId: "table-seoul-night-bites", venueId: "venue-1" }],
    localSignalPostedVenueIds: ["venue-1"],
    localPulseEvidenceByVenue: { "venue-1": { tags: ["calm_now"], postedAt: "2026-09-05T00:00:00.000Z" } },
    identityCredential: createSimulatedCredentialB("passport_ekyc", Date.parse("2026-09-05T00:00:00.000Z")),
    commerceWalletStatus: "ready",
    commerceFundingSource: "digital_dollar",
    commerceReceipts: [],
    ...overrides,
  }
}

test("W3-SET-001 root is one title plus four whole-row decisions and moves every editor into SheetB", () => {
  const component = source("features/ondo/settings/settings-entry-b.tsx")
  expect(component).toContain('data-visual-direction="quiet-mobile-settings"')
  expect(component).toContain('data-testid="settings-language-row"')
  expect(component).toContain('data-testid="settings-appearance-row"')
  expect(component).toContain('data-testid="settings-appearance-control"')
  expect(component).toContain('data-testid="ondo-b-discovery-settings"')
  expect(component).toContain('data-testid="ondo-b-device-data-settings"')
  expect(component).not.toContain("<details")
  expect(component).not.toContain("copy.lead")
  expect(component.match(/<SheetB/g)).toHaveLength(5)
  expect(component).toContain('role="radiogroup"')
  expect(component).toContain('role="radio"')
  expect(component).toContain("aria-checked={locale === choice}")
})

test("W3-SET-001A appearance is sanitized, persisted as preference, and resolved independently", () => {
  expect(sanitizeOndoBAppearancePreference("light")).toBe("light")
  expect(sanitizeOndoBAppearancePreference("dark")).toBe("dark")
  expect(sanitizeOndoBAppearancePreference("sepia")).toBe("system")
  expect(resolveOndoBAppearance("system", true)).toBe("dark")
  expect(resolveOndoBAppearance("system", false)).toBe("light")
  expect(resolveOndoBAppearance("light", true)).toBe("light")
  expect(restoreBDeviceState({ appearancePreference: "dark" }).appearancePreference).toBe("dark")
  expect(restoreBDeviceState({ appearancePreference: "invalid" }).appearancePreference).toBe("system")
})

test("W3-SET-001B pre-hydration and SPA remount read the same persisted/system appearance truth", () => {
  expect(readOndoBAppearanceSnapshot(new MemoryStorage({
    [ONDO_B_DEVICE_STORAGE_KEY]: JSON.stringify({ appearancePreference: "dark" }),
  }), false)).toEqual({ preference: "dark", theme: "dark" })
  expect(readOndoBAppearanceSnapshot(new MemoryStorage({
    [ONDO_B_DEVICE_STORAGE_KEY]: JSON.stringify({ appearancePreference: "light" }),
  }), true)).toEqual({ preference: "light", theme: "light" })
  expect(readOndoBAppearanceSnapshot(new MemoryStorage(), true)).toEqual({ preference: "system", theme: "dark" })

  const provider = source("features/ondo/shared/state/ondo-b-provider.tsx")
  expect(provider).toContain(": readBrowserOndoBAppearanceSnapshot()")
  expect(provider).not.toMatch(/useLayoutEffect\(\(\) => \{\s*syncOndoBAppearanceDocument\(state\.appearancePreference, state\.resolvedAppearance\)/s)
  expect(ONDO_B_APPEARANCE_BOOTSTRAP_SCRIPT).toContain(ONDO_B_DEVICE_STORAGE_KEY)
})

test("W3-SET-002 one capability registry keeps Settings limited to effective and dietary-unknown choices", () => {
  expect(Object.fromEntries(ONDO_B_DISCOVERY_PREFERENCES.map(({ id, capability }) => [id, capability]))).toEqual({
    classic: "effective",
    cafe: "effective",
    late: "unsupported_legacy",
    lively: "unsupported_legacy",
    calm: "unsupported_legacy",
    vegetarian: "dietary_unknown",
    vegan: "dietary_unknown",
    halal: "dietary_unknown",
    allergy_aware: "dietary_unknown",
  })
  expect(SETTINGS_PREFERENCE_SECTIONS_B.map(({ id }) => id)).toEqual(["food", "dietary"])
  expect(SETTINGS_PREFERENCE_SECTIONS_B.flatMap(({ preferences }) => preferences)).toEqual([
    "classic", "cafe", "vegetarian", "vegan", "halal", "allergy_aware",
  ])
  expect(settingsPreferenceSummaryB("ko", [])).toEqual({ labels: [], overflow: 0, total: 0 })
  expect(settingsPreferenceSummaryB("en", ["halal", "classic", "late", "classic"])).toEqual({
    labels: ["Local classics", "Halal"],
    overflow: 0,
    total: 2,
  })
  expect(settingsPreferenceSummaryB("en", ["late", "lively", "calm"])).toEqual({ labels: [], overflow: 0, total: 0 })
  expect(settingsPreferencesEqualB(["halal", "classic"], ["classic", "halal"])).toBe(true)
})

test("W3-SET-002A Save and Clear preserve hidden legacy bytes without presenting them as controls", () => {
  const persisted = ["late", "classic", "lively", "halal"] as const
  expect(mergeSettingsPreferenceDraftB(persisted, ["cafe", "vegan"])).toEqual([
    "cafe", "late", "lively", "vegan",
  ])
  expect(clearSettingsEditablePreferencesB(persisted)).toEqual(["late", "lively"])

  const component = source("features/ondo/settings/settings-entry-b.tsx")
  expect(component).toContain("mergeSettingsPreferenceDraftB(state.discoveryPreferences, draftPreferences)")
  expect(component).toContain("clearSettingsEditablePreferencesB(draftPreferences)")
})

test("W3-SET-003 privacy snapshot is sanitized, counted, and keeps readiness axes independent", () => {
  const now = new Date("2026-09-05T00:30:00.000Z")
  const snapshot = readSettingsPrivacySnapshotB({
    state: state(),
    deviceStorage: new MemoryStorage({ "ondo-b.device.v1": "{}" }),
    sessionStorage: new MemoryStorage({
      "ondo-b.account.v1": JSON.stringify({ account: "ACC-ACTIVE", returnTo: null }),
      // An unbound eligible assertion is intentionally sanitized to not_set.
      "ondo-b.action-gate.v1": JSON.stringify({ version: 1, person: { status: "eligible", expiresAt: "2030-01-01T00:00:00.000Z" }, payment: { status: "unverified", expiresAt: null }, pending: null, personRoute: null, presentation: null, lastConsumed: null, outcome: null }),
    }),
    now,
    allowReviewFixture: true,
  })

  expect(snapshot.storageAvailable).toBe(true)
  expect(snapshot.categoryCount).toBe(5)
  expect(snapshot.discovery).toEqual({ saved: 1, recent: 1, preferences: 3, privateNotes: 1 })
  expect(snapshot.together).toEqual({ tables: 1, signals: 1 })
  expect(snapshot.identity).toEqual({ account: "ready", person: "not_set", age: "not_set", payment: "not_set", ktourId: "ready" })
  expect(snapshot.balance).toEqual({ status: "ready", records: 0, fundingChanged: true })
})

test("W3-SET-004 storage failure is visible without manufacturing empty or ready data", () => {
  const blocked = { getItem() { throw new DOMException("blocked", "SecurityError") } }
  const snapshot = readSettingsPrivacySnapshotB({ state: state(), deviceStorage: blocked, sessionStorage: blocked })
  expect(snapshot.storageAvailable).toBe(false)
  expect(snapshot.categoryCount).toBe(0)
  expect(new Set(Object.values(snapshot.identity))).toEqual(new Set(["unavailable"]))
  expect(snapshot.balance.status).toBe("unavailable")
})
test("W3-SET-004A native personal records count in privacy without importing identity authority", () => {
  const snapshot = readSettingsPrivacySnapshotB({ state: state(), sessionStorage: new MemoryStorage(), deviceStorage: new MemoryStorage({
    "ondo-b.place-memories.v1": JSON.stringify({ "research-seoul-onion-anguk": { saved: true, note: "coffee", visitedAt: null, verified: true }, unknown: { saved: true, note: "not registered" } }),
  }) })
  expect(snapshot.discovery.saved).toBe(2)
  expect(snapshot.discovery.privateNotes).toBe(2)
  expect(snapshot.identity.person).toBe("not_set")
  expect(snapshot.identity.payment).toBe("not_set")
})

test("W3-SET-005 preferences are draft-and-save and deletion reports rollback truth", () => {
  const component = source("features/ondo/settings/settings-entry-b.tsx")
  const provider = source("features/ondo/shared/state/ondo-b-provider.tsx")
  expect(component).toContain("setDraftPreferences")
  expect(component).toContain("disabled={!draftDirty}")
  expect(component).toContain("actions.setDiscoveryPreferences(next)")
  expect(component).toContain('initialFocusSelector="[data-settings-keep]"')
  expect(provider).toContain('accountSaveTransaction: null')
  expect(provider).toContain('accountSaveRecoveryBlocked: false')
  expect(provider).toContain('rollback: "complete" | "incomplete"')
  expect(provider).toContain('outcome: "storage_failed"')
  expect(component).toContain('result.rollback === "complete"')
})

test("W3-SET-006 mobile composition has no root animation and preserves 44px targets and short landscape", () => {
  const css = source("features/ondo/settings/settings-entry-b.module.css")
  expect(css).toMatch(/\.row\s*\{[^}]*min-height:\s*82px;/s)
  expect(css).toMatch(/\.preferenceChoice\s*\{[^}]*min-height:\s*44px;/s)
  expect(css).toContain("@media (max-width: 350px)")
  expect(css).toContain("@media (orientation: landscape) and (max-height: 500px)")
  expect(css).not.toMatch(/\.page\s*\{[^}]*animation:/s)
})

test("W3-SET-007 a guest preference reaches Map presentation without manufacturing an identity intent", () => {
  const map = source("features/ondo/map/map-entry-b.tsx")
  const model = source("features/ondo/map/b-discovery-personalization.ts")
  expect(map).toContain("if (preferences.length === 0)")
  expect(map).not.toContain("if (!persona || preferences.length === 0)")
  expect(map).toContain("...(persona ? { intent: persona } : {})")
  expect(model).toContain("intent?: OndoBDiscoveryIntent | null")
  expect(model).toContain('=== "unsupported_legacy") return undefined')
})
