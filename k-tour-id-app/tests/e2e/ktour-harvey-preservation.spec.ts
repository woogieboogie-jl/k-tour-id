import type { Page } from "@playwright/test"
import { CANONICAL_MAP_VENUES_COMPACT } from "../../lib/ondo/venues/map-data"
import { expect, HARVEY_VENUE, test, type HarveyFixture } from "./helpers/harvey-fixture"

// Browser-only integration boundaries. Every provider/API result is intercepted;
// a synthetic OAuth fragment is NOT an authenticated Google token or Sui proof.
test.describe.configure({ timeout: 60_000 })
test.use({ serviceWorkers: "block" })
const layer = (page: Page) => page.getByTestId("hackathon-layer")

async function reachDelegation(page: Page, fixture: HarveyFixture, query = "") {
  await fixture.preferences("en", "dark")
  await fixture.open(query)
  await page.locator("#hk-consent").check()
  await page.getByTestId("hackathon-start").click()
  await page.getByTestId("hackathon-identity-start").click()
  await page.getByTestId("hackathon-identity-approve").click()
  await page.getByTestId("hackathon-issue").click()
  await page.getByTestId("hackathon-present").click()
  await page.getByTestId("hackathon-propose").click()
  await expect(layer(page)).toHaveAttribute("data-phase", "delegation")
}

async function discoveryContext(page: Page) {
  return page.evaluate(() => {
    const entry = history.state?.__ondoBDiscovery
    if (!entry) return null
    const { city, view, query, category, editorialCategory, layer, camera, listScroll } = entry
    return { city, view, query, category, editorialCategory, layer, camera, listScroll }
  })
}

test("PRESERVE-01 native Back during preparation closes the journey and prevents a late signature", async ({ page, harvey }, info) => {
  await reachDelegation(page, harvey)
  await page.getByTestId("hackathon-signer-demo").click()
  let release = () => {}
  let received = false
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.context().route("**/delegation/prepare", async route => {
    received = true
    await gate
    await route.fallback()
  })
  try {
    await page.locator("#hk-approve").check()
    await page.getByTestId("hackathon-delegate").click()
    await expect.poll(() => received).toBe(true)
    await page.goBack({ waitUntil: "domcontentloaded" })
    await expect.soft(layer(page), "Native Back must leave the active approval UI").toHaveCount(0)
    const response = page.waitForResponse(r => r.url().endsWith("/delegation/prepare"))
    release()
    await response
    await page.waitForTimeout(350)
    await page.screenshot({ path: info.outputPath("native-back-after-delayed-prepare.png"), scale: "css" })
    for (const action of ["delegation/submit", "agent/run", "redeem"]) expect.soft(harvey.actionCount(action), action).toBe(0)
    expect(harvey.actionCount("cancel"), "Navigation is not a server cancellation").toBe(0)
  } finally { release() }
})

for (const outcome of ["cancelled", "accepted"] as const) {
  test(`PRESERVE OAuth ${outcome} full-document return preserves discovery context without approving execution`, async ({ page, harvey }, info) => {
    harvey.config.isolatedMock = false // Fictional DTO only; external traffic is still blocked.
    harvey.config.modes.zklogin = "google"
    await reachDelegation(page, harvey, "&q=coffee&category=night&view=list")
    const before = await discoveryContext(page)
    expect(before).toMatchObject({ query: "coffee", category: "night", view: "list" })
    const id = harvey.operation!.operationId
    const state = "fixture-oauth-correlation-only"
    await page.evaluate(({ id, state }) => sessionStorage.setItem(`ondo-b.hackathon.signer.v1:${id}`, JSON.stringify({
      kind: "zklogin", address: "", ephemeralSecretKey: "FIXTURE_NOT_A_PRIVATE_KEY", maxEpoch: 100,
      randomness: "fixture", inputs: null, nonce: "fixture", jwtPending: true, oauthState: state,
    })), { id, state })
    const fragment = outcome === "cancelled" ? `error=access_denied&state=${state}` : `id_token=synthetic.payload.signature&state=${state}`
    await page.goto(`/hackathon/zklogin/callback#${fragment}`, { waitUntil: "domcontentloaded" })
    if (outcome === "cancelled") {
      await expect(page.getByTestId("hackathon-login-return")).toBeVisible()
      expect(new URL(page.url()).hash).toBe("")
      await page.getByTestId("hackathon-login-return").click()
    }
    await expect(layer(page)).toHaveAttribute("data-phase", "delegation")
    await expect(page.getByTestId("hackathon-signer-google")).toBeVisible()
    await expect(page.locator("#hk-approve")).toHaveCount(0)
    expect(new URL(page.url()).hash).toBe("")
    expect(harvey.count("/zklogin/prove")).toBe(0)
    for (const action of ["delegation/prepare", "delegation/submit", "agent/run", "redeem"]) expect(harvey.actionCount(action)).toBe(0)
    await page.getByTestId("hackathon-close").click()
    await expect(layer(page)).toHaveCount(0)
    await expect(page.getByTestId("canonical-place-overlay")).toHaveAttribute("data-venue-id", HARVEY_VENUE)
    await expect(page.getByTestId("hackathon-entitlement-open")).toBeFocused()
    await page.screenshot({ path: info.outputPath(`oauth-${outcome}-place-return.png`), scale: "css" })
    await expect.poll(() => discoveryContext(page), "OAuth navigation must not reset the prior map/list filters").toEqual(before)
  })
}

