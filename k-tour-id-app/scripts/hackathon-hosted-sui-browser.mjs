#!/usr/bin/env node
// Explicit one-shot operator verification: one UI journey can issue THREE real
// Testnet transactions. Not read-only. No retry, redeem, screenshots or traces.
import assert from "node:assert/strict"
import { constants, openSync, fstatSync, readSync, closeSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { chromium, expect } from "@playwright/test"
import { SuiGrpcClient } from "@mysten/sui/grpc"
import { parseSerializedSignature } from "@mysten/sui/cryptography"
import { Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519"
import { TransactionDataBuilder } from "@mysten/sui/transactions"

export const PIN = Object.freeze({
  host: "ktour-id.vercel.app", branch: "deploy/sui-main-20260928", project: "prj_w5rckTz9B1DO55fvVRXjQRy9L5RM", team: "team_6kJAloQ9WlswvMtbbCmGI7Er",
  username: "jaewook-9643", owner: "woogieboogie-jl", repo: "k-tour-id", chain: "69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD",
  rpc: "https://fullnode.testnet.sui.io:443", version: "349181963", gas: "10000000",
  packageId: "0x7a28a5e59d87e385f2eb3047ca2bbe76301627343f8d88eeb0f03733d4f2389e",
  campaignId: "0xa273ccd96315ae187b16eb3192c822795bc2031e6f79405739daec4a52275afd",
  venueId: "mois-0021cd596bc5b2a922ad", issuer: "0x900cd55f3d9de4541e306c6a3b1fe85cd4ddbf04319ee316ae21b6bb3ba95d76",
  agent: "0x17ee59f56d182c010732daaf509a2b35b221bf7ec62e4a59c3b2ceca2c3bbce4", sponsor: "0x900cd55f3d9de4541e306c6a3b1fe85cd4ddbf04319ee316ae21b6bb3ba95d76",
})
export const LIMITS = Object.freeze({ deadlineMs: 360000, requestMs: 20000, metadataBytes: 524288, bodyBytes: 131072, chainReads: 5, chainBytes: 524288 })
const AUTH = "/Users/woogieboogie/.config/vercel-accounts/jaewook/auth.json", API = "/api/hackathon/v1"
const SHA = /^[a-f0-9]{40}$/, DIGEST = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/, ADDRESS = /^0x[0-9a-f]{64}$/, OP = /^op_[A-Za-z0-9_-]{8,64}$/
const ACTIONS = ["identity/start", "identity/complete", "credential/issue", "credential/holder-ack", "presentation/request", "presentation/submit", "proposal", "delegation/prepare", "delegation/submit", "agent/run"]
const PHASES = ["consent", "identity", "issuance", "presentation", "proposal", "delegation", "agent", "fulfillment", "done", "cancelled"]
const safeErrors = new WeakSet()
const fail = code => { const e = new Error(code); e.safeCode = code; safeErrors.add(e); throw e }
export function originOf(value) {
  let u; try { u = new URL(value) } catch { fail("invalid_target") }
  if (typeof value !== "string" || u.protocol !== "https:" || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.vercel\.app$/.test(u.hostname) || u.port || u.username || u.password || u.pathname !== "/" || u.search || u.hash) fail("unapproved_target")
  return u.origin
}
function privateText(file, cap) {
  let fd
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW)
    const s = fstatSync(fd)
    if (!s.isFile() || (s.mode & 0o077) || s.uid !== process.getuid() || s.size > cap) fail("private_input_unavailable")
    const b = Buffer.alloc(cap + 1); let used = 0
    while (used < b.length) { const n = readSync(fd, b, used, b.length - used, null); if (!n) break; used += n }
    if (used > cap) fail("private_input_unavailable")
    return b.subarray(0, used).toString("utf8")
  } catch { fail("private_input_unavailable") } finally { if (fd !== undefined) closeSync(fd) }
}
function token() {
  let auth; try { auth = JSON.parse(privateText(AUTH, 16384)) } catch { fail("authentication_unavailable") }
  if (typeof auth.token !== "string" || !/^[A-Za-z0-9_.-]{16,512}$/.test(auth.token)) fail("authentication_unavailable")
  return auth.token
}
export function validateCode(code) { if (typeof code !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(code)) fail("invalid_access_code"); return code }
function abortable(work, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error("deadline"))
    if (signal.aborted) { void work.catch(() => {}); abort(); return }
    signal.addEventListener("abort", abort, { once: true })
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
  })
}
async function boundedBytes(response, cap, signal) {
  const declared = response.headers.get("content-length")
  if (!response.ok || response.redirected || !response.body || (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > cap))) { void response.body?.cancel().catch(() => {}); fail("remote_response") }
  const reader = response.body.getReader(), chunks = []; let length = 0
  try {
    while (true) { const next = await abortable(reader.read(), signal); if (next.done) break; length += next.value.length; if (length > cap) fail("remote_response_size"); chunks.push(next.value) }
    return Buffer.concat(chunks)
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock() }
}
export function metadataApi(auth, outerSignal, fetchImpl = globalThis.fetch) {
  let calls = 0
  return async path => {
    if (++calls > 4 || !/^\/v(?:2\/user|9\/projects\/prj_[A-Za-z0-9]+|13\/deployments\/(?:dpl_[A-Za-z0-9]+|[a-z0-9.-]+)|4\/aliases\/ktour-id\.vercel\.app)$/.test(path)) fail("metadata_read_scope")
    const url = new URL(path, "https://api.vercel.com"); url.searchParams.set("teamId", PIN.team)
    const signal = AbortSignal.any([outerSignal, AbortSignal.timeout(LIMITS.requestMs)])
    const response = await abortable(fetchImpl(url.href, { method: "GET", redirect: "error", credentials: "omit", cache: "no-store", signal, headers: { authorization: `Bearer ${auth}` } }), signal)
    try { return JSON.parse((await boundedBytes(response, LIMITS.metadataBytes, signal)).toString("utf8")) } catch { fail("metadata_unavailable") }
  }
}

