import { expect, test, type Page } from "@playwright/test"

// Real local BFF + sample cryptography. No provider/chain requests are allowed.
const venue = "mois-0021cd596bc5b2a922ad"
const layer = (page: Page) => page.getByTestId("hackathon-layer")
const observations = new WeakMap<Page, { forbidden: string[]; errors: string[] }>()
test.beforeEach(async ({ page, request, baseURL }) => {
  expect(baseURL).toBe("http://127.0.0.1:3137")
  expect(await (await request.get("/api/hackathon/v1/config")).json()).toMatchObject({ isolatedMock: true, capabilities: { chainExecutionEnabled: false } })
  const forbidden: string[] = [], errors: string[] = []
  observations.set(page, { forbidden, errors })
  page.on("pageerror", e => errors.push(e.message))
  await page.context().route("**/*", async route => {
    const req = route.request(), url = new URL(req.url())
    if (url.origin !== baseURL) {
      if (req.isNavigationRequest() || !["GET", "HEAD", "OPTIONS"].includes(req.method()) || /fullnode|sui\.io|enoki|omni.?one|opendid|sumsub|accounts\.google|raonsecure/i.test(url.hostname)) forbidden.push(`${req.method()} ${url.origin}`)
      return route.abort("blockedbyclient")
    }
    if (req.method() === "POST" && (!url.pathname.startsWith("/api/hackathon/v1/") || /delegation|agent\/run|\/redeem$/.test(url.pathname))) {
      forbidden.push(`${req.method()} ${url.pathname}`)
      return route.abort("blockedbyclient")
    }
    return route.continue()
  })
  await page.addInitScript(() => localStorage.setItem("ondo-b.device.v1", JSON.stringify({ locale: "en", appearancePreference: "dark", onboarding: "ONB-COMPLETE" })))
})
test.afterEach(({ page }) => {
  expect(observations.get(page)?.forbidden ?? []).toEqual([])
  expect(observations.get(page)?.errors ?? []).toEqual([])
})

async function reachIssuance(page: Page) {
  await page.goto(`/?venueId=${venue}&review=0`, { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true")
  await page.getByTestId("canonical-place-details").click()
  await page.getByTestId("hackathon-entitlement-open").click()
  await page.locator("#hk-consent").check()
  await page.getByTestId("hackathon-start").click()
  await page.getByTestId("hackathon-identity-start").click()
  await page.getByTestId("hackathon-identity-approve").click()
  await expect(layer(page)).toHaveAttribute("data-phase", "issuance")
}

test("BFF-RECOVERY-01 decline before challenge creation cancels the real local operation", async ({ page }) => {
  await reachIssuance(page)
  await page.getByTestId("hackathon-issue").click()
  await expect(layer(page)).toHaveAttribute("data-phase", "presentation")
  const response = page.waitForResponse(r => r.url().endsWith("/presentation/deny"))
  await page.getByTestId("hackathon-presentation-deny").click()
  expect((await response).status()).toBe(200)
  await expect(layer(page)).toHaveAttribute("data-status", "cancelled")
  await page.getByTestId("hackathon-return").click()
  await expect(page.getByTestId("canonical-place-overlay")).toHaveAttribute("data-venue-id", venue)
})

test("BFF-RECOVERY-02 interrupted holder acknowledgement retries the same credential after reload", async ({ page }) => {
  await reachIssuance(page)
  let failOnce = true
  await page.context().route("**/credential/holder-ack", async route => {
    if (failOnce) {
      failOnce = false
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "test_interrupted_ack", message: "Interrupted acknowledgement", retryable: true } }) })
    }
    return route.fallback()
  })
  const firstIssue = page.waitForResponse(r => r.url().endsWith("/credential/issue"))
  await page.getByTestId("hackathon-issue").click()
  const first = await (await firstIssue).json()
  await expect(layer(page).getByRole("alert")).toContainText("Interrupted acknowledgement")
  await page.reload({ waitUntil: "domcontentloaded" })
  await expect(layer(page)).toHaveAttribute("data-phase", "issuance")
  const retryIssue = page.waitForResponse(r => r.url().endsWith("/credential/issue"))
  await page.getByTestId("hackathon-issue").click()
  const second = await (await retryIssue).json()
  expect(second.result.credential.credentialRef).toBe(first.result.credential.credentialRef)
  expect(second.vc).toEqual(first.vc)
  await expect(layer(page)).toHaveAttribute("data-phase", "presentation")
  await page.getByTestId("hackathon-presentation-deny").click()
  await expect(layer(page)).toHaveAttribute("data-status", "cancelled")
})

test("BFF-RECOVERY-03 an unknown caller-selected cookie is rotated, then the known session is reused", async ({ page, context, baseURL }) => {
  const chosen = "ses_caller_selected_" + Date.now().toString(36)
  await context.addCookies([{ name: "ondo_hk_session", value: chosen, url: baseURL!, httpOnly: true, sameSite: "Lax" }])
  expect((await page.request.post("/api/hackathon/v1/sessions", { headers: { Origin: baseURL!, Cookie: `ondo_hk_session=${chosen}` } })).status()).toBe(200)
  const first = (await context.cookies()).find(c => c.name === "ondo_hk_session")!
  expect(first.value).not.toBe(chosen)
  expect(first.httpOnly).toBe(true)
  // APIRequestContext does not send production Secure cookies over plain HTTP
  // loopback, unlike the browser's potentially-trustworthy localhost context.
  expect((await page.request.post("/api/hackathon/v1/sessions", { headers: { Origin: baseURL!, Cookie: `ondo_hk_session=${first.value}` } })).status()).toBe(200)
  expect((await context.cookies()).find(c => c.name === "ondo_hk_session")!.value).toBe(first.value)
})
