import { expect, test, type Page, type TestInfo } from "@playwright/test"

test.describe.configure({ timeout: 120_000 })
test.use({ serviceWorkers: "block", video: "off", deviceScaleFactor: 1 })

const VENUE_ID = "mois-0021cd596bc5b2a922ad"
const DEVICE_KEY = "ondo-b.device.v1"

async function installReadOnlyGuard(page: Page, baseURL: string) {
  const origin = new URL(baseURL).origin
  const mutations: string[] = []
  const providerRequests: string[] = []
  const blocked: string[] = []
  const hostingRequests: string[] = []
  const pageErrors: string[] = []
  page.on("pageerror", error => pageErrors.push(error.message))
  page.on("request", request => {
    const url = new URL(request.url())
    const platformProbe = request.method() === "POST" && url.origin === "https://vercel.live" && url.pathname === "/login/validate"
    const hostingFeedback = request.method() === "GET" && url.origin === "https://vercel.live" && ["/_next-live/feedback/feedback.js", "/_next-live/feedback/feedback.html"].includes(url.pathname)
    if (platformProbe || hostingFeedback) hostingRequests.push(`${request.method()} ${url.origin}${url.pathname}`)
    if (request.method() === "POST" && !platformProbe) mutations.push(`${request.method()} ${url.pathname}`)
    if (url.origin !== origin && !["tiles.openfreemap.org", "fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname) && !platformProbe && !hostingFeedback) {
      providerRequests.push(`${request.method()} ${url.origin}${url.pathname}`)
    }
  })
  await page.route("**/*", async route => {
    const request = route.request()
    const url = new URL(request.url())
    const local = url.origin === origin
    const venueRead = /^\/api\/ondo\/venues(?:\/|$)/.test(url.pathname)
    const configRead = url.pathname === "/api/hackathon/v1/config"
    const passive = ["tiles.openfreemap.org", "fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname)
    const platformProbe = request.method() === "POST" && url.origin === "https://vercel.live" && url.pathname === "/login/validate"
    const hostingFeedback = request.method() === "GET" && url.origin === "https://vercel.live" && ["/_next-live/feedback/feedback.js", "/_next-live/feedback/feedback.html"].includes(url.pathname)
    const allowed = ["GET", "HEAD", "OPTIONS"].includes(request.method()) && (local
      ? (!url.pathname.startsWith("/api/") || venueRead || configRead)
      : passive || hostingFeedback)
    if (!allowed) {
      if (platformProbe) {
        await route.abort("blockedbyclient")
        return
      }
      blocked.push(`${request.method()} ${url.origin}${url.pathname}`)
      await route.abort("blockedbyclient")
      return
    }
    await route.continue()
  })
  return { mutations, providerRequests, blocked, hostingRequests, pageErrors }
}

async function assertGuardClean(guard: Awaited<ReturnType<typeof installReadOnlyGuard>>, testInfo: TestInfo) {
  await testInfo.attach("hosting-requests", { body: JSON.stringify(guard.hostingRequests, null, 2), contentType: "application/json" })
  expect(guard.mutations).toEqual([])
  expect(guard.providerRequests).toEqual([])
  expect(guard.blocked).toEqual([])
  expect(guard.pageErrors).toEqual([])
}

async function openMap(page: Page, baseURL: string) {
  await page.addInitScript(({ key }) => {
    localStorage.setItem(key, JSON.stringify({
      onboarding: "ONB-COMPLETE", locale: "en", appearancePreference: "light",
      savedVenueIds: [], savedEditorialPlaceIds: [], recentVenueIds: [], recentEditorialPlaceIds: [],
    }))
  }, { key: DEVICE_KEY })
  await page.goto(`${baseURL}/?venueId=${VENUE_ID}&review=0`, { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("ondo-b-root")).toBeVisible()
  await expect(page.getByTestId("canonical-place-details")).toBeVisible()
  await page.getByTestId("canonical-place-details").click()
  await expect(page.getByTestId("canonical-place-overlay")).toHaveAttribute("data-venue-id", VENUE_ID)
}

test("read-only Preview readiness keeps the public place journey and blocks mutations", async ({ page, baseURL }, testInfo) => {
  const guard = await installReadOnlyGuard(page, baseURL!)
  const config = await page.request.get(`${baseURL}/api/hackathon/v1/config`)
  expect(config.status()).toBe(200)
  expect(await config.json()).toMatchObject({
    previewReadOnly: true,
    isolatedMock: true,
    capabilities: { chainExecutionEnabled: false },
  })

  await openMap(page, baseURL!)
  await page.getByTestId("hackathon-entitlement-open").click()
  const readiness = page.getByTestId("hackathon-readiness")
  await expect(readiness).toBeVisible()
  await expect(readiness).toHaveAttribute("data-status", "ready")
  await expect(readiness).toContainText(/identity|인증|本人確認/i)
  await expect(page.getByTestId("hackathon-layer")).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath("preview-readiness.png"), fullPage: false, scale: "css" })

  await page.getByTestId("hackathon-readiness-return").click()
  await expect(readiness).toHaveCount(0)
  await expect(page.getByTestId("canonical-place-overlay")).toHaveAttribute("data-venue-id", VENUE_ID)
  await expect(page.getByTestId("hackathon-entitlement-open")).toBeVisible()
  await expect(page.getByTestId("hackathon-entitlement-open")).toBeFocused()
  await page.getByTestId("canonical-place-overlay").getByRole("button", { name: "Close" }).click()
  await expect(page.getByTestId("canonical-place-overlay")).toHaveCount(0)
  await expect(page.getByTestId("ondo-b-map-entry")).toHaveAttribute("data-map-state", "ready", { timeout: 30_000 })
  await expect(page.getByTestId("maplibre-map")).toHaveAttribute("data-map-state", "ready", { timeout: 30_000 })
  await page.screenshot({ path: testInfo.outputPath("preview-return-map.png"), fullPage: false, scale: "css" })

  for (const tab of ["ondo", "my", "tables", "id", "settings"]) {
    await page.getByTestId(`nav-${tab}`).click()
    await expect(page.getByTestId("ondo-b-root")).toBeVisible()
  }

  await assertGuardClean(guard, testInfo)
})

test("read-only Preview sanitizes a fake zkLogin callback and returns to map", async ({ page, baseURL }, testInfo) => {
  const guard = await installReadOnlyGuard(page, baseURL!)
  await openMap(page, baseURL!)
  await page.evaluate(({ venueId }) => {
    sessionStorage.setItem("ondo-b.hackathon.pending.v1", JSON.stringify({ venueId, locale: "en", resumeOperationId: "preview-op", savedAt: Date.now() }))
    sessionStorage.setItem("ondo-b.hackathon.signer.v1:preview-op", JSON.stringify({ kind: "zklogin", address: "", ephemeralSecretKey: "fixture", maxEpoch: 1, randomness: "fixture", inputs: null, nonce: "fixture", jwtPending: true, oauthState: "fixture-state" }))
  }, { venueId: VENUE_ID })
  const beforeSession = await page.evaluate(() => Object.fromEntries(Object.entries(sessionStorage)))
  await page.goto(`${baseURL}/hackathon/zklogin/callback#state=fixture-state&id_token=fixture.payload.signature`, { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("hackathon-login-return")).toBeVisible()
  await expect(page.getByRole("heading", { name: /sign-in wasn't completed/i })).toBeVisible()
  await expect.poll(() => {
    const url = new URL(page.url())
    return { pathname: url.pathname, hash: url.hash, state: url.searchParams.get("state"), idToken: url.searchParams.get("id_token") }
  }).toEqual({ pathname: "/hackathon/zklogin/callback", hash: "", state: null, idToken: null })
  await expect.poll(() => page.evaluate(() => Object.fromEntries(Object.entries(sessionStorage)))).toEqual(beforeSession)
  await page.getByTestId("hackathon-login-return").click()
  await expect(page.getByTestId("ondo-b-root")).toBeVisible()
  await expect(page.getByTestId("hackathon-layer")).toHaveCount(0)
  await assertGuardClean(guard, testInfo)
})

test("read-only Preview does not expose the Lab header route", async ({ page, baseURL }, testInfo) => {
  const guard = await installReadOnlyGuard(page, baseURL!)
  const response = await page.goto(`${baseURL}/labs/header-preview`, { waitUntil: "domcontentloaded" })
  expect(response?.status()).toBe(404)
  await assertGuardClean(guard, testInfo)
})
