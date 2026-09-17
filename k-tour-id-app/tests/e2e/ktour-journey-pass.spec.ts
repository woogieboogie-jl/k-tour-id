import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Locator, type Page } from "@playwright/test"

const PLACE = "mois-0021cd596bc5b2a922ad"
const failures = new WeakMap<Page, string[]>()
type Locale = "en" | "ko" | "ja"
type Appearance = "light" | "dark"

test.describe.configure({ timeout: 90_000 })
test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  failures.set(page, errors)
  page.on("pageerror", error => errors.push(error.stack ?? error.message))
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url())
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())
      || /sumsub|onfido|omni.?one|opendid|fullnode|sui\.io|walletconnect|stripe/i.test(url.hostname)) {
      errors.push(`Forbidden request: ${request.method()} ${url.origin}`)
      await route.abort("blockedbyclient")
      return
    }
    await route.continue()
  })
})
test.afterEach(({ page }) => { expect(failures.get(page) ?? []).toEqual([]) })

// Preferences and review opt-in only. Positive activity, identity, account,
// signer and payment states must be reached through their ordinary UI.
async function preferences(page: Page, locale: Locale = "en", appearance: Appearance = "light", review = true) {
  await page.addInitScript(({ locale, appearance, review }) => {
    localStorage.setItem("ondo-b.device.v1", JSON.stringify({ locale, appearancePreference: appearance, onboarding: "ONB-COMPLETE" }))
    sessionStorage.setItem("ondo.review.flow.v1", review ? "1" : "0")
  }, { locale, appearance, review })
}

function sheetFor(content: Locator) {
  return content.locator('xpath=ancestor::*[@data-testid="ondo-sheet"][1]')
}

async function usable(action: Locator) {
  await action.scrollIntoViewIfNeeded()
  await expect(action).toBeVisible()
  const box = await action.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.height).toBeGreaterThanOrEqual(44)
  await expect.poll(() => action.evaluate(node => {
    const rect = node.getBoundingClientRect()
    return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
  })).toBe(true)
}

