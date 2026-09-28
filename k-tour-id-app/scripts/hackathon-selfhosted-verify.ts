// Independent operator READ ONLY verification; never imports signing keys or app adapters.
// Usage: node --import tsx scripts/hackathon-selfhosted-verify.ts --read-only \
//   /absolute/run-directory/manifest.json /absolute/run-directory/browser-public-report.json
import assert from "node:assert/strict"
import { constants, openSync, closeSync, fstatSync, readSync, lstatSync, realpathSync } from "node:fs"
import { basename, dirname, isAbsolute, resolve } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"
import { GrpcTypes, SuiGrpcClient } from "@mysten/sui/grpc"
import { Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519"
import { parseSerializedSignature } from "@mysten/sui/cryptography"
import { TransactionDataBuilder } from "@mysten/sui/transactions"
import { isValidTransactionDigest } from "@mysten/sui/utils"
import { chainId, commitment, verifyExecutionEvidence } from "../lib/hackathon/sui-evidence"

export const VERIFY_LIMITS = Object.freeze({ requests: 5, deadlineMs: 30_000, requestMs: 15_000, requestBytes: 8192, responseBytes: 524_288, oneResponseBytes: 131_072, publicFileBytes: 32_768 })
const RPC = "https://fullnode.testnet.sui.io:443"
const CHAIN = "69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD"
const MODULE_HASH = "f266e663f8045ecef8806fe0fc1ddf77ae74acf97c32d90dec2dbb38d6b94ffc"
const PATHS = { info: "/sui.rpc.v2.LedgerService/GetServiceInfo", transaction: "/sui.rpc.v2.LedgerService/GetTransaction", objects: "/sui.rpc.v2.LedgerService/BatchGetObjects" }
type Json = Record<string, unknown>
const json = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v)
function address(v: unknown): string { assert.ok(typeof v === "string" && chainId(v) === v); return v }
function digest(v: unknown): string { assert.ok(typeof v === "string" && isValidTransactionDigest(v)); return v }
function hash(v: unknown): string { const h = commitment(v); assert.ok(h); return h }
function uint(v: unknown): string {
  assert.ok(typeof v === "string" || (typeof v === "number" && Number.isSafeInteger(v)))
  const s = String(v); assert.ok(/^(0|[1-9][0-9]{0,19})$/.test(s) && BigInt(s) <= 18_446_744_073_709_551_615n); return s
}

/** Explicit public filenames only; no directory scanning, dotenv or private-file reads. */
export function loadPublicInputs(args: string[]) {
  assert.ok(args.length === 3 && args[0] === "--read-only")
  const [manifestPath, reportPath] = args.slice(1)
  assert.ok(isAbsolute(manifestPath) && isAbsolute(reportPath))
  assert.equal(resolve(manifestPath), manifestPath); assert.equal(resolve(reportPath), reportPath)
  assert.equal(basename(manifestPath), "manifest.json"); assert.equal(basename(reportPath), "browser-public-report.json")
  const dir = dirname(manifestPath)
  assert.equal(dirname(reportPath), dir)
  assert.equal(dirname(dir), resolve(homedir(), ".local/share/ktour-sui-e2e"))
  assert.match(basename(dir), /^run-20260928-[A-Za-z0-9]{6}$/)
  assert.equal(realpathSync(dir), dir)
  assert.ok(lstatSync(dir).isDirectory() && (lstatSync(dir).mode & 0o077) === 0)
  const readPublic = (path: string): unknown => {
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = fstatSync(fd)
      assert.ok(stat.isFile() && stat.size <= VERIFY_LIMITS.publicFileBytes)
      const buffer = Buffer.alloc(VERIFY_LIMITS.publicFileBytes + 1)
      let bytes = 0
      while (bytes < buffer.length) {
        const n = readSync(fd, buffer, bytes, buffer.length - bytes, null)
        if (n === 0) break
        bytes += n
      }
      assert.ok(bytes <= VERIFY_LIMITS.publicFileBytes)
      return JSON.parse(buffer.subarray(0, bytes).toString("utf8"))
    } finally { closeSync(fd) }
  }
  return validatePublicInputs(readPublic(manifestPath), readPublic(reportPath))
}

