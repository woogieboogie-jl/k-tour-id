// Public DTOs only. A proof response is not CX identity, an OpenDID VC, or consent to execute.
export const ZKLOGIN_CALLBACK = "https://ktour-id.vercel.app/hackathon/zklogin/callback"
export const ZKLOGIN_OPERATION_ID = /^op_[A-Za-z0-9_-]{8,64}$/
export const ZKLOGIN_ATTEMPT_ID = /^zkl_[A-Za-z0-9_-]{24}$/
export type ZkLoginProofInputs = { proofPoints: { a: string[]; b: string[][]; c: string[] }; issBase64Details: { value: string; indexMod4: number }; headerBase64: string; addressSeed: string }
export type ZkLoginStart = { operationId: string; attemptId: string; extendedEphemeralPublicKey: string; maxEpoch: number; jwtRandomness: string }
export type ZkLoginAttemptView = { version: 1; operationId: string; attemptId: string; status: "pending" | "proving" | "proved" | "unknown" | "rejected" | "cancelled" | "expired"; expiresAt: string; maxEpoch: number; address: string | null; inputs: ZkLoginProofInputs | null }
export type ZkLoginStarted = ZkLoginAttemptView & { googleClientId: string; redirectUri: typeof ZKLOGIN_CALLBACK; nonce: string; oauthState: string }

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
const exact = (v: unknown, keys: string[]): v is Record<string, unknown> => object(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k))
const decimalBelow = (v: unknown, modulus: bigint) => typeof v === "string" && /^(0|[1-9][0-9]{0,77})$/.test(v) && BigInt(v) < modulus
// Groth16 coordinates use BN254's base field; Poseidon addressSeed uses its
// different scalar field (the installed Sui SDK's BN254_FIELD_SIZE).
const coordinate = (v: unknown) => decimalBelow(v, 21888242871839275222246405745257275088696311157297823662689037894645226208583n)
const seed = (v: unknown) => decimalBelow(v, 21888242871839275222246405745257275088548364400416034343698204186575808495617n)
const vector = (v: unknown, n: number) => Array.isArray(v) && v.length === n && v.every(coordinate)
export function validZkLoginInputs(v: unknown): v is ZkLoginProofInputs {
  if (!exact(v, ["proofPoints", "issBase64Details", "headerBase64", "addressSeed"]) || !exact(v.proofPoints, ["a", "b", "c"]) || !exact(v.issBase64Details, ["value", "indexMod4"])) return false
  const p = v.proofPoints, i = v.issBase64Details
  return vector(p.a, 3) && vector(p.c, 3) && Array.isArray(p.b) && p.b.length === 3 && p.b.every(row => vector(row, 2)) &&
    typeof i.value === "string" && /^[A-Za-z0-9_-]{1,2048}$/.test(i.value) && Number.isInteger(i.indexMod4) && Number(i.indexMod4) >= 0 && Number(i.indexMod4) <= 3 &&
    typeof v.headerBase64 === "string" && /^[A-Za-z0-9_-]{1,2048}$/.test(v.headerBase64) && seed(v.addressSeed)
}
export function validZkLoginAttemptView(v: unknown, operationId: string, attemptId: string): v is ZkLoginAttemptView {
  if (!exact(v, ["version", "operationId", "attemptId", "status", "expiresAt", "maxEpoch", "address", "inputs"]) || v.version !== 1 || v.operationId !== operationId || v.attemptId !== attemptId || !ZKLOGIN_OPERATION_ID.test(operationId) || !ZKLOGIN_ATTEMPT_ID.test(attemptId) ||
    !["pending", "proving", "proved", "unknown", "rejected", "cancelled", "expired"].includes(String(v.status)) || typeof v.expiresAt !== "string" || !Number.isFinite(Date.parse(v.expiresAt)) || !Number.isSafeInteger(v.maxEpoch) || Number(v.maxEpoch) < 1) return false
  return v.status === "proved" ? typeof v.address === "string" && /^0x[0-9a-f]{64}$/.test(v.address) && validZkLoginInputs(v.inputs) : v.address === null && v.inputs === null
}
