import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { readFile } from "node:fs/promises"
import { GrpcTypes } from "@mysten/sui/grpc"
import type { LiveReadClient } from "../../scripts/hackathon-sui-live-readiness"

const originalFetch = globalThis.fetch
let networkAttempts = 0
let subject: typeof import("../../scripts/hackathon-sui-live-readiness")
let manifest: unknown
const NOW = Date.parse("2026-09-28T00:00:00Z")
before(async () => {
  globalThis.fetch = async () => { networkAttempts += 1; throw new Error("fixture_network_forbidden") }
  subject = await import("../../scripts/hackathon-sui-live-readiness")
  manifest = JSON.parse(await readFile(new URL("../../../move/ondo_entitlement/deploy-info.testnet.json", import.meta.url), "utf8"))
})
after(() => { globalThis.fetch = originalFetch; assert.equal(networkAttempts, 0) })

function fixture() {
  const p = subject.LIVE_PIN
  return {
    info: { chain: "testnet", chainId: p.chainIdentifier, epoch: "1234", checkpointHeight: "999", timestamp: new Date(NOW).toISOString() },
    objects: [
      { object: { objectId: p.packageId, objectType: "package", version: "1", owner: { kind: "IMMUTABLE" } } },
      { object: { objectId: p.campaignId, objectType: `${p.packageId}::entitlement::Campaign`, version: "1026899622", owner: { kind: "SHARED", version: String(p.initialSharedVersion) }, json: {
        id: p.campaignId, issuer: String(p.issuer), agent: String(p.agent), active: true, policy_version: "1", campaign_ref: Buffer.from(p.campaignRef).toString("base64"), issued: "26", delegated: "24", consumed: "23",
      } } },
      { object: { objectId: p.clockId, objectType: "0x2::clock::Clock", version: "999999999", owner: { kind: "SHARED", version: "1" }, json: { id: p.clockId, timestamp_ms: String(NOW) } } },
    ],
    balances: [
      { balance: { coinType: "0x2::sui::SUI", balance: "743838116", coinBalance: "743838116", addressBalance: "0" } },
      { balance: { coinType: "0x2::sui::SUI", balance: "0", coinBalance: "0", addressBalance: "0" } },
    ],
  }
}
type Fixture = ReturnType<typeof fixture>
function injected(data = fixture()) {
  const calls: string[] = [], p = subject.LIVE_PIN
  const client: LiveReadClient = {
    async serviceInfo(signal) { assert.equal(signal.aborted, false); calls.push("info"); return data.info },
    async object(id, signal) { assert.equal(signal.aborted, false); calls.push(id); return data.objects[[p.packageId, p.campaignId, p.clockId].findIndex(value => value === id)] },
    async balance(owner, signal) { assert.equal(signal.aborted, false); calls.push(owner); return data.balances[[p.issuer, p.agent].findIndex(value => value === owner)] },
  }
  return { client, calls }
}
function frame(bytes: Uint8Array) {
  const framed = new Uint8Array(bytes.length + 5)
  new DataView(framed.buffer).setUint32(1, bytes.length)
  framed.set(bytes, 5)
  return framed
}
const INFO_URL = "https://fullnode.testnet.sui.io/sui.rpc.v2.LedgerService/GetServiceInfo"
const infoInit = (): RequestInit => ({ method: "POST", headers: { "content-type": "application/grpc-web+proto", "x-grpc-web": "1" }, body: frame(new Uint8Array()) })
const response = (bytes = new Uint8Array()) => new Response(bytes, { headers: { "content-type": "application/grpc-web+proto", "grpc-status": "0" } })

