// Offline diagnostics only. Never import a provider, read process.env, call a
// URL, derive a salt, construct a signer, or treat configuration as live proof.
export const ZKLOGIN_READINESS_NAMES = [
  "HK_SUI_NETWORK", "NEXT_PUBLIC_GOOGLE_CLIENT_ID", "HK_ZKLOGIN_SALT_SEED",
  "ENOKI_API_KEY", "ENOKI_API_URL", "HK_ZKLOGIN_PROVER_URL",
  "NEXT_PUBLIC_HK_HOSTED_SUI", "HK_HOSTED_SUI_ENABLED", "VERCEL_GIT_COMMIT_REF",
] as const
type Name = typeof ZKLOGIN_READINESS_NAMES[number]
export type ZkLoginReadinessEnv = Partial<Record<Name, string | undefined>>
type Issue = { code: string; name?: Name }

function checked(input: ZkLoginReadinessEnv): ZkLoginReadinessEnv {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error()
    const out: ZkLoginReadinessEnv = {}
    for (const name of Reflect.ownKeys(input)) {
      if (typeof name !== "string" || !ZKLOGIN_READINESS_NAMES.includes(name as Name)) throw new Error()
      const d = Object.getOwnPropertyDescriptor(input, name)!
      if (!("value" in d) || (d.value !== undefined && (typeof d.value !== "string" || d.value.length > 8192 || /[\x00-\x1f\x7f]/.test(d.value)))) throw new Error()
      out[name as Name] = d.value
    }
    return out
  } catch { throw new Error("zklogin_readiness_input_invalid") }
}
function validHttps(value: string) {
  try {
    const u = new URL(value)
    return value === value.trim() && u.protocol === "https:" && !u.username && !u.password && !u.search && !u.hash && !u.port
  } catch { return false }
}

/** A URL's spelling cannot establish its proving key or OAuth registration.
 * In particular, the current Sui docs support public Testnet proving, but
 * do not justify treating the historical Devnet endpoint as Testnet-ready.
 * Runtime selection now rejects an absent endpoint; keep this offline issue
 * classification for incomplete/historical configuration inventories. */
export function assessZkLoginReadiness(input: ZkLoginReadinessEnv = {}) {
  const env = checked(input)
  const present = (name: Name) => Boolean(env[name]?.trim())
  const issues: Issue[] = []
  for (const name of ["NEXT_PUBLIC_GOOGLE_CLIENT_ID", "HK_ZKLOGIN_SALT_SEED"] as const) {
    if (!present(name)) issues.push({ code: "zklogin_input_missing", name })
  }
  const network = env.HK_SUI_NETWORK || "testnet"
  if (network !== "testnet") issues.push({ code: "zklogin_network_requires_review", name: "HK_SUI_NETWORK" })
  if (env.NEXT_PUBLIC_HK_HOSTED_SUI === "1" || env.HK_HOSTED_SUI_ENABLED === "1" || env.VERCEL_GIT_COMMIT_REF === "deploy/sui-main-20260928") {
    issues.push({ code: "hosted_sui_profile_forbids_zklogin" })
  }
  const provider = present("ENOKI_API_KEY") ? "enoki" : present("HK_ZKLOGIN_PROVER_URL") ? "explicit-prover" : "implicit-prover"
  if (provider === "enoki") {
    const url = env.ENOKI_API_URL || "https://api.enoki.mystenlabs.com/v1"
    if (!validHttps(url)) issues.push({ code: "zklogin_enoki_url_invalid", name: "ENOKI_API_URL" })
    else if (url !== "https://api.enoki.mystenlabs.com/v1") issues.push({ code: "zklogin_custom_enoki_requires_review", name: "ENOKI_API_URL" })
    issues.push({ code: "zklogin_enoki_app_configuration_unverified" })
  } else {
    if (provider === "explicit-prover" && !validHttps(env.HK_ZKLOGIN_PROVER_URL!)) {
      issues.push({ code: "zklogin_prover_url_invalid", name: "HK_ZKLOGIN_PROVER_URL" })
    } else {
      issues.push({ code: provider === "implicit-prover" ? "zklogin_default_prover_network_unverified" : "zklogin_prover_network_unverified", name: "HK_ZKLOGIN_PROVER_URL" })
    }
    // Not a mandatory Enoki-key request: a reviewed Testnet-compatible public
    // or self-hosted prover is an alternative, with the original salt retained.
    issues.push({ code: "zklogin_prover_access_unverified" })
  }
  issues.push({ code: "oauth_callback_registration_unverified" })
  return {
    provider, issues,
    configuredInputsPresent: present("NEXT_PUBLIC_GOOGLE_CLIENT_ID") && present("HK_ZKLOGIN_SALT_SEED"),
    liveExecutionReady: false as const, providerVerified: false as const,
    humanApproval: "google_login_and_wallet_approval_required" as const,
    safety: { networkCalls: 0, signatures: 0, broadcasts: 0, secretValuesOutput: false },
  }
}
