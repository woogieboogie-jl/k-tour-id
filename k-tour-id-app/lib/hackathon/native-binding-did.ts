/** Server-only OpenDID iOS SDK DIDAuth verification.
 * SDK sources pinned by the native ac9c2d31 snapshot: WalletService.swift:471-505,
 * DataModelProtocol.swift (sorted JSON), OpenSSLWrapper.m (65-byte compact P-256).
 * A valid proof is key possession, NOT a registered DID or CX identity by itself.
 */
import { createHash, createPublicKey, ECDH, verify } from "node:crypto"
import { fromBase58 } from "@mysten/bcs"
import { HkError } from "./util"

export type NativeHolderKey = { did: string; versionId: string; keyId: "pin" | "bio"; publicKeyMultibase: string; keyCommitment: string }
const fail = () => new HkError("native_binding_proof_invalid", "The holder proof could not be verified", 409)
const DID = /^did:omn:[A-Za-z0-9:_-]{8,160}$/
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/
const digest = (v: string | Uint8Array) => createHash("sha256").update(v).digest("hex")
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw fail()
  const out: Record<string, unknown> = Object.create(null)
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || key === "__proto__") throw fail()
    const d = Object.getOwnPropertyDescriptor(value, key)
    if (!d || !("value" in d)) throw fail()
    out[key] = d.value
  }
  return out
}
function exact(value: unknown, keys: string[]): Record<string, unknown> {
  const o = object(value)
  if (Object.keys(o).length !== keys.length || keys.some(k => !(k in o))) throw fail()
  return o
}
function timestamp(v: unknown): number {
  if (typeof v !== "string" || !ISO.test(v) || !Number.isFinite(Date.parse(v))) throw fail()
  return Date.parse(v)
}
export function nativeBindingCanonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value)
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(nativeBindingCanonical).join(",")}]`
  const o = object(value)
  return `{${Object.keys(o).sort().map(k => `${JSON.stringify(k)}:${nativeBindingCanonical(o[k])}`).join(",")}}`
}
function multibase58(value: unknown, size: number): Buffer {
  if (typeof value !== "string" || value.length > 160 || !/^z[1-9A-HJ-NP-Za-km-z]+$/.test(value)) throw fail()
  const bytes = Buffer.from(fromBase58(value.slice(1)))
  if (bytes.length !== size) throw fail()
  return bytes
}
function holderKey(document: unknown, keyId: "pin" | "bio"): NativeHolderKey {
  const d = object(document)
  // Pinned SDK WalletCore.createHolderDidDocument assigns the trust agent as
  // document controller. Individual verification keys remain holder controlled.
  if (typeof d.id !== "string" || !DID.test(d.id) || d.controller !== "did:omn:tas" || d.deactivated !== false || typeof d.versionId !== "string" || !/^[1-9][0-9]{0,8}$/.test(d.versionId)) throw fail()
  if (!Array.isArray(d.verificationMethod) || d.verificationMethod.length < 1 || d.verificationMethod.length > 8 || !Array.isArray(d.authentication) || d.authentication.length > 8) throw fail()
  if (!d.authentication.includes(keyId) || d.authentication.some(x => typeof x !== "string" || x.length > 180)) throw fail()
  const keys = d.verificationMethod.map(object)
  if (new Set(keys.map(k => k.id)).size !== keys.length) throw fail()
  const key = keys.find(k => k.id === keyId)
  if (!key || key.controller !== d.id || key.type !== "Secp256r1VerificationKey2018" || key.authType !== (keyId === "pin" ? 2 : 4)) throw fail()
  const publicKey = multibase58(key.publicKeyMultibase, 33)
  if (![2, 3].includes(publicKey[0])) throw fail()
  // OpenSSL checks the encoded point is actually on P-256.
  ECDH.convertKey(publicKey, "prime256v1", undefined, undefined, "uncompressed")
  const publicKeyMultibase = key.publicKeyMultibase as string
  return { did: d.id, versionId: d.versionId, keyId, publicKeyMultibase,
    keyCommitment: digest(nativeBindingCanonical({ did: d.id, versionId: d.versionId, keyId, publicKeyMultibase })) }
}

export function verifyNativeDidAuth(document: unknown, auth: unknown, expected: { authNonce: string; createdAt: string; expiresAt: string; now?: number }): NativeHolderKey {
  try {
    const now = expected.now ?? Date.now(), start = timestamp(expected.createdAt), end = timestamp(expected.expiresAt)
    if (!Number.isFinite(now) || start > now || end <= now || end - start > 15 * 60_000 || !/^[0-9a-f]{64}$/.test(expected.authNonce)) throw fail()
    const a = exact(auth, ["did", "authNonce", "proof"])
    const proof = exact(a.proof, ["created", "proofPurpose", "verificationMethod", "type", "proofValue"])
    if (a.authNonce !== expected.authNonce || typeof a.did !== "string" || !DID.test(a.did) || proof.proofPurpose !== "authentication" || proof.type !== "Secp256r1Signature2018") throw fail()
    const created = timestamp(proof.created)
    if (created < start - 1000 || created > now + 1000 || created >= end) throw fail()
    if (typeof proof.verificationMethod !== "string") throw fail()
    const match = /^(did:omn:[A-Za-z0-9:_-]{8,160})\?versionId=([1-9][0-9]{0,8})#(pin|bio)$/.exec(proof.verificationMethod)
    if (!match || match[1] !== a.did) throw fail()
    const key = holderKey(document, match[3] as "pin" | "bio")
    if (key.did !== a.did || key.versionId !== match[2]) throw fail()
    const signature = multibase58(proof.proofValue, 65)
    // OpenDID's compact header = 27 + 4 + recoveryId (0..3). Verification uses
    // the explicitly pinned key, not attacker-provided key recovery.
    if (signature[0] < 31 || signature[0] > 34) throw fail()
    const point = Buffer.from(ECDH.convertKey(multibase58(key.publicKeyMultibase, 33), "prime256v1", undefined, undefined, "uncompressed"))
    const publicKey = createPublicKey({ format: "jwk", key: { kty: "EC", crv: "P-256", x: point.subarray(1, 33).toString("base64url"), y: point.subarray(33).toString("base64url") } })
    const { proofValue: _signature, ...unsignedProof } = proof
    const message = Buffer.from(nativeBindingCanonical({ did: a.did, authNonce: a.authNonce, proof: unsignedProof }), "utf8")
    if (!verify("sha256", message, { key: publicKey, dsaEncoding: "ieee-p1363" }, signature.subarray(1))) throw fail()
    return Object.freeze(key)
  } catch { throw fail() }
}

/** Called only with the document read from the configured trusted DID resolver,
 * never with a browser/native-supplied URL or with the initial self-held doc. */
export function assertRegisteredNativeHolder(document: unknown, expected: NativeHolderKey): void {
  try {
    const actual = holderKey(document, expected.keyId)
    if (actual.did !== expected.did || actual.versionId !== expected.versionId || actual.keyCommitment !== expected.keyCommitment || actual.publicKeyMultibase !== expected.publicKeyMultibase) throw fail()
  } catch { throw fail() }
}
