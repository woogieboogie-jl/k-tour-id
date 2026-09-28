import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { bcs } from "@mysten/sui/bcs"
import { TransactionError } from "@mysten/sui/client"
import { RpcError, SuiGrpcClient } from "@mysten/sui/grpc"
import type { ChainTransaction } from "../../lib/hackathon/sui-evidence"
import { HkError } from "../../lib/hackathon/util"

const digest = "4pNNdcruJvmdWyYnSamrh7vxBRCCxWUAwG58uHBP1Wy3"
const otherDigest = "EATbwBKz3PqhQRdqkar1VGxVS31eBL9ex3UYjEdudM5W"
const id = (digit: string) => "0x" + digit.repeat(64)
const originalFetch = globalThis.fetch
let subject: typeof import("../../lib/hackathon/sui-historical-read")
let audit: typeof import("../../scripts/hackathon-readonly-chain-audit")
before(async () => {
  globalThis.fetch = async () => { throw new Error("unexpected_real_network") }
  subject = await import("../../lib/hackathon/sui-historical-read")
  audit = await import("../../scripts/hackathon-readonly-chain-audit")
})
after(() => { globalThis.fetch = originalFetch })

function effects(d = digest, success = true, created = true) {
  return bcs.TransactionEffects.serialize({ V2: {
    status: success ? { Success: true } : { Failure: { error: { InsufficientGas: true }, command: null } },
    executedEpoch: "1", gasUsed: { computationCost: "1", storageCost: "1", storageRebate: "0", nonRefundableStorageFee: "0" },
    transactionDigest: d, gasObjectIndex: null, eventsDigest: null, dependencies: [], lamportVersion: "1",
    changedObjects: created ? [[id("2"), { inputState: { NotExist: true }, outputState: { ObjectWrite: [digest, { AddressOwner: id("3") }] }, idOperation: { Created: true } }]] : [],
    unchangedConsensusObjects: [], auxDataDigest: null,
  } }).toBase64()
}
function fixture() {
  return { data: { chainIdentifier: String(subject.HISTORICAL_TESTNET.chainIdentifier), transaction: {
    digest, effects: { status: "SUCCESS", effectsBcs: effects(), checkpoint: { sequenceNumber: "384352746" },
      events: { pageInfo: { hasNextPage: false }, nodes: [{ sender: { address: id("3") }, contents: { type: { repr: `${id("a")}::entitlement::EntitlementIssued` }, json: { entitlement: id("2") } } }] } },
  } } }
}
const missing = async () => { throw new TransactionError("notFound", digest) }
const fullnode = (): ChainTransaction => ({ digest, success: true, events: [], createdObjectIds: [] })
const mismatch = (e: unknown) => e instanceof HkError && e.code === "sui_evidence_mismatch" && !e.message.includes("fixture-secret")
const unavailable = (e: unknown) => e instanceof HkError && e.code === "sui_read" && !e.message.includes("fixture-secret")
function injected(value: unknown = fixture()) {
  const calls: Array<{ input: string; init: RequestInit }> = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    calls.push({ input: String(input), init: init! })
    return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } })
  }
  return { fetch, calls }
}
const read = (fetch: typeof globalThis.fetch, extra: Partial<Parameters<typeof subject.readTransactionWithHistoricalFallback>[0]> = {}) =>
  subject.readTransactionWithHistoricalFallback({ digest, network: "testnet", readFullnode: missing, fetch, ...extra })

test("module import and fullnode success are network-free; source and failed outcomes stay fullnode", async () => {
  for (const success of [true, false]) {
    const f = injected()
    const result = await read(f.fetch, { readFullnode: async signal => { assert.equal(signal.aborted, false); return { ...fullnode(), success } } })
    assert.deepEqual(result, { ...fullnode(), success, readSource: "fullnode" })
    assert.equal(f.calls.length, 0)
  }
  const f = injected()
  assert.equal(await read(f.fetch, { readFullnode: async () => null }), null)
  assert.equal(f.calls.length, 0)
})