async function noOverflow(content: Locator, page: Page) {
  expect(await content.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
  expect(await page.locator("html").evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
}

async function savedVisitFrame(visit: Locator, page: Page) {
  const viewport = page.viewportSize()!
  const sheet = sheetFor(visit)
  const header = sheet.locator("[data-sheet-header]")
  const actions = [header.locator('[data-sheet-navigation="back"]'), page.getByTestId("journey-visit-return"), page.getByTestId("journey-visit-pass")]
  // Do not scroll controls into view: that can hide a modal/ancestor scroll
  // regression where focusing the new footer clips the entire sheet header.
  for (const control of [header, ...actions]) {
    const box = await control.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height)
  }
  for (const action of actions) expect(await action.evaluate(node => {
    const rect = node.getBoundingClientRect()
    return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
  })).toBe(true)
}

async function openPlace(page: Page, review = true) {
  await page.goto(`/?venueId=${PLACE}&review=${review ? "1" : "0"}`, { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true")
  await page.getByTestId("canonical-place-details").click()
  await expect(page.getByTestId("canonical-place-overlay")).toBeVisible()
}

async function openVisit(page: Page) {
  await page.getByTestId("canonical-journey-open").click()
  const visit = page.getByTestId("journey-visit-sheet")
  await expect(visit).toHaveAttribute("data-venue-id", PLACE)
  await expect(visit).toBeVisible()
  return visit
}

async function dismissPlace(page: Page) {
  for (let step = 0; step < 3; step++) {
    if (!await page.getByRole("dialog").count()) break
    await page.keyboard.press("Escape")
    await page.waitForTimeout(240)
  }
  await expect(page.getByRole("dialog")).toHaveCount(0)
}

async function recordVisitAndOpenPass(page: Page) {
  await openPlace(page)
  const visit = await openVisit(page)
  await visit.getByTestId("visit-proof-check").click()
  await expect(visit).toHaveAttribute("data-recorded", "true")
  await expect(visit.getByTestId("visit-stamp-receipt")).toHaveAttribute("data-stamp-count", "1")
  await page.waitForTimeout(400)
  await savedVisitFrame(visit, page)
  await page.getByTestId("journey-visit-return").click()
  await expect(visit).toHaveCount(0)
  await dismissPlace(page)
  await page.getByTestId("nav-id").click()
  const card = page.getByTestId("ondo-b-stamp-milestone")
  await expect(card).toHaveAttribute("data-stamps", "1")
  return card
}

for (const locale of ["en", "ko", "ja"] as const) {
  for (const appearance of ["light", "dark"] as const) {
    for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
      test(`JOURNEY layout ${locale} ${appearance} ${viewport.width}`, async ({ page }, info) => {
        test.skip((viewport.width < 1000) !== (info.project.name === "mobile-chromium"), "Use the actual mobile/desktop browser profile for this viewport")
        await page.setViewportSize(viewport)
        await preferences(page, locale, appearance)
        const card = await recordVisitAndOpenPass(page)
        await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-appearance", appearance)
        await expect(card).toHaveAttribute("data-mode", "review")
        await expect(page.getByTestId("ondo-b-action-gate")).toHaveCount(0)
        await usable(card.getByTestId("journey-stamps-open"))
        await noOverflow(card, page)
        await page.screenshot({ path: info.outputPath("journey-pass.png"), scale: "css" })
        const cardContrast = await new AxeBuilder({ page }).include('[data-testid="ondo-b-stamp-milestone"]').withRules(["color-contrast"]).analyze()
        expect(cardContrast.violations).toEqual([])
        await card.getByTestId("journey-stamps-open").click()
        const collection = page.getByTestId("journey-stamps-collection")
        await expect(collection).toHaveAttribute("data-stamps", "1")
        await expect(collection.getByTestId("journey-stamp-row")).toHaveCount(1)
        await expect(collection.getByTestId("journey-stamp-row")).toHaveAttribute("data-venue-id", PLACE)
        await usable(collection.getByTestId("journey-stamp-row").getByRole("button"))
        await noOverflow(collection, page)
        await page.screenshot({ path: info.outputPath("journey-collection.png"), scale: "css" })
        const collectionContrast = await new AxeBuilder({ page }).include('[data-testid="journey-stamps-collection"]').withRules(["color-contrast"]).analyze()
        expect(collectionContrast.violations).toEqual([])
        await page.keyboard.press("Escape")
        await expect(collection).toHaveCount(0)
        await expect(card.getByTestId("journey-stamps-open")).toBeFocused()
        await page.waitForTimeout(400)
        await expect(card.getByTestId("journey-stamps-open")).toBeFocused()
      })
    }
  }
}

test("JOURNEY normal mode rejects stored activity and shows no active stamp quest", async ({ page }) => {
  await preferences(page, "en", "light", false)
  await page.addInitScript(() => {
    sessionStorage.setItem("ondo-b.activity-profile.v1", JSON.stringify({
      stamps: 10, acceptedEvidenceIds: ["visit:mois-0021cd596bc5b2a922ad"],
      reputation: { visit: "repeat", contribution: "established", meetup: "established" },
      evidenceReceipts: [{ evidenceId: "visit:mois-0021cd596bc5b2a922ad", addsVisitStamp: true }],
    }))
    window.__ONDO_B_QA__ = { profileActivityEvents: [{ evidenceId: "visit:mois-0021cd596bc5b2a922ad", axes: ["visit"], addVisitStamp: true }] }
  })
  await page.goto("/?review=0", { waitUntil: "domcontentloaded" })
  await page.getByTestId("nav-id").click()
  const card = page.getByTestId("ondo-b-stamp-milestone")
  await expect(card).toHaveAttribute("data-stamps", "0")
  await expect(card).toHaveAttribute("data-mode", "unavailable")
  await expect(card).not.toContainText(/0\s*\/\s*10/)
  await expect(card.getByRole("img")).toHaveCount(0)
  await expect(card.getByTestId("journey-stamps-open")).toHaveCount(0)
  await expect(card.getByTestId("open-labs-milestone")).toHaveCount(0)
  await openPlace(page, false)
  const visit = await openVisit(page)
  await expect(visit).toHaveAttribute("data-recorded", "false")
  await expect(visit.getByTestId("visit-proof-check")).toHaveCount(0)
  await expect(page.getByTestId("ondo-b-action-gate")).toHaveCount(0)
  await expect(page.getByTestId("payment-receipt")).toHaveCount(0)
})

test("JOURNEY guest cancellation, unique record, duplicate and collection return preserve the same place", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 540 })
  await preferences(page)
  await openPlace(page)
  const opener = page.getByTestId("canonical-journey-open")
  const visit = await openVisit(page)
  await expect(visit.getByTestId("visit-stamp-receipt")).toHaveAttribute("data-stamp-count", "0")
  await sheetFor(visit).locator('[data-sheet-navigation="back"]').click()
  await expect(visit).toHaveCount(0)
  await expect(opener).toBeFocused()
  await page.waitForTimeout(400)
  await expect(opener).toBeFocused()
  await openVisit(page)
  await expect(visit.getByTestId("visit-stamp-receipt")).toHaveAttribute("data-stamp-count", "0")
  await usable(visit.getByTestId("visit-proof-check"))
  // Both real controls are activated before the queued proof paint. Closing
  // during that pending work must cancel it, including the retained exit.
  await visit.getByTestId("visit-proof-check").evaluate(button => {
    ;(button as HTMLButtonElement).click()
    button.closest('[data-testid="ondo-sheet"]')?.querySelector<HTMLButtonElement>('[data-sheet-navigation="back"]')?.click()
  })
  await expect(visit).toHaveCount(0)
  await openVisit(page)
  await expect(visit.getByTestId("visit-stamp-receipt")).toHaveAttribute("data-stamp-count", "0")
  const gatesBefore = await page.evaluate(() => sessionStorage.getItem("ondo-b.action-gates.v1"))
  // Let the sheet's initial-focus recovery expire. Saving must itself keep
  // keyboard focus inside the modal after the proof button is removed.
  await page.waitForTimeout(400)
  await visit.getByTestId("visit-proof-check").click()
  await expect(visit).toHaveAttribute("data-recorded", "true")
  await expect(visit.getByTestId("visit-stamp-receipt")).toHaveAttribute("data-stamp-count", "1")
  expect(await page.evaluate(() => sessionStorage.getItem("ondo-b.action-gates.v1"))).toBe(gatesBefore)
  await expect(page.getByTestId("ondo-b-action-gate")).toHaveCount(0)
  await expect(page.getByTestId("journey-visit-return")).toBeFocused()
  await page.waitForTimeout(400)
  await expect(page.getByTestId("journey-visit-return")).toBeFocused()
  const savedHeader = sheetFor(visit).locator("[data-sheet-header]")
  const savedBack = savedHeader.locator('[data-sheet-navigation="back"]')
  for (const control of [savedHeader, savedBack]) {
    const box = await control.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.y + box!.height).toBeLessThanOrEqual(540)
  }
  expect(await savedBack.evaluate(node => {
    const rect = node.getBoundingClientRect()
    return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
  })).toBe(true)
  for (const action of [page.getByTestId("journey-visit-return"), page.getByTestId("journey-visit-pass")]) {
    await usable(action)
    const box = await action.boundingBox()
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.y + box!.height).toBeLessThanOrEqual(540)
  }
  expect((await savedHeader.boundingBox())!.y).toBeGreaterThanOrEqual(0)
  await page.keyboard.press("Escape")
  await expect(visit).toHaveCount(0)
  await expect(page.getByTestId("canonical-place-overlay")).toHaveAttribute("data-venue-id", PLACE)
  await openVisit(page)
  await expect(visit).toHaveAttribute("data-recorded", "true")
  await expect(visit.getByTestId("visit-proof-check")).toHaveCount(0)
  await expect(visit.getByTestId("visit-stamp-receipt")).toHaveAttribute("data-stamp-count", "1")
  await page.getByTestId("journey-visit-return").click()
  await expect(visit).toHaveCount(0)
  await expect(page.getByTestId("canonical-place-overlay")).toHaveAttribute("data-venue-id", PLACE)
  await openVisit(page)
  await page.getByTestId("journey-visit-pass").click()
  await expect(visit).toHaveCount(0)
  const collection = page.getByTestId("journey-stamps-collection")
  await expect(collection).toHaveAttribute("data-stamps", "1")
  await expect(collection.getByTestId("journey-stamp-row")).toHaveCount(1)
  await usable(collection.getByTestId("journey-stamp-row").getByRole("button"))
  await collection.getByTestId("journey-stamp-row").getByRole("button").click()
  await expect(collection).toHaveCount(0)
  await expect(page.getByTestId("canonical-place-overlay")).toHaveAttribute("data-venue-id", PLACE)
  await expect(opener).toHaveAttribute("data-recorded", "true")
  await openVisit(page)
  await expect(visit.getByTestId("visit-stamp-receipt")).toHaveAttribute("data-stamp-count", "1")
})

