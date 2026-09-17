import type { Page } from "@playwright/test"
import { expect, HARVEY_VENUE, test, type HarveyFixture } from "./helpers/harvey-fixture"

// These tests exercise the real consumer UI with intercepted synthetic API
// responses. A passed test is NOT evidence of CX/OpenDID/Sui/OmniOne execution.
const layer = (page: Page) => page.getByTestId("hackathon-layer")
const phase = (page: Page, value: string) => expect(layer(page)).toHaveAttribute("data-phase", value)

async function assertFits(page: Page) {
  await expect(layer(page)).toBeVisible()
  expect(await layer(page).evaluate(node => node.scrollWidth <= node.clientWidth + 1), "Journey must not overflow horizontally").toBe(true)
  expect(await page.locator("html").evaluate(node => node.scrollWidth <= node.clientWidth + 1), "Page must not overflow horizontally").toBe(true)
  const box = await layer(page).boundingBox(), viewport = page.viewportSize()!
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(-1)
  expect(box!.y).toBeGreaterThanOrEqual(-1)
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1)
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1)
}

async function returnToPlace(page: Page) {
  await page.getByTestId("hackathon-return").click()
  await expect(layer(page)).toHaveCount(0)
  await expect(page.getByTestId("canonical-place-overlay")).toHaveAttribute("data-venue-id", HARVEY_VENUE)
  await expect(page.getByTestId("hackathon-entitlement-open")).toBeFocused()
}

async function reachPresentation(page: Page, fixture: HarveyFixture) {
  await expect(page.getByTestId("hackathon-start")).toBeDisabled()
  expect(fixture.count("/operations")).toBe(0)
  await page.locator("#hk-consent").check()
  await page.getByTestId("hackathon-start").click()
  await phase(page, "identity")
  expect(fixture.actionCount("identity/start")).toBe(0)
  await page.getByTestId("hackathon-identity-start").click()
  await expect(page.getByTestId("hackathon-cx-qr-load")).toHaveCount(0)
  await expect(page.getByTestId("hackathon-identity-fail")).toHaveCount(0)
  await expect(page.getByTestId("hackathon-identity-cancel")).toHaveCount(0)
  await page.getByTestId("hackathon-identity-approve").click()
  await phase(page, "issuance")
  expect(fixture.actionCount("credential/issue")).toBe(0)
  await page.getByTestId("hackathon-issue").click()
  await phase(page, "presentation")
  expect(fixture.actionCount("credential/holder-ack")).toBe(1)
  expect(fixture.actionCount("presentation/request")).toBe(0)
}

async function reachProposal(page: Page, fixture: HarveyFixture) {
  await reachPresentation(page, fixture)
  await page.getByTestId("hackathon-present").click()
  await phase(page, "proposal")
  expect(fixture.actionCount("proposal")).toBe(0)
}

async function reachApproval(page: Page, fixture: HarveyFixture) {
  await reachProposal(page, fixture)
  await page.getByTestId("hackathon-propose").click()
  await phase(page, "delegation")
  await page.getByTestId("hackathon-signer-demo").click()
  await expect(page.locator("#hk-approve")).not.toBeChecked()
  await expect(page.getByTestId("hackathon-delegate")).toBeDisabled()
  expect(fixture.actionCount("delegation/prepare")).toBe(0)
}

async function completeFixture(page: Page, fixture: HarveyFixture) {
  await page.locator("#hk-approve").check()
  await page.getByTestId("hackathon-delegate").click()
  await phase(page, "agent")
  expect(fixture.actionCount("agent/run")).toBe(0)
  await page.getByTestId("hackathon-agent-run").click()
  await phase(page, "fulfillment")
  expect(fixture.actionCount("redeem")).toBe(0)
  await page.getByTestId("hackathon-redeem").click()
  await phase(page, "done")
  await expect(layer(page)).toHaveAttribute("data-chain-status", "pending")
  expect(fixture.operation?.fulfillment?.status).toBe("redeemed")
  expect(fixture.actionCount("reconcile")).toBe(0)
  await assertFits(page)
  await page.getByTestId("hackathon-reconcile").click()
  await expect(layer(page)).toHaveAttribute("data-chain-status", "confirmed")
  for (const action of ["credential/issue", "credential/holder-ack", "presentation/request", "presentation/submit", "delegation/prepare", "delegation/submit", "agent/run", "redeem", "reconcile"]) {
    expect(fixture.actionCount(action), `Exactly one fixture ${action}`).toBe(1)
  }
}