/** Read-only Vercel checks BEFORE browser launch or access POST. The injected
 * GET API is for offline tests; run() accepts no bypass callback.
 * @param {{origin: string, expectedRevision?: string, deploymentId?: string}} options
 * @param {(path: string) => Promise<any>} api */
export async function verifyDeployment({ origin, expectedRevision, deploymentId = undefined }, api) {
  const base = originOf(origin), host = new URL(base).hostname
  if (!SHA.test(expectedRevision ?? "") || (deploymentId !== undefined && !/^dpl_[A-Za-z0-9]+$/.test(deploymentId))) fail("expected_revision_required")
  const [user, p] = await Promise.all([api("/v2/user"), api(`/v9/projects/${PIN.project}`)])
  if (user?.user?.username !== PIN.username || p?.id !== PIN.project || p.accountId !== PIN.team || p.name !== "ondo" || p.rootDirectory !== "k-tour-id-app" || p.link?.type !== "github" || p.link.org !== PIN.owner || p.link.repo !== PIN.repo) fail("deployment_account_mismatch")
  const publicAlias = host === PIN.host, lookup = deploymentId ?? (publicAlias ? p.targets?.production?.id : host)
  if (typeof lookup !== "string" || (publicAlias && !/^dpl_[A-Za-z0-9]+$/.test(lookup))) fail("deployment_missing")
  const d = await api(`/v13/deployments/${lookup}`)
  if (!/^dpl_[A-Za-z0-9]+$/.test(d?.id ?? "") || (deploymentId && d.id !== deploymentId) || d.projectId !== PIN.project || d.ownerId !== PIN.team || d.readyState !== "READY" || d.meta?.githubCommitSha !== expectedRevision || d.meta.githubCommitRef !== PIN.branch || !Array.isArray(d.regions) || d.regions.length !== 1 || d.regions[0] !== "icn1" || ![null, undefined, "preview", "production"].includes(d.target)) fail("deployment_mismatch")
  // Repo ownership comes from the pinned project's Git integration; when
  // duplicated deployment metadata is present it must not contradict it.
  if ((d.meta.githubCommitOrg !== undefined && d.meta.githubCommitOrg !== PIN.owner) || (d.meta.githubCommitRepo !== undefined && d.meta.githubCommitRepo !== PIN.repo)) fail("deployment_mismatch")
  if (publicAlias) {
    const alias = await api(`/v4/aliases/${PIN.host}`)
    if (d.target !== "production" || p.targets?.production?.id !== d.id || alias?.alias !== PIN.host || alias.projectId !== PIN.project || (alias.deployment?.id ?? alias.deploymentId) !== d.id) fail("deployment_alias_mismatch")
  } else if (d.url !== host) fail("deployment_origin_mismatch")
  return { id: d.id, origin: base, immutableOrigin: originOf(`https://${d.url}`), target: d.target === "production" ? "production" : "preview", sha: expectedRevision, branch: PIN.branch }
}