test("fixed metadata and six injected public reads never claim execution or signer readiness", async () => {
  const before = structuredClone(manifest), { client, calls } = injected()
  const result = await subject.runLiveReadiness(manifest, client, { now: () => NOW })
  assert.equal(result.ok, true)
  assert.equal(result.mode, "live-public-read-only")
  assert.equal(result.liveExecutionReady, false)
  assert.equal(result.inferred.gasReady, false)
  assert.equal(result.inferred.sponsorSelectionVerified, false)
  assert.equal(result.inferred.issuerCoinBalanceCoversIllustrative30MillionMISTCap, true)
  assert.equal(result.observed.balances[1].totalMIST, "0", "zero-balance agent can still use an authorized sponsor")
  assert.deepEqual(result.safety, { rpcCalls: 6, secretReads: 0, generatedKeys: 0, signatures: 0, broadcasts: 0, faucetCalls: 0, accountChanges: 0, retries: 0 })
  assert.equal(calls.length, 6)
  assert.equal(new Set(calls).size, 6)
  assert.deepEqual(manifest, before)
})

test("metadata tuple tampering fails before any client method and unknown fields never leak", async () => {
  const valid = subject.validateLiveMetadata(manifest)
  const cases = [null, {}, { ...valid, network: "mainnet" }, { ...valid, chainIdentifier: "untrusted" }, { ...valid, packageId: "0x" + "11".repeat(32) },
    { ...valid, issuer: valid.agent }, { ...valid, agent: valid.issuer },
    ...["objectId", "initialSharedVersion", "policyVersion", "campaignRef"].map(key => ({ ...valid, campaign: { ...valid.campaign, [key]: "wrong" } })),
    { ...valid, clock: { objectId: "0x6", initialSharedVersion: 2 } }]
  for (const input of cases) {
    const { client, calls } = injected()
    await assert.rejects(subject.runLiveReadiness(input, client), { message: "sui_live_metadata" })
    assert.equal(calls.length, 0)
  }
  const { client } = injected()
  const result = await subject.runLiveReadiness({ ...valid, secret: "fixture-secret", url: "https://secret.invalid" }, client, { now: () => NOW })
  assert.equal(JSON.stringify(result).includes("fixture-secret"), false)
  assert.equal(JSON.stringify(result).includes("secret.invalid"), false)
})

test("CLI requires exactly --read-only, rejects URLs, key flags, env files, execution and duplicate flags", () => {
  assert.equal(subject.parseLiveArgs(["--read-only"]), undefined)
  for (const args of [[], ["--offline"], ["--execute"], ["--read-only", "--read-only"], ["--read-only", "--key=secret"], ["--read-only", ".env"], ["--read-only", "--url=https://other.invalid"]]) {
    assert.throws(() => subject.parseLiveArgs(args), { message: "sui_live_arguments" })
  }
})

test("wrong network, chain identifier, malformed checkpoint, or stale service stops after one read", async () => {
  for (const changed of [{ chain: "mainnet" }, { chainId: "wrong" }, { epoch: "-1" }, { checkpointHeight: "18446744073709551616" }, { timestamp: "secret-error" }, { timestamp: new Date(NOW - 120_001).toISOString() }, { timestamp: new Date(NOW + 120_001).toISOString() }]) {
    const data = fixture(); Object.assign(data.info, changed)
    const { client, calls } = injected(data)
    await assert.rejects(subject.runLiveReadiness(manifest, client, { now: () => NOW }), /^Error: sui_live_/)
    assert.deepEqual(calls, ["info"])
  }
})

