import { expect, test, type Locator, type Page } from "@playwright/test"

const PLACE = "mois-0021cd596bc5b2a922ad"
// A real directory entry without a registered commerce/guide capability.
const DIRECTORY_ONLY = "mois-02d77be9fc4b43fbb360"
const failures = new WeakMap<Page, string[]>()
const profiles = [
  { width: 320, height: 800, locale: "ja", appearance: "light" },
  { width: 390, height: 844, locale: "en", appearance: "dark" },
  { width: 1440, height: 1000, locale: "en", appearance: "light" },
] as const
type Profile = typeof profiles[number]

test.describe.configure({ timeout: 90_000 })
test.use({ serviceWorkers: "block" })

test.beforeEach(async ({ page, context, baseURL, request }) => {
  expect(baseURL).toBeTruthy()
  const origin = new URL(baseURL!).origin
  expect(["127.0.0.1", "localhost", "[::1]"]).toContain(new URL(origin).hostname)
  const config = await request.get(`${origin}/api/hackathon/v1/config`)
  expect(config.ok()).toBe(true)
  expect(await config.json()).toMatchObject({ isolatedMock: true })
  const seen: string[] = []
  failures.set(page, seen)
  page.on("pageerror", error => seen.push(error.message))
  await context.route("**/*", async route => {
    const incoming = route.request(), url = new URL(incoming.url())
    const readOnly = ["GET", "HEAD"].includes(incoming.method())
    const local = url.origin === origin
    const knownApi = /^\/api\/hackathon\/v1\/config$/.test(url.pathname)
      || /^\/api\/ondo\/venues(?:\/|$)/.test(url.pathname)
    const asset = ["tiles.openfreemap.org", "fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname)
      && !incoming.isNavigationRequest()
    if (!(readOnly && (local ? !url.pathname.startsWith("/api/") || knownApi : asset))) {
      seen.push(`${incoming.method()} ${url.origin}${url.pathname}`)
      await route.abort("blockedbyclient")
      return
    }
    await route.continue()
  })
})
test.afterEach(({ page }) => { expect(failures.get(page) ?? [], "No authentication, signature, payment or provider call").toEqual([]) })

async function openPlace(page: Page, profile: Profile, place = PLACE, review = true) {
  await page.setViewportSize({ width: profile.width, height: profile.height })
  await page.emulateMedia({ colorScheme: profile.appearance })
  // Preferences and an explicit local preview URL only, never injected authority.
  await page.addInitScript(({ locale, appearance }) => {
    localStorage.setItem("ondo-b.device.v1", JSON.stringify({ locale, appearancePreference: appearance, onboarding: "ONB-COMPLETE" }))
  }, profile)
  await page.goto(`/?review=${review ? "1" : "0"}&city=seoul&view=list&venueId=${place}&detail=1`, { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true")
  const detail = page.getByTestId("canonical-place-overlay")
  await expect(detail).toHaveAttribute("data-venue-id", place)
  await expect(detail.locator("[data-detail-state]").first()).not.toHaveAttribute("data-detail-state", "loading")
  return detail
}

async function authority(page: Page) {
  return page.evaluate(() => {
    const gate = JSON.parse(sessionStorage.getItem("ondo-b.action-gates.v1") ?? "null")
    return {
      pending: gate?.pending ?? null, presentation: gate?.presentation ?? null,
      consumed: gate?.lastConsumed ?? null, person: gate?.person ?? null, payment: gate?.payment ?? null,
      funding: sessionStorage.getItem("ondo-b.funding-rail.v1"),
      guideSave: sessionStorage.getItem("ktour.experience-save-open.v2"),
    }
  })
}

async function usableRow(action: Locator) {
  await action.scrollIntoViewIfNeeded()
  await expect(action).toBeVisible()
  const geometry = await action.evaluate(node => {
    const box = node.getBoundingClientRect()
    return {
      width: node.clientWidth, scrollWidth: node.scrollWidth, height: box.height,
      hit: node.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)),
      icon: Array.from(node.querySelectorAll("svg")).map(icon => ({ width: icon.getBoundingClientRect().width, display: getComputedStyle(icon).display })),
      text: Array.from(node.querySelectorAll("strong,small")).map(text => {
        const range = document.createRange(); range.selectNodeContents(text)
        const ink = range.getBoundingClientRect(), frame = text.getBoundingClientRect()
        return { right: ink.right, bottom: ink.bottom, frameRight: frame.right, frameBottom: frame.bottom }
      }),
    }
  })
  expect(geometry.height).toBeGreaterThanOrEqual(44)
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1)
  expect(geometry.hit).toBe(true)
  expect(geometry.icon[0]?.width).toBeGreaterThanOrEqual(18)
  expect(geometry.icon[0]?.display).not.toBe("none")
  for (const text of geometry.text) {
    expect(text.right).toBeLessThanOrEqual(text.frameRight + 1)
    expect(text.bottom).toBeLessThanOrEqual(text.frameBottom + 1)
  }
}

