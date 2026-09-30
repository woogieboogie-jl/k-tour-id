// Pure policy for the short-lived hosted Testnet journey. No config/store,
// provider, network, key parsing, signature creation or deployment dependencies.
import { HkError } from "./util"
import { jitIdentityRouteAllowed, assertJitIdentityBody } from "./jit-identity-routes"
import { parseSerializedSignature } from "@mysten/sui/cryptography"
import { approvedOmnioneRpc } from "./omnione-readonly"
import { zkLoginRouteAllowed, assertZkLoginRequestBody } from "./zklogin-route-policy"

export type HostedSuiEnv = Record<string, string | undefined>
export const CONNECTED_PIN = Object.freeze({
  marker: "connected-20260930-v1", model: "gemini-3.8-flash",
  googleClientId: "746125368961-1njodv4sh0b2sjogudsl7dvreb9ra186.apps.googleusercontent.com",
  prover: "https://prover.mystenlabs.com/v1", targetId: "stage-20260930", chainId: "201210",
  registry: "0x07B35E14b1BF59be938Fd72a6f9d9f9E04f0A687", recorder: "0x315694F531f7b25c4CEC3660f9Cd66eab9F2C39a", gasLimit: "300000",
})
export const PIN = Object.freeze({
  branch: "deploy/sui-main-20260928", publicHost: "ktour-id.vercel.app", publicOrigin: "https://ktour-id.vercel.app",
  projectId: "prj_w5rckTz9B1DO55fvVRXjQRy9L5RM", orgId: "team_6kJAloQ9WlswvMtbbCmGI7Er",
  repoOwner: "woogieboogie-jl", repoName: "k-tour-id", region: "icn1",
  network: "testnet", rpc: "https://fullnode.testnet.sui.io:443", explorer: "https://suiscan.xyz/testnet",
  chainIdentifier: "69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD",
  packageId: "0x7a28a5e59d87e385f2eb3047ca2bbe76301627343f8d88eeb0f03733d4f2389e",
  campaignId: "0xa273ccd96315ae187b16eb3192c822795bc2031e6f79405739daec4a52275afd", campaignInitialVersion: "349181963",
  issuer: "0x900cd55f3d9de4541e306c6a3b1fe85cd4ddbf04319ee316ae21b6bb3ba95d76",
  agent: "0x17ee59f56d182c010732daaf509a2b35b221bf7ec62e4a59c3b2ceca2c3bbce4",
  sponsor: "0x900cd55f3d9de4541e306c6a3b1fe85cd4ddbf04319ee316ae21b6bb3ba95d76",
  storeKey: "ktour:sui-hosted:20260928:v1", maxExpiresAt: "2026-09-30T14:59:59Z", maxEnd: Date.parse("2026-09-30T14:59:59Z"),
  maxOperations: 10, gasBudgetMIST: 10_000_000, maxTransactions: 30, maxTotalGasMIST: 300_000_000,
  venueId: "mois-0021cd596bc5b2a922ad", campaignRef: "hk-identity-perk-v1", policyVersion: 1, consentVersion: "hk-consent-2026-09-14",
})
function scope(): never { throw new HkError("hosted_sui_scope", "This action is unavailable in the hosted Testnet journey.", 403) }
const remote = (env: HostedSuiEnv) => Object.keys(env).some(k => k === "VERCEL" || k.startsWith("VERCEL_"))
const secret = (v: string | undefined, min = 32) => typeof v === "string" && v.length >= min && v.length <= 1024 && v === v.trim() && !/[\x00-\x20\x7f]/.test(v) && !/sample|change[\s_-]*me|placeholder|sentinel/i.test(v)
const absent = (env: HostedSuiEnv, prefixes: readonly string[]) => !Object.keys(env).some(key => prefixes.some(prefix => key.startsWith(prefix)) && Boolean(env[key]))
const only = (env: HostedSuiEnv, prefixes: readonly string[], keys: readonly string[]) => !Object.keys(env).some(key => prefixes.some(prefix => key.startsWith(prefix)) && Boolean(env[key]) && !keys.includes(key))

/** Opt-in selection only. Callers must also run the unchanged full lifetime,
 * store, role and deployment preflight before consequential work. */
