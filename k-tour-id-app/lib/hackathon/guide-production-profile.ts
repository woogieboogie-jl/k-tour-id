// Pure deployment policy. No provider, storage, credentials loading or activation.
import { GUIDE_SAVE_V2 } from "./guide-contract"

export type GuideProductionEnv = Record<string, string | undefined>
export const GUIDE_PRODUCTION = Object.freeze({
  branch: "deploy/guide-main-20260929", origin: "https://ktour-id.vercel.app",
  projectId: "prj_w5rckTz9B1DO55fvVRXjQRy9L5RM", orgId: "team_6kJAloQ9WlswvMtbbCmGI7Er",
  repoOwner: "woogieboogie-jl", repoName: "k-tour-id", region: "icn1",
  storeKey: "ktour:integration-preview:autonomous-20260928:v1",
  maxEnd: Date.parse(GUIDE_SAVE_V2.endsAt),
})
export function isGuideProductionProfile(env: GuideProductionEnv = process.env): boolean {
  return (env === process.env && process.env.NEXT_PUBLIC_HK_GUIDE_PRODUCTION === "1") ||
    env.NEXT_PUBLIC_HK_GUIDE_PRODUCTION === "1" || env.HK_GUIDE_PRODUCTION_ENABLED === "1" || env.VERCEL_GIT_COMMIT_REF === GUIDE_PRODUCTION.branch
}
const remote = (env: GuideProductionEnv) => Object.keys(env).some(k => k === "VERCEL" || k.startsWith("VERCEL_"))
const secret = (v: string | undefined) => typeof v === "string" && v.length >= 32 && v.length <= 1024 && v === v.trim() && !/[\x00-\x20\x7f]/.test(v) && !/sample|change[\s_-]*me|placeholder|sentinel/i.test(v)

/** Fixed issue names only. A valid profile is neither provider readiness nor a
 * committed budget transition. Those are independently verified before actions. */
export function guideProductionPreflightIssues(env: GuideProductionEnv = process.env, now = Date.now()): string[] {
  const expiry = env.HK_GUIDE_EXPIRES_AT ?? ""
  const local = !remote(env) && env.HK_GUIDE_LOCAL_TEST === "1" && env.NODE_ENV !== "production"
  const checks: Record<string, boolean> = {
    guide_build: env.NEXT_PUBLIC_HK_GUIDE_PRODUCTION === "1" && (env !== process.env || process.env.NEXT_PUBLIC_HK_GUIDE_PRODUCTION === "1"),
    runtime_enabled: env.HK_GUIDE_PRODUCTION_ENABLED === "1",
    api_enabled: env.HK_API_ENABLED === "1" && env.NEXT_PUBLIC_HK_ENABLED === "1",
    no_profile_overlap: env.NEXT_PUBLIC_HK_HOSTED_SUI === "0" && env.HK_HOSTED_SUI_ENABLED !== "1" &&
      env.NEXT_PUBLIC_HK_INTEGRATION_PREVIEW === "0" && env.HK_INTEGRATION_PREVIEW_ENABLED !== "1" &&
      env.NEXT_PUBLIC_HK_CX_PREVIEW === "0" && env.HK_CX_PREVIEW_ENABLED !== "1" && env.NEXT_PUBLIC_HK_PREVIEW_READ_ONLY === "0",
    real_modes: env.HK_ISOLATED_MOCK === "0" && env.HK_MODE_CX === "cx" && env.HK_MODE_OPENDID === "opendid" && env.HK_AI_MODE === "gemini",
    cx_contract: env.HK_CX_BASE_URL === "https://cx.raonsecure.co.kr:18543" && env.HK_CX_PROVIDER === "comdl" && env.HK_CX_ZKP_TYPE === "AdultVerify" && (!env.HK_CX_SAMPLE_FALLBACK || env.HK_CX_SAMPLE_FALLBACK === "0"),
    expiry: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(expiry) && Number.isFinite(now) && Date.parse(expiry) > now && Date.parse(expiry) <= GUIDE_PRODUCTION.maxEnd,
    issuer_seed: secret(env.HK_ISSUER_SIGNING_SEED),
    access_secret: /^[a-f0-9]{64}$/.test(env.HK_GUIDE_ACCESS_SECRET ?? ""),
    access_code: /^[A-Za-z0-9_-]{32,128}$/.test(env.HK_GUIDE_ACCESS_CODE ?? ""),
    store_key: env.HK_STORE_KEY === GUIDE_PRODUCTION.storeKey,
    no_canary: !env.HK_STORE_CANARY_UUID && !env.HK_STORE_CANARY_OWNER && !env.HK_STORE_CANARY_ALLOW_WRITE,
    guide_scope: (!env.HK_CAMPAIGN_ID || env.HK_CAMPAIGN_ID === GUIDE_SAVE_V2.campaignId) &&
      (!env.HK_CAMPAIGN_VENUE_ID || env.HK_CAMPAIGN_VENUE_ID === GUIDE_SAVE_V2.venueId) &&
      (!env.NEXT_PUBLIC_HK_CAMPAIGN_VENUE_ID || env.NEXT_PUBLIC_HK_CAMPAIGN_VENUE_ID === GUIDE_SAVE_V2.venueId),
  }
  if (!local) Object.assign(checks, {
    hosted_platform: env.VERCEL === "1",
    deployment_target: ["preview", "production"].includes(env.VERCEL_ENV ?? "") && (!env.VERCEL_TARGET_ENV || env.VERCEL_TARGET_ENV === env.VERCEL_ENV),
    immutable_host: /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.vercel\.app$/.test(env.VERCEL_URL ?? ""),
    seoul: env.VERCEL_REGION === GUIDE_PRODUCTION.region,
    project: env.VERCEL_PROJECT_ID === GUIDE_PRODUCTION.projectId,
    team: env.VERCEL_ORG_ID === undefined || env.VERCEL_ORG_ID === GUIDE_PRODUCTION.orgId,
    git_provider: env.VERCEL_GIT_PROVIDER === "github", git_branch: env.VERCEL_GIT_COMMIT_REF === GUIDE_PRODUCTION.branch,
    git_owner: env.VERCEL_GIT_REPO_OWNER === GUIDE_PRODUCTION.repoOwner, git_repo: env.VERCEL_GIT_REPO_SLUG === GUIDE_PRODUCTION.repoName,
    git_revision: /^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA ?? ""),
    no_local_override: env.HK_GUIDE_LOCAL_TEST !== "1",
  })
  return Object.keys(checks).filter(k => !checks[k])
}
