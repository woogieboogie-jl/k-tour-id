import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test"

const DEVICE_KEY = "ondo-b.device.v1"
const TILEJSON = {
  tilejson: "3.0.0",
  tiles: ["https://tiles.openfreemap.org/ondo-structural-empty/{z}/{x}/{y}.pbf"],
  minzoom: 0,
  maxzoom: 18,
  bounds: [124, 33, 132, 39],
}

const VIEWPORTS = [
  { width: 320, height: 720 },
  { width: 320, height: 568 },
  { width: 360, height: 800 },
  { width: 360, height: 568 },
  { width: 390, height: 800 },
  { width: 390, height: 844 },
  { width: 390, height: 500 },
  { width: 390, height: 568 },
  { width: 430, height: 932 },
  { width: 430, height: 500 },
  { width: 500, height: 432 },
  { width: 500, height: 532 },
  { width: 599, height: 631 },
  { width: 599, height: 632 },
  { width: 599, height: 661 },
  { width: 599, height: 662 },
  { width: 599, height: 681 },
  { width: 599, height: 682 },
  { width: 600, height: 461 },
  { width: 600, height: 462 },
  { width: 600, height: 481 },
  { width: 600, height: 482 },
  { width: 600, height: 501 },
  { width: 667, height: 320 },
  { width: 667, height: 501 },
  { width: 768, height: 501 },
  { width: 844, height: 390 },
  { width: 844, height: 501 },
  { width: 844, height: 520 },
  { width: 844, height: 568 },
  { width: 926, height: 600 },
  { width: 1280, height: 720 },
  { width: 1440, height: 1024 },
] as const

type Locale = "en" | "ko"
type LocationCase = "idle" | "ready" | "denied" | "offline"
type Box = NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>

function expectedLayout(width: number, height: number) {
  if (height < 260 || (width < 480 && height < 360)) return "ultra-short"
  if (width <= 430 || (width > height && height <= 568)) return "compact-map"
  return "spacious-map"
}

function intersection(first: Box, second: Box) {
  const width = Math.max(0, Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x))
  const height = Math.max(0, Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y))
  return Number((width * height).toFixed(2))
}

async function rect(locator: Locator) {
  const value = await locator.boundingBox()
  expect(value).not.toBeNull()
  return value as Box
}

async function seed(page: Page, locale: Locale, state: LocationCase) {
  await page.addInitScript(({ key, nextLocale, denied }) => {
    localStorage.setItem(key, JSON.stringify({
      locale: nextLocale,
      onboarding: "ONB-COMPLETE",
      discoveryPreferences: [],
      savedVenueIds: [],
      privateNotesByVenue: {},
    }))
    if (denied) {
      Object.defineProperty(navigator, "geolocation", {
        configurable: true,
        value: { getCurrentPosition(_success: unknown, failure: (value: { code: number }) => void) { failure({ code: 1 }) } },
      })
    }
    window.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style")
      style.textContent = "nextjs-portal { display: none !important; }"
      document.head.append(style)
    }, { once: true })
  }, { key: DEVICE_KEY, nextLocale: locale, denied: state === "denied" })
  await page.route("https://tiles.openfreemap.org/planet", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(TILEJSON) }))
  await page.route("https://tiles.openfreemap.org/ondo-structural-empty/**", (route) => route.fulfill({ status: 200, contentType: "application/x-protobuf", body: Buffer.alloc(0) }))
}

async function activateState(context: BrowserContext, page: Page, state: LocationCase) {
  if (state === "ready" || state === "denied") {
    const locate = page.getByTestId("ondo-b-locate")
    if (await locate.count()) {
      await locate.click()
      await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-location-state", state)
    }
  }
  if (state === "offline") {
    await context.setOffline(true)
    await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-connectivity", "offline")
  }
}

