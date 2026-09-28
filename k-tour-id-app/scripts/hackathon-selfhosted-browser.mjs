#!/usr/bin/env node
// Explicit, one-operation live-chain browser check. NOT part of automatic CI.
// Identity/VC are labelled samples; the three Sui transactions are real.
// Never redeems a perk or calls OmniOne, Google OAuth, CX or OpenDID providers.
import assert from "node:assert/strict"
import { readFileSync, writeFileSync, openSync, closeSync, fsyncSync, lstatSync, realpathSync } from "node:fs"
import { resolve, dirname, basename } from "node:path"
import { homedir } from "node:os"
import { chromium, expect } from "@playwright/test"
import { SuiGrpcClient } from "@mysten/sui/grpc"
import { parseSerializedSignature } from "@mysten/sui/cryptography"
import { verifyTransactionSignature } from "@mysten/sui/verify"
import { TransactionDataBuilder } from "@mysten/sui/transactions"

const dir = resolve(process.argv[2] ?? ".")
assert.equal(dirname(dir), resolve(homedir(), ".local/share/ktour-sui-e2e"))
assert(basename(dir).startsWith("run-20260928-"))
assert.equal(realpathSync(dir), dir)
assert.equal(lstatSync(dir).mode & 0o077, 0)
const manifest = JSON.parse(readFileSync(resolve(dir, "manifest.json"), "utf8"))
assert.equal(manifest.network, "testnet")
assert(manifest.packageId && manifest.campaignId)
const base = "http://127.0.0.1:3160"
const cfgResponse = await fetch(`${base}/api/hackathon/v1/config`, { signal: AbortSignal.timeout(60000) })
assert.equal(cfgResponse.status, 200)
const config = await cfgResponse.json()
assert.equal(config.isolatedMock, false)
assert.deepEqual(config.modes, { cx: "mock", opendid: "mock", ai: "rule", sui: "testnet", omnione: "unconfigured", zklogin: "demo-signer" })
assert.equal(config.sui.packageId, manifest.packageId)
assert.equal(config.sui.campaignId, manifest.campaignId)
assert.equal(config.sui.network, manifest.network)
const client = new SuiGrpcClient({ network: manifest.network, baseUrl: "https://fullnode.testnet.sui.io:443" })
const initialCampaign = (await client.getObject({ objectId: manifest.campaignId, include: { json: true } })).object
assert.equal(initialCampaign.owner.$kind, "Shared")
assert.equal(String(initialCampaign.owner.Shared.initialSharedVersion), String(manifest.campaignInitialVersion))
assert.equal(initialCampaign.json.issuer, manifest.issuer)
assert.equal(initialCampaign.json.agent, manifest.agent)
for (const counter of ["issued", "delegated", "consumed"]) assert.equal(Number(initialCampaign.json[counter]), 0)
// One-shot even after a crash; an operator must reconcile the saved operation.
const claim = openSync(resolve(dir, "browser-attempt.json"), "wx", 0o600)
writeFileSync(claim, JSON.stringify({ startedAt: new Date().toISOString(), base, packageId: manifest.packageId })); fsyncSync(claim); closeSync(claim)
const report = { network: manifest.network, packageId: manifest.packageId, campaignId: manifest.campaignId, startedAt: new Date().toISOString(), sampleIdentity: true, sampleCredential: true, signer: "ED25519", realChain: true, status: "running", calls: [], externalMutations: [], pageErrors: [], checks: {} }
const saveReport = () => writeFileSync(resolve(dir, "browser-public-report.json"), JSON.stringify(report, null, 2), { mode: 0o600 })
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ baseURL: base, viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true })
const page = await context.newPage()
page.setDefaultTimeout(60000)
const pendingResponses = new Set()
let latest = null
page.on("pageerror", () => report.pageErrors.push("browser_runtime_error"))
page.on("response", response => {
  const url = new URL(response.url())
  if (url.origin !== base || !url.pathname.startsWith("/api/hackathon/v1/")) return
  const task = (async () => {
    const data = await response.json().catch(() => null)
    const op = data?.result?.operationId ? data.result : data?.operationId ? data : null
    report.calls.push({ method: response.request().method(), path: url.pathname, status: response.status(), errorCode: data?.error?.code })
    if (op?.operationId) {
      latest = op
      report.operationId = op.operationId
      report.lastPhase = op.phase
      report.delegationStatus = op.delegation?.status
      report.agentStatus = op.agent?.status
      report.issueDigest = op.delegation?.entitlement?.txDigest ?? report.issueDigest
      report.delegateDigest = op.delegation?.userTxDigest ?? report.delegateDigest
      report.agentDigest = op.agent?.txDigest ?? report.agentDigest
    }
    saveReport()
  })()
  pendingResponses.add(task); task.finally(() => pendingResponses.delete(task))
})
try {
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== base) {
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) report.externalMutations.push(url.origin + url.pathname)
      await route.abort("blockedbyclient"); return
    }
    if (!["GET", "HEAD", "OPTIONS", "POST"].includes(request.method()) || (request.method() === "POST" && (!url.pathname.startsWith("/api/hackathon/v1/") || /\/redeem$/.test(url.pathname)))) {
      report.externalMutations.push(url.pathname); await route.abort("blockedbyclient"); return
    }
    await route.continue()
  })
  await page.addInitScript(() => localStorage.setItem("ondo-b.device.v1", JSON.stringify({ locale: "en", appearancePreference: "light", onboarding: "ONB-COMPLETE" })))
  const venue = config.campaign.venueId
  await page.goto(`/?venueId=${venue}&review=0`, { waitUntil: "domcontentloaded", timeout: 120000 })
  await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true", { timeout: 120000 })
  await page.getByTestId("canonical-place-details").click()
  await page.getByTestId("hackathon-entitlement-open").click()
  const layer = page.getByTestId("hackathon-layer")
  const phase = async expected => {
    await expect(layer).toHaveAttribute("data-phase", expected, { timeout: 90000 })
    console.log(JSON.stringify({ phase: expected }))
  }
  await phase("consent")
  await expect(page.getByTestId("hackathon-start")).toBeDisabled()
  await page.locator("#hk-consent").check()
  await page.getByTestId("hackathon-start").click()
  await page.getByTestId("hackathon-identity-start").click()
  await page.getByTestId("hackathon-identity-approve").click()
  await phase("issuance")
  await page.getByTestId("hackathon-issue").click()
  await phase("presentation")
  await page.getByTestId("hackathon-present").click()
  await phase("proposal")
  await page.getByTestId("hackathon-propose").click()
  await phase("delegation")
  await page.getByTestId("hackathon-signer-demo").click()
  await expect(page.getByTestId("hackathon-delegate")).toBeDisabled()
  await page.locator("#hk-approve").check()
  await page.screenshot({ path: resolve(dir, "01-user-approval.png"), scale: "css" })
  await page.getByTestId("hackathon-delegate").click()
  await phase("agent")
  await page.screenshot({ path: resolve(dir, "02-delegated.png"), scale: "css" })
  await page.getByTestId("hackathon-agent-run").click()
  await phase("fulfillment")
  await Promise.all([...pendingResponses])
  assert.equal(latest.agent.status, "executed")
  assert.equal(latest.agent.verified.grantUses, 1)
  assert.equal(latest.fulfillment.status, "pending")
  await page.screenshot({ path: resolve(dir, "03-agent-executed.png"), scale: "css" })
  const evidenceResponse = await context.request.get(`${base}/api/hackathon/v1/operations/${report.operationId}/evidence`)
  assert.equal(evidenceResponse.status(), 200)
  const evidence = await evidenceResponse.json()
  assert.equal(evidence.provenanceCheck.matches, true)
  assert.equal(evidence.sui.agent.status, "executed")
  assert.equal(evidence.omnione, null)
  const mod = `${manifest.packageId}::entitlement::`
  const expected = [[report.issueDigest, ["EntitlementIssued"], [manifest.issuer]], [report.delegateDigest, ["GrantCreated", "ConsentAttested"], [latest.delegation.userAddress, manifest.sponsor]], [report.agentDigest, ["GrantConsumed", "ExecutionAttested"], [manifest.agent, manifest.sponsor]]]
  assert.equal(new Set(expected.map(([digest]) => digest)).size, 3)
  report.receipts = []
  for (const [digest, eventNames, signerAddresses] of expected) {
    assert(digest)
    const r = await client.getTransaction({ digest, include: { effects: true, events: true, bcs: true, transaction: true } })
    const tx = r.Transaction ?? r.FailedTransaction
    assert.equal(tx.digest, digest); assert.equal(tx.status.success, true)
    assert.equal(TransactionDataBuilder.getDigestFromBytes(tx.bcs), digest)
    assert.equal(tx.transaction.sender, signerAddresses[0])
    const verifiedSigners = []
    for (const signature of tx.signatures) {
      assert.equal(parseSerializedSignature(signature).signatureScheme, "ED25519")
      verifiedSigners.push((await verifyTransactionSignature(tx.bcs, signature)).toSuiAddress())
    }
    assert.deepEqual(verifiedSigners.sort(), [...signerAddresses].sort())
    for (const name of eventNames) assert(tx.events.some(event => event.eventType === mod + name))
    report.receipts.push({ digest, success: true, signatureScheme: "ED25519", verifiedSigners, events: tx.events.map(event => event.eventType) })
  }
  const grant = (await client.getObject({ objectId: evidence.sui.grant.objectId, include: { json: true } })).object
  assert.equal(grant.type, mod + "Grant")
  assert.equal(Number(grant.json.uses), 1)
  assert.equal(grant.json.owner, latest.delegation.userAddress)
  assert.equal(grant.json.agent, manifest.agent)
  assert.equal(grant.json.campaign, manifest.campaignId)
  const record = (await client.getObject({ objectId: evidence.sui.agent.recordId, include: { json: true } })).object
  assert.equal(record.type, mod + "ExecutionRecord")
  assert.equal(record.owner.$kind, "AddressOwner")
  assert.equal(record.owner.AddressOwner, latest.delegation.userAddress)
  assert.equal(record.json.grant, grant.objectId)
  assert.equal(record.json.agent, manifest.agent)
  assert.equal(record.json.campaign, manifest.campaignId)
  // A repeated command after execution must not create another chain effect.
  const duplicate = await context.request.post(`${base}/api/hackathon/v1/operations/${report.operationId}/agent/run`, { data: {}, headers: { origin: base } })
  assert.equal(duplicate.status(), 409)
  const after = (await client.getObject({ objectId: grant.objectId, include: { json: true } })).object
  assert.equal(Number(after.json.uses), 1)
  for (const suffix of ["credential/issue", "delegation/prepare", "delegation/submit", "agent/run"]) assert.equal(report.calls.filter(call => call.method === "POST" && call.path.endsWith(suffix) && call.status === 200).length, 1)
  const finalCampaign = (await client.getObject({ objectId: manifest.campaignId, include: { json: true } })).object
  for (const counter of ["issued", "delegated", "consumed"]) assert.equal(Number(finalCampaign.json[counter]), 1)
  report.campaignCounters = { issued: Number(finalCampaign.json.issued), delegated: Number(finalCampaign.json.delegated), consumed: Number(finalCampaign.json.consumed) }
  assert.deepEqual(report.externalMutations, [])
  assert.deepEqual(report.pageErrors, [])
  report.checks = { realBff: true, signedApprovalRequired: true, threeSuccessfulReceipts: true, provenanceMatches: true, grantConsumedExactlyOnce: true, recordOwnedByUser: true, duplicateRejected: true, noOmnioneOrRedemption: true }
  await page.keyboard.press("Escape")
  await expect(layer).toHaveCount(0)
  await expect(page.getByTestId("canonical-place-overlay")).toHaveAttribute("data-venue-id", venue)
  report.checks.returnToOriginalPlace = true
  await page.screenshot({ path: resolve(dir, "04-return-to-place.png"), scale: "css" })
  await Promise.all([...pendingResponses])
  assert.deepEqual(report.externalMutations, [])
  assert.deepEqual(report.pageErrors, [])
  report.status = "passed"
} catch (error) {
  report.status = "failed"
  report.failureClass = error instanceof Error ? error.name : "unknown"
  // Diagnostic stays in the private run directory, never in exported evidence.
  writeFileSync(resolve(dir, "failure-diagnostic.txt"), error instanceof Error ? error.stack ?? error.message : "unknown", { mode: 0o600 })
  await page.screenshot({ path: resolve(dir, "failure.png"), scale: "css" }).catch(() => {})
  process.exitCode = 1
} finally {
  await Promise.all([...pendingResponses])
  report.finishedAt = new Date().toISOString()
  saveReport()
  console.log(JSON.stringify(report))
  await browser.close()
}