test("JOURNEY a stale review button cannot record after live review opt-out", async ({ page }) => {
  await preferences(page)
  await openPlace(page)
  const visit = await openVisit(page)
  await expect(visit.getByTestId("visit-proof-check")).toBeEnabled()
  // Deliberately leave the already-painted control stale. The mutation boundary
  // must recheck authority rather than relying on this React render's flag.
  await page.evaluate(() => {
    sessionStorage.setItem("ondo.review.flow.v1", "0")
    const url = new URL(location.href)
    url.searchParams.set("review", "0")
    history.replaceState(history.state, "", url)
  })
  await visit.getByTestId("visit-proof-check").click()
  await expect(visit.getByTestId("visit-stamp-receipt")).toHaveAttribute("data-proof-state", "failed")
  await expect(visit).toHaveAttribute("data-recorded", "false")
  await expect(visit.getByTestId("visit-stamp-receipt")).toHaveAttribute("data-stamp-count", "0")
})

test("JOURNEY review visits survive tab changes but never claim durable storage on reload", async ({ page }) => {
  await preferences(page)
  const card = await recordVisitAndOpenPass(page)
  await expect(card).toContainText("resets on reload")
  await page.getByTestId("nav-my").click()
  await page.getByTestId("nav-id").click()
  await expect(card).toHaveAttribute("data-stamps", "1")
  const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem("ondo-b.activity-profile.v1") ?? "{}"))
  expect(stored.stamps).toBeUndefined()
  expect(stored.evidenceReceipts).toBeUndefined()
  await page.reload({ waitUntil: "domcontentloaded" })
  await dismissPlace(page)
  await page.getByTestId("nav-id").click()
  await expect(card).toHaveAttribute("data-stamps", "0")
  await expect(card.getByTestId("journey-stamps-open")).toHaveCount(0)
})

