import type { Page } from "@playwright/test"
import { expect, test, type HarveyFixture } from "./helpers/harvey-fixture"

// Independent negative checks for the final merge. All provider responses are
// synthetic; these tests must never count as live identity or chain evidence.
const layer = (page: Page) => page.getByTestId("hackathon-layer")
async function start(page: Page, fixture: HarveyFixture) {
  await fixture.preferences()
  await fixture.open()
  await page.locator("#hk-consent").check()
  await page.getByTestId("hackathon-start").click()
  await expect(layer(page)).toHaveAttribute("data-phase", "identity")
}
async function approval(page: Page, fixture: HarveyFixture) {
  await start(page, fixture)
  await page.getByTestId("hackathon-identity-start").click()
  await page.getByTestId("hackathon-identity-approve").click()
  await page.getByTestId("hackathon-issue").click()
  await page.getByTestId("hackathon-present").click()
  await page.getByTestId("hackathon-propose").click()
  await page.getByTestId("hackathon-signer-demo").click()
  await expect(page.locator("#hk-approve")).not.toBeChecked()
}

test("FINAL-01 historical steps are read-only and do not mutate the operation", async ({ page, harvey }) => {
  await start(page, harvey)
  const mutationCount = harvey.calls.filter(c => c.method === "POST").length
  await page.getByTestId("hackathon-step-back").click()
  await expect(page.getByTestId("hackathon-step-live")).toBeFocused()
  await expect(layer(page)).toHaveAttribute("data-phase", "identity")
  await expect(layer(page)).toHaveAttribute("data-reviewing", "true")
  await expect(page.getByTestId("hackathon-step-review")).toContainText("read-only")
  await expect(page.getByTestId("hackathon-start")).toHaveCount(0)
  await expect(page.getByTestId("hackathon-identity-start")).toHaveCount(0)
  await expect(page.getByTestId("hackathon-step-next")).toHaveCount(0)
  await page.getByTestId("hackathon-step-live").click()
  await expect(page.getByTestId("hackathon-step-back")).toBeFocused()
  await expect(page.getByTestId("hackathon-identity-start")).toBeVisible()
  expect(harvey.calls.filter(c => c.method === "POST")).toHaveLength(mutationCount)
})

test("FINAL-02 reviewing a proposal clears approval; returning never delegates", async ({ page, harvey }) => {
  await approval(page, harvey)
  await page.locator("#hk-approve").check()
  await page.getByTestId("hackathon-step-back").click()
  await expect(page.getByTestId("hackathon-step-review")).toBeVisible()
  await expect(page.getByTestId("hackathon-delegate")).toHaveCount(0)
  await page.getByTestId("hackathon-step-live").click()
  await expect(page.locator("#hk-approve")).not.toBeChecked()
  await expect(page.getByTestId("hackathon-delegate")).toBeDisabled()
  expect(harvey.actionCount("delegation/prepare")).toBe(0)
  expect(harvey.actionCount("delegation/submit")).toBe(0)
})

test("FINAL-03 same-frame repeated start creates only one operation", async ({ page, harvey }) => {
  await harvey.preferences()
  await harvey.open()
  await page.locator("#hk-consent").check()
  await page.getByTestId("hackathon-start").evaluate((el: HTMLButtonElement) => { el.click(); el.click() })
  await expect(layer(page)).toHaveAttribute("data-phase", "identity")
  expect(harvey.count("/operations")).toBe(1)
})

test("FINAL-04 failed delegation retry requires approval again", async ({ page, harvey }) => {
  await approval(page, harvey)
  harvey.failNext("delegation/prepare")
  await page.locator("#hk-approve").check()
  await page.getByTestId("hackathon-delegate").click()
  await expect(layer(page).getByRole("alert")).toBeVisible()
  await expect(page.locator("#hk-approve")).not.toBeChecked()
  await expect(page.getByTestId("hackathon-delegate")).toBeDisabled()
  expect(harvey.actionCount("delegation/prepare")).toBe(1)
  expect(harvey.actionCount("delegation/submit")).toBe(0)
})