test("package, Campaign, roles, policy, activity, shared version and Clock fail closed before balance reads", async () => {
  const mutations: Array<(data: Fixture) => void> = [
    d => { d.objects[0].object.objectType = "wrong" },
    d => { d.objects[0].object.owner.kind = "SHARED" },
    d => { d.objects[0].object.version = "2" },
    d => { d.objects[1].object.objectId = subject.LIVE_PIN.clockId },
    d => { d.objects[1].object.objectType = `${subject.LIVE_PIN.packageId}::other::Campaign` },
    d => { d.objects[1].object.owner.version = "1" },
    d => { d.objects[1].object.owner.kind = "ADDRESS" },
    d => { d.objects[1].object.version = "1" },
    d => { d.objects[1].object.json!.issuer = subject.LIVE_PIN.agent },
    d => { d.objects[1].object.json!.agent = subject.LIVE_PIN.issuer },
    d => { d.objects[1].object.json!.active = false },
    d => { d.objects[1].object.json!.policy_version = "2" },
    d => { d.objects[1].object.json!.campaign_ref = "hk-identity-perk-v1" },
    d => { d.objects[1].object.json!.id = subject.LIVE_PIN.clockId },
    d => { d.objects[1].object.json!.consumed = "999" },
    d => { d.objects[2].object.objectType = "0x3::clock::Clock" },
    d => { d.objects[2].object.owner.version = "2" },
    d => { d.objects[2].object.json!.timestamp_ms = String(NOW - 120_001) },
    d => { d.objects[2].object.json!.timestamp_ms = "18446744073709551615" },
  ]
  for (const mutate of mutations) {
    const data = fixture(); mutate(data)
    const { client, calls } = injected(data)
    await assert.rejects(subject.runLiveReadiness(manifest, client, { now: () => NOW }), /^Error: sui_live_/)
    assert.equal(calls.length, 4)
  }
})

test("object RPC failure is sanitized; no later gas reads or retries", async () => {
  const { client, calls } = injected()
  client.object = async () => { calls.push("failed-object"); throw new Error("fixture-provider-token") }
  await assert.rejects(subject.runLiveReadiness(manifest, client, { now: () => NOW }), { message: "sui_live_object_rpc" })
  assert.equal(calls.length, 4)
})

test("service RPC errors are sanitized even for direct library consumers", async () => {
  const { client } = injected()
  client.serviceInfo = async () => { throw new Error("fixture-provider-token") }
  await assert.rejects(subject.runLiveReadiness(manifest, client, { now: () => NOW }), { message: "sui_live_rpc" })
})

test("unsupported balance is explicitly unknown, not zero, and malformed balances reject", async () => {
  const { client } = injected()
  client.balance = async () => ({ unsupported: true })
  const result = await subject.runLiveReadiness(manifest, client, { now: () => NOW })
  assert.equal(result.observed.balances[0].status, "unsupported")
  assert.equal(result.observed.balances[0].totalMIST, null)
  assert.equal(result.inferred.issuerCoinBalanceCoversIllustrative30MillionMISTCap, null)
  for (const changed of [{ coinType: "0x2::other::FAKE" }, { balance: "-1" }, { coinBalance: "999999999999" }, { addressBalance: "1" }, { balance: "18446744073709551616" }]) {
    const data = fixture(); Object.assign(data.balances[0].balance, changed)
    await assert.rejects(subject.runLiveReadiness(manifest, injected(data).client, { now: () => NOW }), { message: "sui_live_balance" })
  }
})

test("output only projects checked public fields, never raw provider or extra metadata", async () => {
  const data = fixture()
  Object.assign(data.info, { server: "fixture-secret", headers: { authorization: "fixture-secret" } })
  for (const object of data.objects) Object.assign(object.object, { secret: "fixture-secret" })
  Object.assign(data.objects[1].object.json!, { secret: "fixture-secret" })
  Object.assign(data.balances[0].balance, { secret: "fixture-secret" })
  const result = await subject.runLiveReadiness(manifest, injected(data).client, { now: () => NOW })
  assert.equal(JSON.stringify(result).includes("fixture-secret"), false)
})

test("omitted coin components remain unknown and normalized framework types are accepted", async () => {
  const { client } = injected()
  client.balance = async () => ({ balance: { coinType: `0x${"0".repeat(63)}2::sui::SUI`, balance: "743838116" } })
  const result = await subject.runLiveReadiness(manifest, client, { now: () => NOW })
  assert.equal(result.observed.balances[0].coinMIST, null)
  assert.equal(result.observed.balances[0].addressMIST, null)
  assert.equal(result.inferred.issuerCoinBalanceCoversIllustrative30MillionMISTCap, null)
})