export function validatePublicInputs(manifest: unknown, report: unknown) {
  assert.ok(json(manifest) && json(report))
  assert.equal(manifest.schema, "ktour-selfhosted-testnet/v1")
  assert.equal(manifest.network, "testnet"); assert.equal(manifest.chainId, CHAIN); assert.equal(manifest.moduleHash, MODULE_HASH)
  const m = { packageId: address(manifest.packageId), campaignId: address(manifest.campaignId), issuer: address(manifest.issuer), agent: address(manifest.agent), sponsor: address(manifest.sponsor), campaignInitialVersion: uint(manifest.campaignInitialVersion) }
  assert.equal(m.sponsor, m.issuer); assert.notEqual(m.agent, m.issuer)
  assert.equal(report.status, "passed"); assert.equal(report.network, "testnet")
  assert.equal(report.packageId, m.packageId); assert.equal(report.campaignId, m.campaignId)
  assert.equal(report.sampleIdentity, true); assert.equal(report.sampleCredential, true); assert.equal(report.realChain, true)
  assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.externalMutations, [])
  assert.ok(typeof report.operationId === "string" && /^op_[A-Za-z0-9_-]{1,64}$/.test(report.operationId))
  const digests = [digest(report.issueDigest), digest(report.delegateDigest), digest(report.agentDigest)]
  assert.equal(new Set(digests).size, 3)
  // Do not trust the report's signer label, receipts, actors or check booleans.
  return { manifest: m, operationId: report.operationId, digests }
}
type Inputs = ReturnType<typeof validatePublicInputs>
class VerificationFailure extends Error {
  constructor(readonly stage: string) { super("selfhosted_readonly_verification_failed") }
}
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolvePromise, reject) => {
    const abort = () => reject(new Error("deadline"))
    if (signal.aborted) { void work.catch(() => {}); abort(); return }
    signal.addEventListener("abort", abort, { once: true })
    work.then(resolvePromise, reject).finally(() => signal.removeEventListener("abort", abort))
  })
}

