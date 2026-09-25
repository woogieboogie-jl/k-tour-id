import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"

const base = new URL(process.argv[2] ?? "http://127.0.0.1:3141")
assert.equal(base.username + base.password + base.search + base.hash, "")
assert.ok(
  (base.protocol === "http:" && ["127.0.0.1", "localhost"].includes(base.hostname)) ||
  (base.protocol === "https:" && /^ondo-[a-z0-9-]+\.vercel\.app$/.test(base.hostname)),
  "Only local or ondo immutable Preview hosts are accepted; never the public Production alias",
)
let expectedRevision
if (base.protocol === "https:") {
  const deploymentId = process.argv[3]
  assert.match(deploymentId ?? "", /^\d+$/, "Remote probe requires a GitHub deployment ID")
  const endpoint = "repos/woogieboogie-jl/k-tour-id/deployments/" + deploymentId
  const github = path => JSON.parse(execFileSync("gh", ["api", path], { encoding: "utf8" }))
  const deployment = github(endpoint)
  const statuses = github(endpoint + "/statuses")
  assert.equal(deployment.environment, "Preview", "Refusing non-Preview deployment")
  assert.equal(statuses[0]?.state, "success", "Preview is not ready")
  assert.equal(new URL(statuses[0].environment_url).origin, base.origin, "URL is not this exact GitHub Preview deployment")
  assert.match(deployment.sha, /^[a-f0-9]{40}$/)
  expectedRevision = deployment.sha
}
const results = []
async function request(path, method = "GET") {
  const response = await fetch(new URL(path, base), {
    method, redirect: "manual", signal: AbortSignal.timeout(20_000),
    ...(method === "POST" ? { headers: { "content-type": "application/json" }, body: "{}" } : {}),
  })
  assert.equal(response.headers.has("set-cookie"), false, path + " created a session")
  results.push({ path, method, status: response.status })
  return response
}

// Refuse all POST probes unless the exact safe profile first identifies itself.
const configResponse = await request("/api/hackathon/v1/config")
assert.equal(configResponse.status, 200)
assert.equal(configResponse.headers.get("cache-control"), "no-store")
const config = await configResponse.json()
assert.equal(config.previewReadOnly, true)
assert.equal(config.isolatedMock, true)
assert.equal(config.deployment?.profile, "readiness-preview")
if (expectedRevision) assert.equal(config.deployment.revision, expectedRevision, "Unexpected source revision")
assert.equal(config.capabilities.chainExecutionEnabled, false)
assert.deepEqual(config.modes, { cx: "mock", opendid: "mock", ai: "rule", sui: "disabled-isolated", omnione: "disabled-isolated", zklogin: "disabled-isolated" })

const head = await request("/api/hackathon/v1/config", "HEAD")
assert.equal(head.status, 200)
assert.equal(await head.text(), "")
for (const path of ["me", "config/extra", "places/test/demo-entitlements", "operations/test", "zklogin/params"]) {
  const response = await request("/api/hackathon/v1/" + path)
  assert.equal(response.status, 503)
  assert.equal((await response.json()).error.code, "preview_read_only")
}
for (const path of [
  "/api/ask", "/api/chat", "/api/hackathon/v1/sessions",
  "/api/hackathon/v1/operations", "/api/hackathon/v1/operations/test/identity/start",
  "/api/hackathon/v1/operations/test/delegation/submit", "/api/hackathon/v1/operations/test/agent/run",
  "/api/hackathon/v1/operations/test/redeem", "/api/hackathon/v1/zklogin/prove",
]) {
  const response = await request(path, "POST")
  assert.equal(response.status, 503)
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.equal((await response.json()).error.code, "preview_read_only")
}
for (const [path, expected] of [
  ["/", 200],
  ["/api/ondo/venues/mois-0021cd596bc5b2a922ad", 200],
  ["/labs/header-preview", 404],
  ["/hackathon/zklogin/callback", 200],
  ["/hackathon", 307],
]) assert.equal((await request(path)).status, expected, String(path))
// Next may already have started streaming this nested route before notFound().
// A 200 transport alone is not a rendered Lab; verify the actual 404 fallback.
const discoveryLab = await request("/ondo-b/labs/discovery")
const discoveryBody = await discoveryLab.text()
assert.ok(discoveryLab.status === 404 || (
  discoveryLab.status === 200 &&
  discoveryBody.includes("NEXT_HTTP_ERROR_FALLBACK;404") &&
  discoveryBody.includes("This page could not be found")
), "Discovery Lab must render the not-found boundary")
assert.ok(!/data-testid="discovery-preview/.test(discoveryBody), "Discovery Lab UI was exposed")
console.log(JSON.stringify({ origin: base.origin, deployment: config.deployment, passed: results.length, results }, null, 2))