test("SDK reports only UNIMPLEMENTED balance as unsupported; authorization and other failures reject", async () => {
  const signal = new AbortController().signal
  for (const status of ["12", "7", "16", "14"]) {
    const trailer = frame(Buffer.from(`grpc-status: ${status}\r\ngrpc-message: fixture-secret\r\n`)); trailer[0] = 128
    const transport = subject.createReadOnlyTransport(async () => response(trailer), signal)
    const client = subject.createLiveReadClient(transport.fetch)
    if (status === "12") assert.deepEqual(await client.balance(subject.LIVE_PIN.issuer, signal), { unsupported: true })
    else await assert.rejects(client.balance(subject.LIVE_PIN.issuer, signal), { message: "sui_live_balance_rpc" })
    assert.equal(transport.stats().requests, 1)
  }
})

test("deadline bounds an injected client that ignores cancellation", async () => {
  const { client } = injected(), controller = new AbortController()
  client.serviceInfo = async () => new Promise(() => {})
  const pending = subject.runLiveReadiness(manifest, client, { signal: controller.signal })
  controller.abort()
  await assert.rejects(pending, { message: "sui_live_deadline" })
})

test("real installed SDK serializes only six fixed read methods through the guarded fake transport", async () => {
  const data = fixture(), requests: Array<{ url: string; init: RequestInit }> = []
  const fakeFetch: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init: init! })
    const bytes = (init!.body as Uint8Array).subarray(5)
    let body: Uint8Array
    if (String(input).endsWith("/GetServiceInfo")) body = GrpcTypes.GetServiceInfoResponse.toBinary(GrpcTypes.GetServiceInfoResponse.fromJson(data.info))
    else if (String(input).endsWith("/GetObject")) {
      const request = GrpcTypes.GetObjectRequest.fromBinary(bytes)
      body = GrpcTypes.GetObjectResponse.toBinary(GrpcTypes.GetObjectResponse.fromJsonString(JSON.stringify(data.objects.find(value => value.object.objectId === request.objectId)!)))
    } else {
      const request = GrpcTypes.GetBalanceRequest.fromBinary(bytes)
      body = GrpcTypes.GetBalanceResponse.toBinary(GrpcTypes.GetBalanceResponse.fromJson(data.balances[request.owner === subject.LIVE_PIN.issuer ? 0 : 1]))
    }
    const trailer = frame(Buffer.from("grpc-status: 0\r\n")); trailer[0] = 128
    return response(Buffer.concat([frame(body), trailer]))
  }
  const transport = subject.createReadOnlyTransport(fakeFetch, new AbortController().signal)
  const result = await subject.runLiveReadiness(manifest, subject.createLiveReadClient(transport.fetch), { now: () => NOW })
  assert.equal(result.ok, true)
  assert.equal(transport.stats().requests, 6)
  assert.ok(transport.stats().responseBytes > 0)
  assert.equal(requests.length, 6)
  for (const request of requests) {
    assert.equal(new URL(request.url).origin, "https://fullnode.testnet.sui.io")
    assert.equal(request.init.redirect, "error")
    assert.equal(request.init.credentials, "omit")
    assert.equal(new Headers(request.init.headers).has("authorization"), false)
  }
})

test("transport rejects alternate origin, redirects/queries/userinfo, writes and arbitrary request bodies before fetch", async () => {
  let calls = 0
  const fakeFetch: typeof fetch = async () => { calls += 1; return response() }
  const badUrls = [INFO_URL.replace("https:", "http:"), INFO_URL.replace("testnet", "mainnet"), INFO_URL.replace("sui.io/", "sui.io.evil.invalid/"), INFO_URL.replace("https://", "https://secret@"), `${INFO_URL}?token=secret`, `${INFO_URL}#secret`, INFO_URL.replace("GetServiceInfo", "ExecuteTransaction")]
  for (const url of badUrls) {
    const transport = subject.createReadOnlyTransport(fakeFetch, new AbortController().signal)
    await assert.rejects(transport.fetch(url, infoInit()), { message: "sui_live_transport" })
  }
  const badRequests: RequestInit[] = [{ ...infoInit(), method: "GET" }, { ...infoInit(), headers: { authorization: "fixture-secret" } }, { ...infoInit(), headers: { "content-type": "application/grpc-web+proto", "x-grpc-web": "1", "grpc-timeout": "fixture-secret" } }, { ...infoInit(), body: "secret" }, { ...infoInit(), body: frame(new Uint8Array([1])) }]
  for (const init of badRequests) {
    const transport = subject.createReadOnlyTransport(fakeFetch, new AbortController().signal)
    await assert.rejects(transport.fetch(INFO_URL, init), { message: "sui_live_transport" })
  }
  assert.equal(calls, 0)
})

