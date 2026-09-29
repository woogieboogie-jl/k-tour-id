import assert from "node:assert/strict"
import { test } from "node:test"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { once } from "node:events"
import { createOpenDidBridgeClient, resolveOpenDidCxSubject, type OpenDidBridgeClient, type OpenDidBridgeConfig, type OpenDidCxSubject, type OpenDidIssuance, type OpenDidPresentation } from "../../lib/hackathon/adapters/opendid-provider"
import { createOpenDidProviderLifecycle, type OpenDidProviderState, type OpenDidProviderStore } from "../../lib/hackathon/opendid-provider-lifecycle"
import { HkError } from "../../lib/hackathon/util"

const EPOCH = Date.parse("2026-09-29T00:00:00Z")
const iso = (offset: number) => new Date(EPOCH + offset).toISOString()
const binding = { sessionId: "session_synthetic_01", operationId: "op_synthetic_01" }
const subject: OpenDidCxSubject = { kind: "cx_evidence_ref", evidenceRef: "ev_synthetic_01", personVerified: true, adultVerified: null, kycRef: "a".repeat(64) }
const cfg = (url = "https://bridge.example.invalid"): OpenDidBridgeConfig => ({ baseUrl: url, trustedOrigin: url, serviceToken: "test-service-token-".repeat(3), ownerBindingSecret: "test-owner-binding-".repeat(3), issuerDid: "did:omn:synthetic-issuer", schemaId: "https://schema.example.invalid/pass" })
const issued = (): OpenDidIssuance => ({ issuanceId: "iss_synthetic_01", operationId: binding.operationId, state: "issued", revision: 2, offer: null, credential: { vcId: "vc-synthetic-01", issuerDid: cfg().issuerDid, schemaId: cfg().schemaId, validFrom: iso(-60000), validUntil: iso(7200000), holderBinding: "0x" + "b".repeat(64) }, error: null, expiresAt: iso(600000) })
const offered = (): OpenDidIssuance => ({ ...issued(), state: "offered", revision: 1, credential: null, offer: { qrPayload: "synthetic-qr-do-not-persist" } })
const allowed = (): OpenDidPresentation => ({ presentationId: "pres_synthetic_01", operationId: binding.operationId, state: "allowed", revision: 2, offer: null, decision: { decisionRef: "dec_synthetic_01", decisionExpiresAt: iso(300000) }, denyReason: null, expiresAt: iso(600000) })
const presentationOffered = (): OpenDidPresentation => ({ ...allowed(), state: "offered", revision: 1, decision: null, offer: { qrPayload: "synthetic-presentation-qr" } })
const errorCode = (expected: string) => (e: unknown) => e instanceof HkError && e.code === expected

async function localServer(handler: (req: IncomingMessage, res: ServerResponse) => void, run: (client: OpenDidBridgeClient, url: string) => Promise<void>, options: Partial<OpenDidBridgeConfig> = {}) {
  const server = createServer(handler)
  server.listen(0, "127.0.0.1"); await once(server, "listening")
  const address = server.address(); assert(address && typeof address === "object")
  const url = `http://127.0.0.1:${address.port}`
  try { await run(createOpenDidBridgeClient({ ...cfg(url), allowLoopback: true, ...options }), url) }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
}
function json(res: ServerResponse, value: unknown, status = 200) { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value)) }

test("bridge client pins origin and rejects unsafe configuration before network", () => {
  for (const patch of [{ baseUrl: "https://other.example.invalid" }, { baseUrl: "https://u:p@bridge.example.invalid" }, { baseUrl: "https://bridge.example.invalid/path" }, { baseUrl: "https://bridge.example.invalid/?token=x" }, { baseUrl: "http://bridge.example.invalid", trustedOrigin: "http://bridge.example.invalid" }, { serviceToken: "short" }, { ownerBindingSecret: "short" }, { timeoutMs: 0 }]) {
    assert.throws(() => createOpenDidBridgeClient({ ...cfg(), ...patch }), errorCode("opendid_provider_configuration"))
  }
})

