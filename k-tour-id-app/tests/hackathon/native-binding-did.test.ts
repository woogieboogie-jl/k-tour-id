import assert from "node:assert/strict"
import { ECDH, generateKeyPairSync, sign } from "node:crypto"
import test from "node:test"
import { toBase58 } from "@mysten/bcs"
import { assertRegisteredNativeHolder, nativeBindingCanonical, verifyNativeDidAuth } from "../../lib/hackathon/native-binding-did"

const NOW = 1_800_000_000_000, NONCE = "b".repeat(64)
const expected = { authNonce: NONCE, createdAt: new Date(NOW - 1000).toISOString(), expiresAt: new Date(NOW + 120_000).toISOString(), now: NOW }
function fixture() {
  // Ephemeral offline key pair: no persisted/provider/real-holder private key.
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
  const jwk = pair.publicKey.export({ format: "jwk" })
  const point = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, "base64url"), Buffer.from(jwk.y!, "base64url")])
  const compressed = ECDH.convertKey(point, "prime256v1", undefined, undefined, "compressed") as Buffer
  const did = "did:omn:offline-fixture-holder"
  const doc = { "@context": ["https://www.w3.org/ns/did/v1"], id: did, controller: "did:omn:tas", versionId: "1", deactivated: false,
    verificationMethod: [{ id: "pin", type: "Secp256r1VerificationKey2018", controller: did, publicKeyMultibase: "z" + toBase58(compressed), authType: 2 }], authentication: ["pin"] }
  const unsigned = { did, authNonce: NONCE, proof: { created: new Date(NOW).toISOString(), proofPurpose: "authentication", verificationMethod: `${did}?versionId=1#pin`, type: "Secp256r1Signature2018" } }
  const signature = sign("sha256", Buffer.from(nativeBindingCanonical(unsigned)), { key: pair.privateKey, dsaEncoding: "ieee-p1363" })
  return { doc, auth: { ...unsigned, proof: { ...unsigned.proof, proofValue: "z" + toBase58(Buffer.concat([Buffer.from([31]), signature])) } } }
}

test("actual P-256 DIDAuth signature validates canonical nonce/key possession, not authority", () => {
  const f = fixture(), key = verifyNativeDidAuth(f.doc, f.auth, expected)
  assert.equal(key.did, f.doc.id); assert.equal(key.keyId, "pin")
  assert.equal(key.keyCommitment.length, 64)
  assert.equal("personVerified" in key, false)
  assert.doesNotThrow(() => assertRegisteredNativeHolder(f.doc, key))
})

test("wrong nonce, DID, signature, purpose, version, method, time and extra fields fail closed", () => {
  const f = fixture()
  for (const patch of [{ authNonce: "c".repeat(64) }, { did: "did:omn:other-holder-123" }, { approved: true },
    ...[{ proofPurpose: "assertionMethod" }, { type: "Secp256k1Signature2018" }, { verificationMethod: `${f.doc.id}?versionId=2#pin` }, { verificationMethod: `${f.doc.id}#pin` }, { created: new Date(NOW - 5000).toISOString() }, { created: new Date(NOW + 5000).toISOString() }, { proofValue: "z" + toBase58(Buffer.alloc(65, 31)) }].map(proof => ({ proof: { ...f.auth.proof, ...proof } }))]) {
    assert.throws(() => verifyNativeDidAuth(f.doc, { ...f.auth, ...patch }, expected), /holder proof/)
  }
  assert.throws(() => verifyNativeDidAuth(f.doc, f.auth, { ...expected, now: NOW + 120_000 }), /holder proof/)
})

test("an attacker key, unauthenticated key, deactivated doc and malformed point are refused", () => {
  const f = fixture(), other = fixture()
  for (const doc of [other.doc, { ...f.doc, controller: "did:omn:other-controller" }, { ...f.doc, deactivated: true }, { ...f.doc, authentication: [] }, { ...f.doc, verificationMethod: [...f.doc.verificationMethod, ...f.doc.verificationMethod] }, { ...f.doc, verificationMethod: [{ ...f.doc.verificationMethod[0], authType: 1 }] }, { ...f.doc, verificationMethod: [{ ...f.doc.verificationMethod[0], publicKeyMultibase: "z" + toBase58(Buffer.alloc(33)) }] }]) assert.throws(() => verifyNativeDidAuth(doc, f.auth, expected), /holder proof/)
  const key = verifyNativeDidAuth(f.doc, f.auth, expected)
  assert.throws(() => assertRegisteredNativeHolder(other.doc, key), /holder proof/)
  assert.throws(() => assertRegisteredNativeHolder({ ...f.doc, versionId: "2" }, key), /holder proof/)
})

test("input accessor properties are never executed and errors disclose no payload", () => {
  const f = fixture(); let reads = 0
  const auth = { ...f.auth, get authNonce() { reads++; throw new Error("secret native payload") } }
  assert.throws(() => verifyNativeDidAuth(f.doc, auth, expected), error => error instanceof Error && error.message === "The holder proof could not be verified")
  assert.equal(reads, 0)
})
