#!/usr/bin/env node
// End-to-end smoke of the hackathon journey against a running app (default http://localhost:3000).
// Mock identity (sample approve) → real holder key (Node WebCrypto) → VP → proposal → demo Sui signer
// → sponsored delegation PTB → agent consume PTB → redeem → OmniOne outbox → evidence.
// usage: node scripts/hackathon-smoke.mjs [baseUrl] [--negative]
import { webcrypto as crypto } from "node:crypto"
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519"
import { fromBase64, toBase64 } from "@mysten/sui/utils"

const base = process.argv[2]?.startsWith("http") ? process.argv[2] : "http://localhost:3000"
const negative = process.argv.includes("--negative")
let cookie = ""
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

async function call(path, body) {
  const res = await fetch(`${base}/api/hackathon/v1${path}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", cookie, origin: base }, body: body === undefined ? undefined : JSON.stringify(body) })
  const setCookie = res.headers.get("set-cookie"); if (setCookie) cookie = setCookie.split(";")[0]
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${path} → ${res.status} ${JSON.stringify(data.error ?? data).slice(0, 300)}`)
  return data
}
const canonical = (v) => JSON.stringify((function s(x) { return Array.isArray(x) ? x.map(s) : x && typeof x === "object" ? Object.keys(x).sort().reduce((a, k) => { if (x[k] !== undefined) a[k] = s(x[k]); return a }, {}) : x })(v))
const b64url = (u8) => Buffer.from(u8).toString("base64url")
const sha256Hex = async (u8) => "0x" + Buffer.from(await crypto.subtle.digest("SHA-256", u8)).toString("hex")

