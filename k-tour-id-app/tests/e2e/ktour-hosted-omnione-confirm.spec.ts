import { expect, HARVEY_VENUE, HARVEY_CAMPAIGN, test } from "./helpers/harvey-fixture"
import { fixture } from "../hackathon/fixtures/hosted-omnione.fixture"
import type { OperationResult } from "../../lib/hackathon/types"

// Requires a local build/dev server with NEXT_PUBLIC_HK_HOSTED_SUI=1.
// All BFF/provider calls are presentation fixtures: no real identity/chain data.
const ID = "browser-fixture-operation-1", PENDING = "ondo-b.hackathon.pending.v1"
function pendingOperation(bound = true): OperationResult {
  const { op } = fixture()
  return { ...op, operationId: ID, venueId: HARVEY_VENUE, campaignId: HARVEY_CAMPAIGN,
    hostedTestRedemption: bound, status: "pending", phase: "fulfillment", allowedActions: bound ? ["redeem", "reconcile", "return"] : ["check_status", "return"],
    chain: null, fulfillment: { status: "pending", reason: "authorization_consumed", redemptionRef: null, redeemedAt: null, recheck: null } }
}
for (const [locale, width, height, theme] of [["ko", 320, 640, "light"], ["ja", 390, 844, "dark"], ["en", 1440, 1000, "light"]] as const) {
  test(`connected hosted confirmation is explicit and survives close: ${locale}/${width}`, async ({ page, harvey }, info) => {
    await page.setViewportSize({ width, height }); await harvey.preferences(locale, theme)
    Object.assign(harvey.config, { isolatedMock: false, hostedSui: true, capabilities: { hostedTestRedemptionEnabled: true } })
    harvey.config.modes.cx = "cx"; harvey.config.modes.omnione = "stage"; harvey.config.modes.sui = "testnet"
    harvey.operation = pendingOperation()
    await page.addInitScript(({ id, venueId, locale, key }) => { sessionStorage.setItem(key, JSON.stringify({ venueId, locale, resumeOperationId: id, savedAt: Date.now() })) }, { id: ID, venueId: HARVEY_VENUE, locale, key: PENDING })
    let confirmations = 0
    await page.context().route(`**/api/hackathon/v1/operations/${ID}/redeem`, async route => {
      confirmations++
      const { row } = fixture()
      harvey.operation = { ...harvey.operation!, phase: "done", status: "succeeded", allowedActions: ["return"],
        fulfillment: { status: "redeemed", reason: null, redemptionRef: "BROWSER_FIXTURE_NO_REAL_USE", redeemedAt: new Date().toISOString(), recheck: null },
        chain: { ...row, status: "submitted", txHash: "BROWSER_FIXTURE_NO_REAL_TX" } }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(harvey.operation) })
    })
    await page.goto(`/?venueId=${HARVEY_VENUE}&review=0`, { waitUntil: "domcontentloaded" })
    await expect(page.getByTestId("hackathon-hosted-test-confirm")).toBeVisible()
    await expect(page.getByTestId("hackathon-sui-complete")).toHaveCount(0)
    await expect(page.getByTestId("hackathon-redeem")).toBeEnabled()
    expect(confirmations).toBe(0)
    await page.getByTestId("hackathon-close").click()
    expect(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key) ?? "null")?.resumeOperationId, PENDING)).toBe(ID)
    await page.reload({ waitUntil: "domcontentloaded" })
    await expect(page.getByTestId("hackathon-hosted-test-confirm")).toBeVisible()
    expect(confirmations).toBe(0)
    expect(await page.locator("html").evaluate(n => n.scrollWidth <= n.clientWidth + 1)).toBe(true)
    await page.screenshot({ path: info.outputPath("confirmation-fixture.png"), scale: "css" })
    await page.getByTestId("hackathon-redeem").click()
    await expect(page.getByTestId("hackathon-hosted-test-disclosure")).toBeVisible()
    await expect(page.getByTestId("hackathon-layer")).toHaveAttribute("data-chain-status", "submitted")
    await expect(page.getByTestId("hackathon-redeem")).toHaveCount(0)
    expect(confirmations).toBe(1)
    await page.screenshot({ path: info.outputPath("record-pending-fixture.png"), scale: "css" })
  })
}
test("disabled confirmation preserves pending recovery and never relabels it legacy completion", async ({ page, harvey }) => {
  await harvey.preferences("ja", "dark")
  Object.assign(harvey.config, { isolatedMock: false, hostedSui: true, capabilities: { hostedTestRedemptionEnabled: false } })
  harvey.config.modes.sui = "testnet"
  harvey.operation = { ...pendingOperation(), allowedActions: ["check_status", "return"] }
  await page.goto(`/?venueId=${HARVEY_VENUE}&review=0`, { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true")
  await page.getByTestId("canonical-place-details").click(); await page.getByTestId("hackathon-entitlement-open").click()
  await expect(page.getByTestId("hackathon-test-confirm-unavailable")).toBeVisible()
  await expect(page.getByTestId("hackathon-redeem")).toBeDisabled()
  await expect(page.getByTestId("hackathon-sui-complete")).toHaveCount(0)
  await page.getByTestId("hackathon-close").click()
  expect(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key) ?? "null")?.resumeOperationId, PENDING)).toBe(ID)
  expect(harvey.actionCount("redeem")).toBe(0)
})
test("legacy Sui-only operation still completes without the new confirmation or audit", async ({ page, harvey }) => {
  await harvey.preferences("en", "light")
  Object.assign(harvey.config, { isolatedMock: false, hostedSui: true, capabilities: { hostedTestRedemptionEnabled: true } })
  harvey.config.modes.sui = "testnet"
  harvey.operation = pendingOperation(false)
  await page.goto(`/?venueId=${HARVEY_VENUE}&review=0`, { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true")
  await page.getByTestId("canonical-place-details").click(); await page.getByTestId("hackathon-entitlement-open").click()
  await expect(page.getByTestId("hackathon-sui-complete")).toBeVisible()
  await expect(page.getByTestId("hackathon-redeem")).toHaveCount(0)
  await page.getByTestId("hackathon-close").click()
  expect(await page.evaluate(key => sessionStorage.getItem(key), PENDING)).toBeNull()
  expect(harvey.actionCount("redeem")).toBe(0)
})
