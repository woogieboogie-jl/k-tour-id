import assert from "node:assert/strict"
import { createServer } from "node:http"
import test from "node:test"
import { gzipSync } from "node:zlib"
import { chromium } from "@playwright/test"
import { allowedPreviewBrowserRequest, allowedSdkBootstrapRequest, approvedPreviewOrigin, finalPreviewProbeFailure, forwardPreviewRouteWithoutRedirects, optionalSdkTelemetryRequest, runSumsubPreviewProbe } from "../../scripts/kyc/probe-sumsub-preview.mjs"

test("operator smoke accepts only exact immutable project preview origins", () => {
  assert.equal(approvedPreviewOrigin("https://ondo-h1r19wz66-jaewook-9643s-projects.vercel.app"), true)
  for (const value of ["http://ondo-h1r19wz66-jaewook-9643s-projects.vercel.app", "https://ktour-id.vercel.app", "https://ondo-other.vercel.app", "https://ondo-h1r19wz66-jaewook-9643s-projects.vercel.app/", "https://ondo-h1r19wz66-jaewook-9643s-projects.vercel.app?token=x"])
    assert.equal(approvedPreviewOrigin(value), false)
})

test("SDK smoke only allows bounded bootstrap/diagnostic POSTs, never upload or review", () => {
  const body = Buffer.from("{}")
  for (const path of ["/resources/sdkIntegrations/websdkInit", "/resources/tracking/trackEvents", "/resources/tracking/trackTimings", "/resources/serviceLogger/jsError", "/websdk/trackClose"])
    assert.equal(allowedSdkBootstrapRequest("https://api.sumsub.com" + path, "POST", body, "application/json"), true)
  for (const url of ["http://api.sumsub.com/stry", "https://foreign.invalid/stry", "https://api.sumsub.com:8443/stry", "https://secret@api.sumsub.com/stry", "https://api.sumsub.com/resources/applicants/fixture/info/idDoc", "https://api.sumsub.com/resources/applicants/fixture/status/testCompleted", "https://api.sumsub.com/resources/applicants/fixture/status/pending"])
    assert.equal(allowedSdkBootstrapRequest(url, "POST", body, "application/json"), false)
  const init = "https://api.sumsub.com/resources/sdkIntegrations/websdkInit"
  for (const method of ["GET", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS", "post"])
    assert.equal(allowedSdkBootstrapRequest(init, method, body, "application/json"), false)
  assert.equal(allowedSdkBootstrapRequest(init, "POST", Buffer.alloc(65536), "application/json; charset=utf-8"), true)
  assert.equal(allowedSdkBootstrapRequest(init, "POST", Buffer.alloc(65537), "application/json"), false)
  assert.equal(allowedSdkBootstrapRequest(init, "POST", null, "application/json"), false)
  for (const type of ["multipart/form-data", "application/octet-stream", "image/png", "text/plain", ""])
    assert.equal(allowedSdkBootstrapRequest(init, "POST", body, type), false)
  for (const suffix of ["/", "/extra", "%2fextra", ";extra", "%00"])
    assert.equal(allowedSdkBootstrapRequest(init + suffix, "POST", body, "application/json"), false)
})

test("optional stry telemetry is blocked separately and cannot widen other provider endpoints", () => {
  const url = "https://api.sumsub.com/stry"
  assert.equal(optionalSdkTelemetryRequest(url, "POST"), true)
  for (const type of ["application/json", "application/octet-stream", "multipart/form-data"])
    assert.equal(allowedSdkBootstrapRequest(url, "POST", Buffer.from("fixture"), type), false)
  for (const other of [url + "/extra", "https://foreign.invalid/stry", "https://secret@api.sumsub.com/stry", "https://api.sumsub.com:8443/stry", "https://api.sumsub.com/resources/applicants/fixture/status/pending"])
    assert.equal(optionalSdkTelemetryRequest(other, "POST"), false)
  assert.equal(optionalSdkTelemetryRequest(url, "PUT"), false)
})

test("all permitted browser request classes use a closed origin/method policy", () => {
  const origin = "https://ondo-fixture-jaewook-9643s-projects.vercel.app", body = Buffer.from("{}")
  const allows = (path: string, method = "GET") => allowedPreviewBrowserRequest(origin + path, method, body, "application/json", origin)
  for (const [path, method] of [["/", "GET"], ["/fixture.js", "HEAD"], ["/api/kyc/sumsub/status", "GET"], ["/api/kyc/sumsub/session", "POST"], ["/api/kyc/sumsub/session", "DELETE"], ["/api/ondo/venues/fixture", "GET"]])
    assert.equal(allows(path, method), true, method + " " + path)
  for (const [path, method] of [["/api/kyc/sumsub/status", "POST"], ["/api/kyc/sumsub/session", "PUT"], ["/api/kyc/sumsub/session/other", "POST"], ["/api/other", "GET"], ["/", "POST"]])
    assert.equal(allows(path, method), false, method + " " + path)
  assert.equal(allowedPreviewBrowserRequest("https://api.sumsub.com/resources/serviceLogger/jsError", "POST", body, "application/json", origin), true)
  assert.equal(allowedPreviewBrowserRequest("https://api.sumsub.com/stry", "POST", body, "application/json", origin), false)
  assert.equal(allowedPreviewBrowserRequest("https://foreign.invalid/fixture.js", "GET", null, "", origin), false)
  assert.equal(allowedPreviewBrowserRequest("https://static.sumsub.com/fixture.js", "GET", null, "", origin), true)
})

test("final verdict includes late cleanup errors, blocked requests and failed revocation", () => {
  assert.equal(finalPreviewProbeFailure(null, true, 0, 0), null)
  assert.equal(finalPreviewProbeFailure(null, true, 1, 0), "no_app_page_errors")
  assert.equal(finalPreviewProbeFailure(null, true, 0, 1), "no_unexpected_remote_requests")
  assert.equal(finalPreviewProbeFailure(null, false, 0, 0), "session_revocation_failed")
  assert.equal(finalPreviewProbeFailure("provider_screen_not_error", false, 1, 1), "provider_screen_not_error")
})

test("dry and invalid live requests never start a browser or provider", async () => {
  assert.equal((await runSumsubPreviewProbe({})).executed, false)
  assert.equal((await runSumsubPreviewProbe({ mode: "live", origin: "https://foreign.invalid" })).executed, false)
})

test("loopback browser proxy blocks 307/308 before a second hop and preserves SDK asset/session responses", { timeout: 60_000 }, async () => {
  let sinkHits = 0
  const sink = createServer((_request, response) => { sinkHits++; response.end("must never arrive") })
  const listen = async (server: ReturnType<typeof createServer>) => {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    assert.ok(address && typeof address === "object")
    return `http://127.0.0.1:${address.port}`
  }
  const close = async (server: ReturnType<typeof createServer>) => {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
  const sinkOrigin = await listen(sink)
  const source = createServer((request, response) => {
    const url = new URL(request.url!, "http://127.0.0.1")
    request.resume()
    const redirect = Number(url.searchParams.get("redirect"))
    if ([307, 308].includes(redirect)) {
      response.writeHead(redirect, { location: sinkOrigin + "/outside-allowlist" })
      response.end()
    } else if (url.pathname === "/fixture.js") {
      response.writeHead(200, { "content-type": "application/javascript", "content-encoding": "gzip" })
      response.end(gzipSync("window.fixtureReady = true"))
    } else if (url.pathname === "/fixture.css") {
      response.writeHead(200, { "content-type": "text/css" })
      response.end("body { color: rgb(12, 34, 56) }")
    } else if (url.pathname === "/fixture.bin") {
      response.writeHead(200, { "content-type": "application/octet-stream" })
      response.end(Buffer.from([0, 255, 13, 10, 128]))
    } else if (url.pathname === "/api/kyc/sumsub/session") {
      response.writeHead(request.method === "DELETE" ? 204 : 200, { "content-type": "application/json", "set-cookie": ["fixture-session=local-only; Path=/; HttpOnly; SameSite=Lax", "fixture-second=local-only; Path=/; SameSite=Lax"] })
      response.end(request.method === "DELETE" ? undefined : '{"fixture":true}')
    } else {
      response.writeHead(200, { "content-type": "text/html" })
      response.write('<!doctype html><link rel="stylesheet" href="/fixture.css"><script src="/fixture.js"></script>')
      setImmediate(() => response.end("<body>Loopback-only fixture</body>"))
    }
  })
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    const origin = await listen(source)
    browser = await chromium.launch({ headless: true, env: { PATH: process.env.PATH ?? "", TMPDIR: process.env.TMPDIR ?? "/tmp" } })
    const context = await browser.newContext({ serviceWorkers: "block" })
    const blocked: string[] = [], unexpected: string[] = []
    await context.route("**/*", async route => {
      const request = route.request()
      if (!allowedPreviewBrowserRequest(request.url(), request.method(), request.postDataBuffer(), request.headers()["content-type"] ?? "", origin)) {
        unexpected.push(request.method() + " " + new URL(request.url()).pathname)
        return route.abort("blockedbyclient")
      }
      return forwardPreviewRouteWithoutRedirects(route, reason => blocked.push(reason))
    })
    const page = await context.newPage()
    await page.goto(origin, { waitUntil: "load" })
    assert.equal(await page.evaluate(() => (window as Window & { fixtureReady?: boolean }).fixtureReady), true)
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).color), "rgb(12, 34, 56)")
    assert.deepEqual(await page.evaluate(async () => [...new Uint8Array(await (await fetch("/fixture.bin")).arrayBuffer())]), [0, 255, 13, 10, 128])
    assert.deepEqual(await page.evaluate(async () => (await fetch("/api/kyc/sumsub/session", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json()), { fixture: true })
    assert.deepEqual((await context.cookies(origin)).map(cookie => cookie.name).sort(), ["fixture-second", "fixture-session"])
    assert.equal(await page.evaluate(async () => (await fetch("/api/kyc/sumsub/session", { method: "DELETE" })).status), 204)
    for (const redirect of [307, 308]) for (const [path, method] of [["/fixture.js", "GET"], ["/fixture.css", "HEAD"], ["/api/kyc/sumsub/status", "GET"], ["/api/ondo/venues/fixture", "GET"], ["/api/kyc/sumsub/session", "POST"], ["/api/kyc/sumsub/session", "DELETE"]]) {
      const result = await page.evaluate(async ({ path, method, redirect }) => {
        try {
          await fetch(`${path}?redirect=${redirect}`, { method, ...(method === "POST" ? { headers: { "content-type": "application/json" }, body: "{}" } : {}) })
          return "unexpected-success"
        } catch { return "blocked" }
      }, { path, method, redirect })
      assert.equal(result, "blocked", `${redirect} ${method} ${path}`)
    }
    assert.equal(sinkHits, 0)
    assert.deepEqual(unexpected, [])
    assert.deepEqual(blocked, Array(12).fill("redirect_blocked"))
  } finally {
    await browser?.close()
    await close(source)
    await close(sink)
  }
})