const cfg = await call("/config"); log("config modes:", cfg.modes)
await call("/sessions", {})
const ent = await call(`/places/${cfg.campaign.venueId}/demo-entitlements`); log("entitlement supported:", ent.supported, "redeemed:", ent.redeemed)
let op = await call("/operations", { venueId: cfg.campaign.venueId, consentVersion: ent.consentVersion, locale: "ko" }); log("op", op.operationId, op.phase)
if (op.phase === "fulfillment" && op.fulfillment?.status === "blocked") { log("blocked:", op.fulfillment.reason); process.exit(0) }
if (op.phase === "identity") {
  op = await call(`/operations/${op.operationId}/identity/start`, { mobile: false }); log("handoff", op.identity?.handoff?.kind)
  const seed = negative ? "sample-person-1" : `smoke-${Date.now()}`
  op = await call(`/operations/${op.operationId}/identity/complete`, op.identity?.handoff?.kind === "mock" ? { sample: { outcome: "verified", subjectSeed: seed } } : {}); log("identity", op.identity?.mode, op.phase, op.fulfillment?.reason ?? "")
}
if (op.phase === "fulfillment" && op.fulfillment?.status === "blocked") { log("blocked (expected on --negative re-run):", op.fulfillment.reason); process.exit(0) }
// holder key
const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])
const spki = Buffer.from(await crypto.subtle.exportKey("spki", pair.publicKey)).toString("base64").replace(/(.{64})/g, "$1\n")
const pem = `-----BEGIN PUBLIC KEY-----\n${spki.trim()}\n-----END PUBLIC KEY-----\n`
const sign = async (payload) => b64url(new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, new TextEncoder().encode(payload))))
if (op.phase === "issuance") {
  const issued = await call(`/operations/${op.operationId}/credential/issue`, { publicKeyPem: pem, alg: "Ed25519" })
  const cred = issued.result.credential
  op = await call(`/operations/${op.operationId}/credential/holder-ack`, { signatureB64: await sign(canonical({ typ: "ondo-kpass-holder-ack/v1", credentialRef: cred.credentialRef, vcId: cred.vcId, holderBinding: cred.holderBinding })) })
  log("credential", cred.mode, cred.vcId, "→", op.phase)
  globalThis.__vc = issued.vc
}
if (op.phase === "presentation") {
  const req = await call(`/operations/${op.operationId}/presentation/request`, {})
  const p = req.result.presentation
  const vc = globalThis.__vc
  const disclosed = {}; for (const k of p.requestedClaims) if (vc?.credentialSubject && k in vc.credentialSubject) disclosed[k] = vc.credentialSubject[k]
  if (negative) disclosed.personVerified = "tampered"
  const vcDigest = await sha256Hex(new TextEncoder().encode(canonical(vc)))
  const payload = canonical({ typ: "ondo-kpass-vp/v1", presentationId: p.presentationId, nonce: p.nonce, audience: "ondo-hackathon-verifier", purpose: "redeem_demo_entitlement", venueId: op.venueId, campaignId: op.campaignId, vcDigest, disclosed })
  op = await call(`/operations/${op.operationId}/presentation/submit`, { presentationId: p.presentationId, disclosed, signatureB64: await sign(payload) })
  log("presentation", op.presentation?.decision, op.presentation?.denyReason ?? "", "→", op.phase)
  if (negative) { log("negative run stops here (deny expected)"); process.exit(op.presentation?.decision === "deny" ? 0 : 1) }
}
if (op.phase === "proposal") { op = await call(`/operations/${op.operationId}/proposal`, { locale: "ko" }); log("proposal", op.proposal?.mode, op.proposal?.model, "|", op.proposal?.output?.title) }
if (op.phase === "delegation") {
  const kp = Ed25519Keypair.generate()
  const message = `ondo-hk-wallet-proof:${op.operationId}:${op.presentation.decisionRef}`
  const proof = (await kp.signPersonalMessage(new TextEncoder().encode(message))).signature
  const prepared = await call(`/operations/${op.operationId}/delegation/prepare`, { userAddress: kp.toSuiAddress(), signer: "demo", walletProof: { message, signature: proof }, approvedProposalDigest: op.proposal.proposalDigest })
  log("entitlement issued", prepared.result.delegation?.entitlement?.objectId, "issueTx", prepared.result.delegation?.entitlement?.txDigest)
  const bytes = fromBase64(prepared.txBytesB64)
  const userSignature = (await kp.signTransaction(bytes)).signature
  op = await call(`/operations/${op.operationId}/delegation/submit`, { txBytesDigest: await sha256Hex(bytes), userSignature })
  log("delegation", op.delegation?.status, "grant", op.delegation?.grant?.objectId, "tx", op.delegation?.userTxDigest, "→", op.phase)
}
if (op.phase === "agent") { op = await call(`/operations/${op.operationId}/agent/run`, {}); log("agent", op.agent?.status, "tx", op.agent?.txDigest, "record", op.agent?.recordId, "→", op.phase) }
if (op.phase === "fulfillment") { op = await call(`/operations/${op.operationId}/redeem`, { idempotencyKey: `smoke-${op.operationId}` }); log("fulfillment", op.fulfillment?.status, op.fulfillment?.reason ?? "", "ref", op.fulfillment?.redemptionRef, "chain", op.chain?.status, op.chain?.txHash ?? "", op.chain?.lastError ?? "") }
for (let i = 0; i < 5 && op.chain && op.chain.status !== "confirmed" && op.chain.status !== "failed"; i++) { await new Promise((r) => setTimeout(r, 2500)); op = await call(`/operations/${op.operationId}/reconcile`, {}); log("reconcile chain", op.chain?.status, op.chain?.txHash ?? "", op.chain?.lastError ?? "") }
const evidence = await call(`/operations/${op.operationId}/evidence`)
log("evidence provenance:", evidence.provenanceCheck, "omnione:", evidence.omnione?.status, "sui agent:", evidence.sui?.agent?.txUrl)
// duplicate redeem must return the same result, not a second use
const again = await call(`/operations/${op.operationId}/redeem`, { idempotencyKey: `smoke-${op.operationId}` }).catch((e) => ({ error: String(e) }))
log("idempotent redeem →", again.fulfillment?.redemptionRef ?? again.error)
log("DONE", op.status, op.phase)
