import { expect, test } from "./helpers/harvey-fixture"

test.describe.configure({ timeout: 45_000 })
test.use({ serviceWorkers: "block" })

const OPERATION = "browser-fixture-operation-1"
const VENUE = "mois-0021cd596bc5b2a922ad"
const signerKey = `ondo-b.hackathon.signer.v1:${OPERATION}`

async function seedPending(page: import("@playwright/test").Page, savedAt = Date.now()) {
  await page.addInitScript(({ savedAt, operation }) => {
    // Install once per tab: full-document return navigation/reload must not
    // recreate the consumed OAuth state or revive an expired pending marker.
    if (sessionStorage.getItem("test.zklogin-return.seeded")) return
    sessionStorage.setItem("test.zklogin-return.seeded", "1")
    sessionStorage.setItem("ondo-b.hackathon.pending.v1", JSON.stringify({ venueId: "mois-0021cd596bc5b2a922ad", locale: "en", resumeOperationId: operation, savedAt }))
    sessionStorage.setItem(`ondo-b.hackathon.signer.v1:${operation}`, JSON.stringify({
      kind: "zklogin", address: "", ephemeralSecretKey: "fixture-key", maxEpoch: 9,
      randomness: "fixture-randomness", inputs: null, nonce: "fixture-nonce", jwtPending: true, oauthState: "fixture-state",
    }))
  }, { savedAt, operation: OPERATION })
}

test("malformed or other-tab callback has no local state, stores no JWT, and offers map return", async ({ page, harvey }) => {
  await harvey.preferences("en")
  await page.goto("/hackathon/zklogin/callback#state=other&id_token=not-a-jwt", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("hackathon-login-callback")).toHaveAttribute("data-state", "failed")
  await expect(page.getByTestId("hackathon-login-return")).toHaveAttribute("href", "/")
  expect(await page.evaluate(() => Object.keys(sessionStorage).some(key => key.includes("hackathon.jwt")))).toBe(false)
  await expect(page).toHaveURL(url => url.hash === "" && url.search === "")
  expect(harvey.calls.filter(call => call.method === "POST" && call.path !== "/sessions")).toHaveLength(0)
})

test("provider cancellation returns to the same place and clears only the one-time OAuth state", async ({ page, harvey }) => {
  await harvey.preferences("en")
  await seedPending(page)
  await page.goto("/hackathon/zklogin/callback#error=access_denied&state=fixture-state", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("hackathon-login-callback")).toHaveAttribute("data-state", "failed")
  await expect(page.getByTestId("hackathon-login-return")).toHaveAttribute("href", `/?venueId=${VENUE}&detail=1&hk=${OPERATION}`)
  const stored = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key) ?? "null"), signerKey)
  expect(stored.oauthState).toBeUndefined()
  expect(stored.ephemeralSecretKey).toBe("fixture-key")
  await expect(page).toHaveURL(url => url.hash === "" && url.search === "")
  expect(await page.evaluate(operation => sessionStorage.getItem(`ondo-b.hackathon.jwt:${operation}`), OPERATION)).toBeNull()
  expect(harvey.calls.filter(call => call.method === "POST" && call.path !== "/sessions")).toHaveLength(0)
})

test("expired pending return is discarded rather than reopening a stale operation", async ({ page, harvey }) => {
  await harvey.preferences("en")
  await seedPending(page, Date.now() - 60 * 60_000 - 1)
  await page.goto("/hackathon/zklogin/callback#error=access_denied", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("hackathon-login-return")).toHaveAttribute("href", "/")
  expect(await page.evaluate(() => sessionStorage.getItem("ondo-b.hackathon.pending.v1"))).toBeNull()
  await expect(page).toHaveURL(url => url.hash === "" && url.search === "")
  expect(harvey.calls.filter(call => call.method === "POST")).toHaveLength(0)
})

test("accepted callback keeps the JWT in session storage only and scrubs the fragment before place resume", async ({ page, harvey }) => {
  await harvey.preferences("en")
  await seedPending(page)
  await page.goto("/hackathon/zklogin/callback#state=fixture-state&id_token=header.payload.signature", { waitUntil: "domcontentloaded" })
  await page.waitForURL(url => url.searchParams.get("venueId") === VENUE, { timeout: 10_000 })
  expect(new URL(page.url()).hash).toBe("")
  expect(await page.evaluate(operation => sessionStorage.getItem(`ondo-b.hackathon.jwt:${operation}`), OPERATION)).toBe("header.payload.signature")
  expect(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key) ?? "null")?.oauthState, signerKey)).toBeUndefined()
  expect(new URL(page.url()).searchParams.get("venueId")).toBe(VENUE)
  await expect(page, "the consumed resume marker is scrubbed after reopening").toHaveURL(url => url.searchParams.get("hk") === null)
  expect(harvey.calls.filter(call => call.method === "POST" && call.path !== "/sessions")).toHaveLength(0)
})