test("real local HTTP request has server-derived operation owner and exact bridge-v1 body", async () => {
  const observed: Array<{ path?: string; owner?: string; authorization?: string; body: string }> = []
  await localServer((req, res) => { let body = ""; req.on("data", b => body += b); req.on("end", () => { observed.push({ path: req.url, owner: req.headers["x-ktour-owner"] as string, authorization: req.headers.authorization, body }); json(res, offered()) }) }, async client => {
    const r = await client.issuanceStart(binding, { idempotencyKey: "idem_synthetic_01", subject })
    assert.equal(r.state, "offered")
    assert.equal(observed[0].path, "/bridge/v1/issuances")
    assert.equal(observed[0].authorization, `Bearer ${cfg().serviceToken}`)
    assert.match(observed[0].owner!, /^[0-9a-f]{64}$/)
    assert.equal(observed[0].owner, client.ownerBinding(binding))
    assert.notEqual(observed[0].owner, client.ownerBinding({ ...binding, sessionId: "different_session" }))
    assert.notEqual(observed[0].owner, client.ownerBinding({ ...binding, operationId: "op_other_0001" }))
    assert.deepEqual(JSON.parse(observed[0].body), { operationId: binding.operationId, idempotencyKey: "idem_synthetic_01", subject })
    assert(!observed[0].body.includes(binding.sessionId))
  })
})

test("client rejects response operation, handle, issuer, schema, shape and invalid date mismatches", async () => {
  for (const mutate of [
    (r: OpenDidIssuance) => ({ ...r, operationId: "op_other_0001" }),
    (r: OpenDidIssuance) => ({ ...r, issuanceId: "iss_other_0001" }),
    (r: OpenDidIssuance) => ({ ...r, credential: { ...r.credential!, issuerDid: "did:omn:wrong" } }),
    (r: OpenDidIssuance) => ({ ...r, credential: { ...r.credential!, schemaId: "https://evil.invalid" } }),
    (r: OpenDidIssuance) => ({ ...r, extra: "raw-vp" }),
    (r: OpenDidIssuance) => ({ ...r, credential: { ...r.credential!, validFrom: "2026-02-30T00:00:00Z" } }),
    (r: OpenDidIssuance) => ({ ...r, credential: null }),
  ]) await localServer((_req, res) => json(res, mutate(issued())), async client => {
    await assert.rejects(client.issuanceRefresh(binding, "iss_synthetic_01"), errorCode("opendid_provider_response"))
  })
})

test("runtime extra input cannot override the server-owned operation binding", async () => {
  let requestBody: Record<string, unknown> | undefined
  await localServer((req, res) => { let body = ""; req.on("data", b => body += b); req.on("end", () => { requestBody = JSON.parse(body); json(res, offered()) }) }, async client => {
    const injected = { idempotencyKey: "idem_synthetic_01", subject, operationId: "op_other_0001", rawIdentity: "must-not-send" }
    await client.issuanceStart(binding, injected)
    assert.deepEqual(requestBody, { operationId: binding.operationId, idempotencyKey: injected.idempotencyKey, subject })
  })
})

test("client rejects oversized streamed body without trusting Content-Length", async () => {
  await localServer((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.write(" ".repeat(300)); res.end("{}") }, async client => {
    await assert.rejects(client.issuanceRefresh(binding, "iss_synthetic_01"), errorCode("opendid_provider_response"))
  }, { maxResponseBytes: 256 })
})

test("client does not follow redirects or propagate provider secrets/errors", async () => {
  let visits = 0
  await localServer((_req, res) => { visits++; res.writeHead(302, { location: "/secret" }); res.end() }, async client => {
    await assert.rejects(client.issuanceRefresh(binding, "iss_synthetic_01"), errorCode("opendid_provider_unavailable")); assert.equal(visits, 1)
  })
  await localServer((_req, res) => json(res, { error: { code: "internal", message: "raw-secret-user-did" } }, 500), async client => {
    await assert.rejects(client.issuanceRefresh(binding, "iss_synthetic_01"), e => e instanceof HkError && e.code === "opendid_provider_rejected" && !e.message.includes("raw-secret"))
  })
})