async function expectContained(locator: Locator, container: Locator, label: string) {
  await expect(locator, `${label} is visible`).toBeVisible()
  const [item, owner] = await Promise.all([rect(locator), rect(container)])
  expect(item.x, `${label} left containment`).toBeGreaterThanOrEqual(owner.x - .5)
  expect(item.y, `${label} top containment`).toBeGreaterThanOrEqual(owner.y - .5)
  expect(item.x + item.width, `${label} right containment`).toBeLessThanOrEqual(owner.x + owner.width + .5)
  expect(item.y + item.height, `${label} bottom containment`).toBeLessThanOrEqual(owner.y + owner.height + .5)
}

async function expectUnclippedTruth(locator: Locator, label: string) {
  await expect(locator, `${label} is visible`).toBeVisible()
  const metrics = await locator.evaluate((node) => {
    const element = node as HTMLElement
    const style = getComputedStyle(element)
    return {
      text: element.innerText.trim(),
      clientWidth: element.clientWidth,
      clientHeight: element.clientHeight,
      scrollWidth: element.scrollWidth,
      scrollHeight: element.scrollHeight,
      fontSize: Number.parseFloat(style.fontSize),
      overflow: style.overflow,
      textOverflow: style.textOverflow,
      whiteSpace: style.whiteSpace,
    }
  })
  expect(metrics.text, `${label} truth copy remains present`).not.toBe("")
  expect(metrics.fontSize, `${label} has a 12px text floor`).toBeGreaterThanOrEqual(12)
  expect(metrics.scrollWidth, `${label} has no horizontal clipping`).toBeLessThanOrEqual(metrics.clientWidth + 1)
  expect(metrics.scrollHeight, `${label} has no vertical clipping`).toBeLessThanOrEqual(metrics.clientHeight + 1)
  expect(metrics.textOverflow, `${label} is not ellipsized`).not.toBe("ellipsis")
  expect(metrics.whiteSpace, `${label} can wrap`).not.toBe("nowrap")
}

async function expectCenterHit(locator: Locator, label: string) {
  const hit = await locator.evaluate((node) => {
    const element = node as HTMLElement
    const box = element.getBoundingClientRect()
    const target = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    return target === element || (target instanceof Node && element.contains(target))
  })
  expect(hit, `${label} owns its center hit point`).toBe(true)
}

async function expectTarget(locator: Locator, label: string) {
  const box = await rect(locator)
  expect(box.width, `${label} 44px width`).toBeGreaterThanOrEqual(44)
  expect(box.height, `${label} 44px height`).toBeGreaterThanOrEqual(44)
  await expectCenterHit(locator, label)
}

