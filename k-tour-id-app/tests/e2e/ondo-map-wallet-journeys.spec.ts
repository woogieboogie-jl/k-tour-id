import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"
import { installBRuntimeGuard, expectBRuntimeClean } from "../helpers/ondo-b-qa"
import { researchedFoodByIdB } from "../../features/ondo/map/researched-food-b"

test.beforeEach(({ page }) => installBRuntimeGuard(page))
test.afterEach(async ({ page }, info) => { await expectBRuntimeClean(page, info) })
test.setTimeout(120_000)

async function enter(page: Page, city = "jeju", width = 390, locale = "en", appearance = "light", normal = false) {
  await page.setViewportSize({ width, height: 844 })
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: appearance as "light" | "dark" })
  // Display preferences only. All money/account/identity transitions use UI.
  await page.addInitScript(({ locale, appearance }) => {
    if (location.protocol.startsWith("http")) localStorage.setItem("ondo-b.device.v1", JSON.stringify({ locale, appearancePreference: appearance, onboarding: "ONB-COMPLETE" }))
  }, { locale, appearance })
  await page.goto(`/?city=${city}${normal ? "&review=0" : ""}`, { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("maplibre-map")).toHaveAttribute("data-map-state", "ready", { timeout: 30_000 })
}
async function research(page: Page, id: string) {
  const entry = page.getByTestId("ondo-b-map-entry")
  if (await entry.getAttribute("data-effective-view") !== "list") await page.getByTestId("ondo-b-view-toggle").click()
  await page.getByRole("textbox").first().fill("")
  await page.getByTestId("researched-food-list").locator(`button[data-research-id="${id}"]`).click()
  await expect(page.getByTestId("researched-food-detail")).toHaveAttribute("data-research-id", id)
}
async function offer(page: Page, id: string) {
  await research(page, id)
  await page.getByTestId("place-offer-open").click()
  await expect(page.getByTestId("payment-confirm")).toBeVisible()
  await page.getByTestId("benefit-decline").click()
}
async function completePayment(page: Page, withBenefit = false) {
  await page.getByTestId("payment-minimum-consent").getByRole("checkbox").check()
  await page.getByTestId("payment-confirm").click()
  await expect.poll(async () => await page.getByTestId("wallet-connect-sheet").isVisible() || await page.getByTestId("ondo-b-action-gate").isVisible() || await page.getByTestId("payment-receipt").isVisible()).toBe(true)
  const wallet = page.getByTestId("wallet-connect-sheet")
  if (await wallet.isVisible()) {
    await wallet.getByTestId("wallet-setup-scroll").getByRole("button").first().click()
    await expect(wallet).toHaveCount(0)
    await page.getByTestId("payment-confirm").click()
  }
  for (let step = 0; step < 7; step++) {
    const gate = page.getByTestId("ondo-b-action-gate")
    if (await page.getByTestId("payment-receipt").isVisible()) break
    await expect.poll(async () => await gate.isVisible() || await page.getByTestId("payment-receipt").isVisible()).toBe(true)
    if (!await gate.isVisible()) break
    const axis = await gate.getAttribute("data-active-gate")
    expect(withBenefit ? ["account", "payment_kyc", "credential"] : ["account", "payment_kyc"]).toContain(axis)
    if (withBenefit && axis === "credential" && await page.getByTestId("k-tour-id-setup").isVisible()) {
      await finishIdentitySetup(page)
      continue
    }
    await gate.getByTestId("action-gate-confirm").click()
    await expect.poll(async () => await page.getByTestId("payment-receipt").isVisible() || await page.getByTestId("k-tour-id-setup").isVisible() || !await gate.isVisible() || await gate.getAttribute("data-active-gate") !== axis).toBe(true)
  }
  await expect(page.getByTestId("payment-receipt")).toBeVisible({ timeout: 15_000 })
}
async function finishIdentitySetup(page: Page) {
  const setup = page.getByTestId("k-tour-id-setup")
  await setup.getByTestId("ktour-id-route-mobile-id").click()
  await setup.getByTestId("k-tour-id-consent-approve").click()
  const handoff = setup.getByTestId("k-tour-id-route-step")
  await handoff.getByTestId("k-tour-id-continue").click()
  await handoff.getByTestId("identity-handoff-approve").click()
  await expect(handoff).toHaveAttribute("data-handoff-state", "approved")
  await handoff.getByTestId("k-tour-id-continue").click()
  const holder = setup.getByTestId("k-tour-id-holder-delivery")
  await holder.getByTestId("k-tour-id-continue").click()
  await expect(holder).toHaveAttribute("data-holder-state", "receipt")
  await holder.getByTestId("k-tour-id-continue").click()
  // A setup initiated by checkout resumes its scoped presentation directly;
  // it must not send the user to the standalone ID dashboard receipt.
  await expect(setup).toHaveCount(0)
  await expect(page.getByTestId("ondo-b-action-gate")).toHaveAttribute("data-active-gate", "credential")
  await expect(page.getByTestId("action-gate-confirm")).toHaveAttribute("data-presentation-decision", "approve")
  await expect(page.getByTestId("payment-receipt")).toHaveCount(0)
}
async function returnPlace(page: Page, id: string) {
  await page.getByTestId("payment-receipt-return").click()
  await expect(page.getByTestId("researched-food-detail")).toHaveAttribute("data-research-id", id)
  await page.getByTestId("ondo-sheet").filter({ has: page.getByTestId("researched-food-detail") }).locator(":scope > header button").click()
}
async function fund(page: Page, stable = false) {
  const sheet = page.getByTestId("funding-source-sheet")
  await sheet.locator(`input[value='${stable ? "digital_dollar" : "krw_bank"}']`).check()
  await sheet.getByTestId("funding-method-save").click()
  if (stable) {
    await sheet.getByTestId("stablecoin-connect").click()
    await sheet.getByTestId("stablecoin-connection-approve").click()
  }
  await sheet.getByTestId("funding-quote-continue").click()
  await sheet.getByTestId("funding-consent").check()
  await sheet.getByTestId("funding-authorize").click()
  if (stable) {
    await sheet.getByTestId("stablecoin-check-source").click()
    await expect(sheet.getByTestId("funding-rail-journey")).toHaveAttribute("data-credit-committed", "false")
    await sheet.getByTestId("stablecoin-check-destination").click()
  }
  await expect(sheet.getByTestId("funding-rail-journey")).toHaveAttribute("data-credit-committed", "true")
  return sheet
}

