import { expect, test } from "@playwright/test"

const venue = "mois-0021cd596bc5b2a922ad"

// Unlike the fixture-only suite, this test reaches the real LOCAL BFF and its
// signed sample credentials. It must stop at the guarded Sui boundary, never
// claim provider verification, redeem a perk or create a chain transaction.
test("HK-BFF-LOCAL signed sample pass reaches proposal and real server blocks chain execution", async ({ page, request, baseURL }, info) => {
  expect(baseURL).toBe("http://127.0.0.1:3137")
  const config = await request.get("/api/hackathon/v1/config")
  expect(config.ok()).toBe(true)
  expect(await config.json()).toMatchObject({
    isolatedMock: true,
    modes: { cx: "mock", opendid: "mock", ai: "rule", sui: "disabled-isolated", omnione: "disabled-isolated", zklogin: "disabled-isolated" },
    capabilities: { opendidProviderReady: false, chainExecutionEnabled: false },
  })
  const forbidden: string[] = [], errors: string[] = [], mutations: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  await page.context().route("**/*", async route => {
    const req = route.request(), url = new URL(req.url())
    if (url.origin !== baseURL) {
      if (req.isNavigationRequest() || !["GET", "HEAD", "OPTIONS"].includes(req.method())
        || /sumsub|onfido|omni.?one|opendid|fullnode|sui\.io|walletconnect|stripe|raonsecure|accounts\.google\.com|mystenlabs\.com/i.test(url.hostname)) forbidden.push(`${req.method()} ${url.origin}${url.pathname}`)
      await route.abort("blockedbyclient")
      return
    }
    if (req.method() === "POST") {
      mutations.push(url.pathname)
      if (!url.pathname.startsWith("/api/hackathon/v1/")) {
        forbidden.push(`${req.method()} ${url.pathname}`)
        await route.abort("blockedbyclient")
        return
      }
    }
    await route.continue()
  })
  await page.addInitScript(() => localStorage.setItem("ondo-b.device.v1", JSON.stringify({ locale: "en", appearancePreference: "light", onboarding: "ONB-COMPLETE" })))
  await page.goto(`/?venueId=${venue}&review=0`, { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true")
  await page.getByTestId("canonical-place-details").click()
  await page.getByTestId("hackathon-entitlement-open").click()
  const layer = page.getByTestId("hackathon-layer")
  await expect(layer).toHaveAttribute("data-phase", "consent")
  await expect(page.getByTestId("hackathon-start")).toBeDisabled()
  await page.locator("#hk-consent").check()
  await page.getByTestId("hackathon-start").click()
  await page.getByTestId("hackathon-identity-start").click()
  await page.getByTestId("hackathon-identity-approve").click()
  await expect(layer).toHaveAttribute("data-phase", "issuance")
  await page.getByTestId("hackathon-issue").click()
  await expect(layer).toHaveAttribute("data-phase", "presentation")
  await page.getByTestId("hackathon-present").click()
  await expect(layer).toHaveAttribute("data-phase", "proposal")
  await page.getByTestId("hackathon-propose").click()
  await expect(layer).toHaveAttribute("data-phase", "delegation")
  await expect(page.getByTestId("hackathon-signer-google")).toHaveCount(0)
  await page.getByTestId("hackathon-signer-demo").click()
  await expect(page.getByTestId("hackathon-delegate")).toBeDisabled()
  await page.locator("#hk-approve").check()
  const blocked = page.waitForResponse(response => response.url().endsWith("/delegation/prepare"))
  await page.getByTestId("hackathon-delegate").click()
  const response = await blocked
  expect(response.status()).toBe(503)
  expect(await response.json()).toMatchObject({ error: { code: "isolated_mock_external_disabled" } })
  await expect(layer).toHaveAttribute("data-phase", "delegation")
  await expect(layer).toHaveAttribute("data-status", "pending")
  await expect(layer).toContainText("disabled in isolated mock mode")
  await expect(page.getByTestId("hackathon-agent-run")).toHaveCount(0)
  expect(mutations.some(path => /delegation\/submit|agent\/run|\/redeem$/.test(path))).toBe(false)
  await page.screenshot({ path: info.outputPath("real-local-bff-stops-before-chain.png"), scale: "css" })
  await page.getByTestId("hackathon-cancel").click()
  await expect(layer).toHaveAttribute("data-status", "cancelled")
  await page.getByTestId("hackathon-return").click()
  await expect(layer).toHaveCount(0)
  await expect(page.getByTestId("canonical-place-overlay")).toHaveAttribute("data-venue-id", venue)
  await expect(page.getByTestId("hackathon-entitlement-open")).toBeFocused()
  expect(forbidden).toEqual([])
  expect(errors).toEqual([])
})
