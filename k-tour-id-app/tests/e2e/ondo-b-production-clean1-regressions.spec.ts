import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test"
import { CANONICAL_VENUE_ID } from "../helpers/ondo-b-qa"

const ORIGIN = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3112").origin
const DEVICE_KEY = "ondo-b.device.v1"
const ACCOUNT_KEY = "ondo-b.account.v1"
const AFTER19_SESSION_KEY = "ondo-b.after19.session.v1"
// The current white-and-ink direction uses the same high-contrast focus token
// as the product shell; keep this receipt exact so browser-default blue cannot
// silently return.
const FOCUS_COLOR = "rgb(23, 23, 23)"
const PRIMARY_VIEWPORTS = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 801, height: 1000 },
  { width: 1440, height: 1000 },
] as const
const REPRESENTATIVE_VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
] as const

type Locale = "en" | "ko"
type Onboarding = "ONB-NEW" | "ONB-COMPLETE"

async function productionContext(
  browser: Browser,
  viewport: { width: number; height: number },
  locale: Locale,
  onboarding: Onboarding = "ONB-COMPLETE",
) {
  const context = await browser.newContext({ viewport })
  await context.addInitScript(({ key, nextLocale, nextOnboarding }) => {
    localStorage.setItem(key, JSON.stringify({
      locale: nextLocale,
      onboarding: nextOnboarding,
      discoveryPreferences: [],
      savedVenueIds: [],
      privateNotesByVenue: {},
    }))
    sessionStorage.clear()
  }, { key: DEVICE_KEY, nextLocale: locale, nextOnboarding: onboarding })
  return context
}