test("FINAL-05 cancelled approval preserves its reached step without active signing controls", async ({ page, harvey }) => {
  await approval(page, harvey)
  await page.getByTestId("hackathon-cancel").click()
  await expect(layer(page)).toHaveAttribute("data-status", "cancelled")
  await expect(layer(page).getByRole("group", { name: "Approve · 6/9", exact: true })).toBeVisible()
  await expect(page.getByTestId("hackathon-delegate")).toHaveCount(0)
  await page.getByTestId("hackathon-step-back").click()
  await expect(page.getByTestId("hackathon-step-review")).toContainText("Reviewed proposal")
  await page.getByTestId("hackathon-step-live").click()
  await expect(page.getByTestId("hackathon-return")).toBeVisible()
  for (const action of ["delegation/prepare", "delegation/submit", "agent/run", "redeem"]) expect(harvey.actionCount(action)).toBe(0)
})

test("FINAL-06 a legacy step deep link is navigation only, not consent", async ({ page, harvey }) => {
  await harvey.preferences("ja", "dark")
  await harvey.open("&hk=step")
  await expect(page.locator("#hk-consent")).not.toBeChecked()
  await expect(page.getByTestId("hackathon-start")).toBeDisabled()
  expect(harvey.count("/operations")).toBe(0)
})

test("FINAL-07 phase changes retain keyboard ownership and Escape returns without approval", async ({ page, harvey }) => {
  await start(page, harvey)
  await expect(layer(page).getByRole("heading", { level: 3, name: "Identity", exact: true })).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(layer(page)).toHaveCount(0)
  await expect(page.getByTestId("hackathon-entitlement-open")).toBeFocused()
  expect(harvey.actionCount("identity/start")).toBe(0)
})

test("FINAL-09 closing while preparation is pending never signs or submits its late response", async ({ page, harvey }) => {
  await approval(page, harvey)
  let release = () => {}
  let received = false
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.context().route("**/delegation/prepare", async route => {
    received = true
    await gate
    await route.fallback()
  })
  try {
    await page.locator("#hk-approve").check()
    await page.getByTestId("hackathon-delegate").click()
    await expect.poll(() => received).toBe(true)
    await page.getByTestId("hackathon-close").click()
    await expect(layer(page)).toHaveCount(0)
    const response = page.waitForResponse(r => r.url().endsWith("/delegation/prepare"))
    release()
    await response
    await page.waitForTimeout(300)
    expect(harvey.actionCount("delegation/prepare")).toBe(1)
    for (const action of ["delegation/submit", "agent/run", "redeem"]) expect(harvey.actionCount(action)).toBe(0)
  } finally { release() }
})

for (const locale of ["en", "ko", "ja"] as const) {
  test(`FINAL-08 cancelled OAuth offers a localized return without accepting a token ${locale}`, async ({ page, harvey }) => {
    await harvey.preferences(locale)
    await page.goto("/hackathon/zklogin/callback#error=access_denied&id_token=never.persist.this&state=unrelated", { waitUntil: "domcontentloaded" })
    const link = page.getByTestId("hackathon-login-return")
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute("href", "/")
    await expect(page.locator("main")).toHaveAttribute("lang", locale)
    expect(new URL(page.url()).hash).toBe("")
    expect(await page.evaluate(() => Object.keys(sessionStorage).some(key => key.startsWith("ondo-b.hackathon.jwt:")))).toBe(false)
    expect(harvey.calls.filter(c => c.method === "POST")).toHaveLength(0)
  })
}

test("FINAL-10 an unknown delegation cannot offer a fresh approval or signature", async ({ page, harvey }) => {
  await approval(page, harvey)
  await page.locator("#hk-approve").check()
  await page.getByTestId("hackathon-delegate").click()
  await expect(layer(page)).toHaveAttribute("data-phase", "agent")
  const op = harvey.operation!
  harvey.operation = { ...op, phase: "delegation", delegation: { ...op.delegation!, status: "unknown", grant: null } }
  await page.reload({ waitUntil: "domcontentloaded" })
  await expect(layer(page)).toHaveAttribute("data-phase", "delegation")
  await expect(page.locator("#hk-approve")).toHaveCount(0)
  await expect(page.getByTestId("hackathon-delegate")).toHaveCount(0)
  await expect(page.getByTestId("hackathon-reconcile")).toBeVisible()
  await expect(page.getByTestId("hackathon-cancel")).toHaveCount(0)
  expect(harvey.actionCount("delegation/prepare")).toBe(1)
  expect(harvey.actionCount("delegation/submit")).toBe(1)
  // A definitive failed transaction, unlike an unknown one, can be stopped.
  harvey.operation = { ...harvey.operation!, delegation: { ...harvey.operation!.delegation!, status: "failed" } }
  await page.reload({ waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("hackathon-cancel")).toBeVisible()
  await expect(page.getByTestId("hackathon-delegate")).toHaveCount(0)
})
