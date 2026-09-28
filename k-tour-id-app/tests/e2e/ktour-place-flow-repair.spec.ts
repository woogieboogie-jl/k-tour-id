import { expect, test, type Page } from "@playwright/test"
import { CANONICAL_VENUE_ID, gotoB, prepareBPage, seedB } from "../helpers/ondo-b-qa"

test.describe.configure({ timeout: 120_000 })

const errors = new WeakMap<Page, string[]>()
const writes = new WeakMap<Page, string[]>()
test.beforeEach(async ({ page }) => {
  errors.set(page, [])
  writes.set(page, [])
  page.on("pageerror", error => errors.get(page)!.push(error.message))
  await page.route("**/*", async route => {
    const request = route.request()
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      writes.get(page)!.push(new URL(request.url()).pathname)
      await route.abort("blockedbyclient")
      return
    }
    await route.continue()
  })
  await prepareBPage(page)
  await page.emulateMedia({ reducedMotion: "reduce" })
})
test.afterEach(async ({ page }) => {
  expect(errors.get(page)).toEqual([])
  expect(writes.get(page)).toEqual([])
})

test("capability hydration never repurposes the details button as payment", async ({ page }) => {
  await seedB(page, { locale: "ja" })
  await gotoB(page, `?venueId=${CANONICAL_VENUE_ID}&review=0`)
  const peek = page.getByTestId("canonical-place-peek")
  await expect(peek.locator("[data-peek-has-service]")).toHaveAttribute("data-peek-has-service", "false")
  const details = page.getByTestId("canonical-place-details")
  const original = await details.elementHandle()
  expect(original).not.toBeNull()
  await page.evaluate(() => {
    const url = new URL(window.location.href)
    url.searchParams.set("review", "1")
    window.history.replaceState(window.history.state, "", url)
    window.sessionStorage.setItem("ondo.review.flow.v1", "1")
    window.dispatchEvent(new Event("ondo-review-flow-change"))
  })
  await expect(peek.locator("[data-peek-has-service]")).toHaveAttribute("data-peek-has-service", "true")
  expect(await original!.evaluate(node => node.isConnected && node.getAttribute("data-testid") === "canonical-place-details")).toBe(true)
  await details.click()
  await expect(page.getByTestId("canonical-place-overlay")).toBeVisible()
  await expect(page.getByTestId("commerce-place-context")).toHaveCount(0)
})

for (const locale of ["en", "ja"] as const) {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`${locale} ${colorScheme} expanded temperature never overlaps later place actions`, async ({ page }, info) => {
      await page.emulateMedia({ colorScheme })
      await seedB(page, { locale })
      await gotoB(page, `?venueId=${CANONICAL_VENUE_ID}&review=0`)
      await page.getByTestId("canonical-place-details").click()
      const pulse = page.getByTestId("canonical-place-pulse")
      const trip = page.getByTestId("canonical-trip-actions")
      const detail = page.getByTestId("canonical-place-overlay")
      await pulse.locator("summary").click()
      await expect(pulse).toHaveAttribute("open", "")
      const boxes = await detail.evaluate(root => {
        const pulse = root.querySelector("[data-testid='canonical-place-pulse']")!.getBoundingClientRect()
        const following = ["canonical-trip-actions", "canonical-place-decisions", "canonical-place-details-to-check"].map(id => ({
          id, box: root.querySelector(`[data-testid='${id}']`)!.getBoundingClientRect().toJSON(),
        }))
        return { pulse: pulse.toJSON(), following }
      })
      for (const { id, box } of boxes.following) {
        expect(box.top, `${id} must follow the entire expanded temperature`).toBeGreaterThanOrEqual(boxes.pulse.bottom - 1)
      }
      await pulse.screenshot({ path: info.outputPath(`temperature-${locale}-${colorScheme}.png`) })
      await trip.scrollIntoViewIfNeeded()
      await page.screenshot({ path: info.outputPath(`place-flow-${locale}-${colorScheme}.png`) })
      await trip.getByTestId("canonical-journey-open").click()
      await expect(page.getByTestId("journey-visit-sheet")).toBeVisible()
      await page.keyboard.press("Escape")
      await expect(page.getByTestId("journey-visit-sheet")).toHaveCount(0)
      await expect(trip.getByTestId("canonical-journey-open")).toBeFocused()
      await expect(detail).toHaveAttribute("aria-modal", "true")
      await expect(pulse).toHaveAttribute("open", "")
    })

    test(`${locale} ${colorScheme} selected place leaves map search usable`, async ({ page }, info) => {
      await page.emulateMedia({ colorScheme })
      await seedB(page, { locale })
      await gotoB(page, `?venueId=${CANONICAL_VENUE_ID}&review=0`)
      const peek = page.getByTestId("canonical-place-peek")
      await expect(peek).toBeVisible({ timeout: 60_000 })
      await expect(peek).not.toHaveAttribute("aria-modal", "true")
      const toggle = page.getByTestId("ondo-b-map-search-toggle")
      await toggle.click()
      const search = page.getByTestId("ondo-b-search")
      await search.fill("로바")
      await expect(search).toHaveValue("로바")
      await expect(search).toBeFocused()
      await page.screenshot({ path: info.outputPath(`selected-search-${locale}-${colorScheme}.png`) })
      await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden")
    })
  }
}