export function hostedConnectedProvidersEnabled(env: HostedSuiEnv = process.env): boolean {
  return env.NEXT_PUBLIC_HK_HOSTED_PROVIDERS === CONNECTED_PIN.marker && env.HK_HOSTED_PROVIDERS === CONNECTED_PIN.marker &&
    (env !== process.env || process.env.NEXT_PUBLIC_HK_HOSTED_PROVIDERS === CONNECTED_PIN.marker)
}
export const hostedAiEnabled = (env: HostedSuiEnv = process.env) => hostedConnectedProvidersEnabled(env) && env.HK_HOSTED_AI_ENABLED === "1"
export const hostedZkLoginEnabled = (env: HostedSuiEnv = process.env) => hostedConnectedProvidersEnabled(env) && env.HK_HOSTED_ZKLOGIN_ENABLED === "1"
export const hostedNativeEnabled = (env: HostedSuiEnv = process.env) => hostedConnectedProvidersEnabled(env) && env.HK_HOSTED_OPENDID_ENABLED === "1" &&
  env.NEXT_PUBLIC_HK_PUBLIC_CX === "public-identity-20260930-v1" && env.HK_PUBLIC_CX === "public-identity-20260930-v1"

/** Configuration admission only, never evidence of a holder/provider success.
 * No loopback, free-form upstream override or secret enters the browser build. */
function nativeConfigurationReady(env: HostedSuiEnv): boolean {
  const keys = ["HK_OPENDID_HOLDER_BINDING_ENABLED", "HK_OPENDID_BRIDGE_URL", "HK_OPENDID_TRUSTED_ORIGIN", "HK_OPENDID_BRIDGE_TOKEN", "HK_OPENDID_OWNER_BINDING_SECRET",
    "HK_OPENDID_ISSUER_DID", "HK_OPENDID_SCHEMA_ID", "HK_OPENDID_ADMIN_TOKEN", "HK_OPENDID_CAS_URL", "HK_OPENDID_TA_URL", "HK_OPENDID_DID_API_URL"]
  if (!only(env, ["HK_OPENDID_"], keys) || env.HK_OPENDID_HOLDER_BINDING_ENABLED !== "1" || env.HK_MODE_CX !== "cx" ||
    !["HK_OPENDID_BRIDGE_TOKEN", "HK_OPENDID_OWNER_BINDING_SECRET", "HK_OPENDID_ADMIN_TOKEN"].every(k => secret(env[k])) ||
    !/^did:omn:[A-Za-z0-9:_-]{8,160}$/.test(env.HK_OPENDID_ISSUER_DID ?? "")) return false
  try {
    const trusted = new URL(env.HK_OPENDID_TRUSTED_ORIGIN ?? "")
    if (trusted.protocol !== "https:" || trusted.origin !== env.HK_OPENDID_TRUSTED_ORIGIN || trusted.username || trusted.password || trusted.port ||
      !/^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/i.test(trusted.hostname) || /(?:^|\.)(?:localhost|local|internal)$/.test(trusted.hostname)) return false
    for (const key of ["HK_OPENDID_BRIDGE_URL", "HK_OPENDID_CAS_URL", "HK_OPENDID_TA_URL", "HK_OPENDID_DID_API_URL"]) if (env[key] !== trusted.origin) return false
    const schema = new URL(env.HK_OPENDID_SCHEMA_ID ?? "")
    return schema.origin === trusted.origin && !schema.username && !schema.password && !schema.search && !schema.hash && schema.pathname !== "/"
  } catch { return false }
}
export const hostedOmnioneEnabled = (env: HostedSuiEnv = process.env) => hostedConnectedProvidersEnabled(env) && env.HK_HOSTED_OMNIONE_ENABLED === "1" &&
  env.HK_MODE_CX === "cx" && env.HK_OMNIONE_TARGET_ID === CONNECTED_PIN.targetId && env.HK_OMNIONE_CHAIN_ID === CONNECTED_PIN.chainId &&
  env.HK_OMNIONE_REGISTRY_ADDRESS?.toLowerCase() === CONNECTED_PIN.registry.toLowerCase() && env.HK_OMNIONE_RECORDER_ADDRESS?.toLowerCase() === CONNECTED_PIN.recorder.toLowerCase() && env.HK_OMNIONE_GAS_LIMIT === CONNECTED_PIN.gasLimit

