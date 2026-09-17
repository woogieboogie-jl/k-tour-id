// OpenDID adapter — K-Pass VC issuance, holder binding, VP verification (+5%).
//
// mode "opendid": blocked until issuance completion, holder binding and server-side
//   verifier result polling are implemented and pinned to the provider release.
//   An offer or client submission marker is never an issued/verified credential.
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
    throw new HkError("opendid_provider_unimplemented", "OpenDID provider issuance and verification are not implemented; no provider credential was issued", 503)
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

/** Provider entrypoints intentionally fail closed until the complete lifecycle exists. */
export async function verifierRequestOffer(opts: { operationId: string }): Promise<{ offer: unknown; verifierRef: string }> {
  void opts
  throw new HkError("opendid_provider_unimplemented", "OpenDID server-side verifier lifecycle is not implemented", 503)
}
export async function verifierConfirm(verifierRef: string): Promise<"pending" | "verified" | "failed"> {
  void verifierRef
  throw new HkError("opendid_provider_unimplemented", "OpenDID server-side verifier lifecycle is not implemented", 503)
}
