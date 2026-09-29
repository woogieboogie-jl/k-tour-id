import assert from "node:assert/strict"
import { after, before, beforeEach, test } from "node:test"
import { assertZkLoginSigningAttempt, currentZkLoginConfig, zkLoginOperationBinding } from "../../lib/hackathon/zklogin-signing-policy"
import { CONNECTED_PIN } from "../../lib/hackathon/hosted-sui-profile"
import { env, fixture, now } from "./fixtures/hosted-omnione.fixture"
import { HkError } from "../../lib/hackathon/util"
const saved = { ...process.env }, address = "0x" + "8".repeat(64)
const testEnv = { ...env(), HK_HOSTED_ZKLOGIN_ENABLED: "1", NEXT_PUBLIC_GOOGLE_CLIENT_ID: CONNECTED_PIN.googleClientId,
  HK_ZKLOGIN_SALT_SEED: "b".repeat(64), HK_ZKLOGIN_PROVER_URL: CONNECTED_PIN.prover }
function clear() { for (const key of Object.keys(process.env)) if (key === "VERCEL" || /^(VERCEL_|HK_|NEXT_PUBLIC_HK_|NEXT_PUBLIC_GOOGLE_|GOOGLE_|GEMINI_|ENOKI_|KV_|UPSTASH_)/.test(key)) delete process.env[key] }
before(() => clear())
beforeEach(() => { clear(); Object.assign(process.env, testEnv) })
after(() => { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved) })
function prepared() {
  const { op } = fixture(); op.status = "pending"; op.phase = "delegation"; op.agent = null; op.fulfillment = null; op.chain = null
  op.secrets.zkLoginAttempt = { version: 1, operationId: op.operationId, attemptId: "zkl_" + "a".repeat(24), sequence: 1, status: "proved",
    binding: zkLoginOperationBinding(op), configBinding: currentZkLoginConfig().binding, expiresAt: new Date(now + 60_000).toISOString(), address,
    extendedEphemeralPublicKey: "fixture", maxEpoch: 100, jwtRandomness: "1", nonce: "fixture", oauthState: "fixture",
    inputs: { proofPoints: { a: ["1", "2", "3"], b: [["1", "2"], ["3", "4"], ["5", "6"]], c: ["1", "2", "3"] }, issBase64Details: { value: "fixture", indexMod4: 0 }, headerBase64: "fixture", addressSeed: "1" } }
  return op
}
const denied = (e: unknown) => e instanceof HkError && ["zklogin_attempt_inactive", "zklogin_unconfigured"].includes(e.code)
test("connected signing requires the current owned proved attempt without provider calls", () => {
  const op = prepared()
  assert.doesNotThrow(() => assertZkLoginSigningAttempt(op, address, now))
  delete op.secrets.zkLoginAttempt
  assert.throws(() => assertZkLoginSigningAttempt(op, address, now), denied)
})
test("cancelled/unknown/proving/expired attempts, changed recipient or missing proof cannot sign", () => {
  for (const status of ["cancelled", "unknown", "proving", "expired", "pending", "rejected"] as const) {
    const op = prepared(); op.secrets.zkLoginAttempt!.status = status
    assert.throws(() => assertZkLoginSigningAttempt(op, address, now), denied)
  }
  const op = prepared()
  assert.throws(() => assertZkLoginSigningAttempt(op, "0x" + "9".repeat(64), now), denied)
  assert.throws(() => assertZkLoginSigningAttempt(op, address, now + 60_000), denied)
  op.secrets.zkLoginAttempt!.inputs = null
  assert.throws(() => assertZkLoginSigningAttempt(op, address, now), denied)
})
test("current operation, imported identity, explicit consent and signer configuration cannot drift", () => {
  for (const change of [
    (op: ReturnType<typeof prepared>) => { op.sessionId += "other" },
    (op: ReturnType<typeof prepared>) => { op.campaignId += "other" },
    (op: ReturnType<typeof prepared>) => { op.identity!.sourceCurrent = false },
    (op: ReturnType<typeof prepared>) => { op.secrets.identityImportInvalid = true },
    (op: ReturnType<typeof prepared>) => { op.consent = { version: "changed", digest: "changed", acceptedAt: op.createdAt } },
    (op: ReturnType<typeof prepared>) => { op.phase = "agent" },
  ]) { const op = prepared(); change(op); assert.throws(() => assertZkLoginSigningAttempt(op, address, now), denied) }
  const op = prepared(); process.env.HK_ZKLOGIN_SALT_SEED = "c".repeat(64)
  assert.throws(() => assertZkLoginSigningAttempt(op, address, now), denied)
  process.env.HK_ZKLOGIN_SALT_SEED = testEnv.HK_ZKLOGIN_SALT_SEED; process.env.HK_HOSTED_ZKLOGIN_ENABLED = "0"
  assert.throws(() => assertZkLoginSigningAttempt(op, address, now), denied)
})
test("historical non-hosted zkLogin has no new authority requirement; an existing attempt cannot bypass cancellation", () => {
  const op = prepared(); process.env.NEXT_PUBLIC_HK_HOSTED_SUI = "0"; process.env.HK_HOSTED_SUI_ENABLED = "0"
  op.secrets.zkLoginAttempt!.status = "cancelled"
  assert.throws(() => assertZkLoginSigningAttempt(op, address, now), denied)
  delete op.secrets.zkLoginAttempt
  assert.doesNotThrow(() => assertZkLoginSigningAttempt(op, address, now))
})