/** A removed runtime flag cannot bypass a frozen build or the dedicated branch. */
export function isHostedSuiProfile(env: HostedSuiEnv = process.env): boolean {
  return (env === process.env && process.env.NEXT_PUBLIC_HK_HOSTED_SUI === "1") || env.NEXT_PUBLIC_HK_HOSTED_SUI === "1" ||
    env.HK_HOSTED_SUI_ENABLED === "1" || env.VERCEL_GIT_COMMIT_REF === PIN.branch
}

function redisReady(env: HostedSuiEnv): boolean {
  const upUrl = env.UPSTASH_REDIS_REST_URL ?? "", upToken = env.UPSTASH_REDIS_REST_TOKEN ?? ""
  const kvUrl = env.KV_REST_API_URL ?? "", kvToken = env.KV_REST_API_TOKEN ?? ""
  const up = Boolean(upUrl || upToken), kv = Boolean(kvUrl || kvToken)
  if (up === kv || (up && (!upUrl || !upToken)) || (kv && (!kvUrl || !kvToken))) return false
  const value = up ? upUrl : kvUrl, token = up ? upToken : kvToken
  if (!secret(token, 1) || value !== value.trim() || /[\x00-\x20\x7f]/.test(value)) return false
  try {
    const url = new URL(value)
    return url.protocol === "https:" && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.upstash\.io$/.test(url.hostname)
      && !url.username && !url.password && !url.search && !url.hash && url.pathname === "/" && (!url.port || url.port === "443")
  } catch { return false }
}

/** Fixed issue names only. This is configuration validation, not a claim that
 * keys own their roles, Redis is reachable, CX is ready, or chain state matches. */