test("MW-01/05 map-first two-place payments share balance, receipt refund and exact venue return", async ({ page }, info) => {
  await enter(page, "jeju")
  const first = "research-jeju-yaksuteo-olle-market", second = "research-jeju-moasi"
  await offer(page, first); await completePayment(page)
  await expect(page.getByTestId("receipt-place-context")).toHaveAttribute("data-venue-id", first)
  await page.screenshot({ path: info.outputPath("first-receipt.png") })
  await returnPlace(page, first)
  await expect(page.getByTestId("map-wallet-balance")).toHaveAttribute("data-balance-krw", "32000")
  await offer(page, second); await completePayment(page)
  await expect(page.getByTestId("receipt-place-context")).toHaveAttribute("data-venue-id", second)
  await returnPlace(page, second)
  await expect(page.getByTestId("map-wallet-balance")).toHaveAttribute("data-balance-krw", "20000")
  await page.getByTestId("map-wallet-balance").click()
  await expect(page.getByTestId("wallet-order-select")).toHaveCount(2)
  await page.getByTestId("wallet-order-select").filter({ hasText: researchedFoodByIdB(first)!.name.en }).click()
  await page.getByTestId("wallet-activity-receipt").locator(":scope > summary").click()
  // The legacy one-click restore was retired. Use the same bounded refund
  // workflow as checkout, tied to this selected order's remaining amount.
  await expect(page.getByTestId("wallet-activity-refund")).toHaveCount(0)
  const refunds = page.getByTestId("wallet-refund-panel")
  await refunds.locator(":scope > summary").click()
  await expect(page.getByTestId("wallet-refund-remaining")).toHaveText("₩28,000")
  await page.getByTestId("wallet-refund-all").click()
  await expect(page.getByTestId("wallet-refund-amount")).toHaveValue("28000")
  await page.getByTestId("wallet-refund-submit").click()
  await expect(page.getByTestId("wallet-refund-total")).toHaveText("₩28,000")
  await expect(page.getByTestId("wallet-refund-remaining")).toHaveText("₩0")
  await expect(page.locator('[data-testid="wallet-refund-operation"][data-phase="settled"]')).toHaveCount(1)
  await expect(page.getByTestId("wallet-refund-submit")).toHaveCount(0)
  await expect(page.getByTestId("wallet-display-equivalent")).toHaveText("₩48,000")
  await page.screenshot({ path: info.outputPath("shared-history-refund.png") })
  await page.getByTestId("wallet-activity-place").click()
  await expect(page.getByTestId("researched-food-detail")).toHaveAttribute("data-research-id", first)
})