test("JOURNEY visible ninth-to-tenth sample opens a focused optional keepsake without publishing or a bridge", async ({ page }, info) => {
  await preferences(page)
  await page.goto("/?review=1", { waitUntil: "domcontentloaded" })
  await page.getByTestId("nav-my").click()
  await page.getByTestId("open-labs").click()
  await page.getByTestId("labs-acknowledge").click()
  const labs = page.getByTestId("labs-overlay")
  await labs.getByTestId("labs-sample-scenarios").locator("summary").click()
  await labs.getByTestId("labs-sample-visit-setup").locator("summary").click()
  await labs.getByTestId("labs-load-sample-visits").click()
  await expect(labs.getByTestId("visit-stamp-receipt")).toHaveAttribute("data-stamp-count", "9")
  await labs.getByTestId("visit-proof-check").click()
  await expect(labs.getByTestId("labs-visit-milestone")).toBeVisible()
  await labs.getByTestId("labs-back").click()
  await expect(labs).toHaveCount(0)
  await page.getByTestId("nav-id").click()
  const card = page.getByTestId("ondo-b-stamp-milestone")
  await expect(card).toHaveAttribute("data-stamps", "10")
  await card.getByTestId("journey-stamps-open").click()
  const collection = page.getByTestId("journey-stamps-collection")
  await expect(collection.getByTestId("journey-stamp-row")).toHaveCount(10)
  const opener = collection.getByTestId("journey-stamps-keepsake")
  await opener.click()
  const keepsake = page.getByTestId("journey-keepsake-overlay")
  await expect(keepsake).toBeVisible()
  await expect(keepsake.getByTestId("journey-keepsake-truth")).toContainText(/sample/i)
  await expect(keepsake.getByTestId("labs-bridge-quote")).toHaveCount(0)
  await expect(keepsake.getByTestId("labs-consumer-balances")).toHaveCount(0)
  await expect(keepsake.getByTestId("labs-acknowledge")).toHaveCount(0)
  const consent = keepsake.getByRole("checkbox")
  await expect(consent).not.toBeChecked()
  await expect(keepsake.getByTestId("labs-badge-mint")).toBeDisabled()
  await consent.check()
  await consent.uncheck()
  await expect(keepsake.getByTestId("labs-badge-mint")).toBeDisabled()
  await expect(keepsake.getByTestId("labs-badge-result")).toHaveCount(0)
  await noOverflow(keepsake, page)
  await page.screenshot({ path: info.outputPath("focused-keepsake-consent-denied.png"), scale: "css" })
  await keepsake.getByTestId("labs-back").click()
  await expect(keepsake).toHaveCount(0)
  await expect(collection).toHaveAttribute("data-stamps", "10")
  await page.waitForTimeout(400)
  await expect(opener).toBeFocused()
  await opener.click()
  await keepsake.getByTestId("labs-connect-wallet").click()
  await expect(keepsake).toHaveAttribute("data-wallet-state", "WAL-READY")
  await consent.check()
  await keepsake.getByTestId("labs-badge-mint").click()
  const gate = page.getByTestId("ondo-b-action-gate")
  await expect(gate).toHaveAttribute("data-return-cta", "MINT_BADGE")
  await page.keyboard.press("Escape")
  await expect(gate).toHaveCount(0)
  await expect(keepsake).not.toHaveAttribute("data-mint-state", "NFT-MINTED")
  await expect(keepsake.getByTestId("labs-badge-result")).toHaveCount(0)
  await keepsake.getByTestId("labs-back").click()
  await expect(collection).toHaveAttribute("data-stamps", "10")
  expect(await page.evaluate(() => window.__ONDO_B_QA__)).toBeUndefined()
})

