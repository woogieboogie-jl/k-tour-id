// Offline policy and retained budget journal for the unactivated full-provider
// integration lane. No I/O, signing, target inference or budget initialization.
import { INTEGRATION_SUI_TARGETS, integrationSuiRolesMatch } from "./integration-sui-targets"
import { HkError } from "./util"
import { assertCommittedCutover, type CutoverDb } from "./integration-cutover"
import { createHash } from "node:crypto"
import { isGuideProductionProfile, guideProductionPreflightIssues } from "./guide-production-profile"

type Env = Record<string, string | undefined>
export const INTEGRATION_SUI_LIMITS = Object.freeze({
  branch: "integration/autonomous-finish-20260927", targetId: "selfhosted-testnet" as const,
  storeKey: "ktour:integration-preview:autonomous-20260928:v1",
  maxExpiresAt: "2026-09-30T14:59:59Z", maxEnd: Date.parse("2026-09-30T14:59:59Z"),
  maxOperations: 10, gasBudgetMIST: 10_000_000, maxTransactions: 30, maxTotalGasMIST: 300_000_000,
})
const target = INTEGRATION_SUI_TARGETS[INTEGRATION_SUI_LIMITS.targetId]
const unavailable = () => new HkError("integration_sui_scope", "The approved integration Testnet scope is unavailable.", 503)
const invalidBudget = () => new HkError("integration_sui_budget", "The retained integration execution budget is unavailable.", 503)
const OP = /^op_[A-Za-z0-9_-]{8,64}$/
const keyPresent = (value: string | undefined) => typeof value === "string" && value.length >= 32 && value.length <= 1024 && value === value.trim() && !/[\x00-\x20\x7f]/.test(value) && !/placeholder|sentinel|sample|change[\s_-]*me/i.test(value)

/** A removed runtime flag cannot downgrade a protected build or branch. */
export function requiresIntegrationSuiLimits(env: Env = process.env) {
  return (env === process.env && process.env.NEXT_PUBLIC_HK_INTEGRATION_PREVIEW === "1") || env.NEXT_PUBLIC_HK_INTEGRATION_PREVIEW === "1" ||
    env.HK_INTEGRATION_PREVIEW_ENABLED === "1" || env.VERCEL_GIT_COMMIT_REF === INTEGRATION_SUI_LIMITS.branch || isGuideProductionProfile(env)
}

