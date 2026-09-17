import { expect, test, type Locator, type Page } from "@playwright/test"

// R4 regression. One footer owns edge/safe-area padding; nested action groups
// must not add another inset. No identity/payment state is injected.
const PLACE = "mois-0021cd596bc5b2a922ad"

async function aligned(page: Page, content: Locator, action: Locator, expectedInset: number) {
  const sheet = content.locator('xpath=ancestor::*[@data-testid="ondo-sheet"][1]')
  const bodyLine = await content.evaluate(node => node.getBoundingClientRect().left + parseFloat(getComputedStyle(node).paddingLeft))
  const panel = await sheet.boundingBox(), control = await action.boundingBox()
  expect(panel).not.toBeNull(); expect(control).not.toBeNull()
  expect(Math.abs(control!.x - bodyLine), "CTA and main body share their left grid line").toBeLessThanOrEqual(1)
  expect(Math.abs(control!.x - panel!.x - expectedInset - 1)).toBeLessThanOrEqual(1)
  expect(Math.abs(panel!.x + panel!.width - control!.x - control!.width - expectedInset - 1)).toBeLessThanOrEqual(1)
  expect(control!.height).toBeGreaterThanOrEqual(52)
  expect(control!.y + control!.height).toBeLessThanOrEqual(page.viewportSize()!.height)
  expect(await action.evaluate(node => { const b = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)) })).toBe(true)
  expect(await sheet.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
}

for (const viewport of [{ width: 320, height: 568 }, { width: 820, height: 390 }]) {
  test(`R4 shared settings and service footers stay reachable ${viewport.width}`, async ({ page, baseURL }, info) => {
    test.skip(info.project.name !== "mobile-chromium")
    const failures: string[] = []
    page.on("pageerror", error => failures.push(error.message))
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url())
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method()) || /sumsub|onfido|omni.?one|opendid|fullnode|sui\.io|walletconnect|stripe/i.test(url.hostname)) {
        failures.push(`${request.method()} ${url.origin}`); return route.abort("blockedbyclient")
      }
      return route.continue()
    })
    await page.setViewportSize(viewport)
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.addInitScript(origin => {
      if (location.origin !== origin) return
      localStorage.setItem("ondo-b.device.v1", JSON.stringify({ locale: "en", appearancePreference: "dark", onboarding: "ONB-COMPLETE" }))
    }, new URL(baseURL ?? "http://127.0.0.1:3112").origin)
    await page.goto("/?review=1", { waitUntil: "domcontentloaded" })
    await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true")
    async function reachable(control: Locator) {
      const rect = await control.boundingBox()
      expect(rect).not.toBeNull()
      expect(rect!.height).toBeGreaterThanOrEqual(44)
      expect(rect!.x).toBeGreaterThanOrEqual(0)
      expect(rect!.y).toBeGreaterThanOrEqual(0)
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(viewport.width)
      expect(rect!.y + rect!.height).toBeLessThanOrEqual(viewport.height)
      expect(await control.evaluate(node => { const b = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)) })).toBe(true)
    }
    await page.getByTestId("nav-settings").click()
    await page.getByTestId("ondo-b-discovery-settings").click()
    await page.getByTestId("settings-preference-cafe").click()
    await reachable(page.getByTestId("settings-preferences-save"))
    await page.getByTestId("settings-preferences-save").click()
    await expect(page.getByTestId("settings-preferences-save")).toHaveCount(0)
    await expect(page.getByTestId("ondo-b-discovery-settings")).toBeFocused()
    await page.getByTestId("ondo-b-device-data-settings").click()
    await page.getByTestId("ondo-b-clear-device-open").click()
    const keep = page.locator("[data-settings-keep]")
    await reachable(keep)
    await reachable(keep.locator("xpath=following-sibling::button"))
    await page.screenshot({ path: info.outputPath("settings-delete-decision.png"), scale: "css" })
    // Never execute deletion: verify the safe return preserves the public draft save.
    await keep.click()
    await expect(page.getByTestId("ondo-b-clear-device-confirm")).toHaveCount(0)
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ondo-b.device.v1") ?? "{}").discoveryPreferences)).toContain("cafe")
    await page.getByTestId("account-services-open").click()
    await reachable(page.getByTestId("account-services-submit"))
    await page.getByTestId("account-services-outcome").locator("xpath=ancestor::details/summary").click()
    await page.getByTestId("account-services-outcome").selectOption("unknown")
    await page.getByTestId("account-services-submit").click()
    await expect(page.getByTestId("account-services-sample")).toHaveAttribute("data-phase", "unknown")
    const operation = await page.getByTestId("account-services-sample").getAttribute("data-operation-id")
    await reachable(page.getByTestId("account-services-submit"))
    await page.getByTestId("account-services-submit").click()
    await expect(page.getByTestId("account-services-sample")).toHaveAttribute("data-phase", "done")
    await expect(page.getByTestId("account-services-sample")).toHaveAttribute("data-operation-id", operation!)
    await page.keyboard.press("Escape")
    await expect(page.getByTestId("account-services-open")).toBeFocused()
    expect(failures).toEqual([])
  })
}

