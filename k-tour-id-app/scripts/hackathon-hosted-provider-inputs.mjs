// Explicit, private input boundary for the connected Testnet extension.
// Never called by a build, route, browser, import side effect, or CI.
import { openSync, fstatSync, readFileSync, closeSync, constants } from "node:fs"
import { createHash } from "node:crypto"
import { computeAddress } from "ethers"

export const CONNECTED_MARKER = "connected-20260930-v1"
export const GOOGLE_CLIENT_ID_SHA256 = "f20fd5c28fefa3d71e14215ec0bdda7db32865f064312429b2210282410258b8"
export const PROVIDER_FIXED_VALUES = Object.freeze({
  NEXT_PUBLIC_HK_HOSTED_PROVIDERS: CONNECTED_MARKER, HK_HOSTED_PROVIDERS: CONNECTED_MARKER,
  HK_HOSTED_AI_ENABLED: "1", HK_HOSTED_ZKLOGIN_ENABLED: "1", HK_HOSTED_OMNIONE_ENABLED: "1",
  GEMINI_MODEL: "gemini-2.5-flash", HK_ZKLOGIN_PROVER_URL: "https://prover.mystenlabs.com/v1",
  HK_OMNIONE_TARGET_ID: "stage-20260930", HK_OMNIONE_CHAIN_ID: "201210",
  HK_OMNIONE_REGISTRY_ADDRESS: "0x07b35e14b1bf59be938fd72a6f9d9f9e04f0a687",
  HK_OMNIONE_RECORDER_ADDRESS: "0x315694f531f7b25c4cec3660f9cd66eab9f2c39a", HK_OMNIONE_GAS_LIMIT: "300000",
})
export const PROVIDER_SECRET_KEYS = Object.freeze(["GEMINI_API_KEY", "HK_ZKLOGIN_SALT_SEED", "HK_OMNIONE_RPC_URL", "HK_OMNIONE_PRIVATE_KEY"])
export const PROVIDER_INPUT_KEYS = Object.freeze(["NEXT_PUBLIC_GOOGLE_CLIENT_ID", ...PROVIDER_SECRET_KEYS])
export const PROVIDER_ADDED_KEYS = Object.freeze([...Object.keys(PROVIDER_FIXED_VALUES), ...PROVIDER_INPUT_KEYS])
const BASE = "/Users/woogieboogie/.local/share/ktour-integration-owner-inputs"
const fail = () => { throw new Error("release_provider_input") }
function privateJson(name) {
  const fd = openSync(`${BASE}/${name}`, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const s = fstatSync(fd)
    if (!s.isFile() || s.uid !== process.getuid() || (s.mode & 0o777) !== 0o600 || s.nlink !== 1 || s.size > 262144) fail()
    return JSON.parse(readFileSync(fd, "utf8"))
  } finally { closeSync(fd) }
}
export function approvedGoogleClientId(value) {
  return typeof value === "string" && /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(value) &&
    createHash("sha256").update(value).digest("hex") === GOOGLE_CLIENT_ID_SHA256
}
/** Only the operator CLI calls this. Errors never include input/path/provider text. */
export function readHostedProviderInputs() {
  try {
    const inputs = privateJson("inputs.json").inputs
    const gemini = privateJson("gemini-candidate-20260930.json")
    const omni = privateJson("omnione-candidate-20260930.json")
    const zk = privateJson("zklogin-candidate-20260930.json")
    if (!approvedGoogleClientId(inputs?.NEXT_PUBLIC_GOOGLE_CLIENT_ID) || zk?.kind !== "new-namespace-only" ||
      zk.namespace !== "ktour:provider:20260930:v1" || zk.network !== "testnet" || zk.clientId !== inputs.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
      zk.proverUrl !== PROVIDER_FIXED_VALUES.HK_ZKLOGIN_PROVER_URL || !/^[a-f0-9]{64}$/.test(zk.saltSeed ?? "") ||
      zk.preservesExistingUsers !== true || zk.requiresHumanLogin !== true) fail()
    if (gemini?.kind !== "gemini-candidate" || !/^[A-Za-z0-9._-]{16,256}$/.test(gemini.credential ?? "")) fail()
    if (omni?.kind !== "new-stage-eoa" || omni.keystoreVerified !== true ||
      typeof omni.address !== "string" || omni.address.toLowerCase() !== PROVIDER_FIXED_VALUES.HK_OMNIONE_RECORDER_ADDRESS ||
      !/^0x[0-9a-fA-F]{64}$/.test(omni.privateKey ?? "") || computeAddress(omni.privateKey).toLowerCase() !== PROVIDER_FIXED_VALUES.HK_OMNIONE_RECORDER_ADDRESS) fail()
    const rpc = inputs.HK_OMNIONE_RPC_URL
    if (typeof rpc !== "string" || rpc.length > 4096 || /[\x00-\x20\x7f]/.test(rpc)) fail()
    const url = new URL(rpc)
    if (url.origin !== "https://stage-chainapi.omnione.net" ||
      url.pathname !== "/" || url.username || url.password || url.hash || [...url.searchParams.keys()].join() !== "token" || !url.searchParams.get("token")) fail()
    return { NEXT_PUBLIC_GOOGLE_CLIENT_ID: inputs.NEXT_PUBLIC_GOOGLE_CLIENT_ID, GEMINI_API_KEY: gemini.credential,
      HK_ZKLOGIN_SALT_SEED: zk.saltSeed, HK_OMNIONE_RPC_URL: rpc, HK_OMNIONE_PRIVATE_KEY: omni.privateKey }
  } catch { fail() }
}
