import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

const DEVICE_KEY = "ondo-b.device.v1"
const ACCOUNT_KEY = "ondo-b.account.v1"
const ACTION_KEY = "ondo-b.action-gates.v1"
const ACTIVITY_KEY = "ondo-b.activity-profile.v1"
const AFTER19_PREFERENCE_KEY = "ondo-b.after19.preferences.v1"
const AFTER19_SESSION_KEY = "ondo-b.after19.session.v1"
const VENUE_ID = "mois-0021cd596bc5b2a922ad"

type Locale = "en" | "ko" | "ja"

async function seed(page: Page, locale: Locale, stamps = 0) {
  await page.addInitScript(({ deviceKey, accountKey, actionKey, activityKey, language, stampCount }) => {
    if (localStorage.getItem(deviceKey) == null) {
      localStorage.setItem(deviceKey, JSON.stringify({
        locale: language,
        onboarding: "ONB-COMPLETE",
        persona: null,
        discoveryPreferences: [],
        savedVenueIds: [],
        privateNotesByVenue: {},
        recentVenueIds: [],
        plannedTableRefs: [],
        localSignalPostedVenueIds: [],
        localPulseEvidenceByVenue: {},
        localInteractionBoundarySeen: true,
        commerceLocalBoundarySeen: true,
        commerceReceipts: [],
      }))
    }
    if (sessionStorage.getItem(accountKey) == null) sessionStorage.setItem(accountKey, JSON.stringify({ account: "ACC-ACTIVE", returnTo: null }))
    if (sessionStorage.getItem(actionKey) == null) {
      const issuedAt = new Date(Date.now() - 1_000).toISOString()
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()
      const axis = (gate: "person" | "payment_kyc") => ({
        status: "eligible",
        expiresAt,
        reviewReceipt: {
          issuer: "ONDO_REVIEW_FIXTURE",
          executionTruth: "FIXTURE_REVIEW",
          provenanceTruth: "SIMULATED",
          fixtureId: gate === "person" ? "FX-PER-PROFILE-SEED" : "FX-PKY-PROFILE-SEED",
          issuedAt,
          expiresAt,
        },
      })
      sessionStorage.setItem(actionKey, JSON.stringify({
        version: 1,
        person: axis("person"),
        payment: axis("payment_kyc"),
        pending: null,
        lastConsumed: null,
        outcome: null,
      }))
    }
    if (sessionStorage.getItem(activityKey) == null) {
      sessionStorage.setItem(activityKey, JSON.stringify({
        profile: {
          displayName: "Traveler",
          from: { value: "", consent: false },
          livesIn: { value: "", consent: false },
          languages: { value: [], consent: false },
        },
      }))
    }
    if (stampCount > 0) {
      window.__ONDO_B_QA__ = {
        ...(window.__ONDO_B_QA__ ?? {}),
        profileActivityEvents: Array.from({ length: stampCount }, (_, index) => ({
          evidenceId: `visit:qa-memory-${index + 1}`,
          axes: ["visit" as const],
          addVisitStamp: true,
        })),
      }
    }
  }, {
    deviceKey: DEVICE_KEY,
    accountKey: ACCOUNT_KEY,
    actionKey: ACTION_KEY,
    activityKey: ACTIVITY_KEY,
    language: locale,
    stampCount: stamps,
  })
  await page.route("https://tiles.openfreemap.org/**", (route) => route.abort("blockedbyclient"))
}

async function openTravelPass(page: Page, locale: Locale, query = "") {
  await seed(page, locale)
  await page.goto(`/${query}`, { waitUntil: "domcontentloaded" })
  await expect(page.locator("html")).toHaveAttribute("lang", locale)
  await page.getByTestId("nav-id").click()
  await expect(page.getByTestId("ondo-b-traveler-id")).toBeVisible()
}

async function openOffer(page: Page) {
  await page.locator("[data-city='seoul']").click()
  await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-city", "seoul")
  const venueList = page.getByTestId("ondo-b-venue-list")
  if (!await venueList.isVisible()) {
    const toggle = page.getByTestId("ondo-b-view-toggle")
    await expect(toggle).toBeVisible()
    await toggle.click()
    await expect(venueList).toBeVisible()
  }
  const venue = venueList.locator(`[data-venue-id='${VENUE_ID}'] button`)
  await venue.scrollIntoViewIfNeeded()
  await venue.click()
  await page.getByTestId("canonical-place-details").click()
  await page.getByTestId("canonical-meal-benefit-open").click()
  return page.getByTestId("ondo-b-id-wallet-commerce")
}