test("typed Testnet notFound makes exactly one pinned query and normalizes effects/events", async () => {
  const f = injected(), tx = await read(f.fetch)
  assert.equal(f.calls.length, 1)
  assert.equal(tx?.readSource, "testnet-graphql-historical")
  assert.equal(tx?.checkpoint, "384352746")
  assert.deepEqual(tx?.createdObjectIds, [id("2")])
  assert.deepEqual(tx?.events, [{ type: `${id("a")}::entitlement::EntitlementIssued`, sender: id("3"), json: { entitlement: id("2") } }])
  const { input, init } = f.calls[0]
  assert.equal(input, "https://graphql.testnet.sui.io/graphql")
  assert.equal(init.method, "POST"); assert.equal(init.redirect, "error"); assert.equal(init.credentials, "omit")
  assert.deepEqual(init.headers, { "content-type": "application/json" })
  const body = JSON.parse(String(init.body))
  assert.deepEqual(body.variables, { digest })
  assert.match(body.query, /^query HistoricalTransaction/)
  assert.doesNotMatch(body.query, /mutation|execute|simulate|signature/i)
  assert.equal(init.signal?.aborted, true, "deadline resources are cancelled after completion")
})

test("raw gRPC NOT_FOUND is eligible, but messages, wrong digest, other errors and networks are not", async () => {
  assert.equal((await read(injected().fetch, { readFullnode: async () => { throw new RpcError("not found", "NOT_FOUND") } }))?.readSource, "testnet-graphql-historical")
  for (const error of [new Error("Transaction not found fixture-secret"), new RpcError("fixture-secret", "UNAVAILABLE"), new TransactionError("notFound", otherDigest), { code: "NOT_FOUND" }]) {
    const f = injected()
    await assert.rejects(read(f.fetch, { readFullnode: async () => { throw error } }), value => value === error)
    assert.equal(f.calls.length, 0)
  }
  for (const network of ["mainnet", "devnet", "localnet", "TESTNET", "", "testnet.evil.invalid"]) {
    const f = injected()
    await assert.rejects(read(f.fetch, { network }), TransactionError)
    assert.equal(f.calls.length, 0)
  }
})

test("invalid input, cancelled call and fullnode digest mismatch never query historical", async () => {
  for (const d of ["", "fixture-secret", "https://other.invalid", "1".repeat(45)]) {
    let called = false
    const f = injected()
    await assert.rejects(read(f.fetch, { digest: d, readFullnode: async () => { called = true; return fullnode() } }), mismatch)
    assert.equal(called, false); assert.equal(f.calls.length, 0)
  }
  const f = injected()
  await assert.rejects(read(f.fetch, { signal: AbortSignal.abort() }), unavailable)
  await assert.rejects(read(f.fetch, { readFullnode: async () => ({ ...fullnode(), digest: otherDigest }) }), mismatch)
  assert.equal(f.calls.length, 0)
})

test("null historical transaction is absence only when chain and error envelope are valid", async () => {
  const f = injected({ data: { chainIdentifier: subject.HISTORICAL_TESTNET.chainIdentifier, transaction: null } })
  assert.equal(await read(f.fetch), null)
  for (const data of [null, {}, { data: {} }, { data: { chainIdentifier: "mainnet", transaction: null } }, { errors: [{ message: "fixture-secret" }], data: fixture().data }]) {
    await assert.rejects(read(injected(data).fetch), mismatch)
  }
})

test("wrong digest/network/status/effects, absent fields and partial event pages fail closed", async () => {
  const mutations: Array<(f: ReturnType<typeof fixture>) => void> = [
    f => { f.data.chainIdentifier = "mainnet" }, f => { f.data.transaction.digest = otherDigest },
    f => { f.data.transaction.effects.effectsBcs = effects(otherDigest) },
    f => { f.data.transaction.effects.status = "FAILURE" }, f => { f.data.transaction.effects.status = "fixture-secret" },
    f => { f.data.transaction.effects.effectsBcs = "" },
    f => { f.data.transaction.effects.events.pageInfo.hasNextPage = true },
    f => { f.data.transaction.effects.events.nodes[0].sender.address = "fixture-secret" },
    f => { f.data.transaction.effects.events.nodes[0].contents.type.repr = "fixture-secret" },
    f => { f.data.transaction.effects.checkpoint.sequenceNumber = "-1" },
    f => { f.data.transaction.effects.checkpoint.sequenceNumber = "18446744073709551616" },
    f => { Object.assign(f.data.transaction.effects.checkpoint, { sequenceNumber: Number.MAX_SAFE_INTEGER + 1 }) },
    f => { Object.assign(f.data.transaction.effects.events.nodes[0].contents, { json: null }) },
    f => { Object.assign(f.data.transaction.effects, { events: undefined }) },
    f => { Object.assign(f.data.transaction.effects.events, { pageInfo: undefined }) },
    f => { f.data.transaction.effects.events.nodes = Array(51).fill(f.data.transaction.effects.events.nodes[0]) },
  ]
  for (const mutate of mutations) {
    const value = fixture(); mutate(value)
    const f = injected(value)
    await assert.rejects(read(f.fetch), mismatch)
    assert.equal(f.calls.length, 1)
  }
})

