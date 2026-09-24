import { expect, test, type Page } from "@playwright/test"
import {
  expectBRuntimeClean,
  gotoB,
  installBRuntimeGuard,
  prepareBPage,
  seedB,
} from "../helpers/ondo-b-qa"

test.describe.configure({ timeout: 60_000 })
test.use({ serviceWorkers: "block" })

const WIDTHS = [320, 360, 390, 430] as const
const LOCALES = ["ja", "ko", "en"] as const

async function openRoot(page: Page, width: number, locale: "ja" | "ko" | "en", colorScheme: "light" | "dark" = "light") {
  await page.setViewportSize({ width, height: 844 })
  await page.emulateMedia({ colorScheme, reducedMotion: "reduce" })
  await prepareBPage(page)
  await seedB(page, { locale })
  const origin = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3112"
  const config = await page.request.get(`${origin}/api/hackathon/v1/config`)
  expect(config.ok()).toBe(true)
  expect(await config.json()).toMatchObject({ isolatedMock: true })
  await page.route("**/*", async route => {
    const request = route.request()
    const url = new URL(request.url())
    const local = url.origin === new URL(origin).origin
    const allowedApi = url.pathname === "/api/hackathon/v1/config" || /^\/api\/ondo\/venues(?:\/|$)/.test(url.pathname)
    const passive = ["tiles.openfreemap.org", "fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname)
    const allowed = ["GET", "HEAD"].includes(request.method()) && (local ? (!url.pathname.startsWith("/api/") || allowedApi) : passive)
    if (!allowed) return route.abort("blockedbyclient")
    return route.continue()
  })
  await gotoB(page, "?city=seoul")
  await page.evaluate(() => document.fonts.ready)
}

async function readTitleFrame(page: Page) {
  const frame = page.locator('[data-page-title-frame]').first()
  const title = page.locator('[data-page-title]').first()
  await expect(frame).toBeVisible()
  await expect(title).toBeVisible()
  return page.evaluate(() => {
    const frame = document.querySelector<HTMLElement>('[data-page-title-frame]')!
    const title = document.querySelector<HTMLElement>('[data-page-title]')!
    const fs = getComputedStyle(title)
    const fr = frame.getBoundingClientRect()
    const tr = title.getBoundingClientRect()
    return {
      frame: { x: fr.x, y: fr.y, width: fr.width, height: fr.height },
      title: { x: tr.x, y: tr.y, width: tr.width, height: tr.height },
      fontSize: Number.parseFloat(fs.fontSize),
      lineHeight: Number.parseFloat(fs.lineHeight),
      fontWeight: Number.parseInt(fs.fontWeight, 10),
      viewport: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }
  })
}

test.beforeEach(({ page }) => installBRuntimeGuard(page))
test.afterEach(async ({ page }, testInfo) => { await expectBRuntimeClean(page, testInfo) })

// Each profile gets Playwright's fresh mobile context, including its baseURL,
// touch emulation and isolated storage. One slow profile cannot skip the rest.
for (const width of WIDTHS) {
  for (const locale of LOCALES) {
    for (const colorScheme of ["light", "dark"] as const) {
      test(`root title rhythm: ${width}px ${locale} ${colorScheme}`, async ({ page }) => {
          await openRoot(page, width, locale, colorScheme)
          await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-locale", locale)
          await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-appearance", colorScheme)
          const gutter = width <= 360 ? 16 : 20
          for (const tab of ["my", "tables", "id", "settings"] as const) {
            await page.getByTestId(`nav-${tab}`).click()
            const root = page.locator('[data-page-typography="root"]')
            await expect(root).toBeVisible()
            const metrics = await readTitleFrame(page)
            expect(metrics.frame.y).toBeGreaterThanOrEqual(26)
            expect(metrics.frame.y).toBeLessThanOrEqual(32)
            expect(metrics.frame.height).toBeGreaterThanOrEqual(48)
            expect(metrics.frame.x).toBeGreaterThanOrEqual(gutter - 1)
            expect(metrics.frame.x + metrics.frame.width).toBeLessThanOrEqual(width - gutter + 1)
            expect(metrics.fontSize).toBeGreaterThanOrEqual(30)
            expect(metrics.fontSize).toBeLessThanOrEqual(32)
            expect(metrics.lineHeight / metrics.fontSize).toBeGreaterThanOrEqual(1.05)
            expect(metrics.lineHeight / metrics.fontSize).toBeLessThanOrEqual(1.12)
            expect(metrics.scrollWidth).toBeLessThanOrEqual(width)
          }
      })
    }
  }
}

test("settings copy and title frame remain contained at the narrowest width", async ({ page }) => {
  await openRoot(page, 320, "en")
  await page.getByTestId("nav-settings").click()
  const title = page.locator('[data-page-title]')
  await expect(title).toHaveText("Settings")
  await expect(page.getByText("Demo", { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
  const frame = await readTitleFrame(page)
  expect(frame.title.x + frame.title.width).toBeLessThanOrEqual(304)
  const controls = await page.locator('[data-testid="ondo-b-settings-entry"] button').evaluateAll(nodes => nodes.map(node => {
    const r = node.getBoundingClientRect()
    return { right: r.right, bottom: r.bottom, width: r.width, height: r.height }
  }))
  for (const control of controls) {
    expect(control.right).toBeLessThanOrEqual(320)
    expect(control.width).toBeGreaterThanOrEqual(44)
    expect(control.height).toBeGreaterThanOrEqual(44)
  }
  const originalSize = await page.evaluate(() => {
    const scope = document.querySelector<HTMLElement>('[data-testid="ondo-b-settings-entry"]')!
    const targets = [...scope.querySelectorAll<HTMLElement>('h1,h2,h3,p,span,strong,small,button')]
      .filter(node => (node.textContent ?? '').trim().length > 0)
    const before = Number.parseFloat(getComputedStyle(scope.querySelector('h1')!).fontSize)
    const sizes = targets.map(node => Number.parseFloat(getComputedStyle(node).fontSize))
    targets.forEach((node, index) => { if (Number.isFinite(sizes[index])) node.style.setProperty('font-size', `${sizes[index] * 2}px`, 'important') })
    return before
  })
  // Reduced-motion CSS still permits a tiny transition duration; measure the
  // settled 2x text, not the old frame immediately after the style mutation.
  await expect.poll(() => title.evaluate(node => Number.parseFloat(getComputedStyle(node).fontSize))).toBe(originalSize * 2)
  const stress = await page.evaluate(() => {
    const scope = document.querySelector<HTMLElement>('[data-testid="ondo-b-settings-entry"]')!
    const title = scope.querySelector<HTMLElement>('h1')!.getBoundingClientRect()
    const actions = [...scope.querySelectorAll<HTMLElement>('button')].map(node => { const r = node.getBoundingClientRect(); return { right: r.right, width: r.width, height: r.height } })
    return { titleRight: title.right, actions }
  })
  expect(stress.titleRight).toBeLessThanOrEqual(320)
  for (const action of stress.actions) {
    expect(action.right).toBeLessThanOrEqual(320)
    expect(action.width).toBeGreaterThanOrEqual(44)
    expect(action.height).toBeGreaterThanOrEqual(44)
  }
})

test("Tables headings use the bounded mobile card scale and do not overlap cards", async ({ page }) => {
  for (const width of [320, 390] as const) {
    await openRoot(page, width, "ja")
    await page.getByTestId("nav-tables").click()
    const headings = page.locator('[data-testid^="table-card-"] h2')
    await expect(headings.first()).toBeVisible()
    const values = await headings.evaluateAll(nodes => nodes.map(node => {
      const r = node.getBoundingClientRect(), s = getComputedStyle(node)
      const card = node.closest("article")!.getBoundingClientRect()
      const next = (node.nextElementSibling as HTMLElement | null)?.getBoundingClientRect()
      return { y: r.y, bottom: r.bottom, cardBottom: card.bottom, nextTop: next?.top ?? null, font: Number.parseFloat(s.fontSize), line: Number.parseFloat(s.lineHeight) }
    }))
    for (const value of values) {
      expect(value.font).toBeGreaterThanOrEqual(20)
      expect(value.font).toBeLessThanOrEqual(22)
      expect(value.line / value.font).toBeGreaterThanOrEqual(1.15)
      expect(value.line / value.font).toBeLessThanOrEqual(1.25)
      expect(value.bottom).toBeGreaterThan(value.y)
      expect(value.bottom).toBeLessThanOrEqual(value.cardBottom)
      expect(value.nextTop).not.toBeNull()
      expect(value.nextTop!).toBeGreaterThanOrEqual(value.bottom)
    }
  }
})

test("wallet hero keeps explicit heading rhythm and card separation", async ({ page }) => {
  await openRoot(page, 390, "ja")
  await page.getByTestId("nav-id").click()
  const wallet = page.getByTestId("wallet-balance")
  await expect(wallet).toBeVisible()
  const metrics = await page.evaluate(() => {
    const heading = document.querySelector<HTMLElement>("#id-wallet-commerce-title")
    const card = document.querySelector<HTMLElement>('[data-testid="wallet-balance"]')
    if (!heading || !card) return null
    const h = heading.getBoundingClientRect(), c = card.getBoundingClientRect(), s = getComputedStyle(heading)
    return { ratio: Number.parseFloat(s.lineHeight) / Number.parseFloat(s.fontSize), gap: c.top - h.bottom }
  })
  expect(metrics).not.toBeNull()
  expect(metrics!.ratio).toBeGreaterThanOrEqual(1.08)
  expect(metrics!.ratio).toBeLessThanOrEqual(1.16)
  expect(metrics!.gap).toBeGreaterThanOrEqual(16)
})

test("settings child is a real click target and closes without title-frame drift", async ({ page }) => {
  await openRoot(page, 320, "ja")
  await page.getByTestId("nav-settings").click()
  const before = await readTitleFrame(page)
  await page.getByTestId("settings-language-row").click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  const after = await readTitleFrame(page)
  expect(after.title.y).toBe(before.title.y)
})

test("ID setup opens read-only and remains within the phone viewport", async ({ page }) => {
  for (const width of [320, 390] as const) {
    await openRoot(page, width, "ja")
    await page.getByTestId("nav-id").click()
    await page.getByTestId("kpass-start-setup").click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    const box = await dialog.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    await page.keyboard.press("Escape")
    await expect(dialog).toHaveCount(0)
  }
})

test("Tables detail opens by click and returns to the same tab without a title collision", async ({ page }) => {
  await openRoot(page, 390, "ja")
  await page.getByTestId("nav-tables").click()
  const open = page.locator('[data-testid^="table-open-"]').first()
  await expect(open).toBeVisible()
  await open.click()
  await expect(page.getByTestId("table-detail")).toBeVisible()
  const detail = await page.getByTestId("table-detail").boundingBox()
  expect(detail).not.toBeNull()
  expect(detail!.x).toBeGreaterThanOrEqual(0)
  expect(detail!.x + detail!.width).toBeLessThanOrEqual(390)
  await page.keyboard.press("Escape")
  await expect(page.getByTestId("table-detail")).toHaveCount(0)
  await expect(page.getByTestId("tables-entry")).toBeVisible()
})