/** Five distinct pinned reads maximum: ServiceInfo, three receipts, one object batch. */
export async function verifyPublicReceipts(input: Inputs, options: { fetch?: typeof fetch } = {}) {
  const { manifest: m, digests } = input
  const fetchImpl = options.fetch ?? globalThis.fetch
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), VERIFY_LIMITS.deadlineMs)
  const seen = new Set<string>()
  let requests = 0, responseBytes = 0, allowedObjects: string[] | null = null, stage = "service_and_transactions"
  const boundedFetch: typeof fetch = async (target, init) => {
    assert.ok(typeof target === "string" && !controller.signal.aborted)
    const url = new URL(target)
    assert.equal(url.origin, new URL(RPC).origin)
    assert.ok(!url.username && !url.password && !url.search && !url.hash)
    assert.equal(init?.method, "POST")
    assert.ok(init.body instanceof Uint8Array && init.body.length >= 5 && init.body.length <= VERIFY_LIMITS.requestBytes && init.body[0] === 0)
    const bytes = init.body
    assert.equal(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(1), bytes.length - 5)
    const body = bytes.subarray(5)
    let key: string
    if (url.pathname === PATHS.info) { assert.equal(body.length, 0); key = "info" }
    else if (url.pathname === PATHS.transaction) {
      const request = GrpcTypes.GetTransactionRequest.fromBinary(body)
      assert.ok(request.digest && digests.includes(request.digest))
      assert.ok(Buffer.from(body).equals(Buffer.from(GrpcTypes.GetTransactionRequest.toBinary({ digest: request.digest, readMask: request.readMask }))))
      key = request.digest
    } else {
      assert.equal(url.pathname, PATHS.objects)
      const request = GrpcTypes.BatchGetObjectsRequest.fromBinary(body)
      assert.ok(allowedObjects)
      assert.deepEqual(request.requests.map(r => r.objectId), allowedObjects)
      assert.ok(request.requests.every(r => r.version === undefined && r.readMask === undefined))
      assert.ok(Buffer.from(body).equals(Buffer.from(GrpcTypes.BatchGetObjectsRequest.toBinary({ requests: allowedObjects.map(objectId => ({ objectId })), readMask: request.readMask }))))
      key = "objects"
    }
    assert.ok(!seen.has(key) && requests < VERIFY_LIMITS.requests)
    seen.add(key); requests++
    const headers = new Headers(init.headers)
    assert.ok([...headers.keys()].every(k => ["content-type", "x-grpc-web", "grpc-timeout"].includes(k)))
    assert.equal(headers.get("content-type"), "application/grpc-web+proto")
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(VERIFY_LIMITS.requestMs), ...(init.signal ? [init.signal] : [])])
    const pending = fetchImpl(url.href, { method: "POST", headers, body: bytes, signal, redirect: "error", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" })
    void pending.then(response => { if (signal.aborted) void response.body?.cancel().catch(() => {}) }, () => {})
    const response = await abortable(pending, signal)
    if (response.status !== 200 || response.redirected || !response.body) { void response.body?.cancel().catch(() => {}); throw new Error("response") }
    const reader = response.body.getReader(), chunks: Uint8Array[] = []
    let length = 0
    try {
      const declared = response.headers.get("content-length")
      assert.ok(declared === null || (/^\d+$/.test(declared) && Number(declared) <= VERIFY_LIMITS.oneResponseBytes))
      while (true) {
        const chunk = await abortable(reader.read(), signal)
        if (chunk.done) break
        length += chunk.value.byteLength; responseBytes += chunk.value.byteLength
        assert.ok(length <= VERIFY_LIMITS.oneResponseBytes && responseBytes <= VERIFY_LIMITS.responseBytes)
        chunks.push(chunk.value)
      }
      const safeHeaders = new Headers()
      for (const name of ["content-type", "grpc-status"]) { const value = response.headers.get(name); if (value !== null) safeHeaders.set(name, value) }
      return new Response(Buffer.concat(chunks), { headers: safeHeaders })
    } finally { void reader.cancel().catch(() => {}); reader.releaseLock() }
  }
  try {
    const client = new SuiGrpcClient({ network: "testnet", baseUrl: RPC, format: "binary", fetch: boundedFetch })
    const [info, results] = await Promise.all([
      client.ledgerService.getServiceInfo({}, { abort: controller.signal }).response,
      Promise.all(digests.map(digest => client.getTransaction({ digest, include: { transaction: true, bcs: true, effects: true, events: true }, signal: controller.signal }))),
    ])
    assert.equal(info.chainId, CHAIN); assert.equal(info.chain, "testnet")
    const txs = results.map((r, i) => {
      const t = r.Transaction ?? r.FailedTransaction
      assert.equal(t.digest, digests[i]); assert.equal(t.status.success, true); assert.equal(t.effects.transactionDigest, digests[i])
      assert.equal(TransactionDataBuilder.getDigestFromBytes(t.bcs), digests[i]); return t
    })
    const mod = `${m.packageId}::entitlement::`
    const event = (i: number, name: string) => {
      const events = txs[i].events.filter(e => e.eventType === mod + name)
      assert.equal(events.length, 1); assert.ok(json(events[0].json)); assert.equal(events[0].json.campaign, m.campaignId)
      return { sender: events[0].sender, json: events[0].json }
    }
    const issued = event(0, "EntitlementIssued"), granted = event(1, "GrantCreated"), consent = event(1, "ConsentAttested"), consumed = event(2, "GrantConsumed"), attested = event(2, "ExecutionAttested")
    stage = "links_actors_and_signatures"
    assert.deepEqual(txs.map(t => t.events.length), [1, 2, 2])
    const holder = address(granted.json.owner)
    assert.equal(issued.json.holder, holder); assert.equal(consent.json.owner, holder)
    assert.equal(issued.sender, m.issuer); assert.equal(granted.sender, holder); assert.equal(consent.sender, holder)
    assert.equal(consumed.sender, m.agent); assert.equal(attested.sender, m.agent)
    assert.equal(granted.json.agent, m.agent); assert.equal(granted.json.recipient, holder)
    assert.equal(consumed.json.agent, m.agent); assert.equal(attested.json.agent, m.agent); assert.equal(consumed.json.recipient, holder)
    const grantId = address(granted.json.grant), recordId = address(consumed.json.record), entitlementId = address(issued.json.entitlement)
    assert.equal(consent.json.grant, grantId); assert.equal(consumed.json.grant, grantId); assert.equal(attested.json.record, recordId)
    assert.equal(hash(granted.json.intent_ref), hash(issued.json.intent_ref)); assert.equal(hash(consumed.json.intent_ref), hash(issued.json.intent_ref))
    const creations = txs.map(t => t.effects.changedObjects.filter(o => o.idOperation === "Created").map(o => o.objectId))
    for (const [i, id] of [entitlementId, grantId, recordId].entries()) assert.ok(creations[i].includes(id))
    const actors = [m.issuer, holder, m.agent], functions = [["issue"], ["delegate", "attest_consent"], ["consume", "attest_execution"]]
    const signatureChecks: Array<{ schemes: string[]; signerAddresses: string[]; cryptographicallyVerified: true }> = []
    for (const [i, tx] of txs.entries()) {
      assert.equal(tx.transaction.sender, actors[i]); assert.equal(tx.transaction.gasData.owner, m.sponsor)
      assert.deepEqual(tx.transaction.commands.map(c => { assert.ok("MoveCall" in c); assert.equal(c.MoveCall.package, m.packageId); assert.equal(c.MoveCall.module, "entitlement"); return c.MoveCall.function }), functions[i])
      const refs = tx.transaction.inputs.flatMap<{ objectId: string; initialSharedVersion?: string | number }>(i => {
        if (!("Object" in i)) return []
        const o = i.Object, ref = "SharedObject" in o ? o.SharedObject : "ImmOrOwnedObject" in o ? o.ImmOrOwnedObject : o.Receiving
        return [ref]
      })
      assert.ok(refs.some(r => r.objectId === m.campaignId && "initialSharedVersion" in r && String(r.initialSharedVersion) === m.campaignInitialVersion))
      if (i === 1) assert.ok(refs.some(r => r.objectId === entitlementId))
      if (i === 2) assert.ok(refs.some(r => r.objectId === grantId))
      const schemes: string[] = [], addresses: string[] = []
      assert.equal(tx.signatures.length, new Set([actors[i], m.sponsor]).size)
      for (const serialized of tx.signatures) {
        const parsed = parseSerializedSignature(serialized)
        assert.equal(parsed.signatureScheme, "ED25519"); assert.ok(parsed.signatureScheme === "ED25519")
        const key = new Ed25519PublicKey(parsed.publicKey)
        assert.equal(await key.verifyTransaction(tx.bcs, serialized), true)
        schemes.push(parsed.signatureScheme); addresses.push(key.toSuiAddress())
      }
      assert.deepEqual(addresses.slice().sort(), [...new Set([actors[i], m.sponsor])].sort())
      signatureChecks.push({ schemes, signerAddresses: addresses, cryptographicallyVerified: true })
    }
    stage = "current_objects"
    allowedObjects = [m.campaignId, grantId, recordId]
    const result = await client.getObjects({ objectIds: allowedObjects, include: { json: true }, signal: controller.signal })
    assert.equal(result.objects.length, 3)
    const objects = result.objects.map((o, i) => { assert.ok(!(o instanceof Error)); assert.equal(o.objectId, allowedObjects![i]); assert.ok(json(o.json)); return { ...o, json: o.json } })
    const [campaign, grant, record] = objects
    assert.equal(campaign.type, mod + "Campaign"); assert.ok(campaign.owner.$kind === "Shared")
    assert.equal(String(campaign.owner.Shared.initialSharedVersion), m.campaignInitialVersion)
    assert.equal(campaign.json.issuer, m.issuer); assert.equal(campaign.json.agent, m.agent); assert.equal(campaign.json.active, true); assert.equal(uint(campaign.json.policy_version), "1")
    for (const counter of ["issued", "delegated", "consumed"]) assert.equal(uint(campaign.json[counter]), "1")
    assert.ok(grant.owner.$kind === "Shared")
    const expected = { campaignId: m.campaignId, grantType: mod + "Grant", grantId, owner: holder, agent: m.agent, recipient: holder, intentRef: hash(issued.json.intent_ref), actionCommitment: hash(granted.json.action_commitment), consentCommitment: hash(consent.json.consent_commitment), expiresAtMs: Number(uint(granted.json.expires_at_ms)), policyVersion: 1, decisionCommitment: hash(consumed.json.decision_commitment), manifestCommitment: hash(attested.json.manifest_commitment), recordId, events: { granted: mod + "GrantCreated", consent: mod + "ConsentAttested", consumed: mod + "GrantConsumed", attested: mod + "ExecutionAttested" } }
    const verified = verifyExecutionEvidence({ digest: txs[2].digest, success: txs[2].status.success, events: txs[2].events.map(e => ({ type: e.eventType, sender: e.sender, json: e.json })), createdObjectIds: creations[2] }, { objectId: grant.objectId, type: grant.type, initialSharedVersion: grant.owner.Shared.initialSharedVersion, json: grant.json }, expected, digests[2])
    assert.equal(record.type, mod + "ExecutionRecord"); assert.ok(record.owner.$kind === "AddressOwner"); assert.equal(record.owner.AddressOwner, holder)
    for (const [key, value] of [["campaign", m.campaignId], ["grant", grantId], ["agent", m.agent]]) assert.equal(record.json[key], value)
    for (const [key, value] of [["intent_ref", expected.intentRef], ["action_commitment", expected.actionCommitment], ["decision_commitment", expected.decisionCommitment]]) assert.equal(hash(record.json[key]), value)
    assert.equal(uint(record.json.executed_at_ms), String(verified.executedAtMs)); assert.equal(requests, VERIFY_LIMITS.requests)
    return {
      ok: true, checkedAt: new Date().toISOString(), source: "independent-testnet-fullnode-read", operationId: input.operationId,
      packageId: m.packageId, campaignId: m.campaignId, chainIdentifier: CHAIN,
      transactions: txs.map((t, i) => ({ digest: t.digest, checkpoint: t.checkpoint, success: t.status.success, sender: t.transaction.sender, gasOwner: t.transaction.gasData.owner, ...signatureChecks[i] })),
      holder, grantId, grantUses: Number(grant.json.uses), maxUses: Number(grant.json.max_uses), revoked: grant.json.revoked,
      recordId, recordRecipient: record.owner.AddressOwner, linkedEffectsEventsAndObjects: true,
      campaignCounters: { issued: Number(campaign.json.issued), delegated: Number(campaign.json.delegated), consumed: Number(campaign.json.consumed) },
      safety: { readRequests: requests, responseBytes, privateFileReads: 0, signaturesCreated: 0, broadcasts: 0 },
      limitation: "Public receipt consistency and local ED25519 verification only; no independent checkpoint certificate verification, live identity providers, zkLogin, redemption or OmniOne proof. Future pruning fails closed; no fallback, retries or transaction submission.",
    }
  } catch { throw new VerificationFailure(stage) }
  finally { clearTimeout(timer); controller.abort() }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  Promise.resolve().then(() => verifyPublicReceipts(loadPublicInputs(process.argv.slice(2))))
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(JSON.stringify({ ok: false, mode: "independent-read-only", stage: error instanceof VerificationFailure ? error.stage : "public_inputs", error: "verification_failed", newTransactions: 0 })); process.exitCode = 1 })
}