async function intactHeader(detail: Locator) {
  const article = detail.locator(":scope > article")
  const header = article.locator(":scope > header")
  for (const target of [header, header.locator(":scope > span"), ...await header.locator("button").all()]) {
    const measured = await target.evaluate(node => {
      const rect = node.getBoundingClientRect()
      let left = 0, top = 0, right = innerWidth, bottom = innerHeight
      for (let owner = node.parentElement; owner; owner = owner.parentElement) {
        const css = getComputedStyle(owner), box = owner.getBoundingClientRect()
        if (/auto|scroll|hidden|clip/.test(css.overflowX)) { left = Math.max(left, box.left); right = Math.min(right, box.right) }
        if (/auto|scroll|hidden|clip/.test(css.overflowY)) { top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom) }
      }
      return {
        frame: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
        clip: { left, right, top, bottom },
        hits: [rect.top + 2, rect.top + rect.height / 2, rect.bottom - 2].map(y => node.contains(document.elementFromPoint(rect.left + rect.width / 2, y))),
      }
    })
    expect(measured.frame.left).toBeGreaterThanOrEqual(measured.clip.left - 1)
    expect(measured.frame.right).toBeLessThanOrEqual(measured.clip.right + 1)
    expect(measured.frame.top).toBeGreaterThanOrEqual(measured.clip.top - 1)
    expect(measured.frame.bottom).toBeLessThanOrEqual(measured.clip.bottom + 1)
    expect(measured.hits).toEqual([true, true, true])
  }
  const cutouts = await article.evaluate(node => {
    const css = getComputedStyle(node), box = node.getBoundingClientRect()
    return {
      radii: [parseFloat(css.borderTopLeftRadius), parseFloat(css.borderTopRightRadius)], overflow: css.overflowY,
      viewportWidth: innerWidth, rightDocked: Math.abs(box.right - (node.parentElement?.getBoundingClientRect().right ?? innerWidth)) < 1,
      hitInsideSheet: [box.left + 3, box.right - 3].map(x => node.contains(document.elementFromPoint(x, box.top + 3))),
    }
  })
  expect(cutouts.overflow).toMatch(/hidden|clip/)
  expect(cutouts.radii[0]).toBeGreaterThanOrEqual(16)
  if (cutouts.viewportWidth < 900) expect(cutouts.radii[1]).toBeGreaterThanOrEqual(16)
  for (let corner = 0; corner < 2; corner++) {
    if (cutouts.radii[corner] >= 16) expect(cutouts.hitInsideSheet[corner], "Header content must stay outside the rounded cutout").toBe(false)
    // The existing desktop drawer intentionally has a square, canvas-flush
    // right edge. Do not invent a second rounded corner for that layout.
    else expect(corner === 1 && cutouts.rightDocked).toBe(true)
  }
}