async function completeCheckoutCredentialPresentation(page: Page) {
  const setup = page.getByTestId("k-tour-id-setup")
  await expect(setup).toHaveAttribute("data-origin", "action_gate")
  await setup.getByTestId("k-tour-id-method-mobile-id").click()
  await setup.getByTestId("k-tour-id-consent-approve").click()
  await expect(setup).toHaveAttribute("data-phase", "cx_handoff_preview")
  await setup.getByTestId("k-tour-id-continue").click()
  const holder = setup.getByTestId("k-tour-id-holder-delivery")
  await expect(holder).toBeVisible()
  await holder.getByTestId("k-tour-id-continue").click()
  await expect(setup).toBeHidden()

  const gate = page.getByTestId("ondo-b-action-gate")
  await expect(gate).toHaveAttribute("data-active-gate", "credential")
  await gate.getByTestId("action-gate-confirm").click()
}

for (const locale of ["en", "ko", "ja"] as const) {
  test(`profile and four independent activity axes remain polished and local in ${locale}`, async ({ page }) => {
    await openTravelPass(page, locale)
    const surface = page.getByTestId("ondo-b-profile-activity")
    await expect(surface).toBeVisible()
    await expect(surface.locator("[data-axis]" )).toHaveCount(4)
    await expect(surface.locator("[data-axis='identity']")).not.toHaveAttribute("data-axis", "visit")
    await expect(surface).not.toContainText(/trust score|reputation score|nationality|국적|国籍/i)
    const overflow = await surface.evaluate((node) => ({ client: node.clientWidth, scroll: node.scrollWidth }))
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1)
    const axe = await new AxeBuilder({ page }).include("[data-testid='ondo-b-profile-activity']").analyze()
    expect(axe.violations.filter(({ impact }) => impact === "serious" || impact === "critical")).toEqual([])
  })
}