export function hostedSuiPreflightIssues(env: HostedSuiEnv = process.env, now = Date.now()): string[] {
  const expiryText = env.HK_HOSTED_SUI_EXPIRES_AT ?? "", expiry = Date.parse(expiryText)
  const local = env.HK_HOSTED_SUI_LOCAL_TEST === "1" && !remote(env) && env.NODE_ENV !== "production"
  const connected = hostedConnectedProvidersEnabled(env), ai = hostedAiEnabled(env), google = hostedZkLoginEnabled(env), omni = hostedOmnioneEnabled(env), native = hostedNativeEnabled(env)
  const hasMarker = Boolean(env.NEXT_PUBLIC_HK_HOSTED_PROVIDERS || env.HK_HOSTED_PROVIDERS)
  const checks: Record<string, boolean> = {
    hosted_build: env.NEXT_PUBLIC_HK_HOSTED_SUI === "1" && (env !== process.env || process.env.NEXT_PUBLIC_HK_HOSTED_SUI === "1"),
    runtime_enabled: env.HK_HOSTED_SUI_ENABLED === "1",
    no_cx_build: env.NEXT_PUBLIC_HK_CX_PREVIEW === "0" && (env !== process.env || process.env.NEXT_PUBLIC_HK_CX_PREVIEW === "0"),
    no_readonly_build: env.NEXT_PUBLIC_HK_PREVIEW_READ_ONLY === "0" && (env !== process.env || process.env.NEXT_PUBLIC_HK_PREVIEW_READ_ONLY === "0"),
    no_integration_build: env.NEXT_PUBLIC_HK_INTEGRATION_PREVIEW === "0" && (env !== process.env || process.env.NEXT_PUBLIC_HK_INTEGRATION_PREVIEW === "0"),
    no_profile_overlap: env.HK_INTEGRATION_PREVIEW_ENABLED !== "1" && env.HK_CX_PREVIEW_ENABLED !== "1",
    api_enabled: env.NEXT_PUBLIC_HK_ENABLED === "1" && env.HK_API_ENABLED === "1",
    non_isolated: env.HK_ISOLATED_MOCK === "0",
    expiry: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(expiryText) && Number.isFinite(now) && Number.isFinite(expiry) && expiry > now && expiry <= PIN.maxEnd,
    cx_mode: env.HK_MODE_CX === "mock" || env.HK_MODE_CX === "cx",
    sample_credential: native ? env.HK_MODE_OPENDID === "opendid" : env.HK_MODE_OPENDID === "mock",
    native_profile: !env.HK_HOSTED_OPENDID_ENABLED || env.HK_HOSTED_OPENDID_ENABLED === "0" || native,
    connected_profile: !hasMarker || connected,
    connected_flags: ["HK_HOSTED_AI_ENABLED", "HK_HOSTED_ZKLOGIN_ENABLED", "HK_HOSTED_OMNIONE_ENABLED"].every(key => !env[key] || env[key] === "0" || (connected && env[key] === "1")),
    rule_ai: ai ? env.HK_AI_MODE === "gemini" : env.HK_AI_MODE === "rule",
    no_google: google ? env.NEXT_PUBLIC_GOOGLE_CLIENT_ID === CONNECTED_PIN.googleClientId && /^[a-f0-9]{64}$/.test(env.HK_ZKLOGIN_SALT_SEED ?? "") && env.HK_ZKLOGIN_PROVER_URL === CONNECTED_PIN.prover &&
      only(env, ["NEXT_PUBLIC_GOOGLE_", "GOOGLE_", "HK_ZKLOGIN_", "ENOKI_"], ["NEXT_PUBLIC_GOOGLE_CLIENT_ID", "HK_ZKLOGIN_SALT_SEED", "HK_ZKLOGIN_PROVER_URL"]) : absent(env, ["NEXT_PUBLIC_GOOGLE_", "GOOGLE_", "HK_ZKLOGIN_", "ENOKI_"]),
    no_gemini: ai ? secret(env.GEMINI_API_KEY) && env.GEMINI_MODEL === CONNECTED_PIN.model && only(env, ["GEMINI_", "GOOGLE_GENERATIVE_AI_"], ["GEMINI_API_KEY", "GEMINI_MODEL"]) : absent(env, ["GEMINI_", "GOOGLE_GENERATIVE_AI_"]),
    no_omnione: omni ? approvedOmnioneRpc(env.HK_OMNIONE_RPC_URL ?? "") && /^(?:0x)?[a-fA-F0-9]{64}$/.test(env.HK_OMNIONE_PRIVATE_KEY ?? "") && only(env, ["HK_OMNIONE_"], ["HK_OMNIONE_TARGET_ID", "HK_OMNIONE_CHAIN_ID", "HK_OMNIONE_REGISTRY_ADDRESS", "HK_OMNIONE_RECORDER_ADDRESS", "HK_OMNIONE_GAS_LIMIT", "HK_OMNIONE_RPC_URL", "HK_OMNIONE_PRIVATE_KEY"]) : absent(env, ["HK_OMNIONE_"]),
    connected_omnione: env.HK_HOSTED_OMNIONE_ENABLED !== "1" || omni,
    no_opendid_provider: native ? nativeConfigurationReady(env) : absent(env, ["HK_OPENDID_"]),
    no_cx_fallback: !env.HK_CX_SAMPLE_FALLBACK || env.HK_CX_SAMPLE_FALLBACK === "0",
    sui_network: env.HK_SUI_NETWORK === PIN.network,
    sui_rpc: env.HK_SUI_GRPC_URL === PIN.rpc,
    sui_graphql: !env.HK_SUI_GRAPHQL_URL || env.HK_SUI_GRAPHQL_URL === "https://graphql.testnet.sui.io/graphql",
    sui_package: env.HK_SUI_PACKAGE_ID === PIN.packageId,
    sui_campaign: env.HK_SUI_CAMPAIGN_ID === PIN.campaignId,
    sui_shared_version: env.HK_SUI_CAMPAIGN_INITIAL_VERSION === PIN.campaignInitialVersion,
    sui_chain: !env.HK_SUI_CHAIN_IDENTIFIER || env.HK_SUI_CHAIN_IDENTIFIER === PIN.chainIdentifier,
    sui_explorer: !env.HK_SUI_EXPLORER || env.HK_SUI_EXPLORER === PIN.explorer,
    issuer_key: secret(env.HK_SUI_ISSUER_SECRET_KEY), agent_key: secret(env.HK_SUI_AGENT_SECRET_KEY),
    sponsor_key: secret(env.HK_SUI_SPONSOR_SECRET_KEY || env.HK_SUI_ISSUER_SECRET_KEY),
    credential_seed: secret(env.HK_ISSUER_SIGNING_SEED),
    access_secret: /^[a-f0-9]{64}$/.test(env.HK_HOSTED_SUI_ACCESS_SECRET ?? ""),
    access_code: /^[A-Za-z0-9_-]{32,128}$/.test(env.HK_HOSTED_SUI_ACCESS_CODE ?? ""),
    store_key: env.HK_STORE_KEY === PIN.storeKey,
    redis_configuration: redisReady(env),
    no_store_canary: !env.HK_STORE_CANARY_UUID && !env.HK_STORE_CANARY_OWNER && !env.HK_STORE_CANARY_ALLOW_WRITE,
    operation_budget: !env.HK_HOSTED_SUI_MAX_OPERATIONS || env.HK_HOSTED_SUI_MAX_OPERATIONS === String(PIN.maxOperations),
    gas_budget: !env.HK_HOSTED_SUI_GAS_BUDGET_MIST || env.HK_HOSTED_SUI_GAS_BUDGET_MIST === String(PIN.gasBudgetMIST),
    campaign_scope: (!env.HK_CAMPAIGN_VENUE_ID || env.HK_CAMPAIGN_VENUE_ID === PIN.venueId) && (!env.NEXT_PUBLIC_HK_CAMPAIGN_VENUE_ID || env.NEXT_PUBLIC_HK_CAMPAIGN_VENUE_ID === PIN.venueId) && (!env.HK_CAMPAIGN_ID || env.HK_CAMPAIGN_ID === PIN.campaignRef),
    campaign_expiry: !env.HK_CAMPAIGN_ENDS_AT || (Number.isFinite(Date.parse(env.HK_CAMPAIGN_ENDS_AT)) && Date.parse(env.HK_CAMPAIGN_ENDS_AT) <= PIN.maxEnd && Date.parse(env.HK_CAMPAIGN_ENDS_AT) > now),
  }
  // CX mode is an explicit deployment decision. Failure here NEVER changes it.
  if (env.HK_MODE_CX === "cx") Object.assign(checks, {
    cx_origin: env.HK_CX_BASE_URL === "https://cx.raonsecure.co.kr:18543",
    cx_provider: env.HK_CX_PROVIDER === "comdl", cx_zkp: env.HK_CX_ZKP_TYPE === "AdultVerify",
  })
  if (!local) Object.assign(checks, {
    hosted_platform: env.VERCEL === "1",
    deployment_target: (env.VERCEL_ENV === "preview" || env.VERCEL_ENV === "production") && (!env.VERCEL_TARGET_ENV || env.VERCEL_TARGET_ENV === env.VERCEL_ENV),
    immutable_host: /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.vercel\.app$/.test(env.VERCEL_URL ?? ""),
    seoul: env.VERCEL_REGION === PIN.region,
    // PROJECT_ID is a documented runtime system variable; ORG_ID is a CLI
    // linking variable and may be absent. The release operator independently
    // binds this unique project to the approved team through Vercel's API.
    project: env.VERCEL_PROJECT_ID === PIN.projectId,
    team: env.VERCEL_ORG_ID === undefined || env.VERCEL_ORG_ID === PIN.orgId,
    git_provider: env.VERCEL_GIT_PROVIDER === "github", git_branch: env.VERCEL_GIT_COMMIT_REF === PIN.branch,
    git_owner: env.VERCEL_GIT_REPO_OWNER === PIN.repoOwner, git_repo: env.VERCEL_GIT_REPO_SLUG === PIN.repoName,
    git_revision: /^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA ?? ""),
    no_local_override: env.HK_HOSTED_SUI_LOCAL_TEST !== "1",
  })
  return Object.keys(checks).filter(key => !checks[key])
}

