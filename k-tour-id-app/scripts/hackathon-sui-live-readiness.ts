// Public READ-ONLY readiness, not execution authorization. No env/key/signer/app imports.
import { open } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { GrpcTypes, SuiGrpcClient } from "@mysten/sui/grpc"

export const LIVE_PIN = Object.freeze({
  network: "testnet", rpc: "https://fullnode.testnet.sui.io:443",
  chainIdentifier: "69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD",
  packageId: "0xc5d26326ffd5267bb5b54625c1e2b9c03f7cca4753232d0b042c62ee74fd975d",
  campaignId: "0xe3fce96c9c9e1086ff20dd7453e16ff2c52d3d3324e6e4e34446c7d0dc2ecf16",
  initialSharedVersion: 349181955, campaignRef: "hk-identity-perk-v1", policyVersion: 1,
  issuer: "0x8d88f750b8bb8f0e63e6617821e3d2a03fda22b9a7841215689da66c79664c45",
  agent: "0xad9340861c08c87c388108f13bde6fd6e27d2604c39d0f6d201e00d6ee161a05",
  clockId: `0x${"0".repeat(63)}6`, suiType: "0x2::sui::SUI",
})
export const LIVE_LIMITS = Object.freeze({ requests: 6, deadlineMs: 20_000, requestMs: 10_000, requestBytes: 4096, responseBytes: 131_072, metadataBytes: 16_384, freshnessMs: 120_000 })
const PATHS = Object.freeze({ info: "/sui.rpc.v2.LedgerService/GetServiceInfo", object: "/sui.rpc.v2.LedgerService/GetObject", balance: "/sui.rpc.v2.StateService/GetBalance" })
const BASIC_MASK = ["object_id", "object_type", "version", "owner"]
const objectMask = (objectId: string) => objectId === LIVE_PIN.packageId ? BASIC_MASK : [...BASIC_MASK, "json"]
type JsonRecord = Record<string, unknown>
const record = (value: unknown): value is JsonRecord => Boolean(value && typeof value === "object" && !Array.isArray(value))
function fail(code: string): never { throw new Error(`sui_live_${code}`) }
function requireThat(value: unknown, code: string): asserts value { if (!value) fail(code) }
function uint(value: unknown, code: string): string {
  requireThat(typeof value === "string" && /^(0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= 18_446_744_073_709_551_615n, code)
  return value
}
function canonicalType(value: unknown): unknown {
  return typeof value === "string" ? value.replace(/^0x0*2::/, "0x2::") : value
}

/** Only the checked-in public deployment tuple is in scope. Unknown fields are discarded. */
export function validateLiveMetadata(value: unknown) {
  requireThat(record(value) && record(value.campaign) && record(value.clock), "metadata")
  requireThat(value.network === LIVE_PIN.network && value.chainIdentifier === LIVE_PIN.chainIdentifier && value.packageId === LIVE_PIN.packageId && value.issuer === LIVE_PIN.issuer && value.agent === LIVE_PIN.agent, "metadata")
  const c = value.campaign, clock = value.clock
  requireThat(c.objectId === LIVE_PIN.campaignId && c.initialSharedVersion === LIVE_PIN.initialSharedVersion && c.policyVersion === LIVE_PIN.policyVersion && c.campaignRef === LIVE_PIN.campaignRef, "metadata")
  requireThat((clock.objectId === "0x6" || clock.objectId === LIVE_PIN.clockId) && clock.initialSharedVersion === 1, "metadata")
  return { network: LIVE_PIN.network, chainIdentifier: LIVE_PIN.chainIdentifier, packageId: LIVE_PIN.packageId, issuer: LIVE_PIN.issuer, agent: LIVE_PIN.agent,
    campaign: { objectId: LIVE_PIN.campaignId, initialSharedVersion: LIVE_PIN.initialSharedVersion, campaignRef: LIVE_PIN.campaignRef, policyVersion: LIVE_PIN.policyVersion },
    clock: { objectId: LIVE_PIN.clockId, initialSharedVersion: 1 } }
}

export function parseLiveArgs(args: string[]): void {
  requireThat(args.length === 1 && args[0] === "--read-only", "arguments")
}

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error("sui_live_deadline"))
    if (signal.aborted) { work.catch(() => {}); abort(); return }
    signal.addEventListener("abort", abort, { once: true })
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
  })
}

