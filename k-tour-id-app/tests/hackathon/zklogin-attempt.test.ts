import test from "node:test"
import assert from "node:assert/strict"
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519"
import { generateNonce, getExtendedEphemeralPublicKey } from "@mysten/sui/zklogin"
import { createZkLoginAttempts, parseZkLoginStart } from "../../lib/hackathon/zklogin-attempt"
import { validZkLoginAttemptView, validZkLoginInputs } from "../../lib/hackathon/zklogin-attempt-contract"
import { HkError } from "../../lib/hackathon/util"
import type { Db, OperationRecord } from "../../lib/hackathon/store"

// Synthetic provider boundary; no real JWT, identity, proof, ledger or network.
const OP = "op_zklogin_fixture01", SESSION = "fixture_session", ATTEMPT = "zkl_" + "a".repeat(24)
const NOW = Date.parse("2026-09-30T00:00:00.000Z"), iso = (delta: number) => new Date(NOW + delta).toISOString()
const key = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(7))
const input = { operationId: OP, attemptId: ATTEMPT, extendedEphemeralPublicKey: getExtendedEphemeralPublicKey(key.getPublicKey()), maxEpoch: 12, jwtRandomness: "123" }
const proof = { address: "0x" + "a".repeat(64), salt: "private-salt-fixture", sub: "private-sub-fixture", aud: "fixture-client", inputs: { proofPoints: { a: ["1", "2", "1"], b: [["1", "2"], ["3", "4"], ["1", "0"]], c: ["1", "2", "1"] }, issBase64Details: { value: "fixture", indexMod4: 0 }, headerBase64: "fixture", addressSeed: "123" } }
const errorCode = (code: string) => (e: unknown) => e instanceof HkError && e.code === code
function setup() {
  let clock = NOW, epoch = 10, configBinding = "config-fixture", proofCalls = 0, verifyCalls = 0, epochCalls = 0, failAfterProofCommit = false
  let blockProof: Promise<void> | null = null, blockVerification: Promise<void> | null = null, failProof: Error | null = null, rejectToken = false
  let db = { version: 1, sessions: { [SESSION]: { sessionId: SESSION, subjectRef: "subject-fixture", createdAt: iso(0), lastSeenAt: iso(0) } }, operations: {}, redemptions: {}, outbox: {}, idempotency: {}, nonces: {} } as Db
  const op = { operationId: OP, sessionId: SESSION, kind: "demo_entitlement", venueId: "venue-fixture", campaignId: "campaign-fixture", policyVersion: 1, status: "pending", phase: "delegation", expiresAt: iso(600000), identity: { subjectRef: "subject-fixture", personVerified: true, expiresAt: iso(600000) }, credential: { validUntil: iso(600000) }, presentation: { decision: "allow", decisionExpiresAt: iso(300000), decisionRef: "decision-fixture" }, proposal: { proposalDigest: "proposal-fixture" }, consent: { digest: "consent-fixture" }, delegation: null, secrets: {}, audit: [] } as unknown as OperationRecord
  db.operations[OP] = op
  const service = createZkLoginAttempts({
    atomic: async f => { const next = structuredClone(db); const result = f(next); db = next; if (failAfterProofCommit && db.operations[OP].secrets.zkLoginAttempt?.status === "proved") { failAfterProofCommit = false; throw new Error("private transport error") } return structuredClone(result) },
    read: async f => f(structuredClone(db)), now: () => clock, epoch: async () => { epochCalls++; return epoch }, config: () => ({ googleClientId: "fixture-client", binding: configBinding }),
    validate: (_db, row, now) => { if (!row.identity?.personVerified || row.identity.sourceCurrent === false || Date.parse(row.identity.expiresAt) <= now) throw new HkError("zklogin_attempt_inactive", "fixture-invalid", 409) },
    verifyToken: async () => { verifyCalls++; if (blockVerification) await blockVerification; if (rejectToken) throw new HkError("zklogin_jwt", "fixture-rejected", 400) },
    prove: async args => { proofCalls++; assert.equal(args.extendedEphemeralPublicKey, input.extendedEphemeralPublicKey); assert.equal(args.maxEpoch, input.maxEpoch); if (blockProof) await blockProof; if (failProof) throw failProof; return structuredClone(proof) },
  })
  const prove = () => service.prove(SESSION, { operationId: OP, attemptId: ATTEMPT, jwt: "header.payload.signature" })
  return { service, prove, db: () => db, mutate: (f: (op: OperationRecord) => void) => f(db.operations[OP]), stats: () => ({ proofCalls, verifyCalls, epochCalls }), time: (t: number) => { clock = t }, epoch: (n: number) => { epoch = n }, drift: () => { configBinding = "new-config" }, blockProof: (p: Promise<void>) => { blockProof = p }, blockVerification: (p: Promise<void>) => { blockVerification = p }, failProof: () => { failProof = new Error("sensitive-private-provider-url") }, rejectToken: () => { rejectToken = true }, lostCommit: () => { failAfterProofCommit = true } }
}
test("attempt binds canonical SDK nonce, owned operation and private provider tuple without JWT storage", async () => {
  const h = setup(), started = await h.service.start(SESSION, input)
  assert.equal(started.nonce, generateNonce(key.getPublicKey(), input.maxEpoch, input.jwtRandomness))
  assert.equal(started.redirectUri, "https://ktour-id.vercel.app/hackathon/zklogin/callback")
  assert.equal(started.expiresAt, iso(300000))
  const result = await h.prove()
  assert.equal(result.status, "proved"); assert.equal(validZkLoginAttemptView(result, OP, ATTEMPT), true)
  assert.deepEqual(await h.prove(), result); assert.deepEqual(await h.service.status(SESSION, OP, ATTEMPT), result)
  assert.equal(h.stats().proofCalls, 1)
  for (const forbidden of ["header.payload.signature", "private-salt-fixture", "private-sub-fixture"]) assert.equal(JSON.stringify(h.db()).includes(forbidden), false)
})
test("strict input rejects unknown/private fields, noncanonical key and epoch/randomness overflow", () => {
  for (const patch of [{ privateKey: "forbidden" }, { attemptId: "chosen" }, { maxEpoch: NaN }, { maxEpoch: 0 }, { jwtRandomness: "01" }, { jwtRandomness: String(2n ** 128n) }, { extendedEphemeralPublicKey: "fixture-key" }]) assert.throws(() => parseZkLoginStart({ ...input, ...patch }))
})
test("wrong owner, stale phase, expired identity and stale epoch fail before provider work", async () => {
  const h = setup(); await assert.rejects(h.service.start("other-session", input), errorCode("not_found")); assert.equal(h.stats().epochCalls, 0)
  for (const change of [(x: ReturnType<typeof setup>) => x.mutate(o => { o.phase = "identity" }), (x: ReturnType<typeof setup>) => x.mutate(o => { o.identity!.sourceCurrent = false }), (x: ReturnType<typeof setup>) => x.epoch(11)]) { const x = setup(); change(x); await assert.rejects(x.service.start(SESSION, input)); assert.equal(x.stats().proofCalls, 0) }
  await h.service.start(SESSION, input)
  const before = h.stats().epochCalls
  await assert.rejects(h.service.prove("other-session", { operationId: OP, attemptId: ATTEMPT, jwt: "header.payload.signature" }), errorCode("not_found")); assert.equal(h.stats().epochCalls, before)
})
test("duplicate concurrent proves claim once and only return saved state on replay", async () => {
  const h = setup(); await h.service.start(SESSION, input)
  let release!: () => void; h.blockProof(new Promise<void>(r => { release = r }))
  const first = h.prove(); while (!h.stats().proofCalls) await new Promise(r => setTimeout(r, 1))
  assert.equal((await h.prove()).status, "proving"); assert.equal(h.stats().proofCalls, 1)
  release(); assert.equal((await first).status, "proved")
})
test("provider uncertainty is durable, sanitized and cannot resend the proof", async () => {
  const h = setup(); await h.service.start(SESSION, input); h.failProof()
  await assert.rejects(h.prove(), e => errorCode("zklogin_attempt_unknown")(e) && !String(e).includes("sensitive-private"))
  assert.equal((await h.prove()).status, "unknown"); assert.equal(h.stats().proofCalls, 1)
  await assert.rejects(h.service.start(SESSION, { ...input, attemptId: "zkl_" + "b".repeat(24) }), errorCode("zklogin_attempt_used"))
})
test("lost commit acknowledgement recovers the proved result without another provider call", async () => {
  const h = setup(); await h.service.start(SESSION, input); h.lostCommit()
  await assert.rejects(h.prove(), errorCode("zklogin_attempt_unknown"))
  assert.equal((await h.service.status(SESSION, OP, ATTEMPT)).status, "proved"); assert.equal((await h.prove()).status, "proved"); assert.equal(h.stats().proofCalls, 1)
})
for (const stage of ["verification", "proof"] as const) test(`cancellation wins over a late ${stage} response`, async () => {
  const h = setup(); await h.service.start(SESSION, input)
  let release!: () => void; const gate = new Promise<void>(r => { release = r }); stage === "proof" ? h.blockProof(gate) : h.blockVerification(gate)
  const pending = h.prove(); while (!(stage === "proof" ? h.stats().proofCalls : h.stats().verifyCalls)) await new Promise(r => setTimeout(r, 1))
  await h.service.cancel(SESSION, { operationId: OP, attemptId: ATTEMPT }); release()
  await assert.rejects(pending, errorCode("zklogin_attempt_inactive"))
  assert.equal((await h.service.status(SESSION, OP, ATTEMPT)).status, "cancelled")
  assert.equal(h.stats().proofCalls, stage === "proof" ? 1 : 0)
})
test("expiry, proposal drift, identity revocation and configuration drift discard a late proof", async () => {
  for (const change of [(h: ReturnType<typeof setup>) => h.time(NOW + 300001), (h: ReturnType<typeof setup>) => h.mutate(o => { o.proposal!.proposalDigest = "changed" }), (h: ReturnType<typeof setup>) => h.mutate(o => { o.identity!.sourceCurrent = false }), (h: ReturnType<typeof setup>) => h.drift()]) {
    const h = setup(); await h.service.start(SESSION, input); let release!: () => void; h.blockProof(new Promise<void>(r => { release = r })); const p = h.prove(); while (!h.stats().proofCalls) await new Promise(r => setTimeout(r, 1)); change(h); release(); await assert.rejects(p); const view = await h.service.status(SESSION, OP, ATTEMPT); assert.equal(view.status, "expired"); assert.equal(view.inputs, null)
  }
})
test("explicit cancellations cannot bypass three-attempt operation cap or undo approved delegation", async () => {
  const h = setup()
  for (const char of ["a", "b", "c"]) { const attemptId = "zkl_" + char.repeat(24); await h.service.start(SESSION, { ...input, attemptId }); await h.service.cancel(SESSION, { operationId: OP, attemptId }) }
  await assert.rejects(h.service.start(SESSION, { ...input, attemptId: "zkl_" + "d".repeat(24) }), errorCode("zklogin_attempt_limit"))
  h.mutate(o => { o.phase = "agent" }); await assert.rejects(h.service.cancel(SESSION, { operationId: OP, attemptId: "zkl_" + "c".repeat(24) }), errorCode("cannot_cancel"))
})
test("JWT rejection never reaches prover and cannot be retried under the same attempt", async () => {
  const h = setup(); await h.service.start(SESSION, input); h.rejectToken(); await assert.rejects(h.prove(), errorCode("zklogin_jwt")); assert.equal((await h.prove()).status, "rejected"); assert.equal(h.stats().verifyCalls, 1); assert.equal(h.stats().proofCalls, 0)
})
test("proof schema rejects unknown fields, wrong curve coordinates and malformed claims", () => {
  assert.equal(validZkLoginInputs(proof.inputs), true)
  for (const change of [{ arbitrary: true }, { proofPoints: { ...proof.inputs.proofPoints, a: ["-1", "2", "1"] } }, { issBase64Details: { value: "a", indexMod4: 4 } }, { addressSeed: String(2n ** 255n) }, { headerBase64: "a.b" }]) assert.equal(validZkLoginInputs({ ...proof.inputs, ...change }), false)
})
test("addressSeed is bounded by Poseidon's scalar field, not the larger coordinate field", () => {
  const r = 21888242871839275222246405745257275088548364400416034343698204186575808495617n
  const p = 21888242871839275222246405745257275088696311157297823662689037894645226208583n
  assert.equal(validZkLoginInputs({ ...proof.inputs, addressSeed: String(r - 1n), proofPoints: { ...proof.inputs.proofPoints, a: [String(p - 1n), "2", "1"] } }), true)
  assert.equal(validZkLoginInputs({ ...proof.inputs, addressSeed: String(r) }), false)
  assert.equal(validZkLoginInputs({ ...proof.inputs, proofPoints: { ...proof.inputs.proofPoints, a: [String(p), "2", "1"] } }), false)
})