/** Call with addresses derived by the server from its configured signing keys.
 * Never call this with client-provided role declarations. No key access here. */
export function assertHostedSuiRoles(roles: { issuer: string; agent: string; sponsor: string }): void {
  if (!roles || roles.issuer !== PIN.issuer || roles.agent !== PIN.agent || roles.sponsor !== PIN.sponsor) scope()
}

type RoutePath = string | readonly string[]
const operationId = /^op_[A-Za-z0-9_-]{8,64}$/
const actionFields: Record<string, readonly string[]> = Object.freeze({
  "identity/start": ["mobile"], "identity/complete": ["sample"],
  "credential/issue": ["publicKeyPem", "alg"], "credential/holder-ack": ["signatureB64"],
  "presentation/request": [], "presentation/submit": ["presentationId", "disclosed", "signatureB64"], "presentation/deny": [],
  proposal: ["locale"], "delegation/prepare": ["userAddress", "signer", "walletProof", "approvedProposalDigest"],
  "delegation/submit": ["txBytesDigest", "userSignature"], "agent/run": [], cancel: [], reconcile: [], "sui/agent-address": [],
})
function parts(path: RoutePath): readonly string[] | null {
  let out: readonly string[]
  if (typeof path === "string") {
    if (path.length > 512 || !path.startsWith("/")) return null
    const prefix = "/api/hackathon/v1/"
    out = (path.startsWith(prefix) ? path.slice(prefix.length) : path.slice(1)).split("/")
  } else if (Array.isArray(path)) out = path
  else return null
  return out.length >= 1 && out.length <= 5 && out.every(p => typeof p === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(p)) ? out : null
}

