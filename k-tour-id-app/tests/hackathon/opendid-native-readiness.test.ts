import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { createOpenDidBridgeClient, resolveOpenDidCxSubject, type OpenDidBridgeConfig, type OpenDidCxEvidence, type OpenDidCxSubject, type VerifiedCxKycBinding } from "../../lib/hackathon/adapters/opendid-provider"
import { resolveOpenDidNativeBridgeConfig } from "../../lib/hackathon/opendid-native-config"
import { checkOpenDidNativeTransport, OPEN_DID_NATIVE_PROBE_PATH } from "../../lib/hackathon/opendid-native-readiness"
import { providerIntegrationAvailable } from "../../lib/hackathon/provider-operation"
import { HkError } from "../../lib/hackathon/util"

const config: OpenDidBridgeConfig = {
  baseUrl: "https://bridge.example.invalid", trustedOrigin: "https://bridge.example.invalid",
  serviceToken: "test-native-token-".repeat(3), ownerBindingSecret: "test-owner-secret-".repeat(3),
  issuerDid: "did:omn:issuer", schemaId: "https://schema.example.invalid/pass",
}
const env: NodeJS.ProcessEnv = { NODE_ENV: "test", HK_OPENDID_BRIDGE_URL: config.baseUrl, HK_OPENDID_TRUSTED_ORIGIN: config.trustedOrigin,
  HK_OPENDID_BRIDGE_TOKEN: config.serviceToken, HK_OPENDID_OWNER_BINDING_SECRET: config.ownerBindingSecret,
  HK_OPENDID_ISSUER_DID: config.issuerDid, HK_OPENDID_SCHEMA_ID: config.schemaId }
const code = (expected: string) => (error: unknown) => error instanceof HkError && error.code === expected
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
const errorResponse = (authenticated: boolean) => json({ error: { code: authenticated ? "not_found" : "unauthorized", message: authenticated ? "not found" : "unauthorized" } }, authenticated ? 404 : 401)
const fetchFn = (fn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): typeof fetch => fn as typeof fetch
const evidence = (): OpenDidCxEvidence => ({ source: "cx_mobile_id", mode: "cx", evidenceRef: "ev_native_fixture", personVerified: true, adultVerified: null, expiresAt: new Date(Date.now() + 60000).toISOString() })
const mapped = (e: OpenDidCxEvidence): VerifiedCxKycBinding => ({ evidenceRef: e.evidenceRef, kycRef: "a".repeat(64), mappingVersion: "cx-cas-v1" })

test("native configuration resolver shares the live client validation without enabling integration", () => {
  assert.deepEqual(resolveOpenDidNativeBridgeConfig(env), { ...config, allowLoopback: false, timeoutMs: 5000, maxResponseBytes: 32768 })
  assert.equal(providerIntegrationAvailable({ ...env, HK_OPENDID_MODE: "opendid" }), false)
  assert.throws(() => resolveOpenDidNativeBridgeConfig({ NODE_ENV: "test" }), code("opendid_provider_configuration"))
  const result = resolveOpenDidNativeBridgeConfig(env); result.baseUrl = "https://changed.invalid"
  assert.equal(env.HK_OPENDID_BRIDGE_URL, config.baseUrl)
})