test("transport rejects non-allowlisted public object/owner/type/field masks and duplicate requests", async () => {
  let calls = 0
  const fakeFetch: typeof fetch = async () => { calls += 1; return response() }
  const cases = [
    { method: "GetObject", service: "LedgerService", bytes: GrpcTypes.GetObjectRequest.toBinary({ objectId: "0x1", readMask: { paths: ["*"] } }) },
    { method: "GetObject", service: "LedgerService", bytes: GrpcTypes.GetObjectRequest.toBinary({ objectId: subject.LIVE_PIN.packageId, readMask: { paths: ["*"] } }) },
    { method: "GetBalance", service: "StateService", bytes: GrpcTypes.GetBalanceRequest.toBinary({ owner: "0x1", coinType: subject.LIVE_PIN.suiType }) },
    { method: "GetBalance", service: "StateService", bytes: GrpcTypes.GetBalanceRequest.toBinary({ owner: subject.LIVE_PIN.issuer, coinType: "0x2::other::FAKE" }) },
    { method: "GetBalance", service: "StateService", bytes: Buffer.concat([GrpcTypes.GetBalanceRequest.toBinary({ owner: subject.LIVE_PIN.issuer, coinType: subject.LIVE_PIN.suiType }), new Uint8Array([0x78, 1])]) },
  ]
  for (const value of cases) {
    const transport = subject.createReadOnlyTransport(fakeFetch, new AbortController().signal)
    await assert.rejects(transport.fetch(`https://fullnode.testnet.sui.io/sui.rpc.v2.${value.service}/${value.method}`, { ...infoInit(), body: frame(value.bytes) }), { message: "sui_live_transport" })
  }
  assert.equal(calls, 0)
  const transport = subject.createReadOnlyTransport(fakeFetch, new AbortController().signal)
  await transport.fetch(INFO_URL, infoInit())
  await assert.rejects(transport.fetch(INFO_URL, infoInit()), { message: "sui_live_transport" })
  assert.equal(calls, 1)
})

test("response body/header caps, HTTP redirect/errors and stalled body fail closed", async () => {
  for (const fakeFetch of [
    async () => new Response(null, { status: 302, headers: { location: "https://other.invalid" } }),
    async () => new Response("secret", { status: 401 }),
    async () => new Response("small", { headers: { "content-length": String(subject.LIVE_LIMITS.responseBytes + 1) } }),
    async () => response(new Uint8Array(subject.LIVE_LIMITS.responseBytes + 1)),
  ]) {
    const transport = subject.createReadOnlyTransport(fakeFetch, new AbortController().signal)
    await assert.rejects(transport.fetch(INFO_URL, infoInit()), { message: "sui_live_transport" })
    assert.equal(transport.stats().requests, 1)
  }
  const controller = new AbortController()
  const transport = subject.createReadOnlyTransport(async () => new Response(new ReadableStream({ start() { queueMicrotask(() => controller.abort()) } })), controller.signal)
  await assert.rejects(transport.fetch(INFO_URL, infoInit()), { message: "sui_live_deadline" })
})

test("transport deadline bounds fetch implementations that ignore the abort signal", async () => {
  const controller = new AbortController()
  const transport = subject.createReadOnlyTransport(async () => new Promise(() => {}), controller.signal)
  const pending = transport.fetch(INFO_URL, infoInit())
  controller.abort()
  await assert.rejects(pending, { message: "sui_live_deadline" })
  assert.equal(transport.stats().requests, 1)
})