test("MW-02 shortage top-up preserves the exact place and needs a fresh payment confirmation", async ({ page }, info) => {
  await enter(page, "seoul", 320, "ko", "dark")
  for (const id of ["research-seoul-zest", "research-seoul-bar-cham"]) {
    await offer(page, id); await completePayment(page); await returnPlace(page, id)
  }
  await expect(page.getByTestId("map-wallet-balance")).toHaveAttribute("data-balance-krw", "4000")
  await offer(page, "research-seoul-okdongsik")
  await expect(page.getByTestId("commerce-balance-shortage")).toContainText("18,000")
  await page.getByTestId("payment-confirm").click()
  await expect(page.getByTestId("funding-source-sheet")).toHaveAttribute("data-funding-purpose", "topup")
  await expect(page.getByTestId("funding-source-sheet")).toHaveAttribute("data-funding-subject", "offer:research-seoul-okdongsik")
  await expect(page.getByTestId("funding-source-sheet").locator("input[value='travel_balance']")).toHaveCount(0)
  const sheet = await fund(page, true)
  await sheet.getByTestId("funding-sample-use").click()
  await expect(page.getByTestId("payment-receipt")).toHaveCount(0)
  await expect(page.getByTestId("payment-confirm")).toBeVisible()
  await expect(page.getByTestId("payment-minimum-consent").getByRole("checkbox")).not.toBeChecked()
  const checkoutContrast = await new AxeBuilder({ page }).include('[data-testid="ondo-b-id-wallet-commerce"]').withRules(["color-contrast"]).analyze()
  expect(checkoutContrast.violations).toEqual([])
  await page.screenshot({ path: info.outputPath("funded-quote-320-dark.png") })
  await completePayment(page)
  await expect(page.getByTestId("receipt-place-context")).toHaveAttribute("data-venue-id", "research-seoul-okdongsik")
})

test("MW-01 benefit applies to the selected researched venue only after its required checks", async ({ page }, info) => {
  await enter(page, "seoul", 390, "en", "dark")
  await research(page, "research-seoul-zest")
  await page.getByTestId("place-offer-open").click()
  await page.getByTestId("benefit-accept").click()
  await expect(page.locator('[data-flow8-object="quote"]')).toContainText("25,000")
  await expect(page.getByTestId("payment-receipt")).toHaveCount(0)
  await completePayment(page, true)
  await expect(page.getByTestId("receipt-place-context")).toHaveAttribute("data-venue-id", "research-seoul-zest")
  await expect(page.getByTestId("payment-receipt")).toContainText("3,000")
  await page.screenshot({ path: info.outputPath("benefit-receipt-dark.png") })
  await returnPlace(page, "research-seoul-zest")
  await expect(page.getByTestId("map-wallet-balance")).toHaveAttribute("data-balance-krw", "35000")
})

test("MW-03 fund-first returns to supported places in the same city and lets the filter clear", async ({ page }, info) => {
  await enter(page, "busan", 430, "ja", "dark")
  await page.getByTestId("map-wallet-balance").click()
  await page.getByTestId("wallet-link-open").click()
  const wallet = page.getByTestId("wallet-connect-sheet")
  await wallet.getByTestId("wallet-setup-scroll").getByRole("button").first().click()
  await expect(wallet).toHaveCount(0)
  await expect(page.getByTestId("wallet-display-equivalent")).toContainText("60,000")
  await page.getByTestId("wallet-add-funds").click()
  await expect(page.getByTestId("funding-source-sheet")).toHaveAttribute("data-funding-purpose", "topup")
  await expect(page.getByTestId("funding-source-sheet").locator("input[value='travel_balance']")).toHaveCount(0)
  const sheet = await fund(page)
  await sheet.getByTestId("funding-sample-use").click()
  await page.getByTestId("wallet-balance-places").click()
  await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-balance-places-filter", "on")
  await expect(page.getByTestId("map-wallet-balance")).toHaveAttribute("data-balance-krw", "90000")
  await page.screenshot({ path: info.outputPath("balance-places-430-ja-dark.png") })
  await research(page, "research-busan-momos-yeongdo")
  await expect(page.getByTestId("place-offer-open")).toBeVisible()
  await page.getByTestId("ondo-sheet").filter({ has: page.getByTestId("researched-food-detail") }).locator(":scope > header button").click()
  await page.getByTestId("map-balance-places-filter").click()
  await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-balance-places-filter", "off")
})

