// Operation-owned proving attempts: durable claim before provider work, read-only
// recovery after a lost response. Never stores a JWT, subject, salt or private key.
import { Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519"
import { generateNonce } from "@mysten/sui/zklogin"
import { fromBase64, toBase64 } from "@mysten/sui/utils"
import { withStore, readStore, type Db, type OperationRecord } from "./store"
import { assert, digestOf, HkError, randomId } from "./util"
import { currentEpoch } from "./adapters/sui"
import { proveZkLogin } from "./adapters/zklogin"
import { credentialEligibility, presentationEligibility } from "./operation-evidence"
import { assertJitImportedIdentity } from "./jit-identity-import"
import { verifyGoogleToken } from "./zklogin-google-token"
import { ZKLOGIN_CALLBACK, ZKLOGIN_ATTEMPT_ID, ZKLOGIN_OPERATION_ID, validZkLoginInputs, type ZkLoginStart, type ZkLoginAttemptView, type ZkLoginStarted } from "./zklogin-attempt-contract"
import { zkLoginOperationBinding as binding, currentZkLoginConfig } from "./zklogin-signing-policy"
export { assertZkLoginSigningAttempt } from "./zklogin-signing-policy"

export type ZkLoginAttempt = ZkLoginStart & { version: 1; attemptId: string; sequence: number; status: ZkLoginAttemptView["status"]; binding: string; configBinding: string; nonce: string; oauthState: string; expiresAt: string; address: string | null; inputs: ZkLoginAttemptView["inputs"] }
type Ports = {
  atomic: <T>(f: (db: Db) => T) => Promise<T>; read: <T>(f: (db: Db) => T) => Promise<T>;
  config: () => { googleClientId: string; binding: string }; epoch: () => Promise<number>; now?: () => number;
  validate: (db: Db, op: OperationRecord, now: number) => void;
  verifyToken: (jwt: string, expected: { audience: string; nonce: string }) => Promise<unknown>;
  prove: typeof proveZkLogin;
}
const fail = (code: string, message: string, status = 409) => new HkError(code, message, status, false)
const exact = (v: unknown, keys: string[]): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k))
function ids(operationId: unknown, attemptId?: unknown) {
  assert(typeof operationId === "string" && ZKLOGIN_OPERATION_ID.test(operationId) && (attemptId === undefined || (typeof attemptId === "string" && ZKLOGIN_ATTEMPT_ID.test(attemptId))), "bad_request", "Invalid sign-in scope")
}
export function parseZkLoginStart(body: unknown): ZkLoginStart {
  if (!exact(body, ["operationId", "attemptId", "extendedEphemeralPublicKey", "maxEpoch", "jwtRandomness"])) throw fail("bad_request", "Invalid sign-in request", 400)
  ids(body.operationId, body.attemptId)
  assert(typeof body.extendedEphemeralPublicKey === "string" && body.extendedEphemeralPublicKey.length <= 256 && typeof body.jwtRandomness === "string" && /^(0|[1-9][0-9]{0,38})$/.test(body.jwtRandomness) && BigInt(body.jwtRandomness) < 2n ** 128n && Number.isSafeInteger(body.maxEpoch) && Number(body.maxEpoch) > 0, "bad_request", "Invalid sign-in parameters")
  try { const bytes = fromBase64(body.extendedEphemeralPublicKey); if (bytes.length !== 33 || bytes[0] !== 0 || toBase64(bytes) !== body.extendedEphemeralPublicKey) throw Error() } catch { throw fail("bad_request", "Invalid ephemeral public key", 400) }
  return body as ZkLoginStart
}
const view = (a: ZkLoginAttempt, status = a.status): ZkLoginAttemptView => ({ version: 1, operationId: a.operationId, attemptId: a.attemptId, status, expiresAt: a.expiresAt, maxEpoch: a.maxEpoch, address: status === "proved" ? a.address : null, inputs: status === "proved" ? a.inputs : null })