test("invalid pins, control characters, secret bounds and hosted loopback fail before network", () => {
  for (const patch of [
    { issuerDid: "issuer" }, { issuerDid: "did:omn:issuer#key" }, { issuerDid: "did:omn:issuer\n" },
    { schemaId: "not a URI" }, { schemaId: "javascript:alert(1)" }, { schemaId: "https://user:pass@schema.invalid/path" },
    { schemaId: "https://schema.invalid/path#unchecked" }, { schemaId: "http://schema.invalid/path" },
    { ownerBindingSecret: "\n".repeat(40) }, { ownerBindingSecret: "x".repeat(4097) },
    { serviceToken: "token with spaces".repeat(3) }, { maxResponseBytes: 131073 },
    { baseUrl: "https://localhost", trustedOrigin: "https://localhost" },
    { baseUrl: "https://bridge.example.invalid\n" }, { schemaId: "https://schema.example.invalid/with space" },
  ]) assert.throws(() => createOpenDidBridgeClient({ ...config, ...patch }), code("opendid_provider_configuration"))
  assert.throws(() => resolveOpenDidNativeBridgeConfig({ ...env, VERCEL: "1", HK_OPENDID_BRIDGE_ALLOW_LOOPBACK: "1" }), code("opendid_provider_configuration"))
  const local = { ...env, HK_OPENDID_BRIDGE_URL: "http://127.0.0.1:19310", HK_OPENDID_TRUSTED_ORIGIN: "http://127.0.0.1:19310", HK_OPENDID_SCHEMA_ID: "http://127.0.0.1:19301/schema", HK_OPENDID_BRIDGE_ALLOW_LOOPBACK: "1" }
  assert.equal(resolveOpenDidNativeBridgeConfig(local).allowLoopback, true)
  assert.throws(() => resolveOpenDidNativeBridgeConfig({ ...local, HK_OPENDID_BRIDGE_ALLOW_LOOPBACK: "0" }), code("opendid_provider_configuration"))
})

test("preflight uses only two exact GETs with no real operation, then reports authentication only", async () => {
  const requests: Array<{ input: string; init?: RequestInit }> = []
  const result = await checkOpenDidNativeTransport(config, fetchFn(async (input, init) => {
    requests.push({ input: String(input), init }); return errorResponse(requests.length === 2)
  }))
  assert.equal(requests.length, 2)
  for (const request of requests) {
    assert.equal(request.input, `${config.baseUrl}${OPEN_DID_NATIVE_PROBE_PATH}`)
    assert.equal(request.init?.method, "GET"); assert.equal(request.init?.body, undefined)
    assert.equal(request.init?.redirect, "error"); assert.equal(request.init?.cache, "no-store")
  }
  assert.equal(new Headers(requests[0].init?.headers).get("authorization"), null)
  assert.equal(new Headers(requests[0].init?.headers).get("x-ktour-owner"), null)
  assert.equal(new Headers(requests[1].init?.headers).get("authorization"), `Bearer ${config.serviceToken}`)
  assert.match(new Headers(requests[1].init?.headers).get("x-ktour-owner")!, /^[a-f0-9]{64}$/)
  assert.deepEqual(result, { protocol: "bridge-v1", verification: "transport_authentication_only", unauthenticatedRejected: true, authenticatedRouteRecognized: true,
    providerIntegrationAvailable: false, cxHolderMappingVerified: false, nativeIssuanceVerified: false, nativePresentationVerified: false, signingAllowed: false })
  assert.equal(JSON.stringify(result).includes(config.serviceToken), false)
  assert.equal(JSON.stringify(result).includes(config.baseUrl), false)
})

test("preflight refuses missing authorization enforcement without sending a token", async () => {
  let calls = 0
  await assert.rejects(checkOpenDidNativeTransport(config, fetchFn(async () => { calls++; return errorResponse(true) })), code("opendid_native_preflight_failed"))
  assert.equal(calls, 1)
})

test("preflight rejects wrong token, route, extra fields, null code, non-JSON and redirect responses", async () => {
  const invalidResponses = [
    () => errorResponse(false), () => json({ error: { code: "other_route", message: "not found" } }, 404),
    () => json({ error: { code: null, message: "not found" } }, 404),
    () => json({ error: { code: "not_found", message: "not found", rawVp: "must-not-accept" } }, 404),
    () => json({ error: { code: "not_found", message: "not found" }, rawVc: "must-not-accept" }, 404),
    () => new Response("html", { status: 404, headers: { "content-type": "text/html" } }),
    () => new Response(null, { status: 302, headers: { location: "https://different.invalid" } }),
    () => { const response = errorResponse(true); Object.defineProperty(response, "url", { value: "https://different.invalid/bridge" }); return response },
    () => { const response = errorResponse(true); Object.defineProperty(response, "redirected", { value: true }); return response },
  ]
  for (const makeResponse of invalidResponses) {
    let calls = 0
    await assert.rejects(checkOpenDidNativeTransport(config, fetchFn(async () => ++calls === 1 ? errorResponse(false) : makeResponse())), code("opendid_native_preflight_failed"))
    assert.equal(calls, 2)
  }
})

