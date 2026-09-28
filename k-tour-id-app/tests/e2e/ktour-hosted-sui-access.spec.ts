import { expect, HARVEY_VENUE, test } from "./helpers/harvey-fixture"

// Presentation fixtures only; every provider/BFF response intercepted.
for (const [locale, width, height, appearance] of [
  ["ko", 320, 640, "light"], ["en", 390, 844, "light"],
  ["ja", 390, 844, "dark"], ["en", 844, 390, "dark"],
] as const) test(`hosted Sui access and consent remain separate: ${locale}/${width}/${appearance}`, async ({ page, harvey }, info) => {
  await page.setViewportSize({ width, height })
  await harvey.preferences(locale, appearance)
  Object.assign(harvey.config, { isolatedMock: false, hostedSui: true })
  harvey.config.sui.network = "testnet"
  harvey.config.modes.sui = "testnet"
  let granted = false, accesses = 0
  await page.context().route("**/api/hackathon/v1/config", async route => {
    if (!granted) return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { code: "hosted_sui_access_denied", message: "Enter the journey access code." } }) })
    return route.fallback()
  })
  await page.context().route("**/api/hackathon/v1/hosted/access", route => {
    accesses++; granted = true
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) })
  })
  await page.goto(`/?venueId=${HARVEY_VENUE}&review=0`, { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true")
  await page.getByTestId("canonical-place-details").click()
  await page.getByTestId("hackathon-entitlement-open").click()
  const gate = page.getByTestId("integration-preview-access")
  await expect(gate).toBeVisible()
  await expect(page.getByTestId("integration-preview-access-submit")).toBeDisabled()
  expect(harvey.count("/operations")).toBe(0)
  await page.getByTestId("integration-preview-access-code").fill("synthetic_fixture_only_0123456789abcdef")
  expect(await gate.evaluate(n => n.scrollWidth <= n.clientWidth + 1)).toBe(true)
  await page.getByTestId("integration-preview-access-submit").click()
  await expect(gate).toHaveCount(0)
  await expect(page.getByTestId("hackathon-layer")).toHaveAttribute("data-phase", "consent")
  await expect(page.locator("#hk-consent")).not.toBeChecked()
  await expect(page.getByTestId("hackathon-start")).toBeDisabled()
  expect(harvey.count("/operations")).toBe(0)
  expect(accesses).toBe(1)
  expect(await page.locator("html").evaluate(n => n.scrollWidth <= n.clientWidth + 1)).toBe(true)
  await page.screenshot({ path: info.outputPath("hosted-consent-fixture.png"), scale: "css" })
  await page.getByTestId("hackathon-close").click()
  await expect(page.getByTestId("canonical-place-overlay")).toHaveAttribute("data-venue-id", HARVEY_VENUE)
  await expect(page.getByTestId("hackathon-entitlement-open")).toBeFocused()
})