test("MW-04 research venue booking, cancellation and another venue preserve independent requests", async ({ page }, info) => {
  await enter(page, "jeju", 320, "en", "light")
  const first = "research-jeju-yaksuteo-olle-market", second = "research-jeju-woojin-haejangguk"
  await research(page, first); await page.getByTestId("place-reservation-open").click()
  const booking = page.getByTestId("reservation-sample")
  await expect(booking).toHaveAttribute("data-venue-id", first)
  await expect(page.getByTestId("ondo-b-action-gate")).toHaveCount(0)
  await page.getByTestId("reservation-submit").click()
  await expect(booking).toHaveAttribute("data-phase", "confirmed")
  const original = await booking.getAttribute("data-operation-id")
  await page.screenshot({ path: info.outputPath("venue-reservation-320.png") })
  await page.getByTestId("reservation-cancel").click()
  await page.getByTestId("reservation-confirm-cancel").click()
  await expect(booking).toHaveAttribute("data-phase", "cancelled")
  await page.getByTestId("reservation-return-place").click()
  await expect(page.getByTestId("researched-food-detail")).toHaveAttribute("data-research-id", first)
  await page.getByTestId("ondo-sheet").filter({ has: page.getByTestId("researched-food-detail") }).locator(":scope > header button").click()
  await research(page, second); await page.getByTestId("place-reservation-open").click()
  await expect(booking).toHaveAttribute("data-phase", "draft")
  await expect(booking).toHaveAttribute("data-venue-id", second)
  await page.getByTestId("reservation-submit").click()
  await expect(booking).toHaveAttribute("data-phase", "confirmed")
  expect(await booking.getAttribute("data-operation-id")).not.toBe(original)
  await page.getByTestId("reservation-return-place").click()
  await page.getByTestId("ondo-sheet").filter({ has: page.getByTestId("researched-food-detail") }).locator(":scope > header button").click()
  await page.getByTestId("nav-tables").click()
  await page.getByTestId(`reservation-history-${first}`).click()
  await expect(booking).toHaveAttribute("data-venue-id", first)
  await expect(booking).toHaveAttribute("data-phase", "cancelled")
  await expect(booking).toHaveAttribute("data-operation-id", original!)
})

test("MW-SAFE unsupported production mode never promotes researched places to accepting merchants", async ({ page }) => {
  await enter(page, "jeju", 390, "en", "light", true)
  await research(page, "research-jeju-yaksuteo-olle-market")
  await expect(page.getByTestId("place-service-actions")).toHaveCount(0)
  await expect(page.getByTestId("place-offer-open")).toHaveCount(0)
  await expect(page.getByTestId("place-reservation-open")).toHaveCount(0)
})

test("MW-UI mobile research actions remain readable and keyboard accessible without technology branding", async ({ page }, info) => {
  await enter(page, "jeju", 320, "ko", "dark")
  await research(page, "research-jeju-yaksuteo-olle-market")
  const actions = page.getByTestId("place-service-actions")
  await expect(actions).toBeVisible()
  expect(await actions.innerText()).not.toMatch(/OpenDID|OmniOne|Sui|OOKRW|ooKRW/)
  expect(await page.locator("html").evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
  const contrast = await new AxeBuilder({ page }).include('[data-testid="place-service-actions"]').withRules(["color-contrast"]).analyze()
  expect(contrast.violations).toEqual([])
  for (const button of await actions.getByRole("button").all()) {
    const box = await button.boundingBox()
    expect(box?.height).toBeGreaterThanOrEqual(44)
  }
  await page.screenshot({ path: info.outputPath("research-actions-320-ko-dark.png") })
})
