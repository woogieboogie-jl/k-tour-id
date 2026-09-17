import { expect, test } from "@playwright/test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  abandonPendingBAction,
  B_ACTION_GATE_SESSION_KEY,
  clearBActionGateSession,
  consumePendingBActionAtMutation,
  createBLocalSignalActionReturn,
  DEFAULT_B_ACTION_GATE_SESSION,
  persistBActionGateSession,
  restoreBActionGateSession,
} from "../../features/ondo/identity-b/action-gate-contract-b"

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")
test.afterEach(() => { clearBActionGateSession({ getItem() { return null }, removeItem() {} } as unknown as Storage) })
const NOW = new Date("2026-08-28T03:00:00.000Z")
const VENUE_ID = "mois-0021cd596bc5b2a922ad"

class MemoryStorage {
  constructor(private readonly values: Record<string, string> = {}) {}
  getItem(key: string) { return this.values[key] ?? null }
  setItem(key: string, value: string) { this.values[key] = value }
  removeItem(key: string) { delete this.values[key] }
  raw(key: string) { return this.values[key] ?? null }
}

test("FL-005/006 Person route restoration stays inside the common exact-return gate", () => {
  const coordinator = source("features/ondo/identity-b/action-gate-coordinator-b.tsx")
  const contract = source("features/ondo/identity-b/action-gate-contract-b.ts")
  const alternate = coordinator.slice(coordinator.indexOf("function usePassportAlternative"), coordinator.indexOf("function releaseReady"))

  expect(coordinator).not.toContain("personRouteForPersona")
  expect(coordinator).not.toMatch(/state\.persona|korean_local|long_term_resident/)
  expect(coordinator).toContain("personRouteForIdentityMethod(state.identityCredential?.method ?? null)")
  expect(coordinator).toContain('data-person-route={gate === "person" ? personRoute ?? "unselected" : undefined}')
  expect(coordinator).toContain('data-testid={`person-route-choice-${route}`}')
  expect(coordinator).toContain('data-testid="local-check-passport-alternate"')
  expect(coordinator).toContain('if (!reviewMode) return { execution: providerUnavailable("person"), unavailableStatus: "unavailable" }')
  expect(coordinator).toContain("createReviewFixtureAuthority({")
  expect(coordinator).toContain('reviewFixture<{ axis: "person"; route: BPersonRouteB }>(authority, { outcome: "success", value: { axis: "person", route } })')
  expect(alternate).toContain('selectPersonRoute("passport_ekyc")')
  expect(alternate).not.toMatch(/pending\s*:/)
  expect(coordinator).toContain("renewExpiredPendingBAction")
  expect(contract).toContain("const personRoute = latest.personRoute")
  expect(contract).toContain("pending: null, personRoute: null, presentation: null, lastConsumed: null, outcome: null")
  expect(contract).toContain("const personRoute = sanitizePersonRoute(record.personRoute, pending)")
  expect(contract).toMatch(/pending,\s*personRoute,\s*presentation:/)
  expect(contract).toContain("presentation: sanitizePresentation(record.presentation, pending)")
  expect(coordinator).toContain('createBActionReviewAxis("person", staged.execution, now)')
  expect(coordinator).toContain("No identity provider is connected. Identity data is not sent and no credential is created.")
  expect(coordinator).toContain('passportNote: "연결되면 별도의 여권 확인 경로를 사용해요."')
  expect(coordinator).toContain('passportNote: "接続時は別のパスポート確認を利用します。"')
})

test("FL-005/006 route card preserves the mobile type and touch floors", () => {
  const styles = source("features/ondo/identity-b/action-gate-coordinator-b.module.css")
  expect(styles).toMatch(/\.personRoute small \{[^}]*font-size:\s*12px/)
  const routeNote = styles.match(/\.routeNote \{([^}]+)\}/)?.[1] ?? ""
  // Explanatory route meaning is decision body text, not the compact label.
  expect(Number(routeNote.match(/font-size:\s*([\d.]+)px/)?.[1])).toBeGreaterThanOrEqual(15)
  expect(Number(routeNote.match(/line-height:\s*([\d.]+)/)?.[1])).toBeGreaterThanOrEqual(1.45)
  expect(styles).toContain(".dialog button,.disclosure summary { min-width: 44px; min-height: 44px;")
  expect(styles).toMatch(/\.content \{[^}]*overflow-y:\s*auto/)
  expect(styles).toMatch(/\.body \{[^}]*grid-template-rows:\s*minmax\(0, 1fr\) auto/)
  expect(styles).toMatch(/\.actions \{[^}]*env\(safe-area-inset-bottom\)/)
  expect(styles).toMatch(/\.layer \{[^}]*env\(safe-area-inset-top\)/)
  expect(styles).not.toMatch(/font-size:\s*(?:10|11)px/)
})

test("FL-005/006 pending-token route persistence is strict and clears at terminal boundaries", () => {
  const pending = createBLocalSignalActionReturn({ venueId: VENUE_ID, draftNonce: "person:route:1", tags: ["welcoming"], note: "exact", now: NOW })
  const storage = new MemoryStorage()
  const selected = {
    ...DEFAULT_B_ACTION_GATE_SESSION,
    pending,
    personRoute: { tokenId: pending.tokenId, route: "mobile_residence_card" as const },
    outcome: { tokenId: pending.tokenId, gate: "person" as const, status: "unavailable" as const },
  }
  expect(persistBActionGateSession(storage as unknown as Storage, selected, NOW)).toBe(true)
  expect(restoreBActionGateSession(storage as unknown as Storage, NOW)).toMatchObject({
    personRoute: { tokenId: pending.tokenId, route: "mobile_residence_card" },
    outcome: { tokenId: pending.tokenId, gate: "person", status: "unavailable" },
  })

  const injected = { ...selected, personRoute: { ...selected.personRoute, nationality: "must-not-persist" } }
  expect(persistBActionGateSession(storage as unknown as Storage, injected, NOW)).toBe(true)
  expect(storage.raw(B_ACTION_GATE_SESSION_KEY)).not.toContain("nationality")
  expect(restoreBActionGateSession(storage as unknown as Storage, NOW).personRoute).toBeNull()

  persistBActionGateSession(storage as unknown as Storage, {
    ...selected,
    person: { status: "eligible", expiresAt: new Date(NOW.getTime() + 60_000).toISOString() },
  }, NOW)
  expect(consumePendingBActionAtMutation(storage as unknown as Storage, pending, new Set(["account", "person"]), NOW)).not.toBeNull()
  expect(restoreBActionGateSession(storage as unknown as Storage, NOW).personRoute).toBeNull()

  persistBActionGateSession(storage as unknown as Storage, selected, NOW)
  expect(abandonPendingBAction(storage as unknown as Storage, pending, NOW)).toBe(true)
  expect(restoreBActionGateSession(storage as unknown as Storage, NOW).personRoute).toBeNull()
})