test("timeout bounds both response headers and a stalled response body", async () => {
  for (const sendHeaders of [false, true]) await localServer((_req, res) => { if (sendHeaders) { res.writeHead(200, { "content-type": "application/json" }); res.write("{") } }, async client => {
    const started = Date.now()
    await assert.rejects(client.issuanceRefresh(binding, "iss_synthetic_01"), errorCode("opendid_provider_timeout"))
    assert(Date.now() - started < 1500)
  }, { timeoutMs: 70 })
})

test("client accepts status only for exact issuance and refuses a contradictory positive status", async () => {
  for (const response of [{ issuanceId: "iss_other_0001", active: true, reason: null, checkedAt: iso(0) }, { issuanceId: "iss_synthetic_01", active: true, reason: "status_suspended", checkedAt: iso(0) }]) {
    await localServer((_req, res) => json(res, response), async client => { await assert.rejects(client.credentialStatus(binding, "iss_synthetic_01"), errorCode("opendid_provider_response")) })
  }
})

test("CX mapping is explicit, reference-bound and never synthetic fallback", async () => {
  const evidence = { source: "cx_mobile_id" as const, mode: "cx" as const, evidenceRef: subject.evidenceRef, personVerified: true, adultVerified: null, expiresAt: iso(10000) }
  await assert.rejects(resolveOpenDidCxSubject(evidence, undefined, EPOCH), errorCode("opendid_cx_mapping_unavailable"))
  await assert.rejects(resolveOpenDidCxSubject(evidence, async () => ({ evidenceRef: "ev_other_0001", kycRef: subject.kycRef, mappingVersion: "cx-cas-v1" }), EPOCH), errorCode("opendid_cx_mapping_unavailable"))
  await assert.rejects(resolveOpenDidCxSubject({ ...evidence, personVerified: false }, undefined, EPOCH), errorCode("opendid_identity_required"))
  assert.deepEqual(await resolveOpenDidCxSubject(evidence, async () => ({ evidenceRef: subject.evidenceRef, kycRef: subject.kycRef, mappingVersion: "cx-cas-v1" }), EPOCH), subject)
})