/** Decode the SDK's binary unary request before sending; never forward arbitrary protobuf data. */
function validateRequest(path: string, bytes: Uint8Array) {
  requireThat(bytes.length >= 5 && bytes.length <= LIVE_LIMITS.requestBytes && bytes[0] === 0, "request")
  requireThat(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(1) === bytes.length - 5, "request")
  const body = bytes.subarray(5)
  if (path === PATHS.info) { requireThat(body.length === 0, "request"); return "info" }
  if (path === PATHS.object) {
    const request = GrpcTypes.GetObjectRequest.fromBinary(body)
    requireThat(request.objectId === LIVE_PIN.packageId || request.objectId === LIVE_PIN.campaignId || request.objectId === LIVE_PIN.clockId, "request")
    requireThat(request.version === undefined && JSON.stringify(request.readMask?.paths) === JSON.stringify(objectMask(request.objectId)), "request")
    // Unknown protobuf fields are rejected too, not silently passed through.
    requireThat(Buffer.from(body).equals(Buffer.from(GrpcTypes.GetObjectRequest.toBinary({ objectId: request.objectId, readMask: { paths: objectMask(request.objectId) } }))), "request")
    return request.objectId
  }
  requireThat(path === PATHS.balance, "request")
  const request = GrpcTypes.GetBalanceRequest.fromBinary(body)
  requireThat((request.owner === LIVE_PIN.issuer || request.owner === LIVE_PIN.agent) && request.coinType === LIVE_PIN.suiType, "request")
  requireThat(Buffer.from(body).equals(Buffer.from(GrpcTypes.GetBalanceRequest.toBinary({ owner: request.owner, coinType: LIVE_PIN.suiType }))), "request")
  return request.owner
}