async function openPage(context: BrowserContext, path: string) {
  const page = await context.newPage()
  await page.goto(`${ORIGIN}${path}`, { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("ondo-b-root")).toBeVisible()
  return page
}

async function expectReachableInScrollOwner(locator: Locator, owner: Locator, shouldFocus = true) {
  await locator.scrollIntoViewIfNeeded()
  const [itemBox, ownerBox] = await Promise.all([locator.boundingBox(), owner.boundingBox()])
  expect(itemBox).not.toBeNull()
  expect(ownerBox).not.toBeNull()
  const visibleTop = Math.max(itemBox!.y, ownerBox!.y)
  const visibleBottom = Math.min(itemBox!.y + itemBox!.height, ownerBox!.y + ownerBox!.height)
  expect(visibleBottom - visibleTop).toBeGreaterThanOrEqual(Math.min(44, itemBox!.height))
  if (shouldFocus) {
    await locator.focus()
    await expect(locator).toBeFocused()
  }
}

async function canonicalReceipt(page: Page) {
  return page.evaluate(() => {
    const url = new URL(location.href)
    return {
      keys: [...url.searchParams.keys()].sort(),
      params: Object.fromEntries(url.searchParams),
      level: history.state?.__ondoBDiscovery?.level as string | undefined,
    }
  })
}

test.describe("ONDO B production CLEAN1 finding regressions", () => {
  test.describe.configure({ timeout: 180_000 })

  test("CLEAN1-D1-FOCUS uses one complete focus owner for onboarding", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "one Chromium owner covers the exact viewport and locale matrix")

    for (const locale of ["en", "ko"] as const) {
      for (const viewport of PRIMARY_VIEWPORTS) {
        const context = await productionContext(browser, viewport, locale, "ONB-NEW")
        const page = await openPage(context, "/")
        const dialog = page.getByTestId("ondo-onboarding")
        // Let the product's deliberate initial dialog focus settle before
        // proving the first action's independent focus owner and outline.
        await expect(dialog).toBeFocused()
        const action = dialog.locator("[data-onboarding-initial-focus]").first()
        await action.focus()
        await expect(action).toBeFocused()
        const receipt = await action.evaluate((node) => {
          const style = getComputedStyle(node)
          const dialogStyle = getComputedStyle(node.closest("[role='dialog']")!)
          const box = node.getBoundingClientRect()
          const dialogBox = node.closest("[role='dialog']")!.getBoundingClientRect()
          return {
            dialogOutlineStyle: dialogStyle.outlineStyle,
            outlineStyle: style.outlineStyle,
            outlineWidth: style.outlineWidth,
            fullyContained: box.top >= dialogBox.top && box.bottom <= dialogBox.bottom,
          }
        })
        expect(receipt).toEqual({
          dialogOutlineStyle: "none",
          outlineStyle: "solid",
          outlineWidth: "2px",
          fullyContained: true,
        })
        await expect(dialog).toBeVisible()
        await context.close()
      }
    }

    const shortContext = await productionContext(browser, { width: 844, height: 390 }, "en", "ONB-NEW")
    const shortPage = await openPage(shortContext, "/")
    const shortDialog = shortPage.getByTestId("ondo-onboarding")
    await expect(shortDialog).toBeFocused()
    await shortDialog.locator("[data-onboarding-initial-focus]").first().focus()
    await expect(shortDialog.locator("[data-onboarding-initial-focus]").first()).toBeFocused()
    await shortContext.close()
  })

  test("CLEAN1-D1-SEARCH gives the input shell and clear button one focus treatment each", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "one Chromium owner covers both locales and representative viewport classes")

    for (const locale of ["en", "ko"] as const) {
      for (const viewport of REPRESENTATIVE_VIEWPORTS) {
        const context = await productionContext(browser, viewport, locale)
        const page = await openPage(context, "/?city=seoul&view=list")
        const input = page.getByTestId("ondo-b-search")
        const shell = page.getByTestId("ondo-b-search-shell")
        await input.fill("로바")
        await expect(input).toBeFocused()
        const inputFocus = await input.evaluate((node) => {
          const inputStyle = getComputedStyle(node)
          const shellStyle = getComputedStyle(node.parentElement!)
          return {
            inputOutline: inputStyle.outlineStyle,
            shellColor: shellStyle.outlineColor,
            shellOffset: shellStyle.outlineOffset,
            shellStyle: shellStyle.outlineStyle,
            shellWidth: shellStyle.outlineWidth,
          }
        })
        expect(inputFocus).toEqual({
          inputOutline: "none",
          shellColor: FOCUS_COLOR,
          shellOffset: "2px",
          shellStyle: "solid",
          shellWidth: "2px",
        })

        await page.keyboard.press("Tab")
        const clear = shell.getByRole("button", { name: locale === "ko" ? "검색어 지우기" : "Clear search" })
        await expect(clear).toBeFocused()
        const clearFocus = await clear.evaluate((node) => {
          const buttonStyle = getComputedStyle(node)
          const shellStyle = getComputedStyle(node.parentElement!)
          return {
            buttonColor: buttonStyle.outlineColor,
            buttonOffset: buttonStyle.outlineOffset,
            buttonStyle: buttonStyle.outlineStyle,
            buttonWidth: buttonStyle.outlineWidth,
            shellOutline: shellStyle.outlineStyle,
          }
        })
        expect(clearFocus).toEqual({
          buttonColor: FOCUS_COLOR,
          buttonOffset: "2px",
          buttonStyle: "solid",
          buttonWidth: "2px",
          shellOutline: "none",
        })
        await context.close()
      }
    }
  })

  test("CLEAN1-D1-ATTRIBUTION isolates every source link from arbitrary basemap labels", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "one Chromium owner covers both locales and representative viewport classes")

    for (const locale of ["en", "ko"] as const) {
      for (const viewport of REPRESENTATIVE_VIEWPORTS) {
        const context = await productionContext(browser, viewport, locale)
        const page = await openPage(context, "/?city=seoul&view=map")
        const attribution = page.getByTestId("ondo-b-attribution")
        const creditSurface = attribution.getByTestId("ondo-b-map-credit-details")
        await expect(attribution).toBeVisible()
        const surface = await creditSurface.evaluate((node) => {
          const style = getComputedStyle(node)
          return {
            backgroundColor: style.backgroundColor,
            boxSizing: style.boxSizing,
            paddingLeft: style.paddingLeft,
            paddingRight: style.paddingRight,
          }
        })
        expect(surface.backgroundColor).not.toBe("rgba(0, 0, 0, 0)")
        expect(surface.boxSizing).toBe("border-box")
        await expect(attribution.getByRole("link")).toHaveCount(3)
        const targets = await attribution.getByRole("link").evaluateAll((links) => links.map((link) => {
          const box = link.getBoundingClientRect()
          return { width: box.width, height: box.height }
        }))
        expect(targets.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true)
        await context.close()
      }
    }
  })

  test("CLEAN1-D3-REFLOW makes 200-percent ultra-short search, truth, and a result reachable", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "one Chromium owner covers both locales at the exact 200-percent CSS viewport")

    for (const locale of ["en", "ko"] as const) {
      const context = await productionContext(browser, { width: 334, height: 160 }, locale)
      const page = await openPage(context, "/?city=seoul&view=map")
      const root = page.getByTestId("ondo-b-map-entry")
      const content = page.getByTestId("ondo-scroll-region")
      const search = page.getByTestId("ondo-b-search")
      const result = page.getByTestId("ondo-b-result-bar")
      const row = page.getByTestId("ondo-b-venue-list").locator("li[data-venue-id] button").first()
      await expect(root).toHaveAttribute("data-layout-mode", "ultra-short")
      await expect(root).toHaveAttribute("data-effective-view", "list")
      const metrics = await content.evaluate((node) => ({
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
        rootHeight: document.querySelector("[data-testid='ondo-b-map-entry']")!.getBoundingClientRect().height,
      }))
      expect(metrics.rootHeight).toBeGreaterThanOrEqual(216)
      expect(metrics.scrollHeight - metrics.clientHeight).toBeGreaterThanOrEqual(130)

      await expectReachableInScrollOwner(search, content)
      await expectReachableInScrollOwner(result, content, false)
      await expectReachableInScrollOwner(row, content)
      await context.close()
    }
  })

  test("CLEAN1-D4-HISTORY restores a canonical detail URL after hydration, reload, and onboarding", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "one Chromium owner covers the canonical history lifecycle")
    const detailPath = `/?city=seoul&view=list&q=Roba&category=night&venueId=${CANONICAL_VENUE_ID}&detail=1`
    const expectedParams = {
      city: "seoul",
      view: "list",
      q: "Roba",
      category: "night",
      venueId: CANONICAL_VENUE_ID,
      detail: "1",
    }

    const context = await productionContext(browser, { width: 390, height: 844 }, "en")
    const page = await openPage(context, detailPath)
    const overlay = page.getByTestId("canonical-place-overlay")
    await expect(overlay).toBeVisible()
    await expect(overlay.locator("[data-detail-state]")).toHaveAttribute("data-detail-state", "ready")
    expect(await canonicalReceipt(page)).toEqual({
      keys: ["category", "city", "detail", "q", "venueId", "view"],
      params: expectedParams,
      level: "detail",
    })

    await page.reload({ waitUntil: "domcontentloaded" })
    await expect(overlay).toBeVisible()
    await expect(overlay.locator("[data-detail-state]")).toHaveAttribute("data-detail-state", "ready")
    expect(await canonicalReceipt(page)).toEqual({
      keys: ["category", "city", "detail", "q", "venueId", "view"],
      params: expectedParams,
      level: "detail",
    })

    await page.goBack()
    await expect(page.getByTestId("canonical-place-peek")).toBeVisible()
    await page.goBack()
    await expect(page.getByTestId("canonical-place-peek")).toHaveCount(0)
    await expect(page.getByTestId("ondo-b-search")).toHaveValue("Roba")
    expect((await canonicalReceipt(page)).params.category).toBe("night")
    await page.getByTestId("ondo-b-map-options-open").click()
    const selectedCategory = page.getByTestId("ondo-b-map-options-categories").getByRole("button", { pressed: true })
    await expect(selectedCategory).toHaveAccessibleName("Pubs & cafés")
    await context.close()

    const onboardingContext = await productionContext(browser, { width: 390, height: 844 }, "en", "ONB-NEW")
    const onboardingPage = await openPage(onboardingContext, detailPath)
    await expect(onboardingPage.getByTestId("ondo-onboarding")).toHaveCount(0)
    const restored = onboardingPage.getByTestId("canonical-place-overlay")
    await expect(restored).toBeVisible()
    await expect(restored.locator("[data-detail-state]")).toHaveAttribute("data-detail-state", "ready")
    expect(await canonicalReceipt(onboardingPage)).toEqual({ keys: ["category", "city", "detail", "q", "venueId", "view"], params: expectedParams, level: "detail" })
    await onboardingPage.reload({ waitUntil: "domcontentloaded" })
    await expect(onboardingPage.getByTestId("ondo-onboarding")).toHaveCount(0)
    await expect(restored).toBeVisible()
    expect(await canonicalReceipt(onboardingPage)).toEqual({ keys: ["category", "city", "detail", "q", "venueId", "view"], params: expectedParams, level: "detail" })
    await onboardingContext.close()
  })

  test("CLEAN1-AFTER19 derives bars and pubs while preserving URL category through empty-search reset", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chromium", "the mobile project covers the consumer category rail once")
    const context = await productionContext(browser, { width: 390, height: 844 }, "en")
    await context.addInitScript(({ key, accountKey }) => {
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()
      sessionStorage.setItem(accountKey, JSON.stringify({ account: "ACC-ACTIVE", returnTo: null }))
      sessionStorage.setItem(key, JSON.stringify({
        version: 1,
        age: "eligible",
        ageExpiresAt: expiresAt,
        eligibilityReceipt: {
          schema: "local-age-declaration.v1",
          predicate: "AGE_GTE_19",
          outcome: "eligible",
          issuerType: "LOCAL_DECLARATION",
          provenanceTruth: "SELF_DECLARED",
          issuedAt: new Date(Date.now() - 60_000).toISOString(),
          expiresAt,
          disclosure: "night_view_only",
        },
        mode: "on",
        activation: "manual",
        expiryNotice: false,
      }))
    }, { key: AFTER19_SESSION_KEY, accountKey: ACCOUNT_KEY })
    const page = await openPage(context, "/?city=seoul&view=list&category=korean")
    const root = page.getByTestId("ondo-b-map-entry")
    const rail = page.getByTestId("ondo-b-category-rail")
    await expect(root).toHaveAttribute("data-after19-active", "true")
    await expect.poll(() => new URL(page.url()).searchParams.get("category")).toBe("korean")
    await expect(root).toHaveAttribute("data-result-count", "25")
    await expect(rail.getByRole("button")).toHaveCount(1)
    await expect(rail.getByRole("button", { name: "Bars & pubs", pressed: true })).toBeVisible()
    await expect(rail.getByRole("button", { name: "All" })).toHaveCount(0)
    await expect(rail.getByRole("button", { name: "Korean" })).toHaveCount(0)

    await page.getByTestId("ondo-b-search").fill("__no_after19_place__")
    const empty = page.getByTestId("ondo-b-empty-results")
    await expect(empty).toContainText("No places match")
    await empty.getByRole("button", { name: "Clear search" }).click()
    await expect(page.getByTestId("ondo-b-search")).toHaveValue("")
    await expect(empty).toHaveCount(0)
    await expect(rail.getByRole("button", { name: "Bars & pubs", pressed: true })).toBeVisible()
    await expect.poll(() => new URL(page.url()).searchParams.get("category")).toBe("korean")
    await context.close()
  })

  test("CLEAN1-MAP-A11Y enters a city with useful focus and a concise map description", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chromium", "one keyboard-capable Chromium project covers the transition")
    const context = await productionContext(browser, { width: 390, height: 844 }, "en")
    const page = await openPage(context, "/")
    const seoul = page.getByTestId("ondo-b-nation").locator("[data-city='seoul']")
    await seoul.focus()
    await page.keyboard.press("Enter")
    await expect(page.getByTestId("ondo-b-search")).toBeFocused()
    await expect(page.getByTestId("maplibre-map")).toHaveAttribute("aria-describedby", "ondo-b-map-instruction ondo-b-result-truth")
    await context.close()
  })

  test("CLEAN1-LOCATION keeps disclosure geometry inside the map and announces denial immediately", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chromium", "the narrow viewport is the clipping boundary")
    const context = await productionContext(browser, { width: 390, height: 844 }, "en")
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "geolocation", {
        configurable: true,
        value: { getCurrentPosition: (_success: PositionCallback, failure: PositionErrorCallback) => failure({ code: 1, message: "denied", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError) },
      })
    })
    const page = await openPage(context, "/?city=seoul&view=map")
    const disclosure = page.getByTestId("ondo-b-location-message")
    await disclosure.locator("summary").click()
    const [detailBox, mapBox] = await Promise.all([page.getByTestId("ondo-b-location-details").boundingBox(), page.getByTestId("ondo-b-map-entry").boundingBox()])
    expect(detailBox).not.toBeNull()
    expect(mapBox).not.toBeNull()
    expect(detailBox!.x).toBeGreaterThanOrEqual(mapBox!.x)
    expect(detailBox!.x + detailBox!.width).toBeLessThanOrEqual(mapBox!.x + mapBox!.width)
    await page.getByTestId("ondo-b-locate").click()
    await expect(page.getByTestId("ondo-b-location-feedback")).toBeVisible()
    await expect(page.getByTestId("ondo-b-location-feedback")).toContainText(/location|Search/i)
    await context.close()
  })

  test("CLEAN1-AFTER19 leaves Jeju editorial discovery unfiltered and gives selected Seoul facts a dark surface", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chromium", "one mobile After 19 receipt covers both city behaviors")
    const context = await productionContext(browser, { width: 390, height: 844 }, "en")
    await context.addInitScript(({ key }) => sessionStorage.setItem(key, JSON.stringify({
      version: 1,
      age: "eligible",
      ageExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      mode: "on",
      activation: "manual",
      expiryNotice: false,
    })), { key: AFTER19_SESSION_KEY })
    const page = await openPage(context, "/?city=jeju&view=map")
    await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-after19-session-active", "true")
    await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-after19-active", "true")
    // The place index is intentionally collapsed while the map pins remain the
    // primary Jeju interaction. Count its complete DOM set without requiring
    // hidden controls to be exposed in the accessibility tree.
    await expect(page.getByTestId("ondo-b-editorial-place-list").locator("button")).toHaveCount(8)

    await page.goto(`${ORIGIN}/?city=seoul&view=list&category=night`, { waitUntil: "domcontentloaded" })
    const firstVenue = page.getByTestId("ondo-b-venue-list").locator("li[data-venue-id] button").first()
    const transliteration = firstVenue.locator("small > span:not([class*='srOnly'])").first()
    expect(await transliteration.evaluate((node) => getComputedStyle(node).color)).toBe("rgb(242, 238, 245)")
    await firstVenue.click()
    const peek = page.getByTestId("canonical-place-peek")
    await expect(peek).toBeVisible()
    expect(await peek.evaluate((node) => getComputedStyle(node).backgroundImage)).toContain("linear-gradient")
    await context.close()
  })
})