/** Unknown paths, methods, encodings and tails fail closed. Provider/fulfillment
 * exceptions require their exact connected-profile opt-in. */
export function hostedSuiRouteAllowed(method: string, path: RoutePath, env: HostedSuiEnv = process.env): boolean {
  const p = parts(path)
  if (!p) return false
  if (p[0] === "operations" && operationId.test(p[1] ?? "") && p[2] === "provider") return method === "POST" && hostedNativeEnabled(env) &&
    ["issuance/start", "issuance/refresh", "presentation/start", "presentation/refresh", "cancel"].includes(p.slice(3).join("/"))
  if (jitIdentityRouteAllowed(method, p)) return true
  if (p[0] === "zklogin") return hostedZkLoginEnabled(env) && zkLoginRouteAllowed(method, p)
  if (p.length === 3 && p[0] === "operations" && operationId.test(p[1]) && p[2] === "redeem") return method === "POST" && hostedOmnioneEnabled(env)
  if (method === "GET") return (p.length === 1 && ["config", "me"].includes(p[0])) ||
    (p.length === 2 && p[0] === "guide" && p[1] === "collection") ||
    (p.length === 3 && p[0] === "places" && p[2] === "demo-entitlements") ||
    ((p.length === 2 || (p.length === 3 && p[2] === "evidence")) && p[0] === "operations" && operationId.test(p[1]))
  if (method !== "POST") return false
  return (p.length === 1 && ["sessions", "operations"].includes(p[0])) ||
    (p.length === 2 && p[0] === "hosted" && p[1] === "access") ||
    ((p.length === 3 || p.length === 4) && p[0] === "operations" && operationId.test(p[1]) && Object.hasOwn(actionFields, p.slice(2).join("/")))
}

type Body = Record<string, unknown>
function fields(value: unknown, allowed: readonly string[], required: readonly string[] = []): asserts value is Body {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) scope()
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (Reflect.ownKeys(value).some(key => typeof key !== "string" || !allowed.includes(key) || !("value" in descriptors[key]) || !descriptors[key].enumerable)
    || required.some(key => !Object.hasOwn(value, key))) scope()
}
const text = (v: unknown, max: number) => typeof v === "string" && v.length > 0 && v.length <= max && !/[\x00-\x1f\x7f]/.test(v)
const hex32 = (v: unknown) => typeof v === "string" && /^0x[0-9a-f]{64}$/.test(v)
function base64(v: unknown, max: number): Buffer | null {
  if (typeof v !== "string" || !v.length || v.length > max || !/^[A-Za-z0-9+/]+={0,2}$/.test(v)) return null
  const bytes = Buffer.from(v, "base64")
  return bytes.toString("base64") === v ? bytes : null
}
function ed25519(v: unknown): boolean { const bytes = base64(v, 132); return !!bytes && bytes.length === 97 && bytes[0] === 0 }
function zklogin(v: unknown): boolean {
  const bytes = base64(v, 16384)
  if (!bytes || bytes[0] !== 5) return false
  try { return parseSerializedSignature(v as string).signatureScheme === "ZkLogin" } catch { return false }
}
// Browser WebCrypto holder signatures are raw 64-byte Ed25519/P-256 values
// encoded as unpadded base64url, unlike serialized Sui signatures above.
function holderSignature(v: unknown): boolean {
  if (typeof v !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(v)) return false
  const bytes = Buffer.from(v, "base64url")
  return bytes.length === 64 && bytes.toString("base64url") === v
}

/** Schema/scheme boundary only; service must still verify signatures, session,
 * approval digests, object evidence, journal and durable lifetime budget. */