/** Public fixed issue names only. Key presence is NOT proof of role ownership. */
export function integrationSuiPreflightIssues(env: Env = process.env, now = Date.now()): string[] {
  const guide = isGuideProductionProfile(env)
  const end = (guide ? env.HK_GUIDE_EXPIRES_AT : env.HK_INTEGRATION_PREVIEW_EXPIRES_AT) ?? "", expiry = Date.parse(end)
  const checks: Record<string, boolean> = {
    sui_target: env.HK_INTEGRATION_SUI_TARGET === target.id,
    integration_build: guide ? guideProductionPreflightIssues(env, now).length === 0 : env.NEXT_PUBLIC_HK_INTEGRATION_PREVIEW === "1" && (env !== process.env || process.env.NEXT_PUBLIC_HK_INTEGRATION_PREVIEW === "1"),
    runtime_enabled: guide ? env.HK_GUIDE_PRODUCTION_ENABLED === "1" : env.HK_INTEGRATION_PREVIEW_ENABLED === "1",
    no_profile_overlap: env.NEXT_PUBLIC_HK_HOSTED_SUI !== "1" && env.HK_HOSTED_SUI_ENABLED !== "1" && env.NEXT_PUBLIC_HK_CX_PREVIEW === "0" && env.HK_CX_PREVIEW_ENABLED !== "1" && env.NEXT_PUBLIC_HK_PREVIEW_READ_ONLY === "0",
    provider_modes: env.HK_ISOLATED_MOCK === "0" && env.HK_MODE_CX === "cx" && env.HK_MODE_OPENDID === "opendid",
    no_cx_fallback: !env.HK_CX_SAMPLE_FALLBACK || env.HK_CX_SAMPLE_FALLBACK === "0",
    expiry: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(end) && Number.isFinite(now) && Number.isFinite(expiry) && expiry > now && expiry <= INTEGRATION_SUI_LIMITS.maxEnd,
    sui_network: env.HK_SUI_NETWORK === target.network,
    sui_rpc: target.rpcUrls.includes(env.HK_SUI_GRPC_URL ?? ""),
    sui_package: env.HK_SUI_PACKAGE_ID === target.packageId,
    sui_campaign: env.HK_SUI_CAMPAIGN_ID === target.campaignId,
    sui_shared_version: env.HK_SUI_CAMPAIGN_INITIAL_VERSION === target.campaignInitialVersion,
    sui_chain: env.HK_SUI_CHAIN_IDENTIFIER === target.chainIdentifier,
    sui_explorer: !env.HK_SUI_EXPLORER || env.HK_SUI_EXPLORER === "https://suiscan.xyz/testnet",
    sui_graphql: !env.HK_SUI_GRAPHQL_URL || env.HK_SUI_GRAPHQL_URL === "https://graphql.testnet.sui.io/graphql",
    issuer_key: keyPresent(env.HK_SUI_ISSUER_SECRET_KEY), agent_key: keyPresent(env.HK_SUI_AGENT_SECRET_KEY),
    sponsor_key: keyPresent(env.HK_SUI_SPONSOR_SECRET_KEY || env.HK_SUI_ISSUER_SECRET_KEY),
    store_key: env.HK_STORE_KEY === INTEGRATION_SUI_LIMITS.storeKey,
    no_store_canary: !env.HK_STORE_CANARY_UUID && !env.HK_STORE_CANARY_OWNER && !env.HK_STORE_CANARY_ALLOW_WRITE,
    operation_budget: !env.HK_INTEGRATION_SUI_MAX_OPERATIONS || env.HK_INTEGRATION_SUI_MAX_OPERATIONS === String(INTEGRATION_SUI_LIMITS.maxOperations),
    gas_budget: !env.HK_INTEGRATION_SUI_GAS_BUDGET_MIST || env.HK_INTEGRATION_SUI_GAS_BUDGET_MIST === String(INTEGRATION_SUI_LIMITS.gasBudgetMIST),
  }
  return Object.keys(checks).filter(key => !checks[key])
}
export function assertIntegrationSuiLimits(env: Env = process.env, now = Date.now()) {
  if (integrationSuiPreflightIssues(env, now).length) throw unavailable()
  return target
}
export function assertIntegrationSuiRoles(roles: { issuer: string; agent: string; sponsor: string }) {
  if (!integrationSuiRolesMatch(target, roles)) throw unavailable()
}

/** Private request-local scope fingerprint. Only fixed relevant fields are read;
 * never serialize/log this binding or the secret values used to compute it. */
