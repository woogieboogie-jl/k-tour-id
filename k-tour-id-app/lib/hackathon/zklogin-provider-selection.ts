// Pure configuration selection, NOT proof of a prover's network key, OAuth
// audience access or live readiness. Never sends a request or returns a key.
type Env = Record<string, string | undefined>
export type ZkLoginProviderSelection = { kind: "enoki" | "self-managed-prover"; url: string }

function safeHttps(value: string): URL | null {
  if (!value || value.length > 2048 || /[\x00-\x20\x7f\\?#]/.test(value) || !value.startsWith("https://")) return null
  try {
    const url = new URL(value)
    const labels = url.hostname.split(".")
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash ||
      labels.length < 2 || labels.every(label => /^\d+$/.test(label)) ||
      !labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
      /\.(?:localhost|local|internal)$/.test(url.hostname)) return null
    return url
  } catch { return null }
}

/** Explicit Enoki selection never falls back to a different salt/prover path.
 * Non-Devnet networks conservatively refuse the known Devnet prover host.
 * Other HTTPS self-managed hosts still require independent network/access
 * verification; accepting their syntax does not attest their trustworthiness. */
export function selectZkLoginProvider(env: Env): ZkLoginProviderSelection | null {
  const network = env.HK_SUI_NETWORK || "testnet"
  if (!["testnet", "devnet", "mainnet"].includes(network)) return null
  if (env.ENOKI_API_KEY) {
    if (env.ENOKI_API_KEY.length > 8192 || /[\x00-\x20\x7f]/.test(env.ENOKI_API_KEY)) return null
    const value = env.ENOKI_API_URL || "https://api.enoki.mystenlabs.com/v1"
    if (!safeHttps(value)) return null
    return { kind: "enoki", url: value }
  }
  const value = env.HK_ZKLOGIN_PROVER_URL || ""
  const url = safeHttps(value)
  if (!url || (url.hostname === "prover-dev.mystenlabs.com" && network !== "devnet")) return null
  return { kind: "self-managed-prover", url: value }
}