test("created objects must come from BCS effects, and failed chain execution stays failed", async () => {
  const value = fixture(); value.data.transaction.effects.effectsBcs = effects(digest, true, false)
  assert.deepEqual((await read(injected(value).fetch))?.createdObjectIds, [])
  value.data.transaction.effects.effectsBcs = effects(digest, false)
  value.data.transaction.effects.status = "FAILURE"
  assert.equal((await read(injected(value).fetch))?.success, false)
})

test("provider errors, malformed JSON/BCS, HTTP failure and redirects are fixed errors without retries", async () => {
  const badBcs = fixture(); badBcs.data.transaction.effects.effectsBcs = "AAAA"
  const responses = [new Response("fixture-secret", { status: 429 }), new Response("fixture-secret", { headers: { "content-type": "application/json" } }),
    new Response(JSON.stringify(fixture()), { headers: { "content-type": "text/html" } }),
    new Response(JSON.stringify(fixture()), { status: 302, headers: { location: "https://fixture-secret.invalid" } })]
  for (const response of responses) {
    let calls = 0
    await assert.rejects(read(async () => { calls++; return response }), unavailable)
    assert.equal(calls, 1)
  }
  await assert.rejects(read(injected(badBcs).fetch), unavailable)
  await assert.rejects(read(async () => { throw new Error("fixture-secret") }), unavailable)
})

test("declared and streamed oversized bodies are cancelled before JSON decoding", async () => {
  for (const declared of [false, true]) {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(subject.HISTORICAL_TESTNET.responseBytes + 1)) }, cancel() { cancelled = true } })
    const headers = new Headers({ "content-type": "application/json" })
    if (declared) headers.set("content-length", String(subject.HISTORICAL_TESTNET.responseBytes + 1))
    await assert.rejects(read(async () => new Response(body, { headers })), unavailable)
    assert.equal(cancelled, true)
  }
})

test("abort ends a stalled fullnode, fetch or body even when the injected implementation ignores its signal", async () => {
  for (const stage of ["fullnode", "fetch", "body"]) {
    const controller = new AbortController()
    let calls = 0, cancelled = false
    const fetch: typeof globalThis.fetch = async () => {
      calls++
      if (stage === "fetch") { controller.abort(); return new Promise(() => {}) }
      const body = new ReadableStream<Uint8Array>({ pull() { controller.abort(); return new Promise(() => {}) }, cancel() { cancelled = true } })
      return new Response(body, { headers: { "content-type": "application/json" } })
    }
    await assert.rejects(read(fetch, { signal: controller.signal, readFullnode: stage === "fullnode" ? async () => { controller.abort(); return new Promise(() => {}) } : missing }), unavailable)
    assert.equal(calls, stage === "fullnode" ? 0 : 1)
    if (stage === "body") assert.equal(cancelled, true)
  }
})

test("audit requires exactly --read-only and its SDK getObject read uses the allowlisted BatchGetObjects", async () => {
  audit.parseHistoricalAuditArgs(["--read-only"])
  for (const args of [[], ["--read-only", "--read-only"], ["--execute"], ["--read-only", "https://fixture-secret.invalid"]]) {
    assert.throws(() => audit.parseHistoricalAuditArgs(args), { message: "read_only_required" })
  }
  const calls: string[] = []
  const transport = audit.createHistoricalAuditTransport(async (input, init) => {
    calls.push(String(input))
    assert.equal(init?.method, "POST"); assert.equal(init?.redirect, "error"); assert.equal(init?.credentials, "omit")
    return new Response(new Uint8Array(), { headers: { "content-type": "application/grpc-web+proto", "grpc-status": "5" } })
  })
  const client = new SuiGrpcClient({ network: "testnet", baseUrl: "https://fullnode.testnet.sui.io:443", format: "binary", fetch: transport.fetch })
  await assert.rejects(client.getObject({ objectId: id("2"), include: { json: true } }))
  assert.deepEqual(calls, ["https://fullnode.testnet.sui.io/sui.rpc.v2.LedgerService/BatchGetObjects"])
  assert.equal(transport.requests(), 1)
  for (const target of ["https://fullnode.mainnet.sui.io/sui.rpc.v2.LedgerService/BatchGetObjects", "https://fullnode.testnet.sui.io/sui.rpc.v2.TransactionExecutionService/ExecuteTransaction"]) {
    await assert.rejects(transport.fetch(target, { method: "POST" }))
  }
  assert.equal(calls.length, 1)
})