export function integrationSuiAuthorizationScopeDigest(env: Env = process.env) {
  const names = ["NEXT_PUBLIC_HK_INTEGRATION_PREVIEW", "HK_INTEGRATION_PREVIEW_ENABLED", "HK_INTEGRATION_PREVIEW_EXPIRES_AT",
    "NEXT_PUBLIC_HK_GUIDE_PRODUCTION", "HK_GUIDE_PRODUCTION_ENABLED", "HK_GUIDE_EXPIRES_AT", "HK_GUIDE_LOCAL_TEST", "HK_GUIDE_ACCESS_SECRET", "HK_GUIDE_ACCESS_CODE",
    "HK_API_ENABLED", "NEXT_PUBLIC_HK_ENABLED", "HK_AI_MODE", "HK_CX_BASE_URL", "HK_CX_PROVIDER", "HK_CX_ZKP_TYPE", "HK_ISSUER_SIGNING_SEED",
    "HK_CAMPAIGN_ID", "HK_CAMPAIGN_VENUE_ID", "NEXT_PUBLIC_HK_CAMPAIGN_VENUE_ID", "NODE_ENV",
    "NEXT_PUBLIC_HK_HOSTED_SUI", "HK_HOSTED_SUI_ENABLED", "NEXT_PUBLIC_HK_CX_PREVIEW", "HK_CX_PREVIEW_ENABLED", "NEXT_PUBLIC_HK_PREVIEW_READ_ONLY",
    "HK_ISOLATED_MOCK", "HK_MODE_CX", "HK_MODE_OPENDID", "HK_CX_SAMPLE_FALLBACK", "HK_INTEGRATION_SUI_TARGET",
    "HK_SUI_NETWORK", "HK_SUI_GRPC_URL", "HK_SUI_PACKAGE_ID", "HK_SUI_CAMPAIGN_ID", "HK_SUI_CAMPAIGN_INITIAL_VERSION", "HK_SUI_CHAIN_IDENTIFIER",
    "HK_SUI_EXPLORER", "HK_SUI_GRAPHQL_URL", "HK_SUI_ISSUER_SECRET_KEY", "HK_SUI_AGENT_SECRET_KEY", "HK_SUI_SPONSOR_SECRET_KEY",
    "HK_STORE_KEY", "HK_STORE_CANARY_UUID", "HK_STORE_CANARY_OWNER", "HK_STORE_CANARY_ALLOW_WRITE", "HK_INTEGRATION_SUI_MAX_OPERATIONS", "HK_INTEGRATION_SUI_GAS_BUDGET_MIST",
    "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_URL", "KV_REST_API_TOKEN",
    "VERCEL", "VERCEL_ENV", "VERCEL_TARGET_ENV", "VERCEL_URL", "VERCEL_REGION", "VERCEL_PROJECT_ID", "VERCEL_ORG_ID", "VERCEL_GIT_PROVIDER", "VERCEL_GIT_COMMIT_REF", "VERCEL_GIT_COMMIT_SHA", "VERCEL_GIT_REPO_SLUG", "VERCEL_GIT_REPO_OWNER"]
  return createHash("sha256").update(JSON.stringify(names.map(name => [name, env[name] ?? null]))).digest("hex")
}

/** No env switch or client JSON is an activation capability. Runtime callers
 * must supply a fresh atomically-read ledger AND its separate durable control.
 * Existing no-argument gates remain closed until the real operator cutover and
 * authenticated storage integration exist; local/offline plans cannot open it. */
export function assertIntegrationSuiActivation(db?: CutoverDb, control?: unknown, now = Date.now()): void {
  if (!db || control === undefined) throw new HkError("integration_sui_migration_required", "The shared execution budget migration is not prepared.", 503)
  assertCommittedCutover(db, control, now)
}

export type IntegrationSuiMigration = {
  priorHostedOperationIds: string[]
  hostedLedgerSha256: string
  hostedWritesDisabledAt: string
}

export type IntegrationSuiBudget = {
  version: 1
  targetId: "selfhosted-testnet"
  storeKey: string
  maxExpiresAt: string
  maxOperations: number
  gasBudgetMIST: number
  operationIds: string[]
} & IntegrationSuiMigration
type BudgetDb = { integrationSuiBudget?: unknown; operations: Record<string, unknown> }

/** Pure provisioning template, NOT called by runtime/store code. Provisioning a
 * real ledger requires a separate explicit operator audit and atomic write. */
export function integrationSuiBudgetTemplate(migration: IntegrationSuiMigration): IntegrationSuiBudget {
  const budget: IntegrationSuiBudget = { version: 1, targetId: target.id, storeKey: INTEGRATION_SUI_LIMITS.storeKey, maxExpiresAt: INTEGRATION_SUI_LIMITS.maxExpiresAt,
    maxOperations: INTEGRATION_SUI_LIMITS.maxOperations, gasBudgetMIST: INTEGRATION_SUI_LIMITS.gasBudgetMIST, operationIds: [],
    priorHostedOperationIds: [...migration.priorHostedOperationIds], hostedLedgerSha256: migration.hostedLedgerSha256, hostedWritesDisabledAt: migration.hostedWritesDisabledAt }
  assertIntegrationSuiBudget({ integrationSuiBudget: budget, operations: {} })
  return budget
}

