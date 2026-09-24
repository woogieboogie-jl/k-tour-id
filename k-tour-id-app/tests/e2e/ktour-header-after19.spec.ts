import { expect, test } from "@playwright/test"
import {
  expectBRuntimeClean,
  gotoB,
  installBRuntimeGuard,
  prepareBPage,
  seedB,
} from "../helpers/ondo-b-qa"

async function openSeoul(page: import("@playwright/test").Page) {
  const nonGetApi: string[] = []
  page.on("request", request => {
    const url = new URL(request.url())
    if (url.pathname.startsWith("/api/") && request.method() !== "GET") nonGetApi.push(`${request.method()} ${url.pathname}`)
  })
  await gotoB(page, "?city=seoul")
  const config = await page.request.get("/api/hackathon/v1/config")
  expect(config.ok()).toBe(true)
  expect((await config.json()).isolatedMock).toBe(true)
  await expect(page.getByTestId("ondo-b-city-header").getByRole("heading", { level: 1 })).toBeVisible()
  await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-map-state", "ready", { timeout: 30_000 })
  return nonGetApi
}

test.describe("After 19 options handoff", () => {
  test.describe.configure({ timeout: 60_000 })

  test.beforeEach(async ({ page, baseURL }) => {
    const origin = new URL(baseURL!).origin
    const config = await page.request.get(`${origin}/api/hackathon/v1/config`)
    expect(await config.json()).toMatchObject({ isolatedMock: true })
    installBRuntimeGuard(page)
    await prepareBPage(page)
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url())
      const localRead = url.origin === origin && (!url.pathname.startsWith("/api/") || url.pathname === "/api/hackathon/v1/config" || url.pathname.startsWith("/api/ondo/venues/"))
      const passive = ["tiles.openfreemap.org", "fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname)
      if (!["GET", "HEAD"].includes(request.method()) || !(localRead || passive)) {
        await route.abort("blockedbyclient")
        throw new Error(`Unexpected request: ${request.method()} ${url.pathname}`)
      }
      await route.fallback()
    })
  })

  test.afterEach(async ({ page }, testInfo) => {
    await expectBRuntimeClean(page, testInfo)
  })

  test("inactive options action opens the existing gate and cancel restores options focus", async ({ page }) => {
    await seedB(page, { locale: "en", session: { after19: "A19-OFF" } })
    const nonGetApi = await openSeoul(page)

    const optionsOpen = page.getByTestId("ondo-b-map-options-open")
    await optionsOpen.click()
    const row = page.getByTestId("ondo-b-map-options-after19-open")
    await expect(row).toHaveAccessibleName("After 19 picks")
    await row.click()

    const gate = page.getByTestId("global-after19-prompt-layer")
    await expect(gate).toBeVisible()
    await gate.getByTestId("global-after19-cancel").click()
    await expect(gate).toHaveCount(0)
    await expect(optionsOpen).toBeFocused()
    expect(nonGetApi).toEqual([])
  })

  test("active options action is explicit turn-off and leaves no hidden review surface", async ({ page }) => {
    await seedB(page, {
      locale: "en",
      session: {
        account: "ACC-ACTIVE",
        age: "AGE-VERIFIED",
        ageExpiresAt: "2026-08-20T20:30:00+09:00",
        after19: "A19-ON",
      },
      after19LocalDeclaration: true,
    })
    await page.addInitScript(() => {
      sessionStorage.setItem("ondo-b.account.v1", JSON.stringify({ account: "ACC-ACTIVE", returnTo: null }))
      sessionStorage.setItem("ondo-b.after19.session.v1", JSON.stringify({
        version: 1,
        age: "eligible",
        ageExpiresAt: "2026-08-20T20:30:00+09:00",
        eligibilityReceipt: {
          schema: "local-age-declaration.v1",
          predicate: "AGE_GTE_19",
          outcome: "eligible",
          issuerType: "LOCAL_DECLARATION",
          provenanceTruth: "SELF_DECLARED",
          fixtureId: "FX-AGE-GLOBAL-001",
          issuedAt: "2026-08-19T20:30:00+09:00",
          expiresAt: "2026-08-20T20:30:00+09:00",
          disclosure: "night_view_only",
        },
        mode: "on",
        activation: "manual",
        expiryNotice: false,
      }))
    })
    const nonGetApi = await openSeoul(page)

    const globalAfter19 = page.getByTestId("ondo-b-after19-global")
    await expect(globalAfter19).toHaveAttribute("data-after19-mode", "on")
    await expect(page.getByTestId("global-after19-banner")).toHaveCount(0)
    const optionsOpen = page.getByTestId("ondo-b-map-options-open")
    await optionsOpen.click()
    const row = page.getByTestId("ondo-b-map-options-after19-open")
    await expect(row).toHaveAccessibleName("Turn off After 19")
    await row.click()

    const notice = page.getByTestId("global-after19-off-notice")
    await expect(notice).toBeVisible()
    const headerBox = await page.getByTestId("ondo-b-city-header").boundingBox()
    const noticeBox = await notice.boundingBox()
    expect(headerBox && noticeBox).toBeTruthy()
    expect(noticeBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height - 1)
    await expect(page.getByTestId("global-after19-review-provenance")).toHaveCount(0)
    await expect(optionsOpen).toBeFocused()
    await notice.getByRole("button", { name: "Turn back on" }).click()
    await expect(globalAfter19).toHaveAttribute("data-after19-mode", "on")
    await expect(notice).toHaveCount(0)
    expect(nonGetApi).toEqual([])
  })
})
