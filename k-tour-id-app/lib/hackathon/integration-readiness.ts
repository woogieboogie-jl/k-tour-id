// Credential-free, offline integration readiness. This module deliberately
// does not import providers, construct signers, call fetch, or inspect the
// ambient process environment. Callers must pass an explicit environment map.
import { assessZkLoginReadiness, ZKLOGIN_READINESS_NAMES } from "./zklogin-readiness"
import { integrationSuiRolesMatch, resolveIntegrationSuiTarget } from "./integration-sui-targets"
import { omnioneTarget } from "./omnione-targets"

export type ExplicitEnv = Record<string, string | undefined>

export const READINESS_ENV_NAMES = [
  "HK_API_ENABLED", "NEXT_PUBLIC_HK_ENABLED", "HK_CX_API_KEY", "HK_CX_BASE_URL", "HK_CX_PROVIDER", "HK_CX_ZKP_TYPE", "HK_MODE_CX", "HK_MODE_OPENDID", "HK_ISOLATED_MOCK", "NEXT_PUBLIC_HK_CX_PREVIEW", "NEXT_PUBLIC_HK_PREVIEW_READ_ONLY", "VERCEL_ENV",
  "HK_ISSUER_SIGNING_SEED", "HK_STORE_KEY", "KV_REST_API_URL", "KV_REST_API_TOKEN",
  "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN",
  "HK_INTEGRATION_SUI_TARGET", "HK_SUI_NETWORK", "HK_SUI_CHAIN_IDENTIFIER", "HK_SUI_GRPC_URL", "HK_SUI_PACKAGE_ID", "HK_SUI_CAMPAIGN_ID", "HK_SUI_CAMPAIGN_INITIAL_VERSION",
  "HK_SUI_ISSUER_SECRET_KEY", "HK_SUI_AGENT_SECRET_KEY", "HK_SUI_SPONSOR_SECRET_KEY",
  "NEXT_PUBLIC_GOOGLE_CLIENT_ID", "HK_ZKLOGIN_SALT_SEED", "ENOKI_API_KEY", "ENOKI_API_URL", "HK_ZKLOGIN_PROVER_URL",
  "NEXT_PUBLIC_HK_HOSTED_SUI", "HK_HOSTED_SUI_ENABLED", "VERCEL_GIT_COMMIT_REF",
  "HK_OMNIONE_RPC_URL", "HK_OMNIONE_CHAIN_ID", "HK_OMNIONE_PRIVATE_KEY", "HK_OMNIONE_REGISTRY_ADDRESS", "HK_OMNIONE_TARGET_ID", "HK_OMNIONE_RECORDER_ADDRESS",
  "HK_AI_MODE", "GEMINI_API_KEY", "GEMINI_MODEL",
] as const

type Name = typeof READINESS_ENV_NAMES[number]
type Issue = { code: string; name?: string }
export type IntegrationReadinessOptions = {
  env?: ExplicitEnv
  aiRequested?: boolean
  zkLoginRequested?: boolean
  availableInputs?: Partial<Record<Name, boolean>>
  // Operator-observed public addresses only. They are compared with fixed pins,
  // not accepted as proof of key possession or permission to execute.
  suiRoles?: { issuer: string; agent: string; sponsor: string }
}

const value = (env: ExplicitEnv, name: Name) => env[name] ?? ""
const present = (env: ExplicitEnv, name: Name) => value(env, name).trim().length > 0
const validHttps = (raw: string, rootOnly = true) => {
  try {
    const url = new URL(raw)
    return raw === raw.trim() && url.protocol === "https:" && !url.username && !url.password && !url.hash && !url.search && (!rootOnly || url.pathname === "/")
  } catch { return false }
}
const invalidPlaceholder = (raw: string) => /sample|change[\s_-]*me|placeholder|sentinel/i.test(raw)
const validRpc = (raw: string) => {
  try { const u = new URL(raw); const token = u.searchParams.get("token") ?? ""; return raw === raw.trim() && u.origin === "https://stage-chainapi.omnione.net" && u.pathname === "/" && !u.username && !u.password && !u.hash && [...u.searchParams.keys()].join(",") === "token" && token.length > 0 && token.length <= 4096 && token !== "API_KEY" && !/[<>\s\x00-\x1f\x7f]/.test(token) }
  catch { return false }
}
const issue = (code: string, name?: string): Issue => name ? { code, name } : { code }

