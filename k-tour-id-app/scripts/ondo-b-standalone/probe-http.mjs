import { spawn } from "node:child_process"
import { createServer } from "node:net"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import {
  APP_ROOT,
  BLOCKED_HTTP_PATHS,
  FORBIDDEN_QA_ARTIFACT_TEXT,
  LEGACY_DISCOVERY_QUERY_KEYS,
  LEGACY_ARTIFACT_TEXT,
  PUBLIC_FILES,
  STAGE_ROOT,
} from "./policy.mjs"

const VENUE_ID = "mois-0021cd596bc5b2a922ad"

function reservePort() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") return reject(new Error("Could not reserve a local probe port"))
      const port = address.port
      server.close((error) => error ? reject(error) : resolvePromise(port))
    })
  })
}

async function waitForServer(baseUrl, child) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`Local artifact server exited with ${child.exitCode}`)
    try {
      await fetch(baseUrl, { redirect: "manual" })
      return
    } catch {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 200))
    }
  }
  throw new Error("Timed out waiting for the local artifact server")
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function request(baseUrl, path, expectedStatus) {
  const response = await fetch(new URL(path, baseUrl), { redirect: "manual" })
  assert(response.status === expectedStatus, `${path}: expected ${expectedStatus}, received ${response.status}`)
  return response
}

function assertNoLegacyText(text, label) {
  for (const pattern of LEGACY_ARTIFACT_TEXT) {
    assert(!pattern.test(text), `${label}: emitted blocked text ${pattern}`)
  }
}

function assertNoQaText(text, label) {
  for (const pattern of FORBIDDEN_QA_ARTIFACT_TEXT) {
    assert(!pattern.test(text), `${label}: emitted production QA control ${pattern}`)
  }
}

