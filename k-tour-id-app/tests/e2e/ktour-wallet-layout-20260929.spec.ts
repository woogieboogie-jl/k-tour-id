import { expect, test, type Page } from "@playwright/test"

test.describe.configure({ timeout: 60_000 })
test.use({ serviceWorkers: "block" })

async function prepare(page: Page, locale: "ko" | "en" | "ja", theme: "light" | "dark", origin: string) {
  await page.route("**/*", route => {
    const request = route.request(), url = new URL(request.url())
    // UI fixtures cannot contact providers, mutate a server or sign a journey.
    const localRead = url.origin === origin && ["GET", "HEAD"].includes(request.method())
      && (!url.pathname.startsWith("/api/") || url.pathname === "/api/hackathon/v1/config" || url.pathname.startsWith("/api/ondo/venues/"))
    return localRead ? route.continue() : route.abort("blockedbyclient")
  })
  await page.addInitScript(({ locale, theme }) => {
    localStorage.setItem("ondo-b.device.v1", JSON.stringify({ locale, appearancePreference: theme, onboarding: "ONB-COMPLETE", discoveryPreferences: [], savedVenueIds: [], privateNotesByVenue: {} }))
  }, { locale, theme })
  await page.goto("/?city=seoul", { waitUntil: "domcontentloaded" })
  await page.getByTestId("nav-id").click()
  await expect(page.getByTestId("travel-pass-card")).toBeVisible()
  await expect(page.locator("html")).toHaveAttribute("data-ondo-theme", theme)
  // Geometry concerns the settled layout, not the temporary 10px card entry
  // transform. Keep the real animation enabled and await only finite effects.
  await page.evaluate(() => document.fonts.ready)
  await page.getByTestId("travel-pass-card").evaluate(async node => {
    await Promise.all(node.getAnimations({ subtree: true })
      .filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime))
      .map(animation => animation.finished.catch(() => undefined)))
  })
}

async function boundedGuide(page: Page, viewportWidth: number) {
  const guide = page.getByTestId("product-guide")
  await expect(guide).toBeVisible()
  const geometry = await guide.evaluate(node => {
    const bounds = node.getBoundingClientRect()
    return { left: bounds.left, right: bounds.right, overflow: node.scrollWidth - node.clientWidth,
      buttons: [...node.querySelectorAll<HTMLButtonElement>("button")].filter(button => button.getClientRects().length > 0).map(button => {
        const rect = button.getBoundingClientRect()
        return { left: rect.left, right: rect.right, width: rect.width, height: rect.height, overflow: button.scrollWidth - button.clientWidth }
      }) }
  })
  expect(geometry.left).toBeGreaterThanOrEqual(0)
  expect(geometry.right).toBeLessThanOrEqual(viewportWidth + 1)
  expect(geometry.overflow).toBeLessThanOrEqual(1)
  for (const button of geometry.buttons) {
    expect(button.height).toBeGreaterThanOrEqual(44)
    expect(button.width).toBeGreaterThanOrEqual(44)
    expect(button.left).toBeGreaterThanOrEqual(geometry.left)
    expect(button.right).toBeLessThanOrEqual(geometry.right + 1)
    expect(button.overflow).toBeLessThanOrEqual(1)
  }
}

for (const width of [320, 390, 1440, 1920]) for (const locale of ["ko", "en", "ja"] as const) for (const theme of ["light", "dark"] as const) {
  test(`wallet and guide ${width}px ${locale} ${theme}`, async ({ page, baseURL }, info) => {
    await page.setViewportSize({ width, height: width < 700 ? 844 : 1080 })
    await prepare(page, locale, theme, new URL(baseURL!).origin)
    const screen = page.getByTestId("ondo-b-traveler-id")
    const title = screen.locator("h1")
    const pass = page.getByTestId("travel-pass-card")
    const wallet = page.getByTestId("ondo-b-id-wallet-commerce")
    const [titleBox, passBox, walletBox] = await Promise.all([title.boundingBox(), pass.boundingBox(), wallet.boundingBox()])
    expect(passBox!.y - (titleBox!.y + titleBox!.height), "pass must follow its title, not the height of the wallet column").toBeLessThanOrEqual(36)
    expect(await screen.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1)
    expect(await wallet.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1)
    if (width >= 900) {
      expect(walletBox!.x).toBeGreaterThan(passBox!.x + passBox!.width)
      const titleLines = await title.evaluate(node => {
        const range = document.createRange(); range.selectNodeContents(node)
        return range.getClientRects().length
      })
      expect(titleLines, "desktop title should not break because a Demo chip takes its width").toBe(1)
    }
    await page.screenshot({ path: info.outputPath("wallet.png") })
    if (width < 700) {
      await page.getByTestId("wallet-balance").scrollIntoViewIfNeeded()
      await page.screenshot({ path: info.outputPath("wallet-balance.png") })
    }
    const opener = screen.getByTestId("review-sample-indicator")
    await expect(opener).not.toContainText(/demo|sample|데모|샘플|デモ|サンプル/i)
    await opener.click()
    await boundedGuide(page, width)
    await expect(page.getByTestId("product-guide")).not.toContainText(/Try the whole journey|Map activity, travel balance|지도 활동·여행 잔액/)
    await page.screenshot({ path: info.outputPath("guide.png") })
    await page.getByTestId("product-guide-connection").locator("summary").click()
    await expect(page.getByTestId("product-guide-connection")).toContainText(locale === "ko" ? "실제 주문이나 자금 이동이 없습니다" : locale === "ja" ? "実際の注文や資金移動はありません" : "no order or funds move")
    await boundedGuide(page, width)
    await page.keyboard.press("Escape")
    await expect(page.getByTestId("product-guide")).toBeHidden()
    await expect(opener).toBeFocused()
  })
}

test("320px Japanese large text keeps guide actions readable and scrollable", async ({ page, baseURL }, info) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await prepare(page, "ja", "dark", new URL(baseURL!).origin)
  await page.getByTestId("ondo-b-traveler-id").getByTestId("review-sample-indicator").click()
  await page.addStyleTag({ content: '[data-testid="product-guide"] :is(p,button,summary) { font-size: 22px !important; line-height: 1.7 !important; }' })
  await page.getByTestId("product-guide-connection").locator("summary").click()
  await boundedGuide(page, 320)
  const last = page.getByTestId("product-guide-connection").getByRole("button")
  await last.scrollIntoViewIfNeeded()
  const lastBox = await last.boundingBox()
  expect(lastBox!.y).toBeGreaterThanOrEqual(0)
  expect(lastBox!.y + lastBox!.height).toBeLessThanOrEqual(568)
  await page.screenshot({ path: info.outputPath("guide-large-text.png") })
})