/** Copy only the names in the fixed contract; values never leave this function. */
export function allowlistedEnv(input: ExplicitEnv = {}): ExplicitEnv {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error()
    if (Object.keys(input).some(name => !READINESS_ENV_NAMES.includes(name as Name))) throw new Error()
    const result: ExplicitEnv = {}
    for (const name of READINESS_ENV_NAMES) {
      const descriptor = Object.getOwnPropertyDescriptor(input, name)
      if (!descriptor) continue
      if (!("value" in descriptor)) throw new Error()
      const v: unknown = descriptor.value
      if (v !== undefined && (typeof v !== "string" || v.length > 8192 || /[\x00-\x1f\x7f]/.test(v))) throw new Error()
      result[name] = v as string | undefined
    }
    return result
  } catch { throw new Error("readiness_input_invalid") }
}

export function runIntegrationReadiness(options: IntegrationReadinessOptions = {}) {
  try {
    if (!options || typeof options !== "object" || Array.isArray(options) || ![Object.prototype, null].includes(Object.getPrototypeOf(options))) throw new Error()
    const copied: IntegrationReadinessOptions = {}
    for (const name of Object.keys(options)) {
      if (!["env", "aiRequested", "zkLoginRequested", "availableInputs", "suiRoles"].includes(name)) throw new Error()
      const d = Object.getOwnPropertyDescriptor(options, name)!
      if (!("value" in d)) throw new Error()
      if ((name === "aiRequested" || name === "zkLoginRequested") && d.value !== undefined && typeof d.value !== "boolean") throw new Error()
      Object.defineProperty(copied, name, { value: d.value, enumerable: true })
    }
    if (copied.availableInputs !== undefined) {
      const inputs = copied.availableInputs
      if (!inputs || typeof inputs !== "object" || Array.isArray(inputs) || ![Object.prototype, null].includes(Object.getPrototypeOf(inputs))) throw new Error()
      for (const key of Object.keys(inputs)) {
        const d = Object.getOwnPropertyDescriptor(inputs, key)!
        if (!READINESS_ENV_NAMES.includes(key as Name) || !("value" in d) || typeof d.value !== "boolean") throw new Error()
      }
    }
    let safeRoles: IntegrationReadinessOptions["suiRoles"]
    if (copied.suiRoles !== undefined) {
      const roles = copied.suiRoles
      if (!roles || typeof roles !== "object" || Array.isArray(roles) || ![Object.prototype, null].includes(Object.getPrototypeOf(roles)) ||
        Reflect.ownKeys(roles).length !== 3) throw new Error()
      safeRoles = { issuer: "", agent: "", sponsor: "" }
      for (const name of ["issuer", "agent", "sponsor"] as const) {
        const d = Object.getOwnPropertyDescriptor(roles, name)
        if (!d || !("value" in d) || typeof d.value !== "string" || d.value.length > 128 || /[\x00-\x1f\x7f]/.test(d.value)) throw new Error()
        safeRoles[name] = d.value
      }
    }
    options = { ...copied, ...(safeRoles ? { suiRoles: safeRoles } : {}) }
  } catch { throw new Error("readiness_input_invalid") }
  const env = allowlistedEnv(options.env ?? {})
  const available = options.availableInputs ?? {}
  const ownerInputs: Issue[] = [], internalConfigWork: Issue[] = [], separateWorkflow: Issue[] = [], futureHumanApproval: Issue[] = []
  const cxOnly = value(env, "NEXT_PUBLIC_HK_CX_PREVIEW") === "1"
  const isolated = value(env, "NEXT_PUBLIC_HK_PREVIEW_READ_ONLY") === "1" || (!cxOnly && value(env, "HK_ISOLATED_MOCK") === "1")
  const cxEnabled = !isolated && (cxOnly || value(env, "HK_MODE_CX") === "cx")
  const zkLoginRequested = options.zkLoginRequested ?? true
  const aiRequested = options.aiRequested ?? true
  if (cxOnly) internalConfigWork.push(issue("existing_cx_profile_cannot_execute_chains"))
  if (isolated) internalConfigWork.push(issue("isolated_profile_cannot_execute_chains"))
  if (value(env, "VERCEL_ENV") === "production") internalConfigWork.push(issue("production_not_approved"))
  if (value(env, "HK_API_ENABLED") !== "1" || value(env, "NEXT_PUBLIC_HK_ENABLED") !== "1") internalConfigWork.push(issue("api_not_enabled"))
  if (!cxEnabled) internalConfigWork.push(issue("cx_mock_not_provider_verification", "HK_MODE_CX"))

  const requireInput = (name: Name, code = "owner_input_missing") => {
    if (present(env, name)) return
    ;(available[name] ? internalConfigWork : ownerInputs).push(issue(available[name] ? "available_input_not_configured" : code, name))
  }
  {
    // The existing CX deployment works without an x-api-key. Only carry a key
    // when that service actually supplies one; do not invent an owner blocker.
    if (available.HK_CX_API_KEY && !present(env, "HK_CX_API_KEY")) internalConfigWork.push(issue("available_input_not_configured", "HK_CX_API_KEY"))
    if (!present(env, "HK_ISSUER_SIGNING_SEED") || invalidPlaceholder(value(env, "HK_ISSUER_SIGNING_SEED")) || value(env, "HK_ISSUER_SIGNING_SEED").length < 32) {
      ;(available.HK_ISSUER_SIGNING_SEED ? internalConfigWork : ownerInputs).push(issue(available.HK_ISSUER_SIGNING_SEED ? "available_input_not_configured" : "issuer_seed_missing_or_placeholder", "HK_ISSUER_SIGNING_SEED"))
    }
  }
  const redisParts = ["KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"] as const
  const redisAny = redisParts.some(name => present(env, name))
  const redisPair = (present(env, "KV_REST_API_URL") && present(env, "KV_REST_API_TOKEN")) || (present(env, "UPSTASH_REDIS_REST_URL") && present(env, "UPSTASH_REDIS_REST_TOKEN"))
  const kv = present(env, "KV_REST_API_URL") || present(env, "KV_REST_API_TOKEN"), up = present(env, "UPSTASH_REDIS_REST_URL") || present(env, "UPSTASH_REDIS_REST_TOKEN")
  if (!redisAny || !redisPair || kv === up) internalConfigWork.push(issue("branch_redis_configuration_missing", "KV_REST_API_URL"))
  else {
    const url = present(env, "KV_REST_API_URL") ? value(env, "KV_REST_API_URL") : value(env, "UPSTASH_REDIS_REST_URL")
    if (!validHttps(url) || !new URL(url).hostname.endsWith(".upstash.io")) internalConfigWork.push(issue("branch_redis_configuration_invalid", "KV_REST_API_URL"))
  }
  if (!/^ktour:integration-preview:[A-Za-z0-9:_-]{1,120}$/.test(value(env, "HK_STORE_KEY"))) internalConfigWork.push(issue("branch_store_key_missing", "HK_STORE_KEY"))

  // No package guessing or implicit fall-through to another owner's deployment.
  // The selected target does not assert that its signing keys are available.
  let suiTarget: ReturnType<typeof resolveIntegrationSuiTarget> | null = null
  if (!present(env, "HK_INTEGRATION_SUI_TARGET")) internalConfigWork.push(issue("sui_target_selection_required", "HK_INTEGRATION_SUI_TARGET"))
  else {
    try { suiTarget = resolveIntegrationSuiTarget(value(env, "HK_INTEGRATION_SUI_TARGET")) }
    catch { internalConfigWork.push(issue("sui_target_selection_invalid", "HK_INTEGRATION_SUI_TARGET")) }
  }
  let omniTarget: ReturnType<typeof omnioneTarget> | null = null
  try { omniTarget = omnioneTarget(env.HK_OMNIONE_TARGET_ID) }
  catch { internalConfigWork.push(issue("omnione_target_selection_invalid", "HK_OMNIONE_TARGET_ID")) }
  if (omniTarget && present(env, "HK_OMNIONE_RECORDER_ADDRESS") && value(env, "HK_OMNIONE_RECORDER_ADDRESS").toLowerCase() !== omniTarget.recorder) internalConfigWork.push(issue("omnione_recorder_configuration_invalid", "HK_OMNIONE_RECORDER_ADDRESS"))
  const deployed: Partial<Record<Name, string>> = {
    ...(suiTarget ? {
      HK_SUI_PACKAGE_ID: suiTarget.packageId, HK_SUI_CAMPAIGN_ID: suiTarget.campaignId,
      HK_SUI_CAMPAIGN_INITIAL_VERSION: suiTarget.campaignInitialVersion,
    } : {}),
    ...(omniTarget ? { HK_OMNIONE_REGISTRY_ADDRESS: omniTarget.registry } : {}),
  }
  for (const [name, expected] of Object.entries(deployed)) {
    if (!present(env, name as Name)) internalConfigWork.push(issue("known_public_value_not_configured", name))
    else if (value(env, name as Name).toLowerCase() !== expected) internalConfigWork.push(issue("deployed_target_mismatch", name))
  }
  if (suiTarget) {
    for (const [name, expected] of [["HK_SUI_NETWORK", suiTarget.network], ["HK_SUI_CHAIN_IDENTIFIER", suiTarget.chainIdentifier]] as const) {
      if (!present(env, name)) internalConfigWork.push(issue("known_public_value_not_configured", name))
      else if (value(env, name) !== expected) internalConfigWork.push(issue("sui_target_requires_review", name))
    }
    if (!present(env, "HK_SUI_GRPC_URL")) internalConfigWork.push(issue("known_public_value_not_configured", "HK_SUI_GRPC_URL"))
    else if (!suiTarget.rpcUrls.includes(value(env, "HK_SUI_GRPC_URL"))) internalConfigWork.push(issue("sui_target_requires_review", "HK_SUI_GRPC_URL"))
  }
  const suiRolesCompared = !!suiTarget && !!options.suiRoles && integrationSuiRolesMatch(suiTarget, options.suiRoles)
  if (!options.suiRoles) internalConfigWork.push(issue("sui_public_roles_not_checked"))
  else if (suiTarget && !suiRolesCompared) internalConfigWork.push(issue("sui_public_roles_mismatch"))

  requireInput("HK_SUI_ISSUER_SECRET_KEY")
  requireInput("HK_SUI_AGENT_SECRET_KEY")
  // Sponsor is optional by contract: the adapter falls back to issuer.
  requireInput("HK_OMNIONE_PRIVATE_KEY", "authorized_signer_input_missing")
  if (!present(env, "HK_OMNIONE_RPC_URL")) internalConfigWork.push(issue("provided_rpc_not_configured", "HK_OMNIONE_RPC_URL"))
  if (present(env, "HK_OMNIONE_RPC_URL") && !validRpc(value(env, "HK_OMNIONE_RPC_URL"))) internalConfigWork.push(issue("omnione_rpc_configuration_invalid", "HK_OMNIONE_RPC_URL"))
  if (present(env, "HK_OMNIONE_CHAIN_ID") && value(env, "HK_OMNIONE_CHAIN_ID") !== "201210") internalConfigWork.push(issue("omnione_chain_configuration_invalid", "HK_OMNIONE_CHAIN_ID"))
  if (present(env, "HK_OMNIONE_REGISTRY_ADDRESS") && !/^0x[0-9a-f]{40}$/i.test(value(env, "HK_OMNIONE_REGISTRY_ADDRESS"))) internalConfigWork.push(issue("omnione_registry_configuration_invalid", "HK_OMNIONE_REGISTRY_ADDRESS"))

  if (zkLoginRequested) {
    for (const name of ["NEXT_PUBLIC_GOOGLE_CLIENT_ID", "HK_ZKLOGIN_SALT_SEED"] as const) requireInput(name)
    const zk = assessZkLoginReadiness(Object.fromEntries(ZKLOGIN_READINESS_NAMES.map(name => [name, env[name]])))
    // Required input ownership was classified above; all remaining entries
    // concern our provider/target verification, never duplicate key requests.
    internalConfigWork.push(...zk.issues.filter(item => item.code !== "zklogin_input_missing"))
    futureHumanApproval.push(issue("google_login_and_wallet_approval_required"))
  } else separateWorkflow.push(issue("google_zklogin_user_approval_separate"))

  const aiMode = !cxOnly && !isolated && (value(env, "HK_AI_MODE") || (present(env, "GEMINI_API_KEY") ? "gemini" : "rule")) === "gemini" && present(env, "GEMINI_API_KEY") ? "gemini" : "rule"
  if (aiRequested) requireInput("GEMINI_API_KEY")
  if (aiRequested && aiMode !== "gemini") internalConfigWork.push(issue("ai_rule_fallback_not_provider_verified"))

  // This inventories the non-OpenDID setup; OpenDID remains a separate required
  // workflow, not removed or marked complete. No all-provider readiness claim.
  separateWorkflow.push(issue("opendid_provider_workflow_separate"))
  separateWorkflow.push(issue("sumsub_nonblocking_to_cx_chain"))
  futureHumanApproval.push(issue("mobile_id_holder_approval_required"))
  return {
    ok: ownerInputs.length === 0 && internalConfigWork.length === 0,
    purpose: "prepare_full_provider_integration",
    suiTarget, suiRolesCompared, suiSignerOwnershipVerified: false,
    requestedCapabilities: { cx: true, sui: true, omnione: true, ai: aiRequested, zkLogin: zkLoginRequested },
    mode: { cx: cxEnabled ? "cx" : "mock", ai: aiMode, opendid: "separate-workflow-pending" },
    providerVerified: false, liveExecutionReady: false, opendidProviderReady: false,
    unverified: ["protected_deployment_target_and_runtime_access", "signer_validity_and_role_binding", "provider_connectivity", "actual_consents", "new_chain_transactions", "end_to_end_provider_evidence"],
    issues: { ownerInputs, internalConfigWork, separateWorkflow, futureHumanApproval },
    safety: { networkCalls: 0, signatures: 0, broadcasts: 0, envMutations: 0, secretValuesOutput: false },
    inspectedEnvNames: READINESS_ENV_NAMES,
  }
}