function harness(overrides: Partial<OpenDidBridgeClient> = {}) {
  let row: OpenDidProviderState | null = null, clock = EPOCH
  const counts = { issue: 0, refresh: 0, cancel: 0, present: 0, poll: 0, deny: 0, status: 0 }
  const store: OpenDidProviderStore = {
    async read() { return row ? structuredClone(row) : null },
    async compareAndSet(_id, revision, next) { if ((row?.revision ?? null) !== revision) return false; row = structuredClone(next); return true },
  }
  const bridge: OpenDidBridgeClient = {
    ownerBinding: b => b.sessionId + ":" + b.operationId,
    async issuanceStart() { counts.issue++; return offered() },
    async issuanceRefresh() { counts.refresh++; return issued() },
    async issuanceCancel() { counts.cancel++; return { ...offered(), state: "cancelled", offer: null, revision: 3 } },
    async credentialStatus() { counts.status++; return { issuanceId: "iss_synthetic_01", active: true, reason: null, checkedAt: new Date(clock).toISOString() } },
    async presentationStart() { counts.present++; return presentationOffered() },
    async presentationRefresh() { counts.poll++; return allowed() },
    async presentationDeny() { counts.deny++; return { ...presentationOffered(), state: "cancelled", offer: null, revision: 3 } },
    ...overrides,
  }
  const lifecycle = createOpenDidProviderLifecycle({ store, bridge, now: () => clock })
  const context = { ...binding, expiresAt: iso(3600000) }
  const ready = async () => { await lifecycle.startIssuance(context, subject); await lifecycle.refreshIssuance(context); await lifecycle.startPresentation(context); await lifecycle.refreshPresentation(context) }
  return { lifecycle, context, counts, ready, store, bridge, row: () => row!, advance: (ms: number) => clock += ms }
}
const deferred = <T>() => { let resolve!: (v: T) => void, reject!: (e: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

test("durable lifecycle issues, presents and requires fresh status for each authority step", async () => {
  const h = harness(); await h.ready()
  assert.equal(h.row().phase, "allowed"); assert.equal(h.row().lastStatus, null)
  await h.lifecycle.assertFreshPermission(h.context); await h.lifecycle.assertFreshPermission(h.context)
  assert.equal(h.counts.status, 2)
  assert.equal(JSON.stringify(h.row()).includes("qrPayload"), false)
  assert.equal(JSON.stringify(h.row()).includes("synthetic-qr"), false)
})

test("issuance owner and subject cannot change on resume or duplicate start", async () => {
  const h = harness(); await h.lifecycle.startIssuance(h.context, subject)
  await assert.rejects(h.lifecycle.read({ ...h.context, sessionId: "wrong_session" }), errorCode("not_found"))
  await assert.rejects(h.lifecycle.startIssuance(h.context, { ...subject, evidenceRef: "ev_other_0001" }), errorCode("opendid_subject_mismatch"))
  assert.equal(h.counts.issue, 1)
  await assert.rejects(h.lifecycle.read({ ...h.context, operationBinding: "different-operation-policy" }), errorCode("opendid_operation_binding"))
})

test("an expired native credential cannot start a new presentation request", async () => {
  const h = harness(); await h.lifecycle.startIssuance(h.context, subject); await h.lifecycle.refreshIssuance(h.context)
  h.row().issuance!.credential!.validUntil = iso(0)
  await assert.rejects(h.lifecycle.startPresentation(h.context), errorCode("opendid_credential_expired"))
  assert.equal(h.counts.present, 0)
})

test("simultaneous duplicate issuance claims produce exactly one provider write", async () => {
  const d = deferred<OpenDidIssuance>(); let calls = 0
  const h = harness({ async issuanceStart() { calls++; return d.promise } })
  const first = h.lifecycle.startIssuance(h.context, subject)
  while (!calls) await new Promise(resolve => setImmediate(resolve))
  const second = await h.lifecycle.startIssuance(h.context, subject)
  assert(second.state.pending); assert.equal(calls, 1)
  d.resolve(offered()); await first
  assert.equal(h.row().phase, "issuance"); assert.equal(h.row().pending, null)
})

test("lost response retries the same durable idempotency key, not a new operation", async () => {
  const keys: string[] = []
  const h = harness({ async issuanceStart(_binding, input) { keys.push(input.idempotencyKey); if (keys.length === 1) throw new HkError("opendid_provider_timeout", "timeout", 504, true); return offered() } })
  await assert.rejects(h.lifecycle.startIssuance(h.context, subject))
  assert.equal(h.row().pending, null)
  await h.lifecycle.refreshIssuance(h.context)
  assert.equal(keys.length, 2); assert.equal(keys[0], keys[1])
})

test("cancel is durable before provider I/O and late issuance cannot resurrect it", async () => {
  const d = deferred<OpenDidIssuance>(); let began = false
  const h = harness({ async issuanceStart() { began = true; return d.promise } })
  const first = h.lifecycle.startIssuance(h.context, subject)
  while (!began) await new Promise(resolve => setImmediate(resolve))
  await h.lifecycle.cancel(h.context); assert.equal(h.row().phase, "cancelled")
  d.resolve(issued()); const late = await first
  assert.equal(late.state.phase, "cancelled"); assert.equal(late.state.issuance, null); assert.equal(h.counts.cancel, 1)
  await assert.rejects(h.lifecycle.assertFreshPermission(h.context), errorCode("opendid_permission_required"))
})

test("late presentation after expiry cannot create a decision", async () => {
  const d = deferred<OpenDidPresentation>(); let began = false
  const h = harness({ async presentationRefresh() { began = true; return d.promise } })
  await h.lifecycle.startIssuance(h.context, subject); await h.lifecycle.refreshIssuance(h.context); await h.lifecycle.startPresentation(h.context)
  const pending = h.lifecycle.refreshPresentation(h.context)
  while (!began) await new Promise(resolve => setImmediate(resolve))
  h.advance(3600000); d.resolve(allowed())
  const r = await pending
  assert.equal(r.state.phase, "expired"); assert.equal(r.state.presentation?.decision, null); assert.equal(h.counts.deny, 1)
})

test("mismatched provider operation and stale provider revision never commit", async () => {
  const h = harness({ async issuanceRefresh() { return { ...issued(), operationId: "op_other_0001" } } })
  await h.lifecycle.startIssuance(h.context, subject)
  await assert.rejects(h.lifecycle.refreshIssuance(h.context), errorCode("opendid_provider_binding"))
  assert.equal(h.row().phase, "issuance"); assert.equal(h.row().pending, null)
  h.bridge.issuanceRefresh = async () => ({ ...issued(), revision: 0 })
  await assert.rejects(h.lifecycle.refreshIssuance(h.context), errorCode("opendid_provider_binding"))
})

test("revoked, stale, future and wrong-credential status cannot authorize permission", async () => {
  for (const patch of [{ active: false, reason: "status_suspended" }, { checkedAt: iso(-60001) }, { checkedAt: iso(1001) }, { issuanceId: "iss_other_0001" }]) {
    const h = harness({ async credentialStatus() { return { issuanceId: "iss_synthetic_01", active: true, reason: null, checkedAt: iso(0), ...patch } } }); await h.ready()
    await assert.rejects(h.lifecycle.assertFreshPermission(h.context), errorCode("opendid_status_required"))
  }
})

test("an exact decision-expiry boundary is denied even if ledger remains active", async () => {
  const h = harness(); await h.ready(); h.advance(300000)
  await assert.rejects(h.lifecycle.assertFreshPermission(h.context), errorCode("opendid_permission_expired"))
})

test("cancel during fresh status cannot authorize chain work", async () => {
  const d = deferred<{ issuanceId: string; active: boolean; reason: null; checkedAt: string }>(); let began = false
  const h = harness({ async credentialStatus() { began = true; return d.promise } }); await h.ready()
  const permission = h.lifecycle.assertFreshPermission(h.context)
  while (!began) await new Promise(resolve => setImmediate(resolve))
  await h.lifecycle.cancel(h.context); d.resolve({ issuanceId: "iss_synthetic_01", active: true, reason: null, checkedAt: iso(0) })
  await assert.rejects(permission, errorCode("opendid_permission_required")); assert.equal(h.row().phase, "cancelled")
})

test("a busy status lease cannot reuse previous active status", async () => {
  const h = harness(); await h.ready(); await h.lifecycle.assertFreshPermission(h.context)
  const d = deferred<{ issuanceId: string; active: boolean; reason: null; checkedAt: string }>(); let began = false
  h.bridge.credentialStatus = async () => { began = true; return d.promise }
  const first = h.lifecycle.assertFreshPermission(h.context)
  while (!began) await new Promise(resolve => setImmediate(resolve))
  await assert.rejects(h.lifecycle.assertFreshPermission(h.context), errorCode("opendid_permission_required"))
  d.resolve({ issuanceId: "iss_synthetic_01", active: true, reason: null, checkedAt: iso(0) }); await first
})

test("provider cancellation outage preserves local denial and explicit cleanup uncertainty", async () => {
  const h = harness({ async issuanceCancel() { throw new HkError("opendid_provider_unavailable", "unavailable", 503, true) } })
  await h.lifecycle.startIssuance(h.context, subject)
  const stopped = await h.lifecycle.cancel(h.context)
  assert.equal(stopped.state.phase, "cancelled"); assert.equal(stopped.state.cleanupPending, true)
  await h.lifecycle.refreshIssuance(h.context); assert.equal(h.counts.refresh, 0)
})