test("accepted callback scrubs before a stalled same-origin place navigation", async ({ page, harvey }) => {
  await harvey.preferences("en")
  await seedPending(page)
  let releaseNavigation!: () => void
  let navigationStarted = false
  const gate = new Promise<void>(resolve => { releaseNavigation = resolve })
  await page.route(url => url.pathname === "/" && url.searchParams.get("hk") === OPERATION, async route => {
    navigationStarted = true
    await gate
    await route.continue()
  })
  try {
    // Do not wait for the destination's DOMContentLoaded while its document
    // request is deliberately paused by this test.
    await page.goto("/hackathon/zklogin/callback?return-fixture=1#state=fixture-state&id_token=header.payload.signature", { waitUntil: "commit" })
    await expect.poll(() => navigationStarted).toBe(true)
    // The destination has not responded: this is still the callback document.
    // Reading the driver's current URL needs no evaluation that could wait for
    // the new document's execution context while its response is held here.
    const beforeResume = new URL(page.url())
    expect(beforeResume.pathname).toBe("/hackathon/zklogin/callback")
    expect(beforeResume.search).toBe("")
    expect(beforeResume.hash).toBe("")
  } finally {
    releaseNavigation()
  }
  await page.waitForURL(url => url.searchParams.get("venueId") === VENUE)
  expect(await page.evaluate(operation => sessionStorage.getItem(`ondo-b.hackathon.jwt:${operation}`), OPERATION)).toBe("header.payload.signature")
  expect(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key) ?? "null")?.oauthState, signerKey)).toBeUndefined()
  expect(harvey.calls.filter(call => call.method === "POST" && call.path !== "/sessions")).toHaveLength(0)
})

test("failed URL scrub does not store the accepted token or consume its state", async ({ page, harvey }) => {
  await harvey.preferences("en")
  await seedPending(page)
  await page.addInitScript(() => {
    const replace = history.replaceState.bind(history)
    let failNextScrub = true
    history.replaceState = (state, unused, url) => {
      // Fail the callback's first scrub, not every later framework-owned
      // history update (which would deliberately break the router itself).
      if (failNextScrub && url === "/hackathon/zklogin/callback") {
        failNextScrub = false
        throw new DOMException("Fixture blocked history", "SecurityError")
      }
      return replace(state, unused, url)
    }
  })
  await page.goto("/hackathon/zklogin/callback#state=fixture-state&id_token=header.payload.signature", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("hackathon-login-callback")).toHaveAttribute("data-state", "failed")
  expect(await page.evaluate(operation => sessionStorage.getItem(`ondo-b.hackathon.jwt:${operation}`), OPERATION)).toBeNull()
  expect(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key) ?? "null")?.oauthState, signerKey)).toBe("fixture-state")
  expect(new URL(page.url()).pathname).toBe("/hackathon/zklogin/callback")
  expect(harvey.calls.filter(call => call.method === "POST")).toHaveLength(0)
})

test("reloading a malformed callback remains fail-closed without creating a second return", async ({ page, harvey }) => {
  await harvey.preferences("en")
  await seedPending(page)
  await page.goto("/hackathon/zklogin/callback?replay=1#state=wrong-state&id_token=replayed.payload.signature", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("hackathon-login-callback")).toHaveAttribute("data-state", "failed")
  await expect(page).toHaveURL(url => url.hash === "" && url.search === "")
  expect(await page.evaluate(operation => sessionStorage.getItem(`ondo-b.hackathon.jwt:${operation}`), OPERATION)).toBeNull()
  await page.reload({ waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("hackathon-login-callback")).toHaveAttribute("data-state", "failed")
  await expect(page.getByTestId("hackathon-login-return")).toHaveAttribute("href", `/?venueId=${VENUE}&detail=1&hk=${OPERATION}`)
  expect(harvey.calls.filter(call => call.method === "POST")).toHaveLength(0)
})