for (const locale of ["en", "ja"] as const) {
  test(`${locale} editorial preview permits search but expanded details keep focus isolation`, async ({ page }) => {
    await seedB(page, { locale })
    await gotoB(page, "?city=jeju&editorialPlaceId=jeju-seongsan-ilchulbong&review=0")
    const peek = page.getByTestId("ondo-b-editorial-place-peek")
    await expect(peek).toBeVisible({ timeout: 60_000 })
    await expect(peek).not.toHaveAttribute("aria-modal", "true")
    await page.getByTestId("ondo-b-map-search-toggle").click()
    await page.getByTestId("ondo-b-search").fill("성산")
    await expect(page.getByTestId("ondo-b-search")).toBeFocused()
    await gotoB(page, "?city=jeju&editorialPlaceId=jeju-seongsan-ilchulbong&review=0")
    await peek.getByTestId("ondo-b-editorial-place-details").click()
    const detail = page.getByTestId("ondo-b-editorial-place-overlay")
    await expect(detail).toHaveAttribute("aria-modal", "true")
    expect(await page.getByTestId("ondo-b-map-search-toggle").evaluate(node => Boolean(node.closest("[inert]")))).toBe(true)
    await page.keyboard.press("Escape")
    await expect(peek).not.toHaveAttribute("aria-modal", "true")
  })

  test(`${locale} story and directory share service rows and return to their exact place`, async ({ page }, info) => {
    await seedB(page, { locale })
    await gotoB(page, `?venueId=${CANONICAL_VENUE_ID}&review=1`)
    await page.getByTestId("canonical-place-details").click()
    const canonical = page.getByTestId("canonical-place-actions")
    await expect(canonical).toHaveAttribute("data-place-flow", "shared")
    await expect(canonical.getByTestId("place-service-actions")).toHaveAttribute("data-service-layout", "rows")
    await canonical.getByTestId("canonical-meal-benefit-open").click()
    await expect(page.getByTestId("commerce-place-context")).toHaveAttribute("data-venue-id", CANONICAL_VENUE_ID)
    await page.getByTestId("commerce-origin-return").click()
    await expect(page.getByTestId("canonical-place-overlay")).toHaveAttribute("data-venue-id", CANONICAL_VENUE_ID)

    const researchId = "research-seoul-onion-anguk"
    await gotoB(page, "?city=seoul&collection=hot&review=1")
    await page.locator(`[data-discovery-place-opener='${researchId}']`).click()
    const research = page.getByTestId("researched-food-detail")
    await expect(research).toHaveAttribute("data-origin", "EDITORIAL_RESEARCH")
    const actions = research.getByTestId("place-detail-actions")
    await expect(actions).toHaveAttribute("data-place-flow", "shared")
    await expect(actions.getByTestId("place-service-actions")).toHaveAttribute("data-service-layout", "rows")
    await expect(actions.getByTestId("hackathon-entitlement-open")).toHaveCount(0)
    await expect(actions.getByTestId("place-reservation-open")).toHaveCount(0)
    await expect(page.getByTestId("place-offer-open")).toHaveCount(1)
    await actions.getByTestId("place-offer-open").click()
    await expect(page.getByTestId("commerce-place-context")).toHaveAttribute("data-venue-id", researchId)
    await page.getByTestId("commerce-origin-return").click()
    await expect(research).toHaveAttribute("data-research-id", researchId)
    await expect(actions.getByTestId("place-offer-open")).toBeFocused()
    await page.screenshot({ path: info.outputPath(`story-shared-flow-${locale}.png`) })
    await page.keyboard.press("Escape")
    await expect(page.getByTestId("map-discovery-results")).toHaveAttribute("data-collection", "hot")

    await gotoB(page, "?city=seoul&collection=hot&review=0")
    await page.locator(`[data-discovery-place-opener='${researchId}']`).click()
    await expect(page.getByTestId("place-offer-open")).toHaveCount(0)
    await expect(page.getByTestId("place-reservation-open")).toHaveCount(0)
    await expect(page.getByTestId("hackathon-entitlement-open")).toHaveCount(0)
    await expect(page.getByTestId("research-on-map")).toBeVisible()
    await expect(page.getByTestId("research-directions")).toBeVisible()
  })
}
