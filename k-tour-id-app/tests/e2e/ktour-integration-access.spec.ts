import { expect, HARVEY_VENUE, test } from "./helpers/harvey-fixture"

// Presentation-only access fixture. All BFF/provider requests are intercepted;
// no real session, identity, key, proof or chain transaction is created.
const FIXTURE_CODE = "fixture_access_code_not_a_real_secret_20260928"
const gateId = "integration-preview-access"

for (const [locale, width, height, appearance] of [
  ["ko", 320, 640, "light"], ["en", 390, 844, "light"],
  ["ja", 390, 844, "dark"], ["en", 844, 390, "dark"],
] as const) test(`private access stays separate from identity consent: ${locale}/${width}/${appearance}`, async ({ page, harvey }, info) => {
  await page.setViewportSize({ width, height })
  await harvey.preferences(locale, appearance)
  harvey.config.isolatedMock = false
  harvey.config.modes.cx = "cx"
  harvey.config.modes.opendid = "opendid"
  let granted = false, attempts = 0
  await page.context().route("**/api/hackathon/v1/config", async route => {
    if (!granted) return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { code: "integration_preview_access_denied", message: "Private access required", retryable: false } }) })
    return route.fallback()
  })
  await page.context().route("**/api/hackathon/v1/integration/access", async route => {
    attempts++
    granted = route.request().postDataJSON()?.accessCode === FIXTURE_CODE
    return route.fulfill({ status: granted ? 200 : 401, contentType: "application/json", body: JSON.stringify(granted ? { ok: true } : { error: { code: "integration_preview_access_denied", message: "Access denied", retryable: false } }) })
  })
  await page.goto(`/?venueId=${HARVEY_VENUE}&review=0`, { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true")
  await page.getByTestId("canonical-place-details").click()
  await page.getByTestId("hackathon-entitlement-open").click()
  const gate = page.getByTestId(gateId)
  await expect(gate).toBeVisible()
  await expect(page.getByTestId("hackathon-start")).toHaveCount(0)
  expect(harvey.count("/operations")).toBe(0)
  await expect(page.getByTestId("integration-preview-access-submit")).toBeDisabled()
  await page.getByTestId("integration-preview-access-code").fill("wrong_fixture_code_not_real_20260928")
  await page.getByTestId("integration-preview-access-submit").click()
  await expect.poll(() => attempts).toBe(1)
  await expect(gate).toBeVisible()
  await page.getByTestId("integration-preview-access-code").fill(FIXTURE_CODE)
  await page.screenshot({ path: info.outputPath("private-access-form.png"), scale: "css" })
  expect(await gate.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
  expect(await page.locator("html").evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
  const box = await page.getByTestId("integration-preview-access-submit").boundingBox()
  expect(box).not.toBeNull()
  expect(box!.width).toBeGreaterThanOrEqual(44)
  expect(box!.height).toBeGreaterThanOrEqual(44)
  await page.getByTestId("integration-preview-access-submit").click()
  await expect(gate).toHaveCount(0)
  await expect(page.getByTestId("hackathon-layer")).toHaveAttribute("data-phase", "consent")
  await expect(page.locator("#hk-consent")).not.toBeChecked()
  await expect(page.getByTestId("hackathon-start")).toBeDisabled()
  expect(harvey.count("/operations")).toBe(0)
  expect(attempts).toBe(2)
  await page.getByTestId("hackathon-close").click()
  await expect(page.getByTestId("canonical-place-overlay")).toHaveAttribute("data-venue-id", HARVEY_VENUE)
  await expect(page.getByTestId("hackathon-entitlement-open")).toBeFocused()
})

test("disabled integration cannot become a journey or create an operation", async ({ page, harvey }) => {
  await harvey.preferences("en")
  await page.context().route("**/api/hackathon/v1/config", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "integration_preview_unavailable", message: "Unavailable", retryable: true } }) }))
  await page.goto(`/?venueId=${HARVEY_VENUE}&review=0`, { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true")
  await page.getByTestId("canonical-place-details").click()
  await page.getByTestId("hackathon-entitlement-open").click()
  await expect(page.getByTestId(gateId)).toBeVisible()
  await expect(page.getByTestId("hackathon-start")).toHaveCount(0)
  expect(harvey.count("/operations")).toBe(0)
})
