import { expect, test, type Locator, type Page } from "@playwright/test"

// Geometry/hit tests cannot see a composited header painting outside a rounded
// sheet. Compare those pixels with the same frame while only chrome is hidden:
// the sheet, shadow, backdrop, underlying scene and layout must remain intact.
async function cornerPaint(page: Page, sheet: Locator, label: string, outputPath: (name: string) => string) {
  const header = sheet.locator("[data-sheet-header]")
  await expect(header).toBeVisible()
  const box = (await sheet.boundingBox())!
  const radius = await sheet.evaluate(node => parseFloat(getComputedStyle(node).borderTopLeftRadius))
  expect(radius).toBeGreaterThan(16)
  const clip = { x: box.x, y: box.y, width: box.width, height: Math.min(88, box.height) }
  const painted = await page.screenshot({ clip, scale: "css", animations: "disabled", path: outputPath(`${label}-corners.png`) })
  const oldVisibility = await header.evaluate(node => { const before = node.style.visibility; node.style.visibility = "hidden"; return before })
  let baseline: Buffer
  try { baseline = await page.screenshot({ clip, scale: "css", animations: "disabled" }) }
  finally { await header.evaluate((node, value) => { node.style.visibility = value }, oldVisibility) }
  const delta = await page.evaluate(async ({ painted, baseline }) => {
    async function pixels(value: string) {
      const img = new Image()
      img.src = `data:image/png;base64,${value}`
      await img.decode()
      const canvas = document.createElement("canvas")
      canvas.width = img.width; canvas.height = img.height
      const ctx = canvas.getContext("2d")!
      ctx.drawImage(img, 0, 0)
      return { width: img.width, data: ctx.getImageData(0, 0, img.width, img.height).data }
    }
    const a = await pixels(painted), b = await pixels(baseline)
    // These 3x3 patches sit outside a >=24px circular cutout, away from the
    // border's antialiasing. Test BOTH corners, not the much larger white body.
    return ["left", "right"].map(side => {
      let maximum = 0
      for (let y = 3; y <= 5; y++) for (let x = 3; x <= 5; x++) {
        const column = side === "left" ? x : a.width - 1 - x
        const i = (y * a.width + column) * 4
        for (let c = 0; c < 3; c++) maximum = Math.max(maximum, Math.abs(a.data[i + c] - b.data[i + c]))
      }
      return { side, maximum }
    })
  }, { painted: painted.toString("base64"), baseline: baseline!.toString("base64") })
  for (const corner of delta) expect(corner.maximum, `${label} ${corner.side}: square chrome must not paint into rounded cutout`).toBeLessThanOrEqual(12)
}

for (const width of [320, 390, 820, 1440]) for (const appearance of ["light", "dark"] as const) {
  test(`SHEET corner paint ${width} ${appearance}`, async ({ page }, info) => {
    test.skip((width < 700) !== (info.project.name === "mobile-chromium"), "Match mobile/desktop context")
    await page.setViewportSize({ width, height: width === 320 ? 568 : width === 390 ? 844 : 1000 })
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.addInitScript(appearance => localStorage.setItem("ondo-b.device.v1", JSON.stringify({ locale: "en", appearancePreference: appearance, onboarding: "ONB-COMPLETE" })), appearance)
    await page.goto("/?venueId=mois-0021cd596bc5b2a922ad&review=1", { waitUntil: "domcontentloaded" })
    await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true")
    await page.getByTestId("canonical-place-details").click()
    await page.getByTestId("canonical-journey-open").click()
    const visit = page.getByTestId("journey-visit-sheet")
    const sheet = visit.locator('xpath=ancestor::*[@data-testid="ondo-sheet"][1]')
    await expect(visit).toBeVisible()
    await page.waitForTimeout(400)
    await cornerPaint(page, sheet, "visit", name => info.outputPath(name))
    await visit.getByTestId("visit-proof-check").click()
    await expect(visit).toHaveAttribute("data-recorded", "true")
    await page.waitForTimeout(400)
    await cornerPaint(page, sheet, "saved", name => info.outputPath(name))
    await page.getByTestId("journey-visit-pass").click()
    const collection = page.getByTestId("journey-stamps-collection")
    await expect(collection).toBeVisible()
    await page.waitForTimeout(400)
    await cornerPaint(page, collection.locator('xpath=ancestor::*[@data-testid="ondo-sheet"][1]'), "collection", name => info.outputPath(name))
  })
}