test("HK-FIXTURE-01 opening and closing never consents or creates an operation", async ({ page, harvey }) => {
  await harvey.preferences()
  await harvey.open()
  await phase(page, "consent")
  await expect(page.getByTestId("hackathon-start")).toBeDisabled()
  await expect(layer(page)).toContainText("Browser fixture perk")
  await expect(page.getByTestId("hackathon-isolated-notice")).toContainText("does not connect to external services")
  await assertFits(page)
  expect(harvey.count("/operations")).toBe(0)
  await page.getByTestId("hackathon-close").click()
  await expect(layer(page)).toHaveCount(0)
  await expect(page.getByTestId("canonical-place-overlay")).toHaveAttribute("data-venue-id", HARVEY_VENUE)
  await expect(page.getByTestId("hackathon-entitlement-open")).toBeFocused()
  expect(harvey.count("/operations")).toBe(0)
})

test("HK-FIXTURE-02 manual journey separates fixture execution, use and audit and returns to the same place", async ({ page, harvey }, info) => {
  await harvey.preferences()
  await harvey.open()
  await reachApproval(page, harvey)
  await assertFits(page)
  await completeFixture(page, harvey)
  await page.getByTestId("hackathon-evidence").click()
  await expect(layer(page)).toContainText("BROWSER_FIXTURE_NOT_PROVIDER_EVIDENCE")
  await expect(layer(page)).toContainText('"actualTransactions": 0')
  await page.screenshot({ path: info.outputPath("fixture-record-confirmed-en-390.png"), scale: "css" })
  await returnToPlace(page)
  expect(harvey.count("/operations")).toBe(1)
})

test("HK-FIXTURE-03 legacy autoplay URL cannot start or approve a journey", async ({ page, harvey }) => {
  await harvey.preferences()
  await harvey.open("&hk=auto")
  await phase(page, "consent")
  await expect(page.locator("#hk-consent")).not.toBeChecked()
  await expect(page.getByTestId("hackathon-start")).toBeDisabled()
  await expect(page.getByTestId("hackathon-demo-entry-auto")).toHaveCount(0)
  await expect(page.getByTestId("hackathon-autopilot")).toHaveCount(0)
  // A bounded negative observation catches delayed legacy autopilot timers.
  await page.waitForTimeout(400)
  expect(harvey.count("/operations")).toBe(0)
  const mutations = harvey.calls.filter(call => call.method === "POST")
  expect(mutations.length).toBeGreaterThan(0)
  expect(mutations.every(call => call.path === "/sessions")).toBe(true)
})

test("HK-FIXTURE-04 declining presentation cancels without creating a proposal or grant", async ({ page, harvey }) => {
  await harvey.preferences()
  await harvey.open()
  await reachPresentation(page, harvey)
  await page.getByTestId("hackathon-presentation-deny").click()
  await phase(page, "cancelled")
  await expect(layer(page)).toHaveAttribute("data-status", "cancelled")
  for (const action of ["presentation/submit", "proposal", "delegation/prepare", "agent/run", "redeem"]) expect(harvey.actionCount(action)).toBe(0)
  await returnToPlace(page)
})

test("HK-FIXTURE-05 retrying a failed proposal preserves the operation and does not approve delegation", async ({ page, harvey }) => {
  await harvey.preferences()
  await harvey.open()
  await reachProposal(page, harvey)
  harvey.failNext("proposal")
  await page.getByTestId("hackathon-propose").click()
  await expect(layer(page)).toContainText("Fixture temporary failure")
  await phase(page, "proposal")
  expect(harvey.actionCount("proposal")).toBe(1)
  await page.getByTestId("hackathon-propose").click()
  await phase(page, "delegation")
  await expect(layer(page)).not.toContainText("Fixture temporary failure")
  expect(harvey.actionCount("proposal")).toBe(2)
  expect(harvey.count("/operations")).toBe(1)
  expect(harvey.actionCount("delegation/prepare")).toBe(0)
  await page.getByTestId("hackathon-signer-demo").click()
  await expect(page.locator("#hk-approve")).not.toBeChecked()
  await expect(page.getByTestId("hackathon-delegate")).toBeDisabled()
})