export function createZkLoginAttempts(ports: Ports) {
  const now = ports.now ?? Date.now
  function operation(db: Db, sessionId: string, operationId: string) {
    const op = db.operations[operationId]
    assert(op?.sessionId === sessionId && db.sessions[sessionId], "not_found", "Operation not found", 404)
    return op
  }
  function active(db: Db, op: OperationRecord) {
    assert(op.status === "pending" && op.phase === "delegation" && !op.delegation && op.proposal && op.presentation?.decision === "allow" && Date.parse(op.expiresAt) > now(), "zklogin_attempt_inactive", "This sign-in no longer belongs to an active approval", 409)
    ports.validate(db, op, now())
  }
  function matches(db: Db, op: OperationRecord, a: ZkLoginAttempt) {
    active(db, op)
    assert(a.binding === binding(op) && a.configBinding === ports.config().binding && Date.parse(a.expiresAt) > now(), "zklogin_attempt_inactive", "The sign-in context changed or expired", 409)
  }
  return {
    async start(sessionId: string, input: unknown): Promise<ZkLoginStarted> {
      const body = parseZkLoginStart(input), config = ports.config()
      await ports.read(db => active(db, operation(db, sessionId, body.operationId)))
      const epoch = await ports.epoch()
      assert(Number.isSafeInteger(epoch) && epoch >= 0 && body.maxEpoch === epoch + 2, "zklogin_epoch", "The sign-in epoch changed. Refresh before starting.", 409)
      return ports.atomic(db => {
        const op = operation(db, sessionId, body.operationId); active(db, op)
        assert(config.binding === ports.config().binding, "zklogin_attempt_inactive", "Sign-in configuration changed", 409)
        const old = op.secrets.zkLoginAttempt
        assert(!old || old.attemptId !== body.attemptId, "zklogin_attempt_used", "This sign-in attempt identifier was already used", 409)
        // An unresolved request is never silently replaced, even after a page reload.
        if (old && ["pending", "proving", "unknown", "proved"].includes(old.status) && Date.parse(old.expiresAt) > now()) throw fail("zklogin_attempt_used", "Check or cancel the existing sign-in before starting another")
        const sequence = (old?.sequence ?? 0) + 1
        assert(sequence <= 3, "zklogin_attempt_limit", "This operation has reached its sign-in attempt limit", 429)
        const expires = Math.min(now() + 10 * 60_000, Date.parse(op.expiresAt), Date.parse(op.identity!.expiresAt), Date.parse(op.credential!.validUntil), Date.parse(op.presentation!.decisionExpiresAt!))
        assert(Number.isFinite(expires) && expires > now(), "zklogin_attempt_inactive", "This sign-in approval expired", 409)
        const bytes = fromBase64(body.extendedEphemeralPublicKey)
        const a: ZkLoginAttempt = { ...body, version: 1, sequence, status: "pending", binding: binding(op), configBinding: config.binding, nonce: generateNonce(new Ed25519PublicKey(bytes.slice(1)), body.maxEpoch, body.jwtRandomness), oauthState: randomId("state", 24), expiresAt: new Date(expires).toISOString(), address: null, inputs: null }
        op.secrets.zkLoginAttempt = a
        return { ...view(a), googleClientId: config.googleClientId, redirectUri: ZKLOGIN_CALLBACK, nonce: a.nonce, oauthState: a.oauthState }
      })
    },
    async status(sessionId: string, operationId: string, attemptId: string): Promise<ZkLoginAttemptView> {
      ids(operationId, attemptId)
      return ports.read(db => {
        const op = operation(db, sessionId, operationId), a = op.secrets.zkLoginAttempt
        assert(a?.attemptId === attemptId, "not_found", "Sign-in attempt not found", 404)
        if (a.status === "cancelled") return view(a)
        try { matches(db, op, a) } catch { return view(a, "expired") }
        return view(a)
      })
    },
    async cancel(sessionId: string, input: unknown): Promise<ZkLoginAttemptView> {
      if (!exact(input, ["operationId", "attemptId"])) throw fail("bad_request", "Invalid sign-in cancellation", 400)
      ids(input.operationId, input.attemptId)
      return ports.atomic(db => {
        const op = operation(db, sessionId, input.operationId as string), a = op.secrets.zkLoginAttempt
        assert(a && a.attemptId === input.attemptId, "not_found", "Sign-in attempt not found", 404)
        // Cancelling login does not undo an approved or broadcast Sui transaction.
        assert(!op.delegation && !["agent", "fulfillment", "done"].includes(op.phase), "cannot_cancel", "Sign-in cannot be cancelled after execution approval", 409)
        a.status = "cancelled"; a.address = null; a.inputs = null
        return view(a)
      })
    },
    async prove(sessionId: string, input: unknown): Promise<ZkLoginAttemptView> {
      if (!exact(input, ["operationId", "attemptId", "jwt"])) throw fail("bad_request", "Invalid proof request", 400)
      ids(input.operationId, input.attemptId)
      assert(typeof input.jwt === "string" && input.jwt.length <= 8192 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(input.jwt), "zklogin_jwt", "Invalid login token")
      const config = ports.config()
      await ports.read(db => { const op = operation(db, sessionId, input.operationId as string), a = op.secrets.zkLoginAttempt; assert(a && a.attemptId === input.attemptId, "not_found", "Sign-in attempt not found", 404); matches(db, op, a) })
      const epoch = await ports.epoch()
      const claimed = await ports.atomic(db => {
        const op = operation(db, sessionId, input.operationId as string), a = op.secrets.zkLoginAttempt
        assert(a && a.attemptId === input.attemptId, "not_found", "Sign-in attempt not found", 404)
        matches(db, op, a)
        assert(Number.isSafeInteger(epoch) && epoch >= 0 && epoch <= a.maxEpoch && a.maxEpoch <= epoch + 2, "zklogin_epoch", "This sign-in epoch expired", 409)
        if (a.status !== "pending") return { already: true as const, attempt: structuredClone(a) }
        a.status = "proving" // Commit before verification/provider I/O. No retry after an unknown result.
        return { already: false as const, attempt: structuredClone(a) }
      })
      if (claimed.already) return view(claimed.attempt)
      const a = claimed.attempt
      try {
        await ports.verifyToken(input.jwt, { audience: config.googleClientId, nonce: a.nonce })
        // Recheck cancellation, expiry and identity drift after Google key retrieval.
        await ports.read(db => { const op = operation(db, sessionId, a.operationId); matches(db, op, a); assert(op.secrets.zkLoginAttempt?.attemptId === a.attemptId && op.secrets.zkLoginAttempt.status === "proving", "zklogin_attempt_inactive", "Sign-in was cancelled", 409) })
        const proof = await ports.prove({ jwt: input.jwt, extendedEphemeralPublicKey: a.extendedEphemeralPublicKey, maxEpoch: a.maxEpoch, jwtRandomness: a.jwtRandomness })
        assert(/^0x[0-9a-f]{64}$/.test(proof.address) && validZkLoginInputs(proof.inputs), "zklogin_prover", "The proof response could not be verified", 502)
        return await ports.atomic(db => {
          const op = operation(db, sessionId, a.operationId); matches(db, op, a)
          const current = op.secrets.zkLoginAttempt
          assert(current?.attemptId === a.attemptId && current.status === "proving", "zklogin_attempt_inactive", "The sign-in attempt changed", 409)
          current.status = "proved"; current.address = proof.address; current.inputs = proof.inputs
          return view(current)
        })
      } catch (error) {
        // Do not replace a completed commit after a lost acknowledgement, or a cancellation.
        await ports.atomic(db => { const op = db.operations[a.operationId], current = op?.secrets.zkLoginAttempt; if (op?.sessionId === sessionId && current?.attemptId === a.attemptId && current.status === "proving") current.status = error instanceof HkError && error.code === "zklogin_jwt" ? "rejected" : "unknown" }).catch(() => {})
        throw error instanceof HkError ? error : fail("zklogin_attempt_unknown", "The sign-in result is uncertain. Check this attempt; do not resubmit.", 503)
      }
    },
  }
}
export const zkLoginAttempts = createZkLoginAttempts({
  atomic: withStore, read: readStore, epoch: currentEpoch, verifyToken: verifyGoogleToken, prove: proveZkLogin,
  config: currentZkLoginConfig,
  validate: (db, op, now) => {
    assertJitImportedIdentity(db, op)
    assert(db.sessions[op.sessionId]?.subjectRef === op.identity?.subjectRef && credentialEligibility(op, now) === null && presentationEligibility(op) === null && Date.parse(op.presentation?.decisionExpiresAt ?? "") > now, "zklogin_attempt_inactive", "Current identity and presentation evidence are required", 409)
  },
})