test("preflight has bounded streamed bytes and does not expose response or transport secrets", async () => {
  for (const oversized of [new Response(" ".repeat(4100), { status: 401, headers: { "content-type": "application/json" } }),
    new Response("{}", { status: 401, headers: { "content-type": "application/json", "content-length": "4100" } })]) {
    await assert.rejects(checkOpenDidNativeTransport(config, fetchFn(async () => oversized)), code("opendid_native_preflight_failed"))
  }
  await assert.rejects(checkOpenDidNativeTransport(config, fetchFn(async () => { throw new Error(`secret=${config.serviceToken}`) })), error => error instanceof HkError && error.code === "opendid_native_preflight_failed" && !error.message.includes(config.serviceToken))
})

test("preflight bounds stalled headers and body even when fetch ignores abort", async () => {
  for (const bodyStall of [false, true]) {
    const started = Date.now()
    await assert.rejects(checkOpenDidNativeTransport({ ...config, timeoutMs: 50 }, fetchFn(async () => bodyStall
      ? new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("{")) } }), { status: 401, headers: { "content-type": "application/json" } })
      : new Promise<Response>(() => undefined))), code("opendid_native_preflight_failed"))
    assert(Date.now() - started < 1500)
  }
})

test("CX resolver freezes a minimal evidence snapshot and refuses malformed or extra mapping fields", async () => {
  const input = { ...evidence(), rawIdentity: "must-not-forward" }
  const subject = await resolveOpenDidCxSubject(input, async value => {
    assert.equal(Object.isFrozen(value), true); assert.equal(Object.hasOwn(value, "rawIdentity"), false); return mapped(value)
  })
  assert.equal(subject.evidenceRef, input.evidenceRef)
  for (const value of [null, { ...mapped(input), rawDid: "must-not-accept" }, { ...mapped(input), kycRef: "A".repeat(64) }, { ...mapped(input), evidenceRef: "ev_another_identity" }]) {
    await assert.rejects(resolveOpenDidCxSubject(input, async () => value), code("opendid_cx_mapping_unavailable"))
  }
  await assert.rejects(resolveOpenDidCxSubject({ ...input, adultVerified: "true" } as unknown as OpenDidCxEvidence, async e => mapped(e)), code("opendid_identity_required"))
})

test("CX mapping preserves snapshot across caller mutation and rechecks expiry after resolution", async () => {
  const input = evidence(), originalRef = input.evidenceRef
  let finish!: (value: VerifiedCxKycBinding) => void
  const pending = resolveOpenDidCxSubject(input, () => new Promise(resolve => { finish = resolve }))
  await Promise.resolve(); input.evidenceRef = "ev_wrong_mutation"; input.adultVerified = true
  finish({ evidenceRef: originalRef, kycRef: "a".repeat(64), mappingVersion: "cx-cas-v1" })
  assert.deepEqual(await pending, { kind: "cx_evidence_ref", evidenceRef: originalRef, personVerified: true, adultVerified: null, kycRef: "a".repeat(64) })
  const now = Date.now(), expiring = { ...evidence(), expiresAt: new Date(now + 10).toISOString() }
  await assert.rejects(resolveOpenDidCxSubject(expiring, async e => { await new Promise(resolve => setTimeout(resolve, 25)); return mapped(e) }, now), code("opendid_identity_required"))
})