test("profile, axes, and stamps reflow without clipping from 320px through landscape and tablet", async ({ page }) => {
  await seed(page, "ko", 9)
  for (const viewport of [
    { width: 320, height: 720 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 768, height: 1024 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport)
    await page.goto("/", { waitUntil: "domcontentloaded" })
    await page.getByTestId("nav-id").click()
    const surface = page.getByTestId("ondo-b-profile-activity")
    await expect(surface).toBeVisible()
    const dimensions = await surface.evaluate((node) => ({ client: node.clientWidth, scroll: node.scrollWidth }))
    expect(dimensions.scroll, `${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(dimensions.client + 1)
    for (const button of await surface.locator("button:visible").all()) {
      const box = await button.boundingBox()
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(43.9)
    }
  }
})

test("profile consent, failure retry, and reload persistence keep previous data safe", async ({ page }) => {
  await page.addInitScript(() => { (window as Window & { __ONDO_B_QA__?: { profile?: "failure" } }).__ONDO_B_QA__ = { profile: "failure" } })
  await openTravelPass(page, "en")
  const profile = page.getByTestId("ondo-profile-panel")
  await profile.getByRole("button", { name: "Edit", exact: true }).click()
  const nameInput = profile.getByRole("textbox", { name: "Display name", exact: true })
  const fromInput = profile.getByRole("textbox", { name: "From", exact: true })
  const livesInput = profile.getByRole("textbox", { name: "Lives in", exact: true })
  const languagesInput = profile.getByRole("textbox", { name: "Languages", exact: true })
  await nameInput.fill("Mina Park")
  await fromInput.fill("Canada")
  await livesInput.fill("Seoul")
  await languagesInput.fill("English, 日本語")
  await profile.getByRole("button", { name: /From/, pressed: false }).click()
  await profile.getByRole("button", { name: /Languages/, pressed: false }).click()
  await profile.getByRole("button", { name: "Save profile" }).click()
  await expect(profile.getByRole("alert")).toBeVisible()
  await expect(nameInput).toHaveValue("Mina Park")
  await expect(languagesInput).toHaveValue("English, 日本語")
  await profile.getByRole("button", { name: "Try saving again" }).click()
  await expect(profile).toContainText("Mina Park")
  await expect(profile).toContainText("Canada")
  await expect(profile).toContainText("English")
  await expect(profile).not.toContainText("Seoul")

  await page.reload({ waitUntil: "domcontentloaded" })
  await page.getByTestId("nav-id").click()
  await expect(page.getByTestId("ondo-profile-panel")).toContainText("Mina Park")
  const stored = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) ?? "null"), ACTIVITY_KEY)
  expect(stored.profile).not.toHaveProperty("nationality")
})

test("payment alone never adds a stamp; an optional unique visit reaches 10 and opens its keepsake", async ({ page }) => {
  await seed(page, "en", 9)
  await page.goto("/", { waitUntil: "domcontentloaded" })
  const offer = await openOffer(page)
  await offer.getByTestId("payment-confirm").click()
  await page.getByTestId("wallet-connect-sheet").getByRole("button", { name: "Set up travel wallet", exact: true }).click()
  await offer.getByTestId("benefit-accept").click()
  await offer.getByTestId("payment-minimum-consent").locator("input").check()
  await offer.getByTestId("payment-confirm").click()
  await completeCheckoutCredentialPresentation(page)
  await expect(offer.getByTestId("payment-receipt")).toBeVisible()
  await expect(offer.getByTestId("visit-stamp-receipt")).toHaveCount(0)
  await offer.getByTestId("receipt-journey-open").click()
  const visit = page.getByTestId("journey-visit-sheet").getByTestId("visit-stamp-receipt")
  await expect(visit).toHaveAttribute("data-stamp-count", "9")
  expect(await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) ?? "null"), ACTIVITY_KEY)).not.toHaveProperty("stamps")

  const visitDetails = visit.getByTestId("visit-stamp-details")
  const visitTruth = "This is a sample visit, not a location or venue check. It stays in this open session and resets on reload. No purchase or identity check is needed to try it."
  await expect(visitDetails).not.toHaveAttribute("open", "")
  await expect(visitDetails.getByText(visitTruth, { exact: true })).toBeHidden()
  await visitDetails.locator("summary").click()
  await expect(visitDetails.getByText(visitTruth, { exact: true })).toBeVisible()

  await visit.getByTestId("visit-proof-check").click()
  await expect(visit).toHaveAttribute("data-stamp-count", "10")
  const persistedActivity = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) ?? "null"), ACTIVITY_KEY)
  expect(persistedActivity).not.toHaveProperty("stamps")
  expect(persistedActivity).not.toHaveProperty("evidenceReceipts")
  await expect(visit.getByTestId("visit-proof-check")).toHaveCount(0)
  await visit.getByTestId("checkout-stamp-milestone").click()
  await expect(page.getByTestId("labs-acknowledge")).toHaveCount(0)
  await expect(page.getByTestId("journey-keepsake-overlay")).toBeVisible()
  await expect(page.getByTestId("labs-overlay")).toBeVisible()
  await expect(page.getByTestId("labs-badge-mint")).toBeVisible()
})

test("clear saved content tombstones every B session axis without reviving legacy data", async ({ page }) => {
  await seed(page, "en", 9)
  await page.addInitScript(({ preferenceKey, sessionKey }) => {
    sessionStorage.setItem("ondo.session.v3", JSON.stringify({ account: "ACC-ACTIVE", person: "PER-VERIFIED", paymentKyc: "PKY-VERIFIED", stamps: 10 }))
    localStorage.setItem("ondo.preferences.v3", JSON.stringify({ autoNight: false }))
    localStorage.setItem(preferenceKey, JSON.stringify({ version: 1, autoOpen: false }))
    sessionStorage.setItem(sessionKey, JSON.stringify({ version: 1, age: "eligible", ageExpiresAt: new Date(Date.now() + 86_400_000).toISOString(), mode: "manual-off", activation: null, expiryNotice: false }))
  }, { preferenceKey: AFTER19_PREFERENCE_KEY, sessionKey: AFTER19_SESSION_KEY })
  await page.goto("/", { waitUntil: "domcontentloaded" })
  await page.getByTestId("nav-settings").click()
  const settings = page.getByTestId("ondo-b-device-data-settings")
  await settings.click()
  await page.getByTestId("ondo-b-clear-device-open").click()
  await page.getByTestId("ondo-b-clear-device-confirm").getByRole("button", { name: "Delete saved data", exact: true }).click()
  const state = await page.evaluate(({ accountKey, actionKey, activityKey, preferenceKey, sessionKey }) => ({
    account: JSON.parse(sessionStorage.getItem(accountKey) ?? "null"),
    action: JSON.parse(sessionStorage.getItem(actionKey) ?? "null"),
    activity: JSON.parse(sessionStorage.getItem(activityKey) ?? "null"),
    preference: JSON.parse(localStorage.getItem(preferenceKey) ?? "null"),
    after19: JSON.parse(sessionStorage.getItem(sessionKey) ?? "null"),
    legacy: sessionStorage.getItem("ondo.session.v3"),
  }), { accountKey: ACCOUNT_KEY, actionKey: ACTION_KEY, activityKey: ACTIVITY_KEY, preferenceKey: AFTER19_PREFERENCE_KEY, sessionKey: AFTER19_SESSION_KEY })
  expect(state.account).toEqual({ account: "ACC-GUEST", returnTo: null })
  expect(state.action).toMatchObject({ person: { status: "unverified" }, payment: { status: "unverified" }, pending: null })
  expect(state.activity).toMatchObject({ stamps: 0, acceptedEvidenceIds: [] })
  expect(state.preference).toEqual({ version: 1, autoOpen: true })
  expect(state.after19).toMatchObject({ age: "unverified", mode: "off" })
  expect(state.legacy).toContain("PER-VERIFIED")
})

test("clear saved content rolls back every session key when a mid-transaction tombstone write fails", async ({ page }) => {
  await seed(page, "en", 4)
  await page.goto("/", { waitUntil: "domcontentloaded" })
  await page.evaluate(() => sessionStorage.setItem("ondo-b.labs.v1", JSON.stringify({ stage: "ready", private: "keep-on-failure" })))
  const before = await page.evaluate(({ deviceKey, accountKey, actionKey, activityKey, preferenceKey, sessionKey }) => ({
    device: localStorage.getItem(deviceKey),
    account: sessionStorage.getItem(accountKey),
    action: sessionStorage.getItem(actionKey),
    activity: sessionStorage.getItem(activityKey),
    preference: localStorage.getItem(preferenceKey),
    after19: sessionStorage.getItem(sessionKey),
    labs: sessionStorage.getItem("ondo-b.labs.v1"),
  }), { deviceKey: DEVICE_KEY, accountKey: ACCOUNT_KEY, actionKey: ACTION_KEY, activityKey: ACTIVITY_KEY, preferenceKey: AFTER19_PREFERENCE_KEY, sessionKey: AFTER19_SESSION_KEY })
  await page.evaluate((accountKey) => {
    const original = Storage.prototype.setItem
    let failOnce = true
    Storage.prototype.setItem = function (key: string, value: string) {
      if (this === sessionStorage && key === accountKey && failOnce) {
        failOnce = false
        throw new DOMException("Injected session failure", "QuotaExceededError")
      }
      return original.call(this, key, value)
    }
  }, ACCOUNT_KEY)

  await page.getByTestId("nav-settings").click()
  const settings = page.getByTestId("ondo-b-device-data-settings")
  await settings.click()
  await page.getByTestId("ondo-b-clear-device-open").click()
  const dialog = page.getByTestId("ondo-b-clear-device-confirm")
  await dialog.getByRole("button", { name: "Delete saved data", exact: true }).click()
  await expect(page.getByTestId("ondo-b-clear-device-error")).toBeVisible()
  const afterFailure = await page.evaluate(({ deviceKey, accountKey, actionKey, activityKey, preferenceKey, sessionKey }) => ({
    device: localStorage.getItem(deviceKey),
    account: sessionStorage.getItem(accountKey),
    action: sessionStorage.getItem(actionKey),
    activity: sessionStorage.getItem(activityKey),
    preference: localStorage.getItem(preferenceKey),
    after19: sessionStorage.getItem(sessionKey),
    labs: sessionStorage.getItem("ondo-b.labs.v1"),
  }), { deviceKey: DEVICE_KEY, accountKey: ACCOUNT_KEY, actionKey: ACTION_KEY, activityKey: ACTIVITY_KEY, preferenceKey: AFTER19_PREFERENCE_KEY, sessionKey: AFTER19_SESSION_KEY })
  expect(afterFailure).toEqual(before)

  await dialog.getByRole("button", { name: "Delete saved data", exact: true }).click()
  await expect(dialog).toHaveCount(0)
})