for (const [width, locale, appearance] of [[320, "ja", "dark"], [390, "en", "light"], [430, "ko", "dark"]] as const) {
  test(`R4 footer single inset ${locale} ${width}`, async ({ page, baseURL }, info) => {
    test.skip(info.project.name !== "mobile-chromium")
    const failures: string[] = []
    page.on("pageerror", error => failures.push(error.message))
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url())
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method()) || /sumsub|onfido|omni.?one|opendid|fullnode|sui\.io|walletconnect|stripe/i.test(url.hostname)) {
        failures.push(`${request.method()} ${url.origin}`); return route.abort("blockedbyclient")
      }
      return route.continue()
    })
    await page.setViewportSize({ width, height: 760 })
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.addInitScript(({ origin, locale, appearance }) => {
      if (location.origin !== origin) return
      localStorage.setItem("ondo-b.device.v1", JSON.stringify({ locale, appearancePreference: appearance, onboarding: "ONB-COMPLETE" }))
    }, { origin: new URL(baseURL ?? "http://127.0.0.1:3112").origin, locale, appearance })
    await page.goto("/?city=seoul&review=1", { waitUntil: "domcontentloaded" })
    await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true")
    await page.getByTestId("ondo-b-map-options-open").click()
    await aligned(page, page.getByTestId("ondo-b-map-options"), page.getByTestId("ondo-b-map-options-done"), width <= 360 ? 16 : 20)
    await page.screenshot({ path: info.outputPath("map-options.png"), scale: "css" })
    await page.getByTestId("ondo-b-map-options-done").click()
    await expect(page.getByTestId("ondo-b-map-options-open")).toBeFocused()
    await page.goto(`/?venueId=${PLACE}&review=1`, { waitUntil: "domcontentloaded" })
    await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true")
    await page.getByTestId("canonical-place-details").click()
    await page.getByTestId("experience-open").click()
    await aligned(page, page.getByTestId("experience-public-guide"), page.getByTestId("experience-add-to-pass"), width <= 360 ? 16 : 20)
    const details = page.getByTestId("experience-public-details").locator(":scope > summary")
    await details.scrollIntoViewIfNeeded()
    const last = await details.boundingBox()
    const footer = await page.getByTestId("experience-public-guide").locator('xpath=ancestor::*[@data-testid="ondo-sheet"][1]').locator("[data-sheet-footer]").boundingBox()
    expect(last!.y + last!.height).toBeLessThanOrEqual(footer!.y + 1)
    await page.screenshot({ path: info.outputPath("guide-footer.png"), scale: "css" })
    await page.keyboard.press("Escape")
    await expect(page.getByTestId("canonical-place-overlay")).toHaveAttribute("data-venue-id", PLACE)
    expect(failures).toEqual([])
  })
}
