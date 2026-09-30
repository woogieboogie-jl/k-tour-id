import assert from "node:assert/strict"
import { test } from "node:test"
import { generateKeyPairSync, ECDH, sign } from "node:crypto"
import { toBase58 } from "@mysten/bcs"
import { createNativeBindingService, assertNativeHolderBinding } from "../../lib/hackathon/native-binding-service"
import { nativeBindingCanonical } from "../../lib/hackathon/native-binding-did"
import type { Db, OperationRecord } from "../../lib/hackathon/store"
import type { NativeBindingProvider } from "../../lib/hackathon/native-binding-provider"
const T = Date.parse("2026-09-30T00:00:00Z"), iso = (n = 0) => new Date(T + n).toISOString(), OP = "op_native_fixture01", SESSION = "ses_fixture_native01"
function op(): OperationRecord { return { operationId: OP, sessionId: SESSION, kind: "demo_entitlement", venueId: "fixture", campaignId: "fixture", policyVersion: 1, status: "pending", phase: "issuance", revision: 1, createdAt: iso(), updatedAt: iso(), expiresAt: iso(3600_000), execution: "provider", safeNextAction: "wait", allowedActions: [], returnContext: null,
  consent: { version: "fixture", digest: "fixture", acceptedAt: iso() }, identity: { evidenceId: "fixture_evidence", subjectRef: "private_actual_cx_fixture", source: "cx_mobile_id", mode: "cx", provider: "comdl", personVerified: true, adultVerified: null, verifiedAt: iso(), expiresAt: iso(3600_000), providerTransactionRef: "private_tx_fixture", handoff: null }, credential: null, presentation: null, proposal: null, delegation: null, agent: null, fulfillment: null, chain: null, error: null, secrets: {}, audit: [] } }