for (const profile of profiles) test(`GROUP-01 ${profile.width} ${profile.locale} ${profile.appearance}: action hierarchy and optional reading/stamp returns`, async ({ page }, info) => {
  const detail = await openPlace(page, profile)
  const actions = detail.getByTestId("canonical-place-actions")
  const memories = detail.getByTestId("canonical-trip-actions")
  await expect(actions).toHaveCount(1)
  await expect(memories).toHaveCount(1)
  await expect(memories.getByRole("heading")).toHaveCount(1)
  if (profile.locale === "en") await expect(memories.getByRole("heading")).toHaveText("Guides & memories")
  for (const id of ["canonical-meal-benefit-open", "place-reservation-open", "hackathon-entitlement-open"]) {
    await expect(actions.getByTestId(id)).toHaveCount(1)
    await expect(memories.getByTestId(id)).toHaveCount(0)
  }
  for (const id of ["experience-open", "canonical-journey-open"]) {
    await expect(memories.getByTestId(id)).toHaveCount(1)
    await expect(actions.getByTestId(id)).toHaveCount(0)
  }
  await expect(detail.getByTestId("experience-open")).toHaveCount(1)
  await expect(detail.getByTestId("experience-open")).toHaveAttribute("data-place-return-section", "experience")
  await expect(detail.getByTestId("hackathon-entitlement-open")).toHaveAttribute("data-place-service", "hackathon")
  await expect(detail.getByTestId("place-service-actions")).toHaveAttribute("data-capability-mode", "sample")
  expect(await actions.evaluate(node => Boolean(node.compareDocumentPosition(document.querySelector('[data-testid="canonical-trip-actions"]')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true)
  await intactHeader(detail)
  await page.screenshot({ path: info.outputPath("place-first-view.png"), scale: "css" })
  for (const id of ["canonical-meal-benefit-open", "place-reservation-open", "hackathon-entitlement-open", "experience-open", "canonical-journey-open", "canonical-place-table"]) await usableRow(detail.getByTestId(id))
  await intactHeader(detail)
  await page.screenshot({ path: info.outputPath("place-after-scrolling.png"), scale: "css" })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(profile.width)
  if (profile.width === 1440) {
    const a = await actions.boundingBox(), b = await memories.boundingBox()
    expect(a).not.toBeNull(); expect(b).not.toBeNull()
    // Desktop reads left-to-right: actions then memories in the same grid row.
    expect(b!.x).toBeGreaterThanOrEqual(a!.x + a!.width - 1)
    expect(Math.abs(b!.y - a!.y)).toBeLessThanOrEqual(1)
  }
  const table = detail.getByTestId("canonical-place-table")
  await expect(table).toHaveAttribute("data-place-service", "table")
  await expect(table.locator("strong")).toHaveText(profile.locale === "ja" ? "旅行者と食事" : "Dine with travelers")
  await expect(table.locator("small")).not.toBeEmpty()
  await expect(detail.getByTestId("canonical-after19-required")).toHaveCount(1)
  const initialAuthority = await authority(page)
  const scroller = detail.locator("[data-place-return-scroll='detail']")
  for (const [id, surface] of [["experience-open", "experience-public-guide"], ["canonical-journey-open", "journey-visit-sheet"]] as const) {
    const opener = detail.getByTestId(id)
    await usableRow(opener)
    const before = await scroller.evaluate(node => node.scrollTop)
    await page.screenshot({ path: info.outputPath(`before-${id}.png`), scale: "css" })
    await opener.click()
    const content = page.getByTestId(surface)
    await expect(content).toBeVisible()
    await expect(page.getByTestId("ondo-b-action-gate")).toHaveCount(0)
    await expect(page.getByTestId("experience-flow")).toHaveCount(0)
    if (surface === "experience-public-guide") {
      await expect(page.getByTestId("experience-guide-content").getByRole("heading", { level: 3 })).toHaveCount(3)
      await expect(page.getByTestId("experience-add-to-pass")).toBeEnabled()
    } else {
      await expect(content).toHaveAttribute("data-recorded", "false")
      await expect(page.getByTestId("visit-stamp-receipt")).toHaveAttribute("data-stamp-count", "0")
    }
    await page.getByTestId("ondo-sheet").filter({ has: content }).locator("button[data-sheet-navigation]").click()
    await expect(content).toHaveCount(0)
    await expect(detail).toHaveAttribute("data-venue-id", PLACE)
    await expect(opener).toBeFocused()
    await expect.poll(async () => Math.abs(await scroller.evaluate(node => node.scrollTop) - before)).toBeLessThanOrEqual(1)
    await intactHeader(detail)
    expect(await authority(page)).toEqual(initialAuthority)
  }
  await expect(detail.getByTestId("canonical-journey-open")).toHaveAttribute("data-recorded", "false")
  await expect(page.getByTestId("hackathon-layer")).toHaveCount(0)
})

for (const profile of [profiles[1], profiles[2]]) test(`GROUP-02 ${profile.width}: directory-only place does not inherit services, a guide or empty action group`, async ({ page }, info) => {
  const detail = await openPlace(page, profile, DIRECTORY_ONLY)
  await expect(detail.getByTestId("canonical-place-actions")).toBeHidden()
  await expect(detail.getByTestId("canonical-place-actions").locator("button,a")).toHaveCount(0)
  for (const id of ["place-service-actions", "hackathon-entitlement-open", "experience-open", "canonical-place-table"]) await expect(detail.getByTestId(id)).toHaveCount(0)
  const memories = detail.getByTestId("canonical-trip-actions")
  await expect(memories.getByTestId("canonical-journey-open")).toHaveCount(1)
  await usableRow(memories.getByTestId("canonical-journey-open"))
  await page.screenshot({ path: info.outputPath("directory-only-memories.png"), scale: "css" })
})

test("GROUP-03 non-review designated venue retains Harvey independently of hidden sample services", async ({ page }) => {
  const detail = await openPlace(page, profiles[1], PLACE, false)
  const actions = detail.getByTestId("canonical-place-actions")
  await expect(actions.getByTestId("hackathon-entitlement-open")).toHaveCount(1)
  await expect(actions.getByTestId("place-service-actions")).toHaveCount(0)
  await expect(detail.getByTestId("experience-open")).toHaveCount(0)
  await expect(detail.getByTestId("canonical-trip-actions").getByTestId("canonical-journey-open")).toHaveCount(1)
  await expect(page.getByTestId("hackathon-layer")).toHaveCount(0)
  await expect(page.getByTestId("ondo-b-action-gate")).toHaveCount(0)
})

test("GROUP-04 dining with travelers opens a Table view, not a reservation or an automatic join", async ({ page }, info) => {
  const detail = await openPlace(page, profiles[1])
  await detail.getByTestId("canonical-place-table").click()
  const table = page.getByTestId("table-detail")
  await expect(table).toHaveAttribute("data-venue-id", PLACE)
  await expect(table).toHaveAttribute("data-table-membership", "TMB-NONE")
  await expect(page.getByTestId("reservation-sample")).toHaveCount(0)
  await expect(page.getByTestId("ondo-b-action-gate")).toHaveCount(0)
  await page.screenshot({ path: info.outputPath("table-view-not-reservation.png"), scale: "css" })
  await table.getByTestId("table-return-place").click()
  await expect(detail).toHaveAttribute("data-venue-id", PLACE)
  await expect(detail.getByTestId("canonical-place-table")).toBeVisible()
  await expect(detail.getByTestId("place-reservation-open")).toHaveCount(1)
})