/** Claims each mutation BEFORE forwarding, including requests that later fail.
 * Both APIRequestContext and browser requests must pass through this guard. */
export function createRequestGuard(origin) {
  const base = originOf(origin), counts = new Map(); let operation = null, index = 0, blocked = false
  const order = ["hosted/access", "sessions", "operations", ...ACTIONS]
  return {
    bindOperation(id) { if (!OP.test(id) || (operation && operation !== id)) fail("operation_mismatch"); operation = id },
    check(method, target) {
      const u = new URL(target, base)
      if (u.origin !== base || u.username || u.password || u.hash) { if (!["GET", "HEAD"].includes(method)) blocked = true; return false }
      if (["GET", "HEAD"].includes(method)) return true
      if (blocked) return false
      const segments = u.pathname.slice(API.length + 1).split("/"), key = segments[0] === "operations" && segments.length > 1 ? segments.slice(2).join("/") : segments.join("/")
      if (method !== "POST" || !u.pathname.startsWith(API + "/") || u.search || key !== order[index] || (segments[0] === "operations" && segments.length > 1 && segments[1] !== operation)) { blocked = true; return false }
      counts.set(key, (counts.get(key) ?? 0) + 1); index++; return true
    },
    summary() { return { blocked, complete: index === order.length, mutations: Object.fromEntries(counts) } },
  }
}
export function validateConfig(c) {
  assert.equal(c.hostedSui, true); assert.equal(c.isolatedMock, false)
  assert.deepEqual(c.modes, { cx: "mock", opendid: "mock", ai: "rule", sui: "testnet", omnione: "unconfigured", zklogin: "demo-signer" })
  assert.equal(c.campaign.venueId, PIN.venueId); assert.equal(c.sui.network, "testnet"); assert.equal(c.sui.packageId, PIN.packageId); assert.equal(c.sui.campaignId, PIN.campaignId)
  assert.equal(c.capabilities?.chainExecutionEnabled, true); assert.equal(c.capabilities?.redemptionEnabled, false)
}
export function receiptCommitment(v) {
  if (typeof v === "string" && /^0x[0-9a-f]{64}$/i.test(v)) return v.toLowerCase()
  if (Array.isArray(v) && v.length === 32 && v.every(n => Number.isInteger(n) && n >= 0 && n <= 255)) return "0x" + Buffer.from(v).toString("hex")
  // SDK gRPC JSON preserves canonical base64 for Move vector<u8> fields.
  if (typeof v === "string" && /^[A-Za-z0-9+/]{43}=$/.test(v)) {
    const bytes = Buffer.from(v, "base64")
    if (bytes.length === 32 && bytes.toString("base64") === v) return "0x" + bytes.toString("hex")
  }
  fail("receipt_commitment")
}
const hash = receiptCommitment

