import { expect, test, type Page } from "@playwright/test"

const unexpectedRequests = new WeakMap<Page, string[]>()
const runtimeErrors = new WeakMap<Page, string[]>()

test.describe.configure({ mode: "serial", timeout: 90_000 })
test.beforeEach(async ({ page }) => {
  unexpectedRequests.set(page, [])
  runtimeErrors.set(page, [])
  page.on("pageerror", error => runtimeErrors.get(page)!.push(error.stack ?? error.message))
  await page.route("**/*", async route => {
    const request = route.request()
    const url = new URL(request.url())
    const externalMutation = !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && !["GET", "HEAD", "OPTIONS"].includes(request.method())
    if (externalMutation || /sumsub|onfido|omni.?one|opendid|fullnode|sui\.io|walletconnect|stripe/i.test(url.hostname)) {
      unexpectedRequests.get(page)!.push(`${request.method()} ${url.origin}`)
      await route.abort("blockedbyclient")
      return
    }
    await route.continue()
  })
})

test.afterEach(({ page }) => {
  expect(unexpectedRequests.get(page) ?? []).toEqual([])
  expect(runtimeErrors.get(page) ?? []).toEqual([])
})

for (const [locale, appearance, width] of [["en", "light", 390], ["ko", "light", 390], ["en", "dark", 430]] as const) {
  test(`JOURNEY focused keepsake completes public sample and returns to collection ${locale} ${appearance}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 })
    // Device preferences only. Account, Person, visit receipts, badge consent,
    // and sample signer must all be reached through visible product controls.
    await page.addInitScript(({ locale, appearance }) => {
      if (!["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) return
      localStorage.setItem("ondo-b.device.v1", JSON.stringify({ locale, appearancePreference: appearance, onboarding: "ONB-COMPLETE" }))
    }, { locale, appearance })
    await page.goto("/?review=1", { waitUntil: "domcontentloaded" })
    await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true")
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
    const passCard = page.getByTestId("ondo-b-stamp-milestone")
    await expect(passCard).toHaveAttribute("data-stamps", "10")
    await passCard.getByTestId("journey-stamps-open").click()
    const collection = page.getByTestId("journey-stamps-collection")
    await expect(collection.getByTestId("journey-stamp-row")).toHaveCount(10)
    const opener = collection.getByTestId("journey-stamps-keepsake")
    await opener.click()
    const keepsake = page.getByTestId("journey-keepsake-overlay")
    await expect(keepsake).toBeVisible()
    await expect(keepsake.getByTestId("labs-bridge-quote")).toHaveCount(0)
    await expect(keepsake.getByTestId("labs-consumer-balances")).toHaveCount(0)
    await expect(keepsake.getByTestId("labs-badge-mint")).toBeDisabled()
    await page.screenshot({ path: info.outputPath(`focused-begin-${locale}.png`), scale: "css" })

    await keepsake.getByTestId("labs-connect-wallet").click()
    await expect(keepsake).toHaveAttribute("data-wallet-state", "WAL-READY")
    await keepsake.getByRole("checkbox").check()
    await keepsake.getByTestId("labs-badge-mint").click()
    const gate = page.getByTestId("ondo-b-action-gate")
    await expect(gate).toHaveAttribute("data-return-cta", "MINT_BADGE")
    // The badge contract requires Person only: no Account, 19+, payment or
    // credential presentation is inferred from this optional preview.
    await expect(gate).toHaveAttribute("data-active-gate", "person")
    await page.screenshot({ path: info.outputPath(`focused-person-${locale}.png`), scale: "css" })
    await gate.getByTestId("person-route-choice-mobile_id_cx").click()
    await gate.getByTestId("local-check-boundary-continue").click()
    await expect(gate).toHaveCount(0)

    await expect(keepsake).toHaveAttribute("data-mint-state", "NFT-MINTED")
    const result = keepsake.getByTestId("labs-badge-result")
    await expect(result).toHaveAttribute("data-review-provenance", "simulated")
    await expect(result).toContainText(locale === "ko" ? "공개된 내용은 없습니다" : "Nothing was published")
    await expect(result).toBeFocused()
    await expect(keepsake.getByTestId("labs-bridge-quote")).toHaveCount(0)
    expect(await keepsake.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
    expect(await page.locator("html").evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
    if (appearance === "dark") {
      const surfaces = await keepsake.evaluate(node => ({
        body: getComputedStyle(node).backgroundColor,
        header: getComputedStyle(node.querySelector(":scope > header")!).backgroundColor,
        sheet: getComputedStyle(node.closest('[data-testid="ondo-sheet"]')!).backgroundColor,
      }))
      expect(surfaces.body, "R8: completed body and remaining sheet use one surface").toBe(surfaces.sheet)
      expect(surfaces.header, "R8: sticky header does not reintroduce a dark horizontal band").toBe(surfaces.sheet)
    }
    await page.screenshot({ path: info.outputPath(`focused-result-${locale}.png`), scale: "css" })

    await expect(keepsake.getByTestId("labs-connect-wallet")).toHaveCount(0)
    await keepsake.getByTestId("journey-keepsake-done").click()
    await expect(keepsake).toHaveCount(0)
    await expect(collection).toHaveAttribute("data-stamps", "10")
    await expect(collection.getByTestId("journey-stamp-row")).toHaveCount(10)
    await expect(opener).toBeFocused()
    await page.waitForTimeout(400)
    await expect(opener).toBeFocused()
    await page.screenshot({ path: info.outputPath(`focused-return-${locale}.png`), scale: "css" })
    await page.keyboard.press("Escape")
    await expect(collection).toHaveCount(0)
    await expect(passCard).toHaveAttribute("data-stamps", "10")
    await expect(passCard.getByTestId("journey-stamps-open")).toBeFocused()
  })
}
