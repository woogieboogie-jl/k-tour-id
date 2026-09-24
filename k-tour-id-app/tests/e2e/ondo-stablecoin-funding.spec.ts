import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Locator, type Page } from "@playwright/test"
import { expectBRuntimeClean, installBRuntimeGuard } from "../helpers/ondo-b-qa"

test.beforeEach(({ page }) => installBRuntimeGuard(page))
test.afterEach(async ({ page }, testInfo) => { await expectBRuntimeClean(page, testInfo) })

const scenarios = [
  { width: 390, appearance: "dark", locale: "en", asset: "USDC", signer: "zklogin" },
  { width: 320, appearance: "light", locale: "ko", asset: "USDC", signer: "existing_wallet" },
  { width: 430, appearance: "dark", locale: "ja", asset: "USDT", signer: "existing_wallet" },
  { width: 1440, appearance: "light", locale: "en", asset: "USDT", signer: "existing_wallet" },
] as const
type Scenario = typeof scenarios[number]

async function identityAxes(page: Page) {
  return page.locator("[data-testid='traveler-id-account'], [data-testid='traveler-id-person'], [data-testid='traveler-id-age'], [data-testid='traveler-id-payment']").evaluateAll(nodes => nodes.map(node => ({
    axis: node.getAttribute("data-testid"), status: node.getAttribute("data-status"), review: node.getAttribute("data-review-result"),
  })))
}

async function enterDigitalDollar(page: Page, scenario: Scenario = scenarios[0], review = true) {
  await page.setViewportSize({ width: scenario.width, height: 900 })
  await page.emulateMedia({ colorScheme: scenario.appearance, reducedMotion: "reduce" })
  // Only ordinary device preferences: never inject claims, balances, callbacks,
  // wallet keys, or successful provider responses.
  await page.addInitScript(({ appearance, locale }) => localStorage.setItem("ondo-b.device.v1", JSON.stringify({ locale, appearancePreference: appearance, onboarding: "ONB-COMPLETE" })), scenario)
  await page.route("https://tiles.openfreemap.org/**", route => route.abort("blockedbyclient"))
  await page.goto(review ? "/?review=1" : "/?review=0", { waitUntil: "domcontentloaded" })
  await expect(page.locator("html")).toHaveAttribute("data-ondo-theme", scenario.appearance)
  await page.getByTestId("nav-id").click()
  const axes = await identityAxes(page)
  expect(axes).toHaveLength(4)
  const originalBalance = await page.getByTestId("wallet-display-equivalent").textContent()
  await page.getByTestId("wallet-funding-change").click()
  const sheet = page.getByTestId("funding-source-sheet")
  await sheet.locator("input[value='digital_dollar']").check()
  if (review) await sheet.getByTestId("funding-method-save").click()
  else {
    await expect(sheet.getByTestId("funding-method-save")).toBeDisabled()
    await expect(sheet.getByTestId("funding-provider-required")).toBeVisible()
    await expect(sheet.getByTestId("stablecoin-funding")).toHaveCount(0)
    await sheet.getByTestId("funding-sample-open").click()
  }
  const journey = sheet.getByTestId("funding-rail-journey")
  const stablecoin = sheet.getByTestId("stablecoin-funding")
  await expect(journey).toHaveAttribute("data-phase", "quoted")
  await expect(stablecoin).toHaveAttribute("data-stage", "quote")
  await expect(journey).toHaveAttribute("data-credit-committed", "false")
  await sheet.getByTestId(`stablecoin-asset-${scenario.asset}`).click()
  await sheet.getByTestId(`stablecoin-signer-${scenario.signer}`).click()
  return { sheet, journey, stablecoin, axes, originalBalance }
}

