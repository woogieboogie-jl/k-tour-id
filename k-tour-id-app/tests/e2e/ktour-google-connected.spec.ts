import { expect, test, MAIN } from "./helpers/google-fixture"
import { HARVEY_CAMPAIGN, HARVEY_VENUE, type HarveyFixture } from "./helpers/harvey-fixture"
import { fixture } from "../hackathon/fixtures/hosted-omnione.fixture"
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519"
import { generateNonce } from "@mysten/sui/zklogin"
import type { Page } from "@playwright/test"
test.use({ baseURL: MAIN, serviceWorkers: "block" }); test.describe.configure({ timeout: 45000 })
const OP = "op_google_browser_fixture", ATT = `zkl_${"a".repeat(24)}`, CLIENT = "synthetic-browser-client.apps.googleusercontent.com"
const SK = `ondo-b.hackathon.signer.v1:${OP}`, JWTKEY = `ondo-b.hackathon.jwt:${OP}`
const expiry = () => new Date(Date.now() + 300000).toISOString()
function status(state = "pending", attemptId = ATT) { return { version: 1, operationId: OP, attemptId, status: state, expiresAt: expiry(), maxEpoch: 12, address: null, inputs: null } }
async function setup(page: Page, harvey: HarveyFixture, locale: "ko" | "en" | "ja" = "en", phase: "delegation" | "proposal" = "delegation") {
  await harvey.preferences(locale, "dark")
  Object.assign(harvey.config, { isolatedMock: false, hostedSui: true }); harvey.config.modes.zklogin = "google"; harvey.config.modes.cx = "cx"; harvey.config.modes.sui = "testnet"; harvey.config.sui.googleClientId = CLIENT
  const { op } = fixture(); harvey.operation = { ...op, operationId: OP, venueId: HARVEY_VENUE, campaignId: HARVEY_CAMPAIGN, status: "pending", phase, delegation: null, agent: null, fulfillment: null, chain: null, allowedActions: phase === "proposal" ? ["check_status", "cancel", "return"] : ["approve", "sign_delegation", "cancel"],
    proposal: { proposalId: "fixture", inputDigest: "fixture", outputDigest: "fixture", promptVersion: "fixture", policyVersion: 1, mode: "rule", model: "rule-v1", createdAt: op.createdAt, proposalDigest: "fixture-proposal", guard: { injectionSuspected: false, schemaValid: true }, output: { action: "redeem_demo_entitlement", target: { venueId: HARVEY_VENUE, campaignId: HARVEY_CAMPAIGN }, title: "Browser fixture scope", summary: "No actual execution", rationale: "One explicitly approved action", language: locale } } }
  await page.addInitScript(({ op, venue, locale }) => { if (sessionStorage.getItem("fixture.google.seed")) return; sessionStorage.setItem("fixture.google.seed", "1"); sessionStorage.setItem("ondo-b.hackathon.pending.v1", JSON.stringify({ venueId: venue, locale, resumeOperationId: op, savedAt: Date.now() })) }, { op: OP, venue: HARVEY_VENUE, locale })
  let operationGets = 0
  await page.route(`**/api/hackathon/v1/operations/${OP}`, route => { operationGets++; return route.fulfill({ json: harvey.operation }) })
  await page.route("**/api/hackathon/v1/zklogin/params", route => route.fulfill({ json: { configured: true, googleClientId: CLIENT, redirectUri: MAIN + "/hackathon/zklogin/callback", epoch: 10, maxEpoch: 12 } }))
  return { open: async () => { await page.goto(`/?venueId=${HARVEY_VENUE}&review=0`, { waitUntil: "domcontentloaded" }); await expect(page.getByTestId("hackathon-layer")).toHaveAttribute("data-phase", phase) }, gets: () => operationGets }
}
async function seedSigner(page: Page, expired = false) {
  const key = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(9))
  await page.addInitScript(({ storage, jwtKey, key, nonce, attempt, expired }) => {
    if (sessionStorage.getItem("fixture.google.signer")) return; sessionStorage.setItem("fixture.google.signer", "1")
    sessionStorage.setItem(storage, JSON.stringify({ kind: "zklogin", address: "", ephemeralSecretKey: key, maxEpoch: 12, randomness: "123", nonce, inputs: null, jwtPending: true, oauthState: `state_${"a".repeat(32)}`, attemptId: attempt, attemptExpiresAt: new Date(Date.now() + (expired ? -1000 : 300000)).toISOString(), proofRequestSent: false }))
    sessionStorage.setItem(jwtKey, "synthetic.payload.signature")
  }, { storage: SK, jwtKey: JWTKEY, key: key.getSecretKey(), nonce: generateNonce(key.getPublicKey(), 12, "123"), attempt: ATT, expired })
}
for (const [locale, width, height] of [["ko", 320, 700], ["ja", 390, 844], ["en", 1440, 1000]] as const) test(`Google explicit initiation/privacy/context: ${locale}/${width}`, async ({ page, harvey }, info) => {
  await page.setViewportSize({ width, height }); const f = await setup(page, harvey, locale); let starts = 0, destination: URL | null = null
  await page.route("**/api/hackathon/v1/zklogin/start", async route => { starts++; const body = route.request().postDataJSON(); const stored = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)!), SK); expect(Object.keys(body).sort()).toEqual(["attemptId", "extendedEphemeralPublicKey", "jwtRandomness", "maxEpoch", "operationId"].sort()); expect(JSON.stringify(body)).not.toContain(stored.ephemeralSecretKey); await route.fulfill({ json: { ...status("pending", body.attemptId), googleClientId: CLIENT, redirectUri: MAIN + "/hackathon/zklogin/callback", nonce: stored.nonce, oauthState: `state_${"a".repeat(32)}` } }) })
  await page.route("https://accounts.google.com/**", route => { destination = new URL(route.request().url()); return route.fulfill({ contentType: "text/html", body: "<title>OFFLINE AUTHORIZATION DESTINATION</title>" }) })
  await f.open(); await expect(page.getByTestId("hackathon-google-disclosure")).toContainText("Testnet"); await expect(page.getByTestId("hackathon-signer-google")).toBeEnabled(); expect(starts).toBe(0)
  await page.getByTestId("hackathon-signer-google").scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath(`google-consent-${locale}.png`), scale: "css" })
  await page.getByTestId("hackathon-signer-google").click(); await expect.poll(() => starts).toBe(1); await expect.poll(() => !!destination).toBe(true)
  expect(destination!.searchParams.get("redirect_uri")).toBe(MAIN + "/hackathon/zklogin/callback"); expect(destination!.searchParams.get("response_type")).toBe("id_token")
  expect(harvey.calls.filter(c => c.method === "POST" && c.path !== "/sessions")).toEqual([])
})
test("native WK bridge cannot start Google and gives external browser guidance", async ({ page, harvey }) => {
  const f = await setup(page, harvey)
  await page.addInitScript(() => { Object.defineProperty(window, "ktourNative", { value: Object.freeze({ available: true, platform: "ios", openOffer() { throw Error("must not call") }, showWallet() { throw Error("must not call") } }) }) })
  await f.open(); await expect(page.getByTestId("hackathon-signer-google")).toBeDisabled(); await expect(page.getByTestId("hackathon-google-browser-required")).toContainText("Safari or Chrome")
  expect(harvey.calls.filter(c => c.path.startsWith("/zklogin/"))).toEqual([])
})
test("proof uncertainty/reload only checks status; explicit cancellation clears only login", async ({ page, harvey }) => {
  const f = await setup(page, harvey); await seedSigner(page); let proves = 0, gets = 0, cancels = 0
  await page.route("**/api/hackathon/v1/zklogin/prove", async route => { proves++; expect(await page.evaluate(key => sessionStorage.getItem(key), JWTKEY)).toBeNull(); await route.abort("failed") })
  await page.route(`**/api/hackathon/v1/zklogin/status/${OP}/${ATT}`, route => { gets++; return route.fulfill({ json: status("unknown") }) })
  await page.route("**/api/hackathon/v1/zklogin/cancel", route => { cancels++; return route.fulfill({ json: status("cancelled") }) })
  await f.open(); await page.getByTestId("hackathon-signer-google").click(); await expect.poll(() => proves).toBe(1); await expect(page.getByTestId("hackathon-signer-google")).toBeEnabled()
  await page.reload({ waitUntil: "domcontentloaded" }); await expect(page.getByTestId("hackathon-signer-google")).toBeVisible(); await page.getByTestId("hackathon-signer-google").click(); await expect.poll(() => gets).toBe(1); expect(proves).toBe(1)
  await page.getByTestId("hackathon-login-cancel").click(); await expect.poll(() => cancels).toBe(1); await expect(page.getByTestId("hackathon-login-cancel")).toHaveCount(0); expect(await page.evaluate(key => sessionStorage.getItem(key), SK)).toBeNull(); await expect(page.getByTestId("hackathon-layer")).toHaveAttribute("data-phase", "delegation")
  expect(harvey.calls.filter(c => c.method === "POST" && c.path !== "/sessions")).toEqual([])
})
test("AI unknown outcome only reads existing result, never repeats proposal", async ({ page, harvey }) => {
  const f = await setup(page, harvey, "en", "proposal"); await f.open(); const before = f.gets(); await expect(page.getByTestId("hackathon-propose")).toHaveCount(0); await expect(page.getByTestId("hackathon-proposal-unknown")).toBeVisible(); await page.getByTestId("hackathon-proposal-check").click(); await expect.poll(f.gets).toBe(before + 1)
  expect(harvey.calls.filter(c => c.path.endsWith("/proposal"))).toEqual([])
})