export function assertHostedSuiBody(path: RoutePath, body: unknown, env: HostedSuiEnv = process.env): void {
  const p = parts(path)
  if (!p || !hostedSuiRouteAllowed("POST", p, env)) scope()
  if (p[0] === "identity") { assertJitIdentityBody(p, body); return }
  if (p[0] === "zklogin") {
    try { assertZkLoginRequestBody(p, body) } catch { scope() }
    return
  }
  const action = p.slice(2).join("/")
  if (p[2] === "provider") { fields(body, []); return }
  if (action === "redeem") { fields(body, ["idempotencyKey"], ["idempotencyKey"]); if (typeof body.idempotencyKey !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(body.idempotencyKey)) scope(); return }
  const allowed = p.length === 1 ? (p[0] === "operations" ? ["venueId", "consentVersion", "locale", "identityAuthorizationRef", "identityContextDigest"] : [])
    : p[0] === "hosted" ? ["accessCode"] : actionFields[action]
  fields(body, allowed)
  if (p[0] === "hosted") { if (typeof body.accessCode !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(body.accessCode)) scope(); return }
  if (p.length === 1 && p[0] === "operations" && (body.venueId !== PIN.venueId || body.consentVersion !== PIN.consentVersion)) scope()
  if (p.length === 1 && p[0] === "operations" && (Object.hasOwn(body, "identityAuthorizationRef") || Object.hasOwn(body, "identityContextDigest")) &&
    (typeof body.identityAuthorizationRef !== "string" || !/^ida_[A-Za-z0-9_-]{16,32}$/.test(body.identityAuthorizationRef) ||
      typeof body.identityContextDigest !== "string" || !/^0x[0-9a-f]{64}$/.test(body.identityContextDigest))) scope()
  if (Object.hasOwn(body, "locale") && (typeof body.locale !== "string" || !["ko", "en", "ja"].includes(body.locale))) scope()
  if (action === "identity/start" && typeof body.mobile !== "boolean") scope()
  if (action === "identity/complete") {
    if (env.HK_MODE_CX === "cx") { if (Object.keys(body).length) scope() }
    else if (env.HK_MODE_CX === "mock") {
      fields(body.sample, ["outcome", "subjectSeed"], ["outcome", "subjectSeed"])
      if (typeof body.sample.outcome !== "string" || !["verified", "cancelled", "failed", "expired"].includes(body.sample.outcome) || typeof body.sample.subjectSeed !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(body.sample.subjectSeed)) scope()
    } else scope()
  }
  if (action === "credential/issue") {
    if (typeof body.alg !== "string" || !["Ed25519", "ECDSA-P256"].includes(body.alg) || typeof body.publicKeyPem !== "string" || body.publicKeyPem.length > 1200 ||
      !/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END PUBLIC KEY-----\s*$/.test(body.publicKeyPem)) scope()
  }
  if (action === "credential/holder-ack" && !holderSignature(body.signatureB64)) scope()
  if (action === "presentation/submit") {
    if (typeof body.presentationId !== "string" || !/^pres_[A-Za-z0-9_-]{8,64}$/.test(body.presentationId) || !holderSignature(body.signatureB64)) scope()
    fields(body.disclosed, ["schemaVersion", "personVerified", "serviceAccess", "validUntil", "policyVersion", "statusRef"])
    for (const key of ["schemaVersion", "validUntil", "statusRef"]) if (Object.hasOwn(body.disclosed, key) && !text(body.disclosed[key], 160)) scope()
    if (Object.hasOwn(body.disclosed, "personVerified") && typeof body.disclosed.personVerified !== "boolean") scope()
    if (Object.hasOwn(body.disclosed, "policyVersion") && body.disclosed.policyVersion !== PIN.policyVersion) scope()
    if (Object.hasOwn(body.disclosed, "serviceAccess") && (!Array.isArray(body.disclosed.serviceAccess) || body.disclosed.serviceAccess.length !== 1 || body.disclosed.serviceAccess[0] !== "redeem_demo_entitlement")) scope()
  }
  if (action === "delegation/prepare") {
    const google = body.signer === "zklogin" && hostedZkLoginEnabled(env)
    if ((!google && body.signer !== "demo") || !hex32(body.userAddress) || !hex32(body.approvedProposalDigest)) scope()
    fields(body.walletProof, ["message", "signature"], ["message", "signature"])
    if (!text(body.walletProof.message, 256) || !(body.walletProof.message as string).startsWith(`ondo-hk-wallet-proof:${p[1]}:`) || !(google ? zklogin(body.walletProof.signature) : ed25519(body.walletProof.signature))) scope()
  }
  if (action === "delegation/submit" && (!hex32(body.txBytesDigest) || !(ed25519(body.userSignature) || (hostedZkLoginEnabled(env) && zklogin(body.userSignature))))) scope()
}