async function expectCleanSheet(page: Page, sheet: Locator) {
  expect(await sheet.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  const axe = await new AxeBuilder({ page }).include("[data-testid='funding-source-sheet']").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()
  expect(axe.violations.filter(({ impact }) => impact === "serious" || impact === "critical")).toEqual([])
}

async function approveSource(sheet: Locator) {
  await expect(sheet.getByTestId("funding-quote-continue")).toBeDisabled()
  await connectSigner(sheet)
  await expect(sheet.getByTestId("funding-quote-continue")).toBeEnabled()
  await sheet.getByTestId("funding-quote-continue").click()
  await expect(sheet.getByTestId("stablecoin-funding")).toHaveAttribute("data-stage", "authorization")
  await expect(sheet.getByTestId("funding-authorize")).toBeDisabled()
  await sheet.getByTestId("funding-consent").check()
  await sheet.getByTestId("funding-authorize").click()
  await expect(sheet.getByTestId("stablecoin-funding")).toHaveAttribute("data-stage", "source_pending")
}

async function connectSigner(sheet: Locator) {
  await sheet.getByTestId("stablecoin-connect").click()
  const preview = sheet.getByTestId("stablecoin-connection-preview")
  await expect(preview).toHaveAttribute("data-status", "waiting")
  await expect(preview).toContainText("Sui Testnet")
  await expect(sheet.getByTestId("funding-authorize")).toHaveCount(0)
  await preview.getByTestId("stablecoin-connection-approve").click()
  await expect(preview).toHaveCount(0)
}

async function operationId(page: Page) {
  return page.evaluate(() => JSON.parse(sessionStorage.getItem("ondo-b.funding-rail.v1") ?? "null")?.operationId as string | undefined)
}

for (const scenario of scenarios) test(`stablecoin source and destination stay separate: ${scenario.asset} ${scenario.width} ${scenario.appearance} ${scenario.locale}`, async ({ page }, testInfo) => {
  test.setTimeout(60_000)
  const { sheet, journey, stablecoin, axes, originalBalance } = await enterDigitalDollar(page, scenario)
  await expectCleanSheet(page, sheet)
  const name = `${scenario.width}-${scenario.appearance}-${scenario.locale}-${scenario.asset}`
  await sheet.screenshot({ path: testInfo.outputPath(`${name}-quote.png`) })
  await approveSource(sheet)
  const before = await operationId(page)
  expect(before).toBeTruthy()
  // A delay that used to auto-settle the generic USD rail must not settle a
  // stablecoin source transaction, let alone its separate destination credit.
  await page.waitForTimeout(1_200)
  await expect(stablecoin).toHaveAttribute("data-stage", "source_pending")
  await expect(journey).toHaveAttribute("data-credit-committed", "false")
  await expect(sheet.getByTestId("funding-receipt-balance")).toHaveCount(0)
  expect(await identityAxes(page)).toEqual(axes)

  await sheet.getByTestId("stablecoin-check-source").click()
  await expect(stablecoin).toHaveAttribute("data-stage", "destination_pending")
  await expect(journey).toHaveAttribute("data-credit-committed", "false")
  await expect(page.getByTestId("wallet-display-equivalent")).toHaveText(originalBalance ?? "")
  await expect(sheet.getByTestId("funding-receipt-balance")).toHaveCount(0)
  await sheet.locator(":scope > header button[data-funding-focus]").click()
  await expect(sheet).toHaveCount(0)
  await page.getByTestId("wallet-funding-change").click()
  await expect(journey).toHaveAttribute("data-phase", "unknown")
  await expect(stablecoin).toHaveAttribute("data-stage", "destination_pending")
  await expect(journey).toHaveAttribute("data-credit-committed", "false")
  await expect(sheet.getByTestId("funding-authorize")).toHaveCount(0)
  await expect(sheet.getByTestId("stablecoin-check-source")).toHaveCount(0)
  expect(await operationId(page)).toBe(before)

  // Duplicate delivery of the same destination-confirmation action must not
  // double-credit the single in-tab operation.
  await sheet.getByTestId("stablecoin-check-destination").evaluate(element => { (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click() })
  await expect(journey).toHaveAttribute("data-phase", "settled")
  await expect(journey).toHaveAttribute("data-credit-committed", "true")
  await expect(stablecoin).toHaveAttribute("data-stage", "settled")
  const receipt = sheet.getByTestId("stablecoin-receipt")
  const completionDetails = receipt.getByTestId("stablecoin-technical-details")
  await expect(completionDetails).toBeVisible()
  await completionDetails.locator("summary").click()
  await expect(sheet.getByTestId("funding-receipt-balance")).toHaveText("₩90,000")
  await expect(receipt).toBeVisible()
  await expect(receipt).toContainText(scenario.asset)
  await expect(receipt).toContainText(/Sample|샘플|サンプル/i)
  // Both assets are labelled Sui Testnet simulations, not assertions that a
  // native/wrapped asset or a production bridge is actually available.
  await expect(receipt).toContainText(/Sui Testnet/i)
  await expect(stablecoin).toContainText(/OmniOne/i)
  await expectCleanSheet(page, sheet)
  await sheet.screenshot({ path: testInfo.outputPath(`${name}-receipt.png`) })
  await sheet.getByTestId("funding-sample-use").click()
  await expect(sheet).toHaveCount(0)
  await expect(page.getByTestId("wallet-display-equivalent")).toHaveText("₩90,000")
  expect(await identityAxes(page)).toEqual(axes)
  await page.getByTestId("wallet-funding-change").click()
  await expect(sheet.getByTestId("funding-method-save")).toBeVisible()
  await expect(journey).toHaveCount(0)
  await expect(sheet.getByTestId("funding-receipt-balance")).toHaveCount(0)
  expect(await operationId(page)).toBe(before)
  await sheet.locator(":scope > header button").click()
  await expect(page.getByTestId("wallet-display-equivalent")).toHaveText("₩90,000")
  expect(await identityAxes(page)).toEqual(axes)
})

for (const failure of ["signer-failed", "signer-wrong_network", "source-empty"] as const) test(`stablecoin ${failure} cannot authorize or credit a top-up`, async ({ page }) => {
  const { sheet, journey, axes, originalBalance } = await enterDigitalDollar(page)
  if (failure === "source-empty") await connectSigner(sheet)
  const scenarioButton = sheet.getByTestId(`stablecoin-${failure}`)
  await scenarioButton.locator("xpath=ancestor::details").locator(":scope > summary").click()
  await scenarioButton.click()
  if (failure !== "source-empty") await connectSigner(sheet)
  await expect(journey).toHaveAttribute("data-phase", "quoted")
  await expect(journey).toHaveAttribute("data-credit-committed", "false")
  await expect(sheet.getByTestId("funding-quote-continue")).toBeDisabled()
  await expect(sheet.getByTestId("funding-authorize")).toHaveCount(0)
  await expect(sheet.getByTestId("funding-receipt-balance")).toHaveCount(0)
  expect(await identityAxes(page)).toEqual(axes)
  await expect(page.getByTestId("wallet-display-equivalent")).toHaveText(originalBalance ?? "")
})

test("changing the selected signer requires reconnecting that signer before review", async ({ page }) => {
  const { sheet, journey } = await enterDigitalDollar(page)
  await connectSigner(sheet)
  await expect(sheet.getByTestId("funding-quote-continue")).toBeEnabled()
  await sheet.getByTestId("stablecoin-signer-existing_wallet").click()
  await expect(sheet.getByTestId("funding-quote-continue")).toBeDisabled()
  await connectSigner(sheet)
  await expect(sheet.getByTestId("funding-quote-continue")).toBeEnabled()
  await expect(journey).toHaveAttribute("data-credit-committed", "false")
})

test("provider inspection requires explicit stablecoin sample entry before any quote or approval", async ({ page }) => {
  const { sheet, journey, axes } = await enterDigitalDollar(page, scenarios[0], false)
  await expect(sheet.getByTestId("funding-quote-continue")).toBeDisabled()
  await approveSource(sheet)
  await expect(journey).toHaveAttribute("data-credit-committed", "false")
  await sheet.getByTestId("stablecoin-check-source").click()
  await expect(journey).toHaveAttribute("data-credit-committed", "false")
  await sheet.getByTestId("stablecoin-check-destination").click()
  await expect(sheet.getByTestId("funding-receipt-balance")).toHaveText("₩90,000")
  expect(await identityAxes(page)).toEqual(axes)
})

test("reselecting the same amount preserves the quote and connected signer", async ({ page }) => {
  const { sheet, journey } = await enterDigitalDollar(page)
  await connectSigner(sheet)
  await expect(sheet.getByTestId("funding-quote-continue")).toBeEnabled()
  const quoteId = () => page.evaluate(() => JSON.parse(sessionStorage.getItem("ondo-b.funding-rail.v1") ?? "null")?.quote.quoteId as string | undefined)
  const before = await quoteId()
  expect(before).toBeTruthy()
  for (let click = 0; click < 10; click++) await sheet.getByTestId("funding-amount-30000").click()
  expect(await quoteId()).toBe(before)
  await expect(sheet.getByTestId("funding-quote-continue")).toBeEnabled()
  await expect(journey).toHaveAttribute("data-phase", "quoted")
  await expect(journey).toHaveAttribute("data-credit-committed", "false")
})
