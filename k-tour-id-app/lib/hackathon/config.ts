// Hackathon integration configuration (server-only values read from process.env).
// Nothing here is a vendor spec; adapters translate to each provider's real API.
// Server-only: never import from client components.
import { HkError } from "./util"

export type CxMode = "mock" | "cx"
export type OpenDidMode = "mock" | "opendid"
export type AiMode = "gemini" | "rule"

export const HK_POLICY_VERSION = 1
export const HK_CONSENT_VERSION = "hk-consent-2026-09-14"
export const HK_SCHEMA_VERSION = "KPassHackathonCredential/v1"
export const HK_SERVICE_ACCESS = "redeem_demo_entitlement" as const

export const HK_TTL = {
  identityHandoffMs: 10 * 60 * 1000,
  evidenceMs: 24 * 60 * 60 * 1000,
  credentialMs: 24 * 60 * 60 * 1000,
  presentationRequestMs: 5 * 60 * 1000,
  decisionMs: 5 * 60 * 1000,
  statusFreshnessMs: 60 * 1000,
  grantExecutionMs: 10 * 60 * 1000,
  fulfillmentMs: 15 * 60 * 1000,
  operationMs: 60 * 60 * 1000,
} as const

function env(name: string, fallback = ""): string {
  const v = process.env[name]
  return v === undefined || v === "" ? fallback : v
}

export function hkConfig() {
  const isolatedMock = env("HK_ISOLATED_MOCK") === "1"
  const cxMode = (!isolatedMock && env("HK_MODE_CX", "mock") === "cx" ? "cx" : "mock") as CxMode
  const openDidMode = (!isolatedMock && env("HK_MODE_OPENDID", "mock") === "opendid" ? "opendid" : "mock") as OpenDidMode
  const aiMode = (!isolatedMock && env("HK_AI_MODE", env("GEMINI_API_KEY") ? "gemini" : "rule") === "gemini" && env("GEMINI_API_KEY") ? "gemini" : "rule") as AiMode
  return {
    isolatedMock,
    campaign: {
      venueId: env("HK_CAMPAIGN_VENUE_ID", env("NEXT_PUBLIC_HK_CAMPAIGN_VENUE_ID", "mois-0021cd596bc5b2a922ad")),
      campaignId: env("HK_CAMPAIGN_ID", "hk-identity-perk-v1"),
      purpose: HK_SERVICE_ACCESS,
      policyVersion: HK_POLICY_VERSION,
      endsAt: env("HK_CAMPAIGN_ENDS_AT", "2026-09-30T23:59:59+09:00"),
      title: { ko: "K-Tour ID 체험 혜택", en: "K-Tour ID experience perk", ja: "K-Tour ID 体験特典" },
      description: {
        ko: "해커톤 체험용 비금전 혜택 1회. 실제 결제·예약·매장 제공 의무가 없습니다.",
        en: "One non-financial hackathon experience perk. No payment, reservation or merchant obligation.",
        ja: "ハッカソン体験用の非金銭特典1回。決済・予約・店舗の提供義務はありません。",
      },
    },
    cx: {
      mode: cxMode,
      baseUrl: env("HK_CX_BASE_URL", "https://cx.raonsecure.co.kr:18543"),
      // Hackathon CX server: `comrc`(주민등록증) and `coresidence`(외국인증) are disabled
      // (provider/list status_code = "n"); `comdl`(모바일운전면허증) and
      // `coidentitydocument`(모바일신분증) are active.
      provider: env("HK_CX_PROVIDER", "comdl"),
      zkpType: env("HK_CX_ZKP_TYPE", "AdultVerify"),
      apiKey: env("HK_CX_API_KEY"),
      // Live CX needs a holder who actually owns this credential type. Keep a clearly
      // labelled sample path so the journey can still be demonstrated end to end;
      // the resulting evidence is recorded as mode "mock", never as a provider result.
      sampleFallback: env("HK_CX_SAMPLE_FALLBACK", "1") !== "0",
    },
    opendid: {
      mode: openDidMode,
      issuerUrl: env("HK_OPENDID_ISSUER_URL", "http://localhost:8091"),
      verifierUrl: env("HK_OPENDID_VERIFIER_URL", "http://localhost:8092"),
      tasUrl: env("HK_OPENDID_TAS_URL", "http://localhost:8090"),
      vcPlanId: env("HK_OPENDID_VC_PLAN_ID", "kpass-hackathon-v1"),
      policyId: env("HK_OPENDID_VP_POLICY_ID", "kpass-hackathon-policy-v1"),
      issuerDid: env("HK_OPENDID_ISSUER_DID", "did:omn:ondo-issuer-sample"),
      signingSeed: env("HK_ISSUER_SIGNING_SEED", "ondo-hackathon-sample-issuer-seed-change-me"),
    },
    ai: {
      mode: aiMode,
      promptVersion: env("HK_AI_PROMPT_VERSION", "perk-proposal-v1"),
      model: env("GEMINI_MODEL", "gemini-2.5-flash"),
    },
    sui: {
      network: env("HK_SUI_NETWORK", "testnet"),
      grpcUrl: env("HK_SUI_GRPC_URL", "https://fullnode.testnet.sui.io:443"),
      packageId: env("HK_SUI_PACKAGE_ID"),
      campaignId: env("HK_SUI_CAMPAIGN_ID"),
      campaignInitialVersion: Number(env("HK_SUI_CAMPAIGN_INITIAL_VERSION", "0")),
      issuerSecretKey: env("HK_SUI_ISSUER_SECRET_KEY"),
      agentSecretKey: env("HK_SUI_AGENT_SECRET_KEY"),
      sponsorSecretKey: env("HK_SUI_SPONSOR_SECRET_KEY", env("HK_SUI_ISSUER_SECRET_KEY")),
      zkSaltSeed: env("HK_ZKLOGIN_SALT_SEED"),
      zkProverUrl: env("HK_ZKLOGIN_PROVER_URL", "https://prover-dev.mystenlabs.com/v1"),
      googleClientId: isolatedMock ? "" : env("NEXT_PUBLIC_GOOGLE_CLIENT_ID"),
      explorer: env("HK_SUI_EXPLORER", "https://suiscan.xyz/testnet"),
    },
    omnione: {
      rpcUrl: env("HK_OMNIONE_RPC_URL"),
      chainId: Number(env("HK_OMNIONE_CHAIN_ID", "201210")),
      privateKey: env("HK_OMNIONE_PRIVATE_KEY"),
      registryAddress: env("HK_OMNIONE_REGISTRY_ADDRESS"),
      gasLimit: BigInt(env("HK_OMNIONE_GAS_LIMIT", "300000")),
    },
    dataDir: env("HK_DATA_DIR", isolatedMock ? ".data/hackathon-isolated" : ".data/hackathon"),
  }
}

