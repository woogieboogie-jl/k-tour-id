import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"
import { CANONICAL_VENUE_ID } from "../helpers/ondo-b-qa"

const DEVICE_KEY = "ondo-b.device.v1"

async function seedProduction(page: Page, locale: "en" | "ko", savedVenueIds: string[] = []) {
  await page.addInitScript(({ key, language, saved }) => {
    localStorage.setItem(key, JSON.stringify({
      locale: language,
      onboarding: "ONB-COMPLETE",
      discoveryPreferences: [],
      savedVenueIds: saved,
      privateNotesByVenue: {},
    }))
  }, { key: DEVICE_KEY, language: locale, saved: savedVenueIds })
}

async function seriousAxeViolations(page: Page, selector: string) {
  const result = await new AxeBuilder({ page })
    .include(selector)
    .exclude(".maplibregl-cooperative-gesture-screen")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze()
  return result.violations.filter((item) => item.impact === "serious" || item.impact === "critical")
}

test.describe("ONDO B production inclusive surfaces", () => {
  test("B-PROD-INCLUSIVE-000 short-landscape onboarding starts at the source introduction", async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 })
    await page.addInitScript(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
    await page.goto("/", { waitUntil: "domcontentloaded" })
    const dialog = page.getByTestId("ondo-onboarding")
    await expect(dialog).toBeVisible()
    await expect(dialog).toBeFocused()
    const receipt = await dialog.evaluate((node) => {
      const language = node.querySelector<HTMLButtonElement>("button[aria-label='日本語で表示']")?.getBoundingClientRect()
      const heading = node.querySelector("h1")?.getBoundingClientRect()
      return {
        scrollTop: node.scrollTop,
        languageTop: language?.top,
        languageBottom: language?.bottom,
        headingTop: heading?.top,
        headingBottom: heading?.bottom,
        viewportHeight: window.innerHeight,
      }
    })
    expect(receipt.scrollTop).toBeLessThanOrEqual(1)
    expect(receipt.languageTop).toBeGreaterThanOrEqual(0)
    expect(receipt.languageBottom).toBeLessThanOrEqual(receipt.viewportHeight)
    expect(receipt.headingTop).toBeGreaterThanOrEqual(0)
    expect(receipt.headingBottom).toBeLessThanOrEqual(receipt.viewportHeight)
  })

  test("B-PROD-INCLUSIVE-001 category controls meet the 44px target in EN and KO", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 })
    for (const locale of ["en", "ko"] as const) {
      await seedProduction(page, locale)
      await page.goto("/?city=seoul&view=list", { waitUntil: "domcontentloaded" })
      const controls = page.locator("[data-testid='ondo-b-category-rail'] button")
      await expect(controls).toHaveCount(8)
      const boxes = await controls.evaluateAll((buttons) => buttons.map((button) => {
        const rect = button.getBoundingClientRect()
        return { width: rect.width, height: rect.height, text: button.textContent?.trim() }
      }))
      expect(boxes.filter((box) => box.width < 44 || box.height < 44)).toEqual([])
    }
  })

  test("B-PROD-INCLUSIVE-002 empty directory results preserve list semantics and contrast", async ({ page }) => {
    await seedProduction(page, "en")
    await page.goto("/?city=seoul&view=list", { waitUntil: "domcontentloaded" })
    await page.getByTestId("ondo-b-search").fill("no-record-can-match-this-query")
    const empty = page.getByTestId("ondo-b-empty-results")
    await expect(empty).toBeVisible()
    await expect(empty).toHaveRole("listitem")
    await expect(empty.getByRole("status")).toBeVisible()
    expect(await seriousAxeViolations(page, "[data-testid='ondo-b-venue-list']")).toEqual([])
  })

  test("B-PROD-INCLUSIVE-003 saved-place metadata stays at the 12px production floor", async ({ page }) => {
    await seedProduction(page, "en", [CANONICAL_VENUE_ID])
    await page.goto("/", { waitUntil: "domcontentloaded" })
    await page.getByTestId("nav-my").click()
    const card = page.getByTestId(`saved-card-${CANONICAL_VENUE_ID}`)
    await expect(card).toBeVisible()
    const undersized = await card.locator("small, p, [role='status'], [role='alert']").evaluateAll((nodes) => nodes
      .filter((node) => (node as HTMLElement).offsetParent !== null)
      .map((node) => ({ text: node.textContent?.trim(), size: Number.parseFloat(getComputedStyle(node).fontSize) }))
      .filter((entry) => entry.size < 12))
    expect(undersized).toEqual([])
    expect(await seriousAxeViolations(page, `[data-testid='saved-card-${CANONICAL_VENUE_ID}']`)).toEqual([])
  })

  test("B-PROD-INCLUSIVE-004 reset confirmation traps Tab and restores its opener", async ({ page }) => {
    await seedProduction(page, "en", [CANONICAL_VENUE_ID])
    await page.goto("/", { waitUntil: "domcontentloaded" })
    await page.getByTestId("nav-settings").click()
    await page.getByTestId("ondo-b-device-data-settings").click()
    const opener = page.getByTestId("ondo-b-clear-device-open")
    await opener.click()
    const dialog = page.getByTestId("ondo-b-clear-device-confirm")
    const back = page.getByRole("dialog", { name: "Delete saved data?", exact: true }).getByRole("button", { name: "Back", exact: true })
    const keep = dialog.getByRole("button", { name: "Keep data", exact: true })
    const clear = dialog.getByRole("button", { name: "Delete saved data", exact: true })
    await expect(keep).toBeFocused()
    await page.keyboard.press("Shift+Tab")
    await expect(back).toBeFocused()
    await page.keyboard.press("Shift+Tab")
    await expect(clear).toBeFocused()
    await page.keyboard.press("Tab")
    await expect(back).toBeFocused()
    await page.keyboard.press("Escape")
    await expect(dialog).toBeHidden()
    await expect(page.getByTestId("ondo-b-device-data-settings")).toBeFocused()
  })

  test("B-PROD-INCLUSIVE-005 place summary preserves directory access and full details isolate it", async ({ page }) => {
    await seedProduction(page, "en")
    await page.goto("/?city=seoul&view=list", { waitUntil: "domcontentloaded" })
    const directory = page.getByTestId("ondo-b-map-entry")
    await page.getByTestId("ondo-b-venue-list").locator("li button").first().click()
    const peek = page.getByTestId("canonical-place-peek")
    await expect(peek).not.toHaveAttribute("aria-modal", "true")
    const isolated = () => directory.evaluate((node) => {
      let current: Element | null = node
      while (current) {
        if (current.hasAttribute("inert") && current.getAttribute("aria-hidden") === "true") return true
        current = current.parentElement
      }
      return false
    })
    expect(await isolated()).toBe(false)
    expect(await seriousAxeViolations(page, "[data-testid='canonical-place-peek']")).toEqual([])
    await peek.getByTestId("canonical-place-details").click()
    await expect(page.getByTestId("canonical-place-overlay")).toHaveAttribute("aria-modal", "true")
    expect(await isolated()).toBe(true)
  })
})