test("missing, throwing and stalled CX resolvers never become synthetic or leak provider errors", async () => {
  await assert.rejects(resolveOpenDidCxSubject(evidence()), code("opendid_cx_mapping_unavailable"))
  await assert.rejects(resolveOpenDidCxSubject(evidence(), async () => { throw new Error("private identity token") }), error => error instanceof HkError && error.code === "opendid_cx_mapping_unavailable" && !error.message.includes("private"))
  await assert.rejects(resolveOpenDidCxSubject(evidence(), async () => { throw new HkError("opendid_identity_required", "private identity token", 409) }), error => error instanceof HkError && error.code === "opendid_identity_required" && !error.message.includes("private"))
  await assert.rejects(resolveOpenDidCxSubject(evidence(), () => new Promise(() => undefined), Date.now(), 50), code("opendid_cx_mapping_unavailable"))
})

const fixtures = JSON.parse(readFileSync(new URL("./fixtures/opendid-native-bridge-v1.json", import.meta.url), "utf8")) as Record<string, unknown>
const fixtureBinding = { sessionId: "native-contract-fixture", operationId: "op_0f3c9a1b2d4e5f60" }
const nativeCfg = { ...config, allowLoopback: true, schemaId: "http://127.0.0.1:19301/issuer/api/v1/vc/vcschema?name=vc.schema.ktour.pass" }
for (const state of ["offered", "issued", "failed"]) test(`actual native bridge-v1 ${state} issuance fixture parses without inventing a new protocol`, async () => {
  const body = fixtures[`issuance.${state}.response`]
  const client = createOpenDidBridgeClient(nativeCfg, fetchFn(async () => json(body)))
  assert.deepEqual(await client.issuanceRefresh(fixtureBinding, "iss_AAAAAAAAAAAAAAAA"), body)
})
for (const state of ["allowed", "denied"]) test(`actual native bridge-v1 ${state} presentation fixture parses without treating it as live authority`, async () => {
  const body = fixtures[`presentation.${state}.response`]
  const client = createOpenDidBridgeClient(nativeCfg, fetchFn(async () => json(body)))
  assert.deepEqual(await client.presentationRefresh(fixtureBinding, "pres_BBBBBBBBBBBBBBBB"), body)
  assert.equal(providerIntegrationAvailable(), false)
})
test("actual native status/error and VP start fixtures retain exact request and fail-closed errors", async () => {
  let body: string | undefined
  const status = createOpenDidBridgeClient(nativeCfg, fetchFn(async () => json(fixtures["status.response"])))
  assert.deepEqual(await status.credentialStatus(fixtureBinding, "iss_AAAAAAAAAAAAAAAA"), fixtures["status.response"])
  const vp = createOpenDidBridgeClient(nativeCfg, fetchFn(async (_input, init) => { body = String(init?.body); return json(fixtures["presentation.allowed.response"]) }))
  await vp.presentationStart(fixtureBinding, "iss_AAAAAAAAAAAAAAAA")
  assert.deepEqual(JSON.parse(body!), fixtures["presentation-start.request"])
  const rejected = createOpenDidBridgeClient(nativeCfg, fetchFn(async () => json(fixtures["error.response"], 409)))
  await assert.rejects(rejected.issuanceRefresh(fixtureBinding, "iss_AAAAAAAAAAAAAAAA"), code("opendid_provider_rejected"))
})
test("native synthetic start fixture is explicitly forbidden at the real main provider boundary", () => {
  let calls = 0
  const client = createOpenDidBridgeClient(nativeCfg, fetchFn(async () => { calls++; return json(fixtures["issuance.offered.response"]) }))
  const synthetic = fixtures["issuance-start.request"] as { idempotencyKey: string; subject: OpenDidCxSubject }
  assert.throws(() => client.issuanceStart(fixtureBinding, synthetic), code("opendid_cx_mapping_unavailable"))
  assert.equal(calls, 0)
})
