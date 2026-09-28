// Read-only Testnet fallback. No configuration, keys, signing, execution or retries.
// Fullnodes do not automatically recover pruned history; GraphQL is an explicit
// data-access source, not independent checkpoint/signature verification.
import { parseTransactionEffectsBcs, TransactionError } from "@mysten/sui/client"
import { SuiGraphQLClient } from "@mysten/sui/graphql"
import { RpcError } from "@mysten/sui/grpc"
import { isValidTransactionDigest } from "@mysten/sui/utils"
import { chainId, type ChainTransaction } from "./sui-evidence"
import { HkError } from "./util"

export const HISTORICAL_TESTNET = Object.freeze({
  url: "https://graphql.testnet.sui.io/graphql",
  chainIdentifier: "69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD",
  deadlineMs: 15_000,
  responseBytes: 512 * 1024,
  events: 50,
})
export type SourcedChainTransaction = ChainTransaction & {
  readSource: "fullnode" | "testnet-graphql-historical"
  checkpoint?: string
}
const QUERY = `query HistoricalTransaction($digest: String!) {
  chainIdentifier
  transaction(digest: $digest) {
    digest
    effects {
      status effectsBcs checkpoint { sequenceNumber }
      events(first: 50) {
        pageInfo { hasNextPage }
        nodes { sender { address } contents { type { repr } json } }
      }
    }
  }
}`
type Json = Record<string, unknown>
const record = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value)
function unavailable(): never { throw new HkError("sui_read", "Historical Sui transaction is unavailable", 502, true) }
function requireEvidence(value: unknown): asserts value {
  if (!value) throw new HkError("sui_evidence_mismatch", "Historical Sui evidence is incomplete or mismatched", 502)
}
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new HkError("sui_read", "Sui transaction read deadline exceeded", 502, true))
    if (signal.aborted) { void work.catch(() => {}); abort(); return }
    signal.addEventListener("abort", abort, { once: true })
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
  })
}

/** Only one fixed GraphQL query can leave this transport, without credentials. */
function historicalFetch(fetchImpl: typeof fetch, digest: string, signal: AbortSignal): typeof fetch {
  let requested = false
  const body = JSON.stringify({ query: QUERY, variables: { digest } })
  return async (input, init) => {
    if (requested || signal.aborted || input !== HISTORICAL_TESTNET.url || init?.method !== "POST" || init.body !== body) unavailable()
    requested = true
    const pending = fetchImpl(HISTORICAL_TESTNET.url, {
      method: "POST", headers: { "content-type": "application/json" }, body, signal,
      redirect: "error", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer",
    })
    // A custom fetch may ignore abort; discard any response arriving afterwards.
    void pending.then(response => { if (signal.aborted) void response.body?.cancel().catch(() => {}) }, () => {})
    const response = await abortable(pending, signal)
    if (response.status !== 200 || response.redirected || !response.body
      || (response.url && response.url !== HISTORICAL_TESTNET.url)
      || !/^application\/(?:json|graphql-response\+json)(?:;|$)/i.test(response.headers.get("content-type") ?? "")) {
      void response.body?.cancel().catch(() => {})
      unavailable()
    }
    const reader = response.body.getReader()
    try {
      const declared = response.headers.get("content-length")
      if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > HISTORICAL_TESTNET.responseBytes)) unavailable()
      const chunks: Uint8Array[] = []
      let length = 0
      while (true) {
        const chunk = await abortable(reader.read(), signal)
        if (chunk.done) break
        length += chunk.value.byteLength
        if (length > HISTORICAL_TESTNET.responseBytes) unavailable()
        chunks.push(chunk.value)
      }
      return new Response(Buffer.concat(chunks), { headers: { "content-type": "application/json" } })
    } finally { void reader.cancel().catch(() => {}); reader.releaseLock() }
  }
}