test("JOURNEY paying alone adds no visit and the receipt has no embedded stamp task", async ({ page }) => {
  await preferences(page)
  await page.goto("/?review=1", { waitUntil: "domcontentloaded" })
  await page.getByTestId("nav-id").click()
  await expect(page.getByTestId("ondo-b-stamp-milestone")).toHaveAttribute("data-stamps", "0")
  await page.getByTestId("wallet-link-open").click()
  await page.getByTestId("wallet-connect-sheet").getByRole("button", { name: "Set up travel wallet", exact: true }).click()
  await page.getByTestId("wallet-balance-places").click()
  await page.getByTestId("ondo-b-search").fill("Roba")
  const row = page.getByTestId("ondo-b-venue-list").locator(`li[data-venue-id="${PLACE}"] > button`)
  if (!await row.isVisible()) await page.getByTestId("ondo-b-view-toggle").click()
  await row.click()
  await page.getByTestId("peek-place-service").click()
  await page.getByTestId("payment-minimum-consent").getByRole("checkbox").check()
  await page.getByTestId("payment-confirm").click()
  await page.getByTestId("action-gate-confirm").click()
  await page.getByTestId("action-gate-confirm").click()
  await expect(page.getByTestId("payment-receipt")).toBeVisible()
  await expect(page.getByTestId("visit-stamp-receipt")).toHaveCount(0)
  await expect(page.getByTestId("visit-proof-check")).toHaveCount(0)
  await usable(page.getByTestId("receipt-journey-open"))
  await page.getByTestId("receipt-journey-open").click()
  const visit = page.getByTestId("journey-visit-sheet")
  await expect(visit).toHaveAttribute("data-venue-id", PLACE)
  await expect(visit.getByTestId("visit-stamp-receipt")).toHaveAttribute("data-stamp-count", "0")
  await usable(visit.getByTestId("visit-proof-check"))
  await sheetFor(visit).locator('[data-sheet-navigation="back"]').click()
  await expect(visit).toHaveCount(0)
  await expect(page.getByTestId("payment-receipt")).toBeVisible()
  await expect(page.getByTestId("receipt-journey-open")).toBeFocused()
  await page.getByTestId("payment-receipt-return").click()
  await expect(page.getByTestId("canonical-place-peek")).toHaveAttribute("data-venue-id", PLACE)
  await dismissPlace(page)
  await page.getByTestId("nav-id").click()
  await expect(page.getByTestId("ondo-b-stamp-milestone")).toHaveAttribute("data-stamps", "0")
})