export async function verifyReceipts(client, op, ev) {
  const holder = op.delegation?.userAddress, digests = [op.delegation?.entitlement?.txDigest, op.delegation?.userTxDigest, op.agent?.txDigest]
  if (!ADDRESS.test(holder ?? "") || holder === PIN.issuer || holder === PIN.agent || digests.some(d => !DIGEST.test(d ?? "")) || new Set(digests).size !== 3) fail("three_receipts_required")
  assert.equal(ev.operationId, op.operationId); assert.equal(ev.sui?.network, "testnet"); assert.equal(ev.sui.packageId, PIN.packageId); assert.equal(ev.sui.campaignId, PIN.campaignId)
  assert.equal(ev.provenanceCheck?.matches, true); assert.equal(ev.omnione, null); assert.equal(ev.sui.signer, "demo")
  assert.equal(ev.sui.entitlement?.issueTx, digests[0]); assert.equal(ev.sui.grant?.tx, digests[1]); assert.equal(ev.sui.agent?.tx, digests[2]); assert.equal(ev.sui.agent.status, "executed")
  const info = await client.ledgerService.getServiceInfo({}).response
  assert.equal(info.chainId, PIN.chain); assert.equal(info.chain, "testnet")
  const txs = await Promise.all(digests.map(async digest => {
    const out = await client.getTransaction({ digest, include: { effects: true, events: true, bcs: true, transaction: true } }), tx = out.Transaction ?? out.FailedTransaction
    assert.equal(tx?.digest, digest); assert.equal(tx?.status?.success, true); assert.equal(tx.effects.transactionDigest, digest)
    assert.equal(TransactionDataBuilder.getDigestFromBytes(tx.bcs), digest); return tx
  }))
  const mod = `${PIN.packageId}::entitlement::`, actors = [PIN.issuer, holder, PIN.agent], functions = [["issue"], ["delegate", "attest_consent"], ["consume", "attest_execution"]]
  const event = (i, name) => { const rows = txs[i].events.filter(e => e.eventType === mod + name); assert.equal(rows.length, 1); assert.equal(rows[0].sender, actors[i]); assert.equal(rows[0].json.campaign, PIN.campaignId); return rows[0].json }
  assert.deepEqual(txs.map(tx => tx.events.length), [1, 2, 2])
  const issued = event(0, "EntitlementIssued"), granted = event(1, "GrantCreated"), consent = event(1, "ConsentAttested"), consumed = event(2, "GrantConsumed"), attested = event(2, "ExecutionAttested")
  assert.equal(issued.holder, holder); assert.equal(granted.owner, holder); assert.equal(consent.owner, holder)
  assert.equal(granted.recipient, holder); assert.equal(consumed.recipient, holder)
  for (const row of [granted, consumed, attested]) assert.equal(row.agent, PIN.agent)
  assert.equal(issued.entitlement, op.delegation.entitlement.objectId); assert.equal(granted.grant, op.delegation.grant.objectId)
  assert.equal(consent.grant, granted.grant); assert.equal(consumed.grant, granted.grant); assert.equal(consumed.record, op.agent.recordId); assert.equal(attested.record, consumed.record)
  for (const row of [issued, granted, consumed]) assert.equal(hash(row.intent_ref), op.delegation.intentRef)
  assert.equal(hash(granted.action_commitment), op.delegation.actionCommitment); assert.equal(hash(consent.consent_commitment), op.delegation.consentCommitment)
  assert.equal(hash(consumed.decision_commitment), op.agent.decisionCommitment); assert.equal(hash(attested.manifest_commitment), op.agent.manifestCommitment)
  const receipts = []
  for (const [i, tx] of txs.entries()) {
    assert.equal(tx.transaction.sender, actors[i]); assert.equal(tx.transaction.gasData.owner, PIN.sponsor); assert.equal(String(tx.transaction.gasData.budget), PIN.gas)
    assert.deepEqual(tx.transaction.commands.map(c => { assert.equal(c.MoveCall?.package, PIN.packageId); assert.equal(c.MoveCall.module, "entitlement"); return c.MoveCall.function }), functions[i])
    const refs = tx.transaction.inputs.flatMap(input => input.Object ? [input.Object.SharedObject ?? input.Object.ImmOrOwnedObject ?? input.Object.Receiving] : [])
    assert.ok(refs.some(ref => ref.objectId === PIN.campaignId && String(ref.initialSharedVersion) === PIN.version))
    if (i > 0) assert.ok(refs.some(ref => ref.objectId === (i === 1 ? issued.entitlement : granted.grant)))
    assert.ok(tx.effects.changedObjects.some(o => o.idOperation === "Created" && o.objectId === [issued.entitlement, granted.grant, consumed.record][i]))
    const signers = [], schemes = []
    for (const serialized of tx.signatures) {
      const parsed = parseSerializedSignature(serialized); assert.equal(parsed.signatureScheme, "ED25519")
      const key = new Ed25519PublicKey(parsed.publicKey); assert.equal(await key.verifyTransaction(tx.bcs, serialized), true)
      signers.push(key.toSuiAddress()); schemes.push(parsed.signatureScheme)
    }
    assert.deepEqual(signers.slice().sort(), [...new Set([actors[i], PIN.sponsor])].sort())
    receipts.push({ digest: tx.digest, checkpoint: tx.checkpoint, success: true, sender: tx.transaction.sender, gasOwner: tx.transaction.gasData.owner, gasBudgetMIST: PIN.gas, signatureSchemes: schemes, signerAddresses: signers, cryptographicallyVerified: true })
  }
  const result = await client.getObjects({ objectIds: [granted.grant, consumed.record], include: { json: true } }), [grant, record] = result.objects
  assert.equal(result.objects.length, 2); assert.equal(grant.objectId, granted.grant); assert.equal(grant.type, mod + "Grant"); assert.equal(grant.owner.$kind, "Shared")
  assert.equal(Number(grant.json.uses), 1); assert.equal(Number(grant.json.max_uses), 1); assert.equal(grant.json.revoked, false)
  for (const [key, value] of [["campaign", PIN.campaignId], ["agent", PIN.agent], ["owner", holder], ["recipient", holder]]) assert.equal(grant.json[key], value)
  assert.equal(hash(grant.json.intent_ref), op.delegation.intentRef); assert.equal(hash(grant.json.action_commitment), op.delegation.actionCommitment); assert.equal(Number(grant.json.policy_version), 1)
  assert.equal(record.objectId, consumed.record); assert.equal(record.type, mod + "ExecutionRecord"); assert.equal(record.owner.AddressOwner, holder)
  assert.equal(record.json.campaign, PIN.campaignId); assert.equal(record.json.grant, granted.grant); assert.equal(record.json.agent, PIN.agent)
  for (const [key, value] of [["intent_ref", op.delegation.intentRef], ["action_commitment", op.delegation.actionCommitment], ["decision_commitment", op.agent.decisionCommitment]]) assert.equal(hash(record.json[key]), value)
  assert.equal(String(record.json.executed_at_ms), String(consumed.executed_at_ms))
  return { receipts, holder, grantId: granted.grant, grantUses: 1, maxUses: 1, recordId: consumed.record, recordRecipient: holder, txDigests: digests }
}
export function readonlyClient(signal, stats, fetchImpl = globalThis.fetch) {
  const allowed = new Set(["/sui.rpc.v2.LedgerService/GetServiceInfo", "/sui.rpc.v2.LedgerService/GetTransaction", "/sui.rpc.v2.LedgerService/BatchGetObjects"])
  return new SuiGrpcClient({ network: "testnet", baseUrl: PIN.rpc, format: "binary", fetch: async (input, init) => {
    const url = new URL(String(input))
    if (url.origin !== new URL(PIN.rpc).origin || !allowed.has(url.pathname) || url.search || url.hash || url.username || url.password || init?.method !== "POST" || !(init.body instanceof Uint8Array) || init.body.length > 2048 || ++stats.reads > LIMITS.chainReads) fail("chain_read_scope")
    const combined = AbortSignal.any([signal, AbortSignal.timeout(LIMITS.requestMs)])
    const response = await abortable(fetchImpl(url.href, { method: "POST", body: init.body, headers: { "content-type": "application/grpc-web+proto", "x-grpc-web": "1" }, signal: combined, redirect: "error", credentials: "omit", cache: "no-store" }), combined)
    const bytes = await boundedBytes(response, LIMITS.bodyBytes, combined); stats.bytes += bytes.length
    if (stats.bytes > LIMITS.chainBytes) fail("chain_response_size")
    const headers = new Headers(); for (const key of ["content-type", "grpc-status"]) if (response.headers.has(key)) headers.set(key, response.headers.get(key))
    return new Response(bytes, { status: 200, headers })
  } })
}
async function apiJson(response) {
  if (response.status() !== 200) fail("application_response")
  const bytes = await response.body(); if (bytes.length > LIMITS.bodyBytes) fail("application_response_size")
  try { return JSON.parse(bytes.toString("utf8")) } catch { fail("application_json") }
}

