// OpenDID adapter — K-Pass VC issuance, holder binding, VP verification (+5%).
//
// mode "opendid": OmniOne Open DID V2.0.0.0 servers (did-issuer-server /
//   did-verifier-server). Issuance = Issuer P210 offer (QR) → holder CA app →
//   poll `issue-vc/result`. Presentation = Verifier P310 `request-offer-qr` →
//   holder app submits VP → `confirm-verify` polled by this server.
//   Endpoint paths follow the published V2 API docs; request/response field
//   names must be pinned to the team's release (see docs/HACKATHON_INTEGRATION_*).
// mode "mock":  issuer = this server (Ed25519 key derived from HK_ISSUER_SIGNING_SEED),
//   holder = the browser (WebCrypto keypair registered at holder-ack).
//   Signatures, nonce/audience binding, expiry and status are REAL checks;
//   only the trust roots are sample. UI labels it SIMULATION.
import { createPrivateKey, createPublicKey, sign as nodeSign, verify as nodeVerify, createHash } from "node:crypto"
import { hkConfig, HK_SCHEMA_VERSION, HK_SERVICE_ACCESS, HK_TTL } from "../config"
import { canonicalJson, digestOf, nowIso, plusMs, randomId, HkError } from "../util"
import type { CredentialSummary } from "../types"

// ── mock issuer key (deterministic from seed) ──────────────────────────
function issuerKeyPair() {
  const seed = createHash("sha256").update(`opendid-issuer:${hkConfig().opendid.signingSeed}`).digest()
  const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed])
  const priv = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" })
  const pub = createPublicKey(priv)
  return { priv, pubPem: pub.export({ format: "pem", type: "spki" }).toString() }
}

export type KPassVc = {
  "@context": string[]
  id: string
  type: string[]
  issuer: string
  issuanceDate: string
  expirationDate: string
  credentialSubject: {
    holderBinding: string           // sha256 of holder public key (SPKI PEM) — no DID/PII
    issuerRef: string
    schemaVersion: string
    personVerified: true
    serviceAccess: string[]
    validFrom: string
    validUntil: string
    policyVersion: number
    statusRef: string
    subjectCommitment: string       // keyed hash of subjectRef; never the subjectRef itself
  }
  proof: { type: "Ed25519Signature2020-sample"; created: string; verificationMethod: string; proofValue: string }
}

export type IssueInput = { operationId: string; subjectRef: string; holderPublicKeyPem: string; holderKeyAlg: "Ed25519" | "ECDSA-P256"; evidenceId: string }

