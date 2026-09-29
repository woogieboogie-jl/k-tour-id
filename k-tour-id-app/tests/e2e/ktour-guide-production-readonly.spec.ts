import { expect, test } from "@playwright/test"
import { GUIDE_SAVE_V2 } from "../../lib/hackathon/guide-contract"

// Explicit opt-in, fresh browser only. Every non-read request is blocked before
// forwarding; no session creation, identity request, OAuth or chain action.
test.skip(process.env.GUIDE_REMOTE_READ_ONLY !== "1", "Only run against the root-approved deployed URL")
test("MAIN-GUIDE remote read-only: free reader, honest readiness, Pass and shared navigation", async ({ page, baseURL }, info) => {
  const origin = new URL(baseURL!).origin
  const blockedMutations: string[] = [], apiReads: string[] = [], pageErrors: string[] = []
  page.on("pageerror", error => pageErrors.push(error.message))
  await page.addInitScript(() => {
    localStorage.setItem("ondo-b.device.v1", JSON.stringify({ locale: "ja", appearancePreference: "dark", onboarding: "ONB-COMPLETE" }))
    sessionStorage.setItem("ondo.review.flow.v1", "0")
  })
  await page.context().route("**/*", async route => {
    const request = route.request(), url = new URL(request.url())
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      if (url.origin === origin && url.pathname.startsWith("/api/")) blockedMutations.push(`${request.method()} ${url.pathname}`)
      await route.abort("blockedbyclient"); return
    }
    if (url.origin !== origin) {
      const passive = ["fonts.googleapis.com", "fonts.gstatic.com", "tiles.openfreemap.org", "demotiles.maplibre.org"].includes(url.hostname)
      if (!passive || request.resourceType() === "document") { await route.abort("blockedbyclient"); return }
    }
    if (url.origin === origin && url.pathname.startsWith("/api/")) apiReads.push(url.pathname)
    await route.continue()
  })
  await page.goto(`/?venueId=${GUIDE_SAVE_V2.venueId}&review=0`, { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true")
  if (!await page.getByTestId("canonical-place-overlay").isVisible()) await page.getByTestId("canonical-place-details").click()
  await page.getByTestId("experience-open").click()
  await expect(page.getByTestId("experience-public-guide")).toBeVisible()
  await expect(page.getByTestId("experience-guide-content").getByRole("heading", { level: 3 })).toHaveCount(3)
  expect(blockedMutations).toEqual([])
  const readinessResult = page.waitForResponse(response => response.url() === `${origin}/api/hackathon/v1/guide/readiness`)
  await page.getByTestId("experience-add-to-pass").click()
  const readinessResponse = await readinessResult
  expect(readinessResponse.status()).toBe(200)
  expect(await readinessResponse.json()).toMatchObject({ supported: true, ready: false, verification: "configuration_only", guideId: GUIDE_SAVE_V2.guideId, campaignId: GUIDE_SAVE_V2.campaignId, action: GUIDE_SAVE_V2.action })
  await expect(page.getByTestId("guide-save-readiness")).toHaveAttribute("data-ready", "false")
  await expect(page.getByTestId("guide-save-readiness")).toContainText("現在、パスには保存できません")
  await expect(page.getByTestId("hackathon-layer")).toHaveCount(0)
  await expect(page.getByTestId("experience-flow")).toHaveCount(0)
  await page.screenshot({ path: info.outputPath("deployed-guide-unavailable-ja.png") })
  await page.getByTestId("guide-keep-reading").click()
  await expect(page.getByTestId("experience-public-guide")).toBeVisible()
  await page.goto("/?review=0", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("ondo-main-nav")).toBeVisible()
  await page.getByTestId("nav-id").click()
  await expect(page.getByTestId("server-guide-collection")).toBeVisible()
  await expect(page.getByTestId("server-guide-collection")).not.toHaveAttribute("data-state", "loading")
  await expect(page.getByTestId("server-guide-collection")).not.toHaveAttribute("data-state", "error")
  await expect(page.getByTestId("experience-saved-guides")).toHaveCount(0)
  await page.getByTestId("server-guide-open").click()
  await expect(page.getByTestId("experience-public-guide")).toBeVisible()
  expect(apiReads).toContain("/api/hackathon/v1/guide/readiness")
  expect(apiReads).toContain("/api/hackathon/v1/guide/collection")
  expect(blockedMutations).toEqual([])
  expect(pageErrors).toEqual([])
})