function proof(nonce: string) {
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" }), jwk = pair.publicKey.export({ format: "jwk" })
  const point = Buffer.from(ECDH.convertKey(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, "base64url"), Buffer.from(jwk.y!, "base64url")]), "prime256v1", undefined, undefined, "compressed"))
  const did = "did:omn:ephemeral-offline-native-holder"
  const doc = { id: did, controller: "did:omn:tas", versionId: "1", deactivated: false, authentication: ["pin"], verificationMethod: [{ id: "pin", controller: did, type: "Secp256r1VerificationKey2018", authType: 2, publicKeyMultibase: "z" + toBase58(point) }] }
  const unsigned = { did, authNonce: nonce, proof: { created: iso(), proofPurpose: "authentication", verificationMethod: `${did}?versionId=1#pin`, type: "Secp256r1Signature2018" } }
  const signature = sign("sha256", Buffer.from(nativeBindingCanonical(unsigned)), { key: pair.privateKey, dsaEncoding: "ieee-p1363" })
  return { doc, auth: { ...unsigned, proof: { ...unsigned.proof, proofValue: "z" + toBase58(Buffer.concat([Buffer.from([31]), signature])) } } }
}
function setup(provider: Partial<NativeBindingProvider> = {}) {
  let clock = T, changed = false, locked = false, queue = Promise.resolve()
  let db: Db = { version: 1, sessions: { [SESSION]: { sessionId: SESSION, createdAt: iso(), lastSeenAt: iso(), subjectRef: null } }, operations: { [OP]: op() }, redemptions: {}, outbox: {}, idempotency: {}, nonces: {} }
  const count = { allocate: 0, cas: 0, holder: 0 }
  const atomic = <R>(fn: (db: Db) => R | Promise<R>) => { const run = queue.then(async () => { const copy = structuredClone(db); locked = true; try { const result = await fn(copy); db = copy; return structuredClone(result) } finally { locked = false } }); queue = run.then(() => undefined, () => undefined); return run }
  const service = createNativeBindingService({ atomic, secret: "offline-fixture-secret-not-production".repeat(2), configBinding: "0x" + "a".repeat(64), now: () => clock, identityChanged: () => changed,
    provider: { async allocateCas(...args) { assert(!locked); count.allocate++; await provider.allocateCas?.(...args) }, async confirmCas(...args) { assert(!locked); count.cas++; await provider.confirmCas?.(...args) }, async confirmHolder(...args) { assert(!locked); count.holder++; await provider.confirmHolder?.(...args) } } })
  const start = () => service.start(SESSION, OP)
  const allocated = async () => { const s = await start(), b = await service.begin(OP, s.bindingId, s.token); return { s, b } }
  const proved = async () => { const x = await allocated(), p = proof(x.b.authNonce); await service.prove(OP, x.s.bindingId, x.b.token, p.doc, p.auth); return x }
  return { service, start, allocated, proved, count, row: () => db.operations[OP], mutate: (fn: (o: OperationRecord) => void) => atomic(db => fn(db.operations[OP])), advance: (ms: number) => clock += ms, drift: () => changed = true }
}
test("actual offline crypto + durable claims produce only trusted-readback verified binding", async () => {
  const h = setup(), { s, b } = await h.proved()
  assert.notEqual(s.token, b.token); assert.equal(s.token.length, 43); assert.equal(b.casUserId.length, 43)
  assert.equal(h.row().secrets.nativeHolderBinding?.status, "proved")
  assert.throws(() => assertNativeHolderBinding(h.row(), undefined, T))
  const verified = await h.service.confirm(OP, s.bindingId, b.token)
  assert.equal(verified.status, "verified"); assertNativeHolderBinding(h.row(), undefined, T)
  assert.equal(h.count.allocate, 1); assert.equal(h.count.holder, 1)
  await h.service.confirm(OP, s.bindingId, b.token); assert.equal(h.count.holder, 1)
  const pub = JSON.stringify(await h.service.status(SESSION, OP))
  for (const v of [s.token, b.token, b.casUserId, "private_actual_cx_fixture", "did:omn:"]) assert(!pub.includes(v))
})
test("sample, wrong session, source drift, expiry and consent drift fail closed before CAS", async () => {
  for (const patch of [(o: OperationRecord) => { o.identity!.mode = "mock" }, (o: OperationRecord) => { o.consent = null }, (o: OperationRecord) => { o.identity!.expiresAt = "invalid" }, (o: OperationRecord) => { o.identity!.sourceCurrent = false }, (o: OperationRecord) => { o.execution = "sample" }]) {
    const h = setup(); await h.mutate(patch); await assert.rejects(h.start()); assert.equal(h.count.allocate, 0)
  }
  const h = setup(); await assert.rejects(h.service.start("wrong", OP)); const s = await h.start(); h.drift(); await assert.rejects(h.service.begin(OP, s.bindingId, s.token)); assert.equal((await h.service.status(SESSION, OP))?.status, "cancelled")
})
test("wrong stage token, modified nonce/context and expired challenge cannot bind", async () => {
  const h = setup(), { s, b } = await h.allocated(), p = proof(s.authNonce)
  await assert.rejects(h.service.prove(OP, s.bindingId, s.token, p.doc, p.auth))
  await assert.rejects(h.service.prove(OP, s.bindingId, b.token, p.doc, { ...p.auth, authNonce: "f".repeat(64) }))
  await h.mutate(o => { o.consent!.digest = "changed" }); await assert.rejects(h.service.prove(OP, s.bindingId, b.token, p.doc, p.auth))
  const e = setup(), x = await e.start(); e.advance(600_000); await assert.rejects(e.service.begin(OP, x.bindingId, x.token)); assert.equal((await e.service.status(SESSION, OP))?.status, "expired")
})
test("lost allocation response reconciles read-only and never sends a second CAS write", async () => {
  const h = setup({ async allocateCas() { throw new Error("private transport details") } }), s = await h.start()
  await assert.rejects(h.service.begin(OP, s.bindingId, s.token), e => e instanceof Error && !e.message.includes("private transport"))
  assert.equal(h.row().secrets.nativeHolderBinding?.status, "unknown")
  await h.service.begin(OP, s.bindingId, s.token); await h.service.begin(OP, s.bindingId, s.token)
  assert.equal(h.count.allocate, 1); assert.equal(h.count.cas, 1)
})
test("crashed allocating claim gets read-only reconciliation after lease, never retry-write", async () => {
  const h = setup(), s = await h.start(); await h.mutate(o => { o.secrets.nativeHolderBinding!.status = "allocating"; o.secrets.nativeHolderBinding!.claimAt = iso() })
  await assert.rejects(h.service.begin(OP, s.bindingId, s.token)); h.advance(30_000)
  await h.service.begin(OP, s.bindingId, s.token); assert.equal(h.count.allocate, 0); assert.equal(h.count.cas, 1)
})
test("cancellation wins late CAS and late authoritative DID completion", async () => {
  let release!: () => void, reached!: () => void; const started = new Promise<void>(r => reached = r), paused = new Promise<void>(r => release = r)
  const h = setup({ async allocateCas() { reached(); await paused } }), s = await h.start(), pending = h.service.begin(OP, s.bindingId, s.token)
  await started; await h.service.cancel(SESSION, OP); release(); await assert.rejects(pending); assert.equal(h.row().secrets.nativeHolderBinding?.status, "cancelled")
  let release2!: () => void, reached2!: () => void; const started2 = new Promise<void>(r => reached2 = r), paused2 = new Promise<void>(r => release2 = r)
  const f = setup({ async confirmHolder() { reached2(); await paused2 } }), x = await f.proved(), confirmation = f.service.confirm(OP, x.s.bindingId, x.b.token)
  await started2; await f.service.cancel(SESSION, OP); release2(); await assert.rejects(confirmation); assert.equal(f.row().secrets.nativeHolderBinding?.status, "cancelled")
})
test("proof duplicates are idempotent but a different key/proof cannot replace the holder", async () => {
  const h = setup(), { s, b } = await h.allocated(), p = proof(b.authNonce)
  const one = await h.service.prove(OP, s.bindingId, b.token, p.doc, p.auth)
  assert.deepEqual(await h.service.prove(OP, s.bindingId, b.token, p.doc, p.auth), one)
  const other = proof(b.authNonce); await assert.rejects(h.service.prove(OP, s.bindingId, b.token, other.doc, other.auth))
})
