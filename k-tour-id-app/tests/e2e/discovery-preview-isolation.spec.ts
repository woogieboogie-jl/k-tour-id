import { expect, test, type Page } from "@playwright/test"

const route = "/ondo-b/labs/discovery"

async function start(page: Page) {
  const forbidden: string[] = []
  const api: string[] = []
  page.on("request", request => {
    const url = new URL(request.url())
    if (url.protocol === "blob:" && url.origin === new URL(page.url()).origin) return
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
      if (url.pathname.startsWith("/api/")) api.push(url.pathname)
      return
    }
    if (url.hostname === "tiles.openfreemap.org" && (url.pathname.startsWith("/planet") || url.pathname.startsWith("/fonts/"))) return
    if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") return
    forbidden.push(`${request.method()} ${url.origin}${url.pathname}`)
  })
  await page.goto(route, { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("discovery-preview")).toBeVisible()
  await expect(page.getByTestId("discovery-preview")).toHaveAttribute("data-ready", "true")
  return { forbidden, api }
}

test("preview isolation: story and Hot flows use only local state plus basemap/font assets", async ({ page }) => {
  const observed = await start(page)
  await page.getByTestId("story-sesame").click()
  await expect(page.locator("[data-place-card]")).toHaveCount(1)
  await page.getByRole("button", { name: /이전 탐색으로|Back to discovery/ }).first().click()
  await page.getByRole("button", { name: "Hot", exact: true }).click()
  await expect(page.getByTestId("discovery-preview")).toHaveAttribute("data-mode", "hot")
  await expect(page.locator("[data-place-card]")).toHaveCount(3)
  await page.getByRole("button", { name: /저장한 장소|Saved places/ }).click()
  await expect(page.getByTestId("discovery-preview")).toHaveAttribute("data-mode", "saved")
  expect(observed.api).toEqual([])
  expect(observed.forbidden).toEqual([])
})