export async function issueCredential(input: IssueInput): Promise<{ summary: CredentialSummary; document: unknown; offer?: unknown }> {
  const c = hkConfig().opendid
  const validFrom = nowIso(), validUntil = plusMs(HK_TTL.credentialMs)
  const statusRef = randomId("status")
  const vcId = `urn:ondo:kpass:${randomId("vc", 10)}`
  const holderBinding = digestOf({ spki: input.holderPublicKeyPem, alg: input.holderKeyAlg })
  if (c.mode === "opendid") {
    // Issuer-initiated offer: the real holder (CA app) completes P210 with the TAS.
    const res = await fetch(`${c.issuerUrl}/issuer/api/v1/request-offer`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vcPlanId: c.vcPlanId, offerType: "QR", reference: input.operationId }), signal: AbortSignal.timeout(15_000) })
    if (!res.ok) throw new HkError("opendid_issuer", `issuer request-offer ${res.status}`, 502, true)
    const offer = await res.json()
    return { offer, document: null, summary: {
      credentialRef: randomId("cred"), vcId: String(offer.offerId ?? vcId), schema: HK_SCHEMA_VERSION, mode: "opendid", issuerDid: c.issuerDid,
      holderBinding, serviceAccess: [HK_SERVICE_ACCESS], validFrom, validUntil, statusRef, status: "unknown", holderAckAt: null,
    } }
  }
  const { priv, pubPem } = issuerKeyPair()
  const subjectCommitment = digestOf({ subject: input.subjectRef, seed: createHash("sha256").update(c.signingSeed).digest("hex") })
  const unsigned = {
    "@context": ["https://www.w3.org/ns/credentials/v2", "urn:ondo:kpass:context:v1"],
    id: vcId, type: ["VerifiableCredential", "KPassHackathonCredential"], issuer: c.issuerDid, issuanceDate: validFrom, expirationDate: validUntil,
    credentialSubject: { holderBinding, issuerRef: c.issuerDid, schemaVersion: HK_SCHEMA_VERSION, personVerified: true as const, serviceAccess: [HK_SERVICE_ACCESS], validFrom, validUntil, policyVersion: hkConfig().campaign.policyVersion, statusRef, subjectCommitment },
  }
  const proofValue = nodeSign(null, Buffer.from(canonicalJson(unsigned)), priv).toString("base64url")
  const vc: KPassVc = { ...unsigned, proof: { type: "Ed25519Signature2020-sample", created: validFrom, verificationMethod: `${c.issuerDid}#key-1`, proofValue } }
  void pubPem
  return { document: vc, summary: {
    credentialRef: randomId("cred"), vcId, schema: HK_SCHEMA_VERSION, mode: "mock", issuerDid: c.issuerDid,
    holderBinding, serviceAccess: [HK_SERVICE_ACCESS], validFrom, validUntil, statusRef, status: "active", holderAckAt: null,
  } }
}

export function verifyIssuerSignature(vc: KPassVc): boolean {
  const { proof, ...unsigned } = vc
  const { pubPem } = issuerKeyPair()
  try { return nodeVerify(null, Buffer.from(canonicalJson(unsigned)), createPublicKey(pubPem), Buffer.from(proof.proofValue, "base64url")) } catch { return false }
}

/** Holder proof payload the browser signs (mock holder). */
export function presentationPayload(p: { presentationId: string; nonce: string; audience: string; purpose: string; venueId: string; campaignId: string; vcDigest: string; disclosed: Record<string, unknown> }) {
  return canonicalJson({ typ: "ondo-kpass-vp/v1", ...p })
}

export function verifyHolderSignature(opts: { alg: "Ed25519" | "ECDSA-P256"; publicKeyPem: string; payload: string; signatureB64: string }): boolean {
  try {
    const key = createPublicKey(opts.publicKeyPem)
    const sig = Buffer.from(opts.signatureB64, "base64url")
    if (opts.alg === "Ed25519") return nodeVerify(null, Buffer.from(opts.payload), key, sig)
    return nodeVerify("sha256", Buffer.from(opts.payload), { key, dsaEncoding: "ieee-p1363" }, sig)
  } catch { return false }
}

/** Real-verifier variant (opendid mode): start a VP request and poll it. */
export async function verifierRequestOffer(opts: { operationId: string }): Promise<{ offer: unknown; verifierRef: string }> {
  const c = hkConfig().opendid
  const res = await fetch(`${c.verifierUrl}/verifier/api/v1/request-offer-qr`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ policyId: c.policyId, reference: opts.operationId }), signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new HkError("opendid_verifier", `verifier request-offer-qr ${res.status}`, 502, true)
  const offer = await res.json()
  return { offer, verifierRef: String(offer.offerId ?? offer.txId ?? "") }
}
export async function verifierConfirm(verifierRef: string): Promise<"pending" | "verified" | "failed"> {
  const c = hkConfig().opendid
  const res = await fetch(`${c.verifierUrl}/verifier/api/v1/confirm-verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ offerId: verifierRef }), signal: AbortSignal.timeout(15_000) })
  if (res.status === 404 || res.status === 425) return "pending"
  if (!res.ok) return "failed"
  const json = await res.json().catch(() => ({}))
  return json?.result === true || json?.status === "VERIFIED" ? "verified" : json?.status === "PENDING" ? "pending" : "failed"
}