async function historicalTransaction(digest: string, fetchImpl: typeof fetch, signal: AbortSignal): Promise<SourcedChainTransaction | null> {
  try {
    const client = new SuiGraphQLClient({ network: "testnet", url: HISTORICAL_TESTNET.url, fetch: historicalFetch(fetchImpl, digest, signal) })
    const response = await abortable(client.query({ query: QUERY, variables: { digest }, signal }), signal)
    requireEvidence(record(response))
    requireEvidence(response.errors === undefined || (Array.isArray(response.errors) && response.errors.length === 0))
    const data = response.data
    requireEvidence(record(data) && data.chainIdentifier === HISTORICAL_TESTNET.chainIdentifier)
    if (data.transaction === null) return null
    const tx = data.transaction
    requireEvidence(record(tx) && tx.digest === digest && record(tx.effects))
    const e = tx.effects
    requireEvidence((e.status === "SUCCESS" || e.status === "FAILURE") && typeof e.effectsBcs === "string" && e.effectsBcs.length > 0)
    const bytes = Buffer.from(e.effectsBcs, "base64")
    requireEvidence(bytes.toString("base64") === e.effectsBcs)
    // The SDK uses this same parser for its normalized GraphQL effects. Created
    // IDs come from effects, never from an event claiming that an object exists.
    const effects = parseTransactionEffectsBcs(bytes)
    requireEvidence(effects.transactionDigest === digest && effects.status.success === (e.status === "SUCCESS"))
    requireEvidence(record(e.checkpoint) && (typeof e.checkpoint.sequenceNumber === "string" || typeof e.checkpoint.sequenceNumber === "number"))
    requireEvidence(typeof e.checkpoint.sequenceNumber !== "number" || Number.isSafeInteger(e.checkpoint.sequenceNumber))
    const checkpoint = String(e.checkpoint.sequenceNumber)
    requireEvidence(/^(0|[1-9][0-9]{0,19})$/.test(checkpoint) && BigInt(checkpoint) <= 18_446_744_073_709_551_615n)
    requireEvidence(record(e.events) && record(e.events.pageInfo) && e.events.pageInfo.hasNextPage === false
      && Array.isArray(e.events.nodes) && e.events.nodes.length <= HISTORICAL_TESTNET.events)
    const events = e.events.nodes.map((event: unknown) => {
      requireEvidence(record(event) && record(event.sender) && chainId(event.sender.address)
        && record(event.contents) && record(event.contents.type) && typeof event.contents.type.repr === "string"
        && /^0x[0-9a-f]{1,64}::[A-Za-z_][A-Za-z_0-9]*::/i.test(event.contents.type.repr)
        && event.contents.type.repr.length <= 2048 && record(event.contents.json))
      return { type: event.contents.type.repr, sender: String(event.sender.address), json: event.contents.json }
    })
    const createdObjectIds = effects.changedObjects.filter(o => o.idOperation === "Created").map(o => o.objectId)
    requireEvidence(createdObjectIds.every(id => chainId(id)) && new Set(createdObjectIds).size === createdObjectIds.length)
    return { digest, success: effects.status.success, events, createdObjectIds, checkpoint, readSource: "testnet-graphql-historical" }
  } catch (error) {
    if (error instanceof HkError) throw error
    // Never retain provider text, response bodies, URLs or raw serialized data.
    unavailable()
  }
}

/** No network on import. Tests inject both reads; no fallback for outages or other networks. */
export async function readTransactionWithHistoricalFallback(options: {
  digest: string
  network: string
  readFullnode: (signal: AbortSignal) => Promise<ChainTransaction | null>
  fetch?: typeof fetch
  signal?: AbortSignal
}): Promise<SourcedChainTransaction | null> {
  requireEvidence(isValidTransactionDigest(options.digest))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HISTORICAL_TESTNET.deadlineMs)
  const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal
  try {
    if (signal.aborted) unavailable()
    try {
      const tx = await abortable(options.readFullnode(signal), signal)
      if (!tx) return null
      requireEvidence(tx.digest === options.digest)
      return { ...tx, readSource: "fullnode" }
    } catch (error) {
      const missing = (error instanceof TransactionError && error.reason === "notFound" && error.digest === options.digest)
        || (error instanceof RpcError && error.code === "NOT_FOUND")
      if (!missing || options.network !== "testnet" || signal.aborted) throw error
    }
    return await historicalTransaction(options.digest, options.fetch ?? globalThis.fetch, signal)
  } finally { clearTimeout(timer); controller.abort() }
}