test("HK-FIXTURE-06 reload and forged legacy auto marker cannot restore execution approval", async ({ page, harvey }) => {
  await harvey.preferences()
  await harvey.open()
  await reachApproval(page, harvey)
  await page.locator("#hk-approve").check()
  await expect(page.getByTestId("hackathon-delegate")).toBeEnabled()
  await page.evaluate(() => {
    const key = "ondo-b.hackathon.pending.v1"
    const pending = JSON.parse(sessionStorage.getItem(key) ?? "null")
    if (!pending) throw new Error("A genuine pending fixture operation is required")
    sessionStorage.setItem(key, JSON.stringify({ ...pending, auto: "redeem" }))
  })
  await page.reload({ waitUntil: "domcontentloaded" })
  await phase(page, "delegation")
  await expect(page.locator("#hk-approve")).not.toBeChecked()
  await expect(page.getByTestId("hackathon-delegate")).toBeDisabled()
  await page.waitForTimeout(400)
  expect(harvey.count("/operations")).toBe(1)
  for (const action of ["delegation/prepare", "delegation/submit", "agent/run", "redeem"]) expect(harvey.actionCount(action)).toBe(0)
})

test("HK-FIXTURE-07 cancelling at the approval boundary never signs or consumes the perk", async ({ page, harvey }) => {
  await harvey.preferences()
  await harvey.open()
  await reachApproval(page, harvey)
  await page.getByTestId("hackathon-cancel").click()
  await phase(page, "cancelled")
  for (const action of ["delegation/prepare", "delegation/submit", "agent/run", "redeem"]) expect(harvey.actionCount(action)).toBe(0)
  await returnToPlace(page)
  expect(await page.evaluate(() => sessionStorage.getItem("ondo-b.hackathon.pending.v1"))).toBeNull()
})

test("HK-FIXTURE-08 configured Google has no demo-signer bypass and viewing never starts OAuth or delegation", async ({ page, harvey }) => {
  // Fictional configuration response only. No live provider is configured in
  // the test server and the Google control must never be clicked here.
  harvey.config.isolatedMock = false
  harvey.config.modes.zklogin = "google"
  await harvey.preferences()
  await harvey.open()
  await reachProposal(page, harvey)
  await page.getByTestId("hackathon-propose").click()
  await phase(page, "delegation")
  await expect(page.getByTestId("hackathon-signer-google")).toBeVisible()
  await expect(page.getByTestId("hackathon-signer-demo")).toHaveCount(0)
  await expect(page.locator("#hk-approve")).toHaveCount(0)
  const mutationCount = harvey.calls.filter(call => call.method === "POST").length
  await page.waitForTimeout(400)
  expect(harvey.calls.filter(call => call.method === "POST")).toHaveLength(mutationCount)
  expect(harvey.count("/zklogin/params")).toBe(0)
  expect(harvey.count("/zklogin/prove")).toBe(0)
  for (const action of ["delegation/prepare", "delegation/submit", "agent/run", "redeem"]) expect(harvey.actionCount(action)).toBe(0)
})

for (const layout of [{ locale: "ja", width: 320, height: 568 }, { locale: "ko", width: 390, height: 844 }] as const) {
  test(`HK-FIXTURE layout ${layout.locale} dark ${layout.width} keeps consent and each manual action reachable`, async ({ page, harvey }, info) => {
    await page.setViewportSize({ width: layout.width, height: layout.height })
    await harvey.preferences(layout.locale, "dark")
    await harvey.open()
    await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-appearance", "dark")
    await expect(layer(page)).toHaveAttribute("data-locale", layout.locale)
    await assertFits(page)
    await reachPresentation(page, harvey)
    await assertFits(page)
    await page.getByTestId("hackathon-present").click()
    await page.getByTestId("hackathon-propose").click()
    await phase(page, "delegation")
    await page.getByTestId("hackathon-signer-demo").click()
    await assertFits(page)
    await page.screenshot({ path: info.outputPath(`fixture-approval-${layout.locale}-${layout.width}-dark.png`), scale: "css" })
    await completeFixture(page, harvey)
    await assertFits(page)
    await returnToPlace(page)
  })
}
