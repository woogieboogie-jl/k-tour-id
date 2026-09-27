import assert from "node:assert/strict"
import { test } from "node:test"
import { ApiError, clearZkLoginOAuthAttempt, clearZkLoginReturn, isTerminalZkLoginError } from "../../features/ondo/hackathon-b/hackathon-client"
import { readOAuthReturn } from "../../features/ondo/hackathon-b/hackathon-oauth-return"

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
  clear() { this.values.clear() }
}

test("OAuth return accepts only the pending state's compact JWT shape", () => {
  assert.deepEqual(readOAuthReturn("#state=expected&id_token=header.payload.signature", "", "expected"), {
    status: "accepted", token: "header.payload.signature",
  })
  assert.deepEqual(readOAuthReturn("#state=other&id_token=header.payload.signature", "", "expected"), { status: "invalid" })
  assert.deepEqual(readOAuthReturn("#state=expected&id_token=header.payload.signature", "?state=expected", "expected"), { status: "accepted", token: "header.payload.signature" })
})

test("cancelled, malformed, expired, and other-tab returns fail closed", () => {
  assert.deepEqual(readOAuthReturn("#error=access_denied&state=expected", "", "expected"), { status: "cancelled" })
  assert.deepEqual(readOAuthReturn("#state=expected&id_token=not-a-jwt", "", "expected"), { status: "invalid" })
  assert.deepEqual(readOAuthReturn("#state=expected&id_token=header.payload.signature", "", undefined), { status: "invalid" })
  assert.deepEqual(readOAuthReturn("#state=expected&id_token=header.payload.signature", "", "expired-state"), { status: "invalid" })
  assert.deepEqual(readOAuthReturn("#state=expected&id_token=header.payload.signature", "", "expected&other"), { status: "invalid" })
})

test("ending an OAuth attempt clears only its one-time state, not the ephemeral signer", () => {
  const storage = new MemoryStorage()
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: storage })
  const operationId = "op-zklogin-return-fixture"
  storage.setItem(`ondo-b.hackathon.signer.v1:${operationId}`, JSON.stringify({
    kind: "zklogin", address: "", ephemeralSecretKey: "fixture-key", maxEpoch: 9,
    randomness: "fixture-randomness", inputs: null, nonce: "fixture-nonce", jwtPending: true, oauthState: "one-time-state",
  }))
  clearZkLoginOAuthAttempt(operationId)
  const signer = JSON.parse(storage.getItem(`ondo-b.hackathon.signer.v1:${operationId}`) ?? "null")
  assert.equal(signer.oauthState, undefined)
  assert.equal(signer.ephemeralSecretKey, "fixture-key")
  assert.equal(storage.getItem(`ondo-b.hackathon.jwt:${operationId}`), null)
})

test("terminal proof rejection clears the callback token, while provider transport errors remain retryable", () => {
  assert.equal(isTerminalZkLoginError(new ApiError("zklogin_exp", "expired", 400, false)), true)
  assert.equal(isTerminalZkLoginError(new ApiError("zklogin_aud", "audience", 400, false)), true)
  assert.equal(isTerminalZkLoginError(new ApiError("zklogin_enoki", "provider", 502, true)), false)
  assert.equal(isTerminalZkLoginError(new Error("network")), false)

  const storage = new MemoryStorage()
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: storage })
  const operationId = "op-zklogin-terminal-fixture"
  storage.setItem(`ondo-b.hackathon.jwt:${operationId}`, "rejected-token")
  storage.setItem(`ondo-b.hackathon.signer.v1:${operationId}`, JSON.stringify({
    kind: "zklogin", address: "", ephemeralSecretKey: "fixture-key", maxEpoch: 9,
    randomness: "fixture-randomness", inputs: null, nonce: "fixture-nonce", jwtPending: true, oauthState: "one-time-state",
  }))
  clearZkLoginReturn(operationId)
  assert.equal(storage.getItem(`ondo-b.hackathon.jwt:${operationId}`), null)
  assert.equal(JSON.parse(storage.getItem(`ondo-b.hackathon.signer.v1:${operationId}`) ?? "null").oauthState, undefined)
  assert.equal(JSON.parse(storage.getItem(`ondo-b.hackathon.signer.v1:${operationId}`) ?? "null").ephemeralSecretKey, "fixture-key")
})
