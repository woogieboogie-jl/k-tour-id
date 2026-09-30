import { expect, test } from "@playwright/test"

// Real map UI with synthetic empty basemap transport only. No identity/session
// fixture, provider request, server mutation, access code or authority storage.
for (const outcome of ["success-search", "failure-search", "success-untouched"] as const) {
  test(`MAP-FOCUS ${outcome}: late retry respects the current interaction owner`, async ({ page, baseURL }, info) => {
    test.setTimeout(60_000)
    const origin = new URL(baseURL!).origin
    const writes: string[] = []
    let retrying = false
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url())
      if (!["GET", "HEAD"].includes(request.method())) { writes.push(request.method()); return route.abort("blockedbyclient") }
      if (url.origin === origin && url.pathname.startsWith("/api/hackathon/")) return route.fulfill({ status: 403, json: { error: { code: "map_fixture_no_identity" } } })
      if (url.hostname === "tiles.openfreemap.org") {
        if (!retrying) return route.abort("failed")
        await pending
        if (outcome === "failure-search") return route.abort("failed")
        if (url.pathname === "/planet") return route.fulfill({ json: { tilejson: "3.0.0", tiles: ["https://tiles.openfreemap.org/retry-focus-empty/{z}/{x}/{y}.pbf"], minzoom: 0, maxzoom: 18, bounds: [124, 33, 132, 39] } })
        if (url.pathname.startsWith("/retry-focus-empty/")) return route.fulfill({ status: 200, contentType: "application/x-protobuf", body: Buffer.alloc(0) })
        return route.abort("blockedbyclient")
      }
      if (url.origin !== origin) return route.abort("blockedbyclient")
      return route.continue()
    })
    await page.addInitScript(() => localStorage.setItem("ondo-b.device.v1", JSON.stringify({ locale: "ko", appearancePreference: "light", onboarding: "ONB-COMPLETE", discoveryPreferences: [], savedVenueIds: [], privateNotesByVenue: {} })))
    try {
      await page.goto("/?city=seoul&review=0", { waitUntil: "domcontentloaded" })
      const entry = page.getByTestId("ondo-b-map-entry")
      await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true", { timeout: 30_000 })
      await expect(entry).toHaveAttribute("data-map-state", "error", { timeout: 20_000 })
      retrying = true
      await page.getByTestId("ondo-b-map-fallback-status").getByRole("button").click()
      await expect(entry).toHaveAttribute("data-map-state", "loading")
      const search = page.getByTestId("ondo-b-search")
      if (outcome !== "success-untouched") {
        await page.getByTestId("ondo-b-map-search-toggle").click()
        await search.click(); await search.fill("Roba")
        await expect(search).toBeFocused()
        await expect(entry).toHaveAttribute("data-effective-view", "list")
      }
      release()
      await expect(entry).toHaveAttribute("data-map-state", outcome === "failure-search" ? "error" : "ready", { timeout: 20_000 })
      // Allow the actual deferred successor callback to run; checking only the
      // state transition can pass just before it steals focus.
      await page.waitForTimeout(300)
      if (outcome !== "success-untouched") {
        await expect(search).toBeFocused()
        await expect(search).toHaveValue("Roba")
        await expect(entry).toHaveAttribute("data-effective-view", "list")
        await expect(page.getByTestId("ondo-b-list-panel")).toBeVisible()
        // Continued ordinary typing works after the provider-independent retry.
        await page.keyboard.type(" cafe")
        await expect(search).toHaveValue("Roba cafe")
      } else {
        await expect(entry).toHaveAttribute("data-effective-view", "map")
        await expect(page.getByTestId("ondo-b-view-toggle")).toBeFocused()
      }
      expect(writes).toEqual([])
      await page.screenshot({ path: info.outputPath(`${outcome}.png`) })
    } finally { release() }
  })
}