export async function run({ origin, accessCode, expectedRevision, deploymentId } = {}) {
  const report = { ok: false, status: "running", checkpoint: "input", errorCode: null, actionSteps: [], txDigests: [], pageErrors: 0, requestFailures: 0, unexpectedRequestFailures: 0, blockedExternalAssets: 0, httpFailures: [], chainRead: { reads: 0, bytes: 0 } }
  let browser, context, guard, latest = null, page; const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort(); void context?.close().catch(() => {}) }, LIMITS.deadlineMs)
  const capture = op => {
    if (!OP.test(op?.operationId ?? "")) return
    guard.bindOperation(op.operationId); latest = op; report.operationId = op.operationId
    if (PHASES.includes(op.phase)) report.lastPhase = op.phase
    if (["pending", "failed", "expired", "cancelled", "succeeded"].includes(op.status)) report.lastOperationStatus = op.status
    report.txDigests = [op.delegation?.entitlement?.txDigest, op.delegation?.userTxDigest, op.agent?.txDigest].filter(d => DIGEST.test(d ?? ""))
  }
  try {
    const base = originOf(origin); validateCode(accessCode)
    if (!SHA.test(expectedRevision ?? "")) fail("expected_revision_required")
    report.checkpoint = "deployment_metadata"
    report.deployment = await verifyDeployment({ origin: base, expectedRevision, deploymentId }, metadataApi(token(), controller.signal))
    report.actionSteps.push("deployment_account_project_revision_verified"); guard = createRequestGuard(base)
    browser = await chromium.launch({ headless: true }); context = await browser.newContext({ baseURL: base, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" })
    page = await context.newPage(); page.setDefaultTimeout(45000)
    page.on("pageerror", () => { report.pageErrors++ }); page.on("requestfailed", request => {
      report.requestFailures++
      if (new URL(request.url()).origin === base) report.unexpectedRequestFailures++
    })
    const observations = new Set()
    page.on("response", response => {
      const u = new URL(response.url()); if (u.origin !== base || !u.pathname.startsWith(API + "/")) return
      const task = (async () => {
        if (response.status() >= 400 && report.httpFailures.length < 10) report.httpFailures.push({ status: response.status(), action: ACTIONS.find(a => u.pathname.endsWith("/" + a)) ?? "application" })
        const bytes = await response.body(); if (bytes.length > LIMITS.bodyBytes) fail("application_response_size")
        const b = JSON.parse(bytes.toString("utf8")); capture(b?.operationId ? b : b?.result)
      })().catch(() => { report.observationError = true }).finally(() => observations.delete(task))
      observations.add(task)
    })
    await context.route("**/*", async route => {
      const req = route.request()
      if (!guard.check(req.method(), req.url())) {
        if (new URL(req.url()).origin !== base && ["GET", "HEAD"].includes(req.method())) report.blockedExternalAssets++
        await route.abort("blockedbyclient"); return
      }
      if (req.method() === "POST" && (Buffer.byteLength(req.postData() ?? "") > LIMITS.bodyBytes || !(req.headers()["content-type"] ?? "").startsWith("application/json"))) { report.invalidBody = true; await route.abort("blockedbyclient"); return }
      await route.continue()
    })
    const read = async path => { if (!guard.check("GET", base + API + path)) fail("request_scope"); return apiJson(await context.request.get(base + API + path, { timeout: LIMITS.requestMs, maxRedirects: 0 })) }
    report.checkpoint = "access"
    if (!guard.check("POST", base + API + "/hosted/access")) fail("request_scope")
    await apiJson(await context.request.post(base + API + "/hosted/access", { data: { accessCode }, headers: { origin: base }, timeout: LIMITS.requestMs, maxRedirects: 0 })); accessCode = undefined
    report.actionSteps.push("access_granted"); report.checkpoint = "configuration"; validateConfig(await read("/config"))
    const before = await read(`/places/${PIN.venueId}/demo-entitlements`); if (before.operation) fail("operation_already_exists")
    await page.addInitScript(() => localStorage.setItem("ondo-b.device.v1", JSON.stringify({ locale: "en", appearancePreference: "light", onboarding: "ONB-COMPLETE" })))
    report.checkpoint = "page_bootstrap"
    await page.goto(`/?venueId=${PIN.venueId}&review=0`, { waitUntil: "domcontentloaded", timeout: 60000 }); await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated", "true", { timeout: 60000 })
    await page.getByTestId("canonical-place-details").click(); await page.getByTestId("hackathon-entitlement-open").click()
    const layer = page.getByTestId("hackathon-layer"), phase = p => expect(layer).toHaveAttribute("data-phase", p, { timeout: 45000 })
    await phase("consent"); report.checkpoint = "consent"; await page.locator("#hk-consent").check(); await page.getByTestId("hackathon-start").click(); await phase("identity")
    await Promise.all([...observations]); if (!latest) fail("operation_missing")
    report.checkpoint = "sample_identity"; await page.getByTestId("hackathon-identity-start").click(); await page.getByTestId("hackathon-identity-approve").click(); await phase("issuance"); report.actionSteps.push("sample_identity_approved")
    report.checkpoint = "holder_issue_ack"; await page.getByTestId("hackathon-issue").click(); await phase("presentation")
    report.checkpoint = "presentation"; await page.getByTestId("hackathon-present").click(); await phase("proposal")
    report.checkpoint = "proposal"; await page.getByTestId("hackathon-propose").click(); await phase("delegation"); await page.getByTestId("hackathon-signer-demo").click()
    report.checkpoint = "delegation"; await page.locator("#hk-approve").check(); await page.getByTestId("hackathon-delegate").click(); await phase("agent"); report.actionSteps.push("ed25519_approval_and_delegation")
    report.checkpoint = "agent_execution"; await page.getByTestId("hackathon-agent-run").click(); await phase("fulfillment")
    await Promise.all([...observations]); const state = guard.summary(); if (state.blocked || !state.complete || report.observationError || report.invalidBody) fail("request_scope")
    const op = await read(`/operations/${latest.operationId}`); capture(op)
    if (op.fulfillment?.status !== "pending" || op.agent?.status !== "executed" || op.chain !== null) fail("fulfillment_not_terminal")
    report.checkpoint = "receipt_verification"
    const ev = await read(`/operations/${op.operationId}/evidence`)
    Object.assign(report, await verifyReceipts(readonlyClient(controller.signal, report.chainRead), op, ev)); report.actionSteps.push("three_sui_receipts_verified", "hosted_fulfillment_pending_no_redeem")
    report.checkpoint = "return_to_place"
    await page.keyboard.press("Escape"); await expect(layer).toHaveCount(0); await expect(page.getByTestId("canonical-place-overlay")).toHaveAttribute("data-venue-id", PIN.venueId)
    await Promise.all([...observations])
    if (guard.summary().blocked || report.pageErrors || report.unexpectedRequestFailures || report.httpFailures.length || report.observationError || report.invalidBody) fail("browser_errors")
    report.actionSteps.push("returned_to_place"); report.ok = true; report.status = "passed"; report.checkpoint = "complete"
  } catch (error) { report.status = "failed"; report.errorCode = safeErrors.has(error) ? error.safeCode : "verification_failed" }
  finally {
    report.requests = guard?.summary() ?? null; clearTimeout(timer); controller.abort()
    if (page && !page.isClosed()) { const phase = await page.getByTestId("hackathon-layer").getAttribute("data-phase", { timeout: 500 }).catch(() => null); if (PHASES.includes(phase)) report.lastPhase = phase }
    if (browser) await browser.close().catch(() => {})
  }
  return report
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [origin, expectedRevision] = process.argv.slice(2)
  Promise.resolve().then(() => { if (process.argv.length !== 4) fail("arguments"); const code = process.env.HK_HOSTED_SUI_ACCESS_CODE || (process.env.HK_HOSTED_SUI_ACCESS_FILE ? privateText(process.env.HK_HOSTED_SUI_ACCESS_FILE, 256).trim() : undefined); return run({ origin, expectedRevision, accessCode: validateCode(code) }) })
    .then(r => { console.log(JSON.stringify(r)); if (!r.ok) process.exitCode = 1 })
    .catch(() => { console.log(JSON.stringify({ ok: false, status: "failed", errorCode: "verification_failed" })); process.exitCode = 1 })
}