test.describe("ONDO B structural production map chrome", () => {
  test.describe.configure({ timeout: 480_000 })

  test("resize hands zoom focus to a visible successor without stealing unrelated focus", async ({ page }) => {
    await seed(page, "en", "idle")
    await page.setViewportSize({ width: 900, height: 720 })
    await page.goto("/?city=seoul&view=map", { waitUntil: "domcontentloaded" })
    const root = page.getByTestId("ondo-b-map-entry")
    const zoomIn = page.locator(".maplibregl-ctrl-group button").first()
    await expect(root).toHaveAttribute("data-map-state", "ready", { timeout: 20_000 })
    await expect(zoomIn).toBeVisible()

    await zoomIn.focus()
    await page.setViewportSize({ width: 430, height: 720 })
    await expect(root).toHaveAttribute("data-layout-mode", "compact-map")
    await expect(page.getByTestId("ondo-b-view-toggle")).toBeFocused()

    await page.setViewportSize({ width: 900, height: 720 })
    await expect(root).toHaveAttribute("data-layout-mode", "spacious-map")
    await expect(root).toHaveAttribute("data-map-state", "ready", { timeout: 20_000 })
    await expect(zoomIn).toBeVisible()
    const nav = page.getByTestId("ondo-main-nav").getByRole("button").first()
    await zoomIn.focus()
    await nav.focus()
    await page.setViewportSize({ width: 430, height: 720 })
    await expect(root).toHaveAttribute("data-layout-mode", "compact-map")
    await expect(nav).toBeFocused()

    await page.setViewportSize({ width: 900, height: 720 })
    await expect(root).toHaveAttribute("data-map-state", "ready", { timeout: 20_000 })
    await expect(zoomIn).toBeVisible()
    await zoomIn.focus()
    await page.setViewportSize({ width: 667, height: 320 })
    await expect(root).toHaveAttribute("data-layout-mode", "ultra-short")
    await expect(page.getByTestId("ondo-b-search")).toBeFocused()
  })

  for (const locale of ["en", "ko"] as const) {
    for (const locationCase of ["idle", "ready", "denied", "offline"] as const) {
      test(`${locale.toUpperCase()} ${locationCase} keeps every actual-root lane truthful across the exact matrix`, async ({ context, page }, testInfo) => {
        test.skip(testInfo.project.name !== "desktop-chromium", "The explicit matrix has one Chromium owner.")
        if (locationCase === "ready") {
          await context.grantPermissions(["geolocation"])
          await context.setGeolocation({ longitude: 127.0557, latitude: 37.5445 })
        }
        await seed(page, locale, locationCase)

        for (const viewport of VIEWPORTS) {
          await context.setOffline(false)
          await page.setViewportSize(viewport)
          await page.goto("/?city=seoul", { waitUntil: "domcontentloaded" })
          const root = page.getByTestId("ondo-b-map-entry")
          await expect(root).toHaveAttribute("data-layout-mode", /^(ultra-short|compact-map|spacious-map)$/)
          const layout = await root.getAttribute("data-layout-mode")
          const rootBox = await rect(root)
          expect(layout, `${viewport.width}x${viewport.height} uses the measured actual-root budget`).toBe(expectedLayout(rootBox.width, rootBox.height))

          const header = page.getByTestId("ondo-b-city-header")
          const search = page.getByTestId("ondo-b-search-shell")
          const rail = page.getByTestId("ondo-b-category-rail")
          await expectContained(header, root, `${viewport.width}x${viewport.height} header`)
          await expectContained(search, header, `${viewport.width}x${viewport.height} search`)
          await expectContained(rail, header, `${viewport.width}x${viewport.height} rail`)
          const railReceipt = await rail.evaluate((element) => {
            const node = element as HTMLElement
            node.scrollLeft = node.scrollWidth
            const last = node.lastElementChild?.getBoundingClientRect()
            const owner = node.getBoundingClientRect()
            return { overflow: getComputedStyle(node).overflowX, scrollLeft: node.scrollLeft, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, lastRight: last?.right, ownerRight: owner.right }
          })
          expect(railReceipt.overflow, "rail is an internal horizontal scroller").toBe("auto")
          if (railReceipt.scrollWidth > railReceipt.clientWidth + 1) expect(railReceipt.scrollLeft, "rail reaches its final category internally").toBeGreaterThan(0)
          expect(railReceipt.lastRight ?? 0, "last rail item is reachable").toBeLessThanOrEqual((railReceipt.ownerRight ?? 0) + 1)
          const categories = rail.getByRole("button")
          for (let index = 0; index < await categories.count(); index += 1) {
            await rail.evaluate((node, buttonIndex) => {
              const element = node as HTMLElement
              const button = element.querySelectorAll<HTMLElement>("button")[buttonIndex]
              if (!button) return
              const railBox = element.getBoundingClientRect()
              const buttonBox = button.getBoundingClientRect()
              const contentLeft = buttonBox.left - railBox.left + element.scrollLeft
              element.scrollLeft = Math.max(0, contentLeft - (element.clientWidth - button.offsetWidth) / 2)
            }, index)
            await expectContained(categories.nth(index), rail, `${viewport.width}x${viewport.height} category ${index + 1}`)
            await expectCenterHit(categories.nth(index), `${viewport.width}x${viewport.height} category ${index + 1}`)
          }

          await activateState(context, page, locationCase)
          const nav = page.getByTestId("ondo-main-nav")
          for (let index = 0; index < 5; index += 1) await expectTarget(nav.getByRole("button").nth(index), `nav ${index + 1}`)

          if (layout === "ultra-short") {
            await expect(page.getByTestId("ondo-b-list-panel")).toBeVisible()
            await expect(page.getByTestId("ondo-b-effective-view-label")).toBeVisible()
            await expect(page.getByTestId("ondo-b-view-toggle")).toHaveCount(0)
            await expect(page.getByTestId("ondo-b-map-key")).toHaveCount(0)
            await expect(page.getByTestId("ondo-b-location-message")).toHaveCount(0)
            await expect(page.locator(".maplibregl-ctrl-group button:visible")).toHaveCount(0)
            continue
          }

          const view = page.getByTestId("ondo-b-view-toggle")
          await expectTarget(view, `${viewport.width}x${viewport.height} view`)
          await expect(root).toHaveAttribute("data-map-state", "ready", { timeout: 20_000 })
          const chrome = page.getByTestId("ondo-b-map-chrome")
          const key = page.getByTestId("ondo-b-map-key")
          const message = page.getByTestId("ondo-b-location-message")
          const locate = page.getByTestId("ondo-b-locate")
          const result = page.getByTestId("ondo-b-result-bar")
          const attribution = page.getByTestId("ondo-b-attribution")
          const keyDetails = key.getByTestId("ondo-b-map-key-details")
          await keyDetails.locator("summary").click()
          const keyTruth = keyDetails.locator(":scope > div > small")
          await expect(keyTruth).toHaveCount(2)
          for (let index = 0; index < 2; index += 1) await expectUnclippedTruth(keyTruth.nth(index), `${viewport.width}x${viewport.height} map key ${index + 1}`)
          await keyDetails.locator("summary").click()
          await expectUnclippedTruth(key.locator(":scope > div").first().locator(":scope > span"), `${viewport.width}x${viewport.height} map key label`)
          await expectUnclippedTruth(message, `${viewport.width}x${viewport.height} location truth`)
          await expectContained(key, chrome, "key lane")
          await expectContained(message, chrome, "message lane")
          await expectContained(result, chrome, "result lane")
          const attributionBox = await rect(attribution)
          expect(attributionBox.x, "attribution stays within map root").toBeGreaterThanOrEqual(rootBox.x - .5)
          expect(attributionBox.y, "attribution stays within map root").toBeGreaterThanOrEqual(rootBox.y - .5)
          expect(attributionBox.x + attributionBox.width, "attribution stays within map root").toBeLessThanOrEqual(rootBox.x + rootBox.width + .5)
          expect(attributionBox.y + attributionBox.height, "attribution stays within map root").toBeLessThanOrEqual(rootBox.y + rootBox.height + .5)
          expect(intersection(attributionBox, await rect(chrome)), "attribution stays separate from action chrome").toBeLessThanOrEqual(.5)
          await expectTarget(locate, "location")
          await expect(attribution.getByRole("link", { name: "OpenFreeMap", exact: true })).toHaveAttribute("href", "https://openfreemap.org/")
          await expect(attribution.getByRole("link", { name: "© OpenMapTiles", exact: true })).toHaveAttribute("href", "https://openmaptiles.org/")
          await expect(attribution.getByRole("link", { name: /OpenStreetMap/ })).toHaveAttribute("href", "https://www.openstreetmap.org/copyright")
          const laneBoxes = await Promise.all([key, message, locate, result, attribution].map(rect))
          for (let left = 0; left < laneBoxes.length; left += 1) {
            for (let right = left + 1; right < laneBoxes.length; right += 1) {
              expect(intersection(laneBoxes[left], laneBoxes[right]), `lanes ${left}/${right} do not overlap`).toBeLessThanOrEqual(.5)
            }
          }
          const [headerBox, railBox, locateBox] = await Promise.all([rect(header), rect(rail), rect(locate)])
          expect(intersection(headerBox, locateBox), "location lane clears the complete header").toBeLessThanOrEqual(.5)
          expect(intersection(railBox, locateBox), "location lane clears the category rail").toBeLessThanOrEqual(.5)
          const zoomButtons = page.locator(".maplibregl-ctrl-group button:visible")
          for (let index = 0; index < await zoomButtons.count(); index += 1) await expectTarget(zoomButtons.nth(index), `zoom ${index + 1}`)
        }
      })
    }
  }
})
