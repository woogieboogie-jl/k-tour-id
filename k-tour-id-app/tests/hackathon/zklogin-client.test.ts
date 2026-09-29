import test, { after, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519"
import { generateNonce } from "@mysten/sui/zklogin"
import { beginZkLogin, canBeginGoogleHere, cancelZkLogin, finishZkLogin, readSigner, writeSigner } from "../../features/ondo/hackathon-b/hackathon-client"
import { ZKLOGIN_CALLBACK, type ZkLoginAttemptView } from "../../lib/hackathon/zklogin-attempt-contract"

// Browser storage and HTTP DTO fixtures only. Never real Google tokens/proofs.
const saved = { window: Object.getOwnPropertyDescriptor(globalThis, "window"), sessionStorage: Object.getOwnPropertyDescriptor(globalThis, "sessionStorage"), fetch: globalThis.fetch }
const memory = new Map<string, string>(), calls: Array<{ path: string; body?: Record<string, unknown> }> = []
const OP = "op_client_fixture01", ATT = `zkl_${"a".repeat(24)}`, expiresAt = () => new Date(Date.now() + 300000).toISOString()
const key = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(8))
const view = (status: ZkLoginAttemptView["status"] = "pending", attemptId = ATT): ZkLoginAttemptView => ({ version: 1, operationId: OP, attemptId, status, maxEpoch: 12, expiresAt: expiresAt(), address: null, inputs: null })
const response = (data: unknown) => Response.json(data)
let handler: (path: string, body?: Record<string, unknown>) => Promise<Response>
function seed() { writeSigner(OP, { kind: "zklogin", address: "", ephemeralSecretKey: key.getSecretKey(), maxEpoch: 12, randomness: "123", nonce: generateNonce(key.getPublicKey(), 12, "123"), inputs: null, jwtPending: true, attemptId: ATT, attemptExpiresAt: expiresAt(), oauthState: `state_${"a".repeat(32)}`, proofRequestSent: false }) }
beforeEach(() => {
  memory.clear(); calls.length = 0
  const w: Record<string, unknown> = { location: { origin: "https://ktour-id.vercel.app" }, navigator: { userAgent: "Mozilla/5.0 Chrome/125.0 Safari/537.36" } }; w.top = w; w.self = w
  Object.defineProperty(globalThis, "window", { configurable: true, value: w })
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => { memory.set(k, v) }, removeItem: (k: string) => { memory.delete(k) } } })
  handler = async (path, body) => {
    if (path.endsWith("/config")) return response({ isolatedMock: false, modes: { zklogin: "google" }, sui: { googleClientId: "fixture-client" } })
    if (path.endsWith("/start")) { const s = readSigner(OP); assert.ok(s?.kind === "zklogin"); return response({ ...view("pending", String(body!.attemptId)), googleClientId: "fixture-client", redirectUri: ZKLOGIN_CALLBACK, nonce: s.nonce, oauthState: `state_${"a".repeat(32)}` }) }
    return response(view(path.endsWith("/cancel") ? "cancelled" : "unknown"))
  }
  globalThis.fetch = async (url, init) => { const path = String(url), body = init?.body ? JSON.parse(String(init.body)) : undefined; calls.push({ path, body }); return handler(path, body) }
})
after(() => { globalThis.fetch = saved.fetch; for (const name of ["window", "sessionStorage"] as const) { const d = saved[name]; if (d) Object.defineProperty(globalThis, name, d); else Reflect.deleteProperty(globalThis, name) } })
test("only exact main top-level supported browser may start; WK/native bridges do not invoke getters", async () => {
  assert.equal(canBeginGoogleHere(), true)
  Object.defineProperty(window, "ktourNative", { configurable: true, get() { assert.fail("bridge getter must not run") } })
  assert.equal(canBeginGoogleHere(), false); await assert.rejects(beginZkLogin(OP, "fixture-client", 12)); assert.equal(calls.length, 0)
  Reflect.deleteProperty(window, "ktourNative")
  Object.assign(window.navigator, { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) AppleWebKit/605.1.15 Mobile/15E148" }); assert.equal(canBeginGoogleHere(), false)
  Object.assign(window.navigator, { userAgent: "Mozilla/5.0 iPhone AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1" }); assert.equal(canBeginGoogleHere(), true)
  Object.assign(window.location, { origin: "https://preview.vercel.app" }); assert.equal(canBeginGoogleHere(), false)
})
test("explicit start binds fresh SDK key/nonce and server state to exact redirect; no execution call", async () => {
  const url = new URL(await beginZkLogin(OP, "fixture-client", 12)), s = readSigner(OP)
  assert.ok(s?.kind === "zklogin"); assert.equal(url.origin, "https://accounts.google.com"); assert.equal(url.searchParams.get("redirect_uri"), ZKLOGIN_CALLBACK); assert.equal(url.searchParams.get("nonce"), s.nonce); assert.equal(url.searchParams.get("state"), s.oauthState)
  assert.deepEqual(Object.keys(calls[1].body!).sort(), ["attemptId", "extendedEphemeralPublicKey", "jwtRandomness", "maxEpoch", "operationId"].sort()); assert.equal(JSON.stringify(calls).includes(s.ephemeralSecretKey), false)
  await assert.rejects(beginZkLogin(OP, "fixture-client", 12)); assert.equal(calls.filter(c => c.path.endsWith("/start")).length, 1)
})
test("lost start response retains known handle; late response cannot replace newer/closed intent", async () => {
  const original = handler; handler = async (path, body) => path.endsWith("/start") ? Promise.reject(new Error("private upstream sentinel")) : original(path, body)
  await assert.rejects(beginZkLogin(OP, "fixture-client", 12), e => !String(e).includes("private upstream")); const s = readSigner(OP); assert.ok(s?.kind === "zklogin" && s.attemptId)
  writeSigner(OP, null); let current = true
  handler = async (path, body) => { const res = await original(path, body); if (path.endsWith("/start")) current = false; return res }
  await assert.rejects(beginZkLogin(OP, "fixture-client", 12, () => current), /closed/); const closed = readSigner(OP); assert.ok(closed?.kind === "zklogin"); assert.equal(closed.oauthState, undefined)
})
test("proof transport uncertainty removes token before sending and reload/check only GETs", async () => {
  seed(); memory.set(`ondo-b.hackathon.jwt:${OP}`, "fixture.payload.signature")
  handler = async path => { if (path.endsWith("/prove")) { assert.equal(memory.has(`ondo-b.hackathon.jwt:${OP}`), false); throw Error("private upstream") }; return response(view("unknown")) }
  await assert.rejects(finishZkLogin(OP, "fixture.payload.signature")); await assert.rejects(finishZkLogin(OP, "fixture.payload.signature")); await assert.rejects(finishZkLogin(OP))
  assert.equal(calls.filter(c => c.path.endsWith("/prove")).length, 1); assert.equal(calls.filter(c => c.path.includes("/status/")).length, 2)
  const sent = readSigner(OP); assert.ok(sent?.kind === "zklogin"); assert.equal(sent.proofRequestSent, true)
})
test("mismatched DTO/key and closed response never create a ready signer", async () => {
  seed(); handler = async () => response({ ...view("pending"), attemptId: `zkl_${"b".repeat(24)}` }); await assert.rejects(finishZkLogin(OP), /does not match/)
  seed(); const s = readSigner(OP); assert.ok(s?.kind === "zklogin"); writeSigner(OP, { ...s, nonce: "other" }); const before = calls.length; await assert.rejects(finishZkLogin(OP, "fixture.payload.signature"), /binding/); assert.equal(calls.length, before)
  seed(); handler = async () => { writeSigner(OP, null); return response(view("pending")) }; await assert.rejects(finishZkLogin(OP), /closed/); assert.equal(readSigner(OP), null)
})
test("cancel is explicit and cannot clear a newer attempt; unknown cancellation retains original key", async () => {
  seed(); const s = readSigner(OP); assert.ok(s?.kind === "zklogin")
  handler = async () => { writeSigner(OP, { ...s, attemptId: `zkl_${"b".repeat(24)}` }); return response(view("cancelled")) }; await cancelZkLogin(OP); const newer = readSigner(OP); assert.ok(newer?.kind === "zklogin"); assert.equal(newer.attemptId, `zkl_${"b".repeat(24)}`)
  seed(); handler = async () => { throw Error("lost") }; await assert.rejects(cancelZkLogin(OP)); assert.equal(readSigner(OP)?.kind, "zklogin")
  handler = async () => response(view("cancelled")); await cancelZkLogin(OP); assert.equal(readSigner(OP), null)
})
test("only authoritative absence discards an uncommitted local start draft", async () => {
  seed(); const s = readSigner(OP); assert.ok(s?.kind === "zklogin"); writeSigner(OP, { ...s, attemptExpiresAt: undefined })
  handler = async () => Response.json({ error: { code: "not_found" } }, { status: 404 }); await cancelZkLogin(OP); assert.equal(readSigner(OP), null)
  seed(); await assert.rejects(cancelZkLogin(OP)); assert.equal(readSigner(OP)?.kind, "zklogin")
})
test("expired cached login cannot look ready or send its token again", async () => {
  seed(); const s = readSigner(OP); assert.ok(s?.kind === "zklogin")
  writeSigner(OP, { ...s, attemptExpiresAt: new Date(Date.now() - 1000).toISOString(), jwtPending: false, proofState: "proved", address: "0x" + "a".repeat(64) })
  const expired = readSigner(OP); assert.ok(expired?.kind === "zklogin"); assert.equal(expired.jwtPending, true); assert.equal(expired.address, ""); assert.equal(expired.inputs, null)
  handler = async () => response(view("expired")); await assert.rejects(finishZkLogin(OP, "fixture.payload.signature")); assert.equal(calls.length, 1); assert.ok(calls[0].path.includes("/status/"))
})
