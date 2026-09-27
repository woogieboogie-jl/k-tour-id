import { expect, test } from "@playwright/test"

test.use({ deviceScaleFactor: 1, video: "off", trace: "off" })
test.setTimeout(60_000)

for (const theme of ["light", "dark"] as const) {
  for (const size of [{ width: 390, height: 844 }, { width: 360, height: 600 }]) {
    test(`story reader ${theme} ${size.width}x${size.height} clips its map surface, not its list`, async ({ page }, testInfo) => {
      await page.setViewportSize(size)
      await page.addInitScript(theme => localStorage.setItem("ondo-b.device.v1", JSON.stringify({ locale: "en", appearancePreference: theme, onboarding: "ONB-COMPLETE" })), theme)
      await page.goto("/?city=busan&collection=busan-market", { waitUntil: "domcontentloaded" })
      await expect(page.getByTestId("maplibre-map")).toHaveAttribute("data-map-state", "ready", { timeout: 30_000 })
      await page.getByTestId("map-discovery-read-toggle").click()
      const panel = page.getByTestId("map-discovery-results")
      await expect(panel).toHaveAttribute("data-reading", "true")
      const geometry = await panel.evaluate(e => {
        const style = getComputedStyle(e)
        return { clip: style.clipPath, radius: style.borderTopLeftRadius, scrollable: e.scrollHeight > e.clientHeight }
      })
      expect(geometry.clip).toBe(`inset(0px round ${geometry.radius})`)
      expect(geometry.scrollable).toBe(true)
      // Canvas must remain present: hiding it can conceal this paint defect.
      await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath("reader-top.png") })
      await panel.evaluate(e => { e.scrollTop = e.scrollHeight })
      await expect(panel.locator("a").last()).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath("reader-scrolled.png") })
      await page.getByTestId("ondo-b-view-toggle").click()
      await expect(panel).toHaveAttribute("data-layout", "list")
      expect(await panel.evaluate(e => getComputedStyle(e).clipPath)).toBe("none")
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    })
  }
}