export type HkConfig = ReturnType<typeof hkConfig>

/** Isolation is an execution boundary, not a simulated chain confirmation. */
export function assertExternalServicesEnabled(service: string) {
  if (hkConfig().isolatedMock) throw new HkError("isolated_mock_external_disabled", `${service} is disabled in isolated mock mode; live verification remains pending`, 503)
}

/** Public, non-secret view for the UI and evidence screens. */
export function hkPublicConfig() {
  const c = hkConfig()
  return {
    isolatedMock: c.isolatedMock,
    campaign: c.campaign,
    modes: {
      cx: c.cx.mode,
      opendid: c.opendid.mode,
      ai: c.ai.mode,
      sui: c.isolatedMock ? "disabled-isolated" : c.sui.packageId && c.sui.issuerSecretKey && c.sui.agentSecretKey ? "testnet" : "unconfigured",
      omnione: c.isolatedMock ? "disabled-isolated" : c.omnione.rpcUrl && c.omnione.privateKey && c.omnione.registryAddress ? "stage" : "unconfigured",
      zklogin: c.isolatedMock ? "disabled-isolated" : c.sui.googleClientId && c.sui.zkSaltSeed ? "google" : "demo-signer",
    },
    capabilities: { opendidProviderReady: false, chainExecutionEnabled: !c.isolatedMock },
    sui: { network: c.sui.network, packageId: c.isolatedMock ? "" : c.sui.packageId, campaignId: c.isolatedMock ? "" : c.sui.campaignId, explorer: c.isolatedMock ? "" : c.sui.explorer, googleClientId: c.sui.googleClientId },
    omnione: { chainId: c.omnione.chainId, registryAddress: c.isolatedMock ? "" : c.omnione.registryAddress },
    ttl: HK_TTL,
    consentVersion: HK_CONSENT_VERSION,
    schemaVersion: HK_SCHEMA_VERSION,
  }
}