/** Six distinct fixed reads maximum; no redirect, credential, retry, or pagination support. */
export function createReadOnlyTransport(fetchImpl: typeof fetch, signal: AbortSignal) {
  const seen = new Set<string>()
  let requests = 0, responseBytes = 0
  const guardedFetch: typeof fetch = async (input, init) => {
    try {
      requireThat(!signal.aborted, "deadline")
      // Do not accept Request objects carrying hidden headers or credentials.
      requireThat(typeof input === "string", "request")
      const url = new URL(input)
      requireThat(url.origin === new URL(LIVE_PIN.rpc).origin && !url.username && !url.password && !url.search && !url.hash && Object.values(PATHS).some(path => path === url.pathname), "target")
      requireThat(init?.method === "POST" && init.body instanceof Uint8Array, "request")
      const headers = new Headers(init.headers)
      requireThat([...headers.keys()].every(name => ["content-type", "x-grpc-web", "grpc-timeout"].includes(name)), "request")
      requireThat(headers.get("content-type") === "application/grpc-web+proto" && headers.get("x-grpc-web") === "1", "request")
      requireThat(headers.get("grpc-timeout") === null || headers.get("grpc-timeout") === `${LIVE_LIMITS.requestMs}m`, "request")
      const key = validateRequest(url.pathname, init.body)
      requireThat(requests < LIVE_LIMITS.requests && !seen.has(key), "request_limit")
      seen.add(key); requests += 1
      const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(LIVE_LIMITS.requestMs), ...(init.signal ? [init.signal] : [])])
      const response = await abortable(fetchImpl(url.href, { method: "POST", headers, body: init.body, signal: requestSignal, redirect: "error", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" }), requestSignal)
      if (!response.ok || response.redirected || !response.body) {
        void response.body?.cancel().catch(() => {})
        fail("response")
      }
      const reader = response.body.getReader()
      try {
        const declaredLength = response.headers.get("content-length")
        requireThat(declaredLength === null || (/^\d+$/.test(declaredLength) && Number(declaredLength) <= LIVE_LIMITS.responseBytes), "response_limit")
        const chunks: Uint8Array[] = []
        let length = 0
        while (true) {
          const chunk = await abortable(reader.read(), requestSignal)
          if (chunk.done) break
          length += chunk.value.byteLength
          requireThat(length <= LIVE_LIMITS.responseBytes, "response_limit")
          chunks.push(chunk.value)
        }
        responseBytes += length
        const safeHeaders = new Headers()
        for (const name of ["content-type", "grpc-status"]) {
          const value = response.headers.get(name)
          if (value !== null) safeHeaders.set(name, value)
        }
        return new Response(Buffer.concat(chunks), { status: 200, headers: safeHeaders })
      } finally { void reader.cancel().catch(() => {}); reader.releaseLock() }
    } catch { fail(signal.aborted ? "deadline" : "transport") }
  }
  return { fetch: guardedFetch, stats: () => ({ requests, responseBytes }) }
}

/** Inject this tiny read surface in tests. There is intentionally no default client/network. */
export interface LiveReadClient {
  serviceInfo(signal: AbortSignal): Promise<unknown>
  object(objectId: string, signal: AbortSignal): Promise<unknown>
  balance(owner: string, signal: AbortSignal): Promise<unknown>
}

export function createLiveReadClient(fetchImpl: typeof fetch): LiveReadClient {
  const client = new SuiGrpcClient({ network: "testnet", baseUrl: LIVE_PIN.rpc, format: "binary", fetch: fetchImpl })
  const options = (signal: AbortSignal) => ({ abort: signal, timeout: LIVE_LIMITS.requestMs })
  return {
    async serviceInfo(signal) {
      return GrpcTypes.GetServiceInfoResponse.toJson((await client.ledgerService.getServiceInfo({}, options(signal))).response)
    },
    async object(objectId, signal) {
      return GrpcTypes.GetObjectResponse.toJson((await client.ledgerService.getObject({ objectId, readMask: { paths: objectMask(objectId) } }, options(signal))).response)
    },
    async balance(owner, signal) {
      try {
        return GrpcTypes.GetBalanceResponse.toJson((await client.stateService.getBalance({ owner, coinType: LIVE_PIN.suiType }, options(signal))).response)
      } catch (error) {
        if (record(error) && error.code === "UNIMPLEMENTED") return { unsupported: true }
        throw new Error("sui_live_balance_rpc")
      }
    },
  }
}

function objectValue(response: unknown, objectId: string, type: string, initialVersion?: string) {
  requireThat(record(response) && record(response.object), "object")
  const object = response.object
  requireThat(object.objectId === objectId && canonicalType(object.objectType) === type && record(object.owner), "object")
  const version = uint(object.version, "object_version")
  requireThat(BigInt(version) > 0n, "object_version")
  if (initialVersion === undefined) requireThat(object.owner.kind === "IMMUTABLE" && version === "1", "package")
  else requireThat(object.owner.kind === "SHARED" && object.owner.version === initialVersion && BigInt(version) >= BigInt(initialVersion), "shared_version")
  return object
}

function gasObservation(response: unknown, owner: string) {
  requireThat(record(response), "balance")
  if (response.unsupported === true) return { owner, status: "unsupported" as const, totalMIST: null, coinMIST: null, addressMIST: null }
  requireThat(record(response.balance) && canonicalType(response.balance.coinType) === LIVE_PIN.suiType, "balance")
  const value = response.balance
  const total = uint(value.balance, "balance")
  const coins = value.coinBalance === undefined ? null : uint(value.coinBalance, "balance")
  const address = value.addressBalance === undefined ? null : uint(value.addressBalance, "balance")
  requireThat((coins === null || BigInt(coins) <= BigInt(total)) && (address === null || BigInt(address) <= BigInt(total)) && (coins === null || address === null || BigInt(coins) + BigInt(address) === BigInt(total)), "balance")
  return { owner, status: "queried" as const, totalMIST: total, coinMIST: coins, addressMIST: address }
}

/** Verifies current public state only; never promotes a balance into signing readiness. */
export async function runLiveReadiness(input: unknown, client: LiveReadClient, settings: { now?: () => number; signal?: AbortSignal } = {}) {
  const metadata = validateLiveMetadata(input)
  const now = settings.now ?? Date.now
  const signal = AbortSignal.any([AbortSignal.timeout(LIVE_LIMITS.deadlineMs), ...(settings.signal ? [settings.signal] : [])])
  let rpcCalls = 0
  const read = async (work: () => Promise<unknown>) => {
    requireThat(!signal.aborted && rpcCalls < LIVE_LIMITS.requests, "deadline"); rpcCalls += 1
    try { return await abortable(Promise.resolve().then(work), signal) }
    catch { fail(signal.aborted ? "deadline" : "rpc") }
  }
  const info = await read(() => client.serviceInfo(signal))
  requireThat(record(info) && info.chain === "testnet" && info.chainId === metadata.chainIdentifier, "network")
  const epoch = uint(info.epoch, "service_info"), checkpoint = uint(info.checkpointHeight, "service_info")
  requireThat(typeof info.timestamp === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/.test(info.timestamp), "service_time")
  const checkpointTime = Date.parse(info.timestamp)
  requireThat(Number.isFinite(checkpointTime) && Math.abs(now() - checkpointTime) <= LIVE_LIMITS.freshnessMs, "service_time")
  const objectResults = await Promise.allSettled([metadata.packageId, metadata.campaign.objectId, metadata.clock.objectId].map(id => read(() => client.object(id, signal))))
  requireThat(objectResults.every(result => result.status === "fulfilled"), "object_rpc")
  const objects = objectResults.map(result => result.status === "fulfilled" ? result.value : undefined)
  const pkg = objectValue(objects[0], metadata.packageId, "package")
  const campaign = objectValue(objects[1], metadata.campaign.objectId, `${metadata.packageId}::entitlement::Campaign`, String(metadata.campaign.initialSharedVersion))
  const clock = objectValue(objects[2], metadata.clock.objectId, "0x2::clock::Clock", "1")
  requireThat(record(campaign.json), "campaign")
  const fields = campaign.json
  requireThat(fields.id === metadata.campaign.objectId && fields.issuer === metadata.issuer && fields.agent === metadata.agent && fields.active === true && fields.policy_version === String(metadata.campaign.policyVersion), "campaign")
  // gRPC JSON renders vector<u8> as base64. Match exact encoding, not permissive decoding.
  requireThat(fields.campaign_ref === Buffer.from(metadata.campaign.campaignRef, "utf8").toString("base64"), "campaign")
  const counts = { issued: uint(fields.issued, "campaign"), delegated: uint(fields.delegated, "campaign"), consumed: uint(fields.consumed, "campaign") }
  requireThat(BigInt(counts.consumed) <= BigInt(counts.delegated) && BigInt(counts.delegated) <= BigInt(counts.issued), "campaign")
  requireThat(record(clock.json) && clock.json.id === metadata.clock.objectId, "clock")
  const timestampMs = uint(clock.json.timestamp_ms, "clock")
  requireThat(BigInt(timestampMs) <= BigInt(Number.MAX_SAFE_INTEGER) && Math.abs(now() - Number(timestampMs)) <= LIVE_LIMITS.freshnessMs && Math.abs(checkpointTime - Number(timestampMs)) <= LIVE_LIMITS.freshnessMs, "clock_time")
  const balanceResults = await Promise.allSettled([metadata.issuer, metadata.agent].map(owner => read(() => client.balance(owner, signal))))
  requireThat(balanceResults.every(result => result.status === "fulfilled"), "balance_rpc")
  const balances = balanceResults.map((result, i) => gasObservation(result.status === "fulfilled" ? result.value : undefined, [metadata.issuer, metadata.agent][i]))
  requireThat(!signal.aborted, "deadline")
  return {
    ok: true, mode: "live-public-read-only", liveExecutionReady: false, checkedAt: new Date(now()).toISOString(),
    metadata, observed: { service: { chain: "testnet", chainIdentifier: metadata.chainIdentifier, epoch, checkpoint, timestamp: new Date(checkpointTime).toISOString() },
      package: { objectId: metadata.packageId, version: pkg.version, owner: "Immutable" },
      campaign: { objectId: metadata.campaign.objectId, version: campaign.version, initialSharedVersion: metadata.campaign.initialSharedVersion, issuer: metadata.issuer, agent: metadata.agent, policyVersion: metadata.campaign.policyVersion, campaignRef: metadata.campaign.campaignRef, active: true, counts },
      clock: { objectId: metadata.clock.objectId, version: clock.version, initialSharedVersion: 1, timestampMs }, balances },
    inferred: { issuerCoinBalanceCoversIllustrative30MillionMISTCap: balances[0].coinMIST === null ? null : BigInt(balances[0].coinMIST) >= 30_000_000n, gasReady: false, sponsorSelectionVerified: false },
    safety: { rpcCalls, secretReads: 0, generatedKeys: 0, signatures: 0, broadcasts: 0, faucetCalls: 0, accountChanges: 0, retries: 0 },
    unverifiedGates: ["authorized-issuer-agent-sponsor-signers", "signer-address-role-match", "selected-sponsor-spendable-gas-and-budget", "explicit-protected-execution-approval", "new-transaction-effects-and-events", "Google-zkLogin", "CX-and-OpenDID-integration", "OmniOne-recording"],
    limitations: ["Public state reads are separate, non-atomic observations; rerun before any approved execution.", "Balances do not prove key possession, gas selection, costs, sponsor authority, or a successful transaction.", "Agent zero balance alone does not block a sponsored transaction. The 30 million MIST comparison is illustrative only.", "No dry-run, signing, transaction submission, historical receipt verification, CX, OpenDID, OAuth, prover, or OmniOne call."],
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let transport: ReturnType<typeof createReadOnlyTransport> | undefined
  try {
    parseLiveArgs(process.argv.slice(2))
    const file = await open(new URL("../../move/ondo_entitlement/deploy-info.testnet.json", import.meta.url), "r")
    let input: unknown
    try {
      const buffer = Buffer.alloc(LIVE_LIMITS.metadataBytes + 1)
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
      requireThat(bytesRead <= LIVE_LIMITS.metadataBytes, "metadata")
      input = JSON.parse(buffer.subarray(0, bytesRead).toString("utf8"))
    } finally { await file.close() }
    validateLiveMetadata(input)
    const signal = AbortSignal.timeout(LIVE_LIMITS.deadlineMs)
    transport = createReadOnlyTransport(globalThis.fetch, signal)
    const result = await runLiveReadiness(input, createLiveReadClient(transport.fetch), { signal })
    process.stdout.write(`${JSON.stringify({ ...result, transport: transport.stats(), limits: LIVE_LIMITS }, null, 2)}\n`)
  } catch {
    process.stdout.write(`${JSON.stringify({ ok: false, mode: "live-public-read-only", liveExecutionReady: false, error: "read_only_readiness_failed", transport: transport?.stats() ?? { requests: 0, responseBytes: 0 } })}\n`)
    process.exitCode = 1
  }
}