/** Missing state is never interpreted as a new budget. IDs are retained even
 * when the corresponding operation is cancelled, expires, or gets pruned. */
export function assertIntegrationSuiBudget(db: BudgetDb): IntegrationSuiBudget {
  const b = db.integrationSuiBudget as IntegrationSuiBudget | undefined
  const template = { version: 1, targetId: target.id, storeKey: INTEGRATION_SUI_LIMITS.storeKey, maxExpiresAt: INTEGRATION_SUI_LIMITS.maxExpiresAt,
    maxOperations: INTEGRATION_SUI_LIMITS.maxOperations, gasBudgetMIST: INTEGRATION_SUI_LIMITS.gasBudgetMIST }
  const variableKeys = ["operationIds", "priorHostedOperationIds", "hostedLedgerSha256", "hostedWritesDisabledAt"]
  if (!b || typeof b !== "object" || Array.isArray(b) || Object.keys(b).sort().join(",") !== [...Object.keys(template), ...variableKeys].sort().join(",") ||
    Object.entries(template).some(([key, value]) => b[key as keyof IntegrationSuiBudget] !== value)) throw invalidBudget()
  if (!Array.isArray(b.operationIds) || !Array.isArray(b.priorHostedOperationIds) || b.priorHostedOperationIds.length < 1 ||
    b.operationIds.length + b.priorHostedOperationIds.length > INTEGRATION_SUI_LIMITS.maxOperations ||
    [...b.operationIds, ...b.priorHostedOperationIds].some(id => typeof id !== "string" || !OP.test(id)) ||
    new Set([...b.operationIds, ...b.priorHostedOperationIds]).size !== b.operationIds.length + b.priorHostedOperationIds.length ||
    Object.keys(db.operations).some(id => !b.operationIds.includes(id)) || !/^0x[0-9a-f]{64}$/.test(b.hostedLedgerSha256) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(b.hostedWritesDisabledAt) || !Number.isFinite(Date.parse(b.hostedWritesDisabledAt)) ||
    Date.parse(b.hostedWritesDisabledAt) >= INTEGRATION_SUI_LIMITS.maxEnd) throw invalidBudget()
  return b
}
export function assertIntegrationSuiOperation(db: BudgetDb, operationId: string) {
  if (!assertIntegrationSuiBudget(db).operationIds.includes(operationId)) throw invalidBudget()
}
export function claimIntegrationSuiOperation(db: BudgetDb, operationId: string) {
  const b = assertIntegrationSuiBudget(db)
  if (!OP.test(operationId) || b.operationIds.includes(operationId) || b.priorHostedOperationIds.includes(operationId)) throw invalidBudget()
  if (b.operationIds.length + b.priorHostedOperationIds.length >= INTEGRATION_SUI_LIMITS.maxOperations) throw new HkError("integration_sui_limit", "This integration journey has reached its execution limit.", 429)
  b.operationIds.push(operationId)
}
export function assertIntegrationSuiBudgetMonotonic(previous: IntegrationSuiBudget, db: BudgetDb) {
  const next = assertIntegrationSuiBudget(db)
  if (previous.hostedLedgerSha256 !== next.hostedLedgerSha256 || previous.hostedWritesDisabledAt !== next.hostedWritesDisabledAt ||
    JSON.stringify(previous.priorHostedOperationIds) !== JSON.stringify(next.priorHostedOperationIds) ||
    previous.operationIds.length > next.operationIds.length || previous.operationIds.some((id, index) => next.operationIds[index] !== id)) throw invalidBudget()
}