export async function probeStandaloneHttp(baseUrl) {
  const page = await request(baseUrl, "/", 200)
  const html = await page.text()
  assert(/K-Tour ID/.test(html), "/: product identity missing")
  assert(/<title>K-Tour ID<\/title>/.test(html), "/: K-Tour ID title missing")
  assert(/property="og:title" content="K-Tour ID"/.test(html), "/: social title missing")
  assert(/property="og:image" content="[^"]*\/og-ktour-korea-v3\.png"/.test(html), "/: production food discovery social card missing")
  assert(/name="twitter:image" content="[^"]*\/og-ktour-korea-v3\.png"/.test(html), "/: Twitter food discovery social card missing")
  assert(/property="og:image:width" content="1200"/.test(html) && /property="og:image:height" content="630"/.test(html), "/: social card dimensions must be 1200x630")
  const description = "Find your next food stop in Korea with K-Tour ID—discover restaurants, cafés and bars on the map, and keep your travel pass close."
  assert(html.includes(`name="description" content="${description}"`), "/: food discovery description missing")
  assert(/rel="icon"[^>]*href="[^"]*\/brand\/ktour-id-mono-v1\.svg"/.test(html), "/: monochrome K-TOUR ID SVG favicon missing")
  assert(/rel="icon"[^>]*href="[^"]*\/brand\/ktour-id-mono-v1-32\.png"/.test(html), "/: monochrome K-TOUR ID PNG favicon missing")
  assert(/rel="apple-touch-icon"[^>]*href="[^"]*\/brand\/ktour-id-mono-v1-180\.png"/.test(html), "/: monochrome K-TOUR ID Apple icon missing")
  assert(!/rel="(?:icon|apple-touch-icon)"[^>]*href="[^"]*\/brand\/ktour-id-mark/.test(html), "/: archived supplied marks must not own active favicon metadata")
  assert(!/rel="icon"[^>]*href="[^"]*\/icon\.svg/.test(html), "/: legacy ONDO app icon still owns the canonical favicon")
  assert(/name="robots" content="noindex, nofollow"/.test(html), "/: noindex boundary missing")
  assert(/LOCALDATA|공식 일반음식점/.test(html), "/: production directory content missing")
  assertNoLegacyText(html, "/")
  assertNoQaText(html, "/")
  for (const header of ["content-security-policy", "x-content-type-options", "referrer-policy", "permissions-policy", "x-frame-options"]) {
    assert(page.headers.has(header), `/: security header missing: ${header}`)
  }

  const legacy = await fetch(new URL("/ondo-b", baseUrl), { redirect: "manual" })
  assert([307, 308].includes(legacy.status), `/ondo-b: expected canonical redirect, received ${legacy.status}`)
  const redirectLocation = legacy.headers.get("location")
  assert(redirectLocation != null && new URL(redirectLocation, baseUrl).pathname === "/", `/ondo-b: unexpected redirect ${redirectLocation}`)

  const discoverySamples = {
    category: "korean",
    city: "seoul",
    collection: "sesame",
    collectionSelection: "lab-seoul-jungbu-market",
    detail: "1",
    discoveryPlaceId: "lab-seoul-jungbu-market",
    editorialPlaceId: "ondo-jeju-haenyeo",
    q: "sesame oil",
    venueId: VENUE_ID,
    view: "list",
  }
  assert(JSON.stringify(Object.keys(discoverySamples).sort()) === JSON.stringify([...LEGACY_DISCOVERY_QUERY_KEYS].sort()), "Legacy redirect probe drifted from the discovery query allowlist")
  for (const [key, value] of Object.entries(discoverySamples)) {
    const response = await fetch(new URL(`/ondo-b?${new URLSearchParams({ [key]: value })}`, baseUrl), { redirect: "manual" })
    assert(response.status === 308, `/ondo-b?${key}: expected 308, received ${response.status}`)
    const redirected = new URL(response.headers.get("location") ?? "", baseUrl)
    assert(redirected.pathname === "/", `/ondo-b?${key}: expected canonical root, received ${redirected.pathname}`)
    assert(redirected.searchParams.get(key) === value, `/ondo-b?${key}: discovery value was not preserved`)
    assert([...redirected.searchParams.keys()].length === 1, `/ondo-b?${key}: unexpected query keys survived`)
  }

  const mixedLegacy = new URL("/ondo-b", baseUrl)
  for (const [key, value] of Object.entries(discoverySamples)) mixedLegacy.searchParams.set(key, value)
  for (const key of ["qa", "private", "after19", "foo", "lang", "tab"]) mixedLegacy.searchParams.set(key, "1")
  const mixedResponse = await fetch(mixedLegacy, { redirect: "manual" })
  assert(mixedResponse.status === 308, `/ondo-b mixed query: expected 308, received ${mixedResponse.status}`)
  const mixedRedirect = new URL(mixedResponse.headers.get("location") ?? "", baseUrl)
  for (const [key, value] of Object.entries(discoverySamples)) assert(mixedRedirect.searchParams.get(key) === value, `/ondo-b mixed query: ${key} was not preserved`)
  for (const key of ["qa", "private", "after19", "foo", "lang", "tab"]) assert(!mixedRedirect.searchParams.has(key), `/ondo-b mixed query: blocked key ${key} survived`)

  const duplicateResponse = await fetch(new URL("/ondo-b?city=seoul&city=busan", baseUrl), { redirect: "manual" })
  const duplicateRedirect = new URL(duplicateResponse.headers.get("location") ?? "", baseUrl)
  assert(!duplicateRedirect.searchParams.has("city"), "/ondo-b duplicate query: ambiguous city must be dropped")
  const oversizedResponse = await fetch(new URL(`/ondo-b?q=${"x".repeat(161)}`, baseUrl), { redirect: "manual" })
  const oversizedRedirect = new URL(oversizedResponse.headers.get("location") ?? "", baseUrl)
  assert(!oversizedRedirect.searchParams.has("q"), "/ondo-b oversized query: values over 160 characters must be dropped")

  const api = await request(baseUrl, `/api/ondo/venues/${VENUE_ID}`, 200)
  const payload = await api.json()
  assert(payload?.venue?.id === VENUE_ID, "Canonical venue API returned the wrong record")
  await request(baseUrl, "/api/ondo/venues/mois-does-not-exist", 404)

  for (const path of BLOCKED_HTTP_PATHS) {
    const response = await request(baseUrl, path, 404)
    assertNoLegacyText(await response.text(), path)
  }

  for (const publicFile of PUBLIC_FILES) {
    const path = `/${publicFile.replace(/^public\//, "")}`
    const asset = await request(baseUrl, path, 200)
    assert(asset.headers.get("content-type")?.startsWith("image/"), `${path}: expected an image content type`)
    const iconSize = /^\/brand\/ktour-id-mono-v1-(16|32|180|192|512)\.png$/.exec(path)?.[1]
    if (path === "/og-ktour-korea-v3.png" || iconSize) {
      const bytes = Buffer.from(await asset.arrayBuffer())
      assert(bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${path}: expected PNG bytes`)
      const width = iconSize ? Number(iconSize) : 1200
      const height = iconSize ? Number(iconSize) : 630
      assert(bytes.readUInt32BE(16) === width && bytes.readUInt32BE(20) === height, `${path}: decoded PNG dimensions differ from metadata`)
    }
  }
  const assets = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
    .map((match) => match[1])
    .filter((path) => path.startsWith("/_next/") || path.startsWith("/assets/"))
  assert(assets.length > 0, "No built assets were referenced by /")
  let renderedSource = html
  for (const path of [...new Set(assets)]) {
    const response = await request(baseUrl, path, 200)
    const contentType = response.headers.get("content-type") ?? ""
    if (/javascript|css|json|text/.test(contentType)) {
      const text = await response.text()
      renderedSource += `\n${text}`
      assertNoLegacyText(text, path)
      assertNoQaText(text, path)
    }
  }
  assert(/https:\/\/openfreemap\.org\//.test(renderedSource), "/: OpenFreeMap attribution link missing from the rendered closure")
  assert(/https:\/\/www\.openstreetmap\.org\/copyright/.test(renderedSource), "/: OpenStreetMap\/ODbL attribution link missing from the rendered closure")

  const result = { baseUrl, legacyRedirect: legacy.status, legacyDiscoveryKeys: LEGACY_DISCOVERY_QUERY_KEYS.length, page: page.status, blocked: BLOCKED_HTTP_PATHS.length, assets: new Set(assets).size, publicAssets: PUBLIC_FILES.length }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  return result
}

async function startLocalArtifact() {
  const port = await reservePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const config = resolve(STAGE_ROOT, "dist/server/wrangler.json")
  await readFile(config)
  const child = spawn(resolve(APP_ROOT, "node_modules/.bin/wrangler"), [
    "dev",
    "--config", config,
    "--ip", "127.0.0.1",
    "--port", String(port),
    "--log-level", "error",
  ], { cwd: resolve(STAGE_ROOT, "dist/server"), stdio: ["ignore", "pipe", "pipe"] })
  let logs = ""
  child.stdout.on("data", (chunk) => { logs += chunk })
  child.stderr.on("data", (chunk) => { logs += chunk })
  try {
    await waitForServer(baseUrl, child)
    return { baseUrl, child }
  } catch (error) {
    child.kill("SIGTERM")
    throw new Error(`${error instanceof Error ? error.message : error}\n${logs.slice(-4000)}`)
  }
}

if (process.argv[1] === import.meta.filename) {
  const externalBaseUrl = process.env.ONDO_B_PROBE_BASE_URL
  if (externalBaseUrl) await probeStandaloneHttp(externalBaseUrl)
  else {
    const { baseUrl, child } = await startLocalArtifact()
    try {
      await probeStandaloneHttp(baseUrl)
    } finally {
      child.kill("SIGTERM")
    }
  }
}