for (const timestamp of ["expired", "future"] as const) {
  test(`PRESERVE stale ${timestamp} return marker cannot resume or restore a journey`, async ({ page, harvey }) => {
    await reachDelegation(page, harvey, "&q=coffee&category=night&view=list")
    await page.evaluate(timestamp => {
      const key = "ondo-b.hackathon.pending.v1"
      const pending = JSON.parse(sessionStorage.getItem(key) ?? "null")
      if (!pending?.resumeOperationId) throw new Error("A genuine pending fixture operation is required")
      sessionStorage.setItem(key, JSON.stringify({ ...pending, savedAt: Date.now() + (timestamp === "future" ? 2 : -2) * 60 * 60_000 }))
    }, timestamp)
    await page.goto("/hackathon/zklogin/callback#error=access_denied", { waitUntil: "domcontentloaded" })
    const back = page.getByTestId("hackathon-login-return")
    await expect(back).toHaveAttribute("href", "/")
    expect(await page.evaluate(() => sessionStorage.getItem("ondo-b.hackathon.pending.v1"))).toBeNull()
    await back.click()
    await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true")
    await expect(layer(page)).toHaveCount(0)
    await expect.poll(async () => (await discoveryContext(page))?.query).toBe("")
    expect(harvey.count("/operations")).toBe(1)
    for (const action of ["cancel", "delegation/prepare", "delegation/submit", "agent/run", "redeem"]) expect(harvey.actionCount(action)).toBe(0)
    expect(harvey.operation?.status, "Expiring local navigation data does not cancel a server operation").toBe("pending")
  })
}

test("PRESERVE a different venue return snapshot is ignored without authorizing execution", async ({ page, harvey }) => {
  await reachDelegation(page, harvey)
  const other = CANONICAL_MAP_VENUES_COMPACT.find(venue => venue.cityId !== "seoul")!
  expect(other.id).not.toBe(HARVEY_VENUE)
  await page.evaluate(({ id, city }) => {
    const key = "ondo-b.hackathon.pending.v1"
    const pending = JSON.parse(sessionStorage.getItem(key) ?? "null")
    if (!pending?.returnContext) throw new Error("A captured return context is required")
    sessionStorage.setItem(key, JSON.stringify({ ...pending, returnContext: {
      ...pending.returnContext, venueId: id, city, query: "UNTRUSTED_OTHER_PLACE", category: "night", view: "list",
    } }))
  }, { id: other.id, city: other.cityId })
  await page.goto("/hackathon/zklogin/callback#error=access_denied", { waitUntil: "domcontentloaded" })
  await page.getByTestId("hackathon-login-return").click()
  await expect(layer(page)).toHaveAttribute("data-phase", "delegation")
  await expect(page.locator("#hk-approve")).toHaveCount(0)
  await page.getByTestId("hackathon-close").click()
  await expect(page.getByTestId("canonical-place-overlay")).toHaveAttribute("data-venue-id", HARVEY_VENUE)
  await expect.poll(() => discoveryContext(page)).toMatchObject({ city: "seoul", query: "", category: "all", view: "map" })
  expect(harvey.count("/zklogin/prove")).toBe(0)
  for (const action of ["delegation/prepare", "delegation/submit", "agent/run", "redeem"]) expect(harvey.actionCount(action)).toBe(0)
})
