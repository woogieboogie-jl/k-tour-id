import { existsSync, readFileSync } from "node:fs"
import { dirname, extname, relative, resolve } from "node:path"
import { expect, test } from "@playwright/test"
import { B_PRODUCTION_FLOWS, B_PRODUCTION_VISUAL_CASES } from "../helpers/ondo-b-production-registry"

const APP_ROOT = process.cwd()
const B_ENTRY = resolve(APP_ROOT, "app/page.tsx")
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".json"] as const

function localImportTargets(source: string) {
  const pattern = /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g
  return [...source.matchAll(pattern)]
    .map((match) => match[1])
    .filter((target) => target.startsWith(".") || target.startsWith("@/"))
}

function resolveSource(importer: string, target: string) {
  const base = target.startsWith("@/") ? resolve(APP_ROOT, target.slice(2)) : resolve(dirname(importer), target)
  const candidates = extname(base)
    ? [base]
    : [...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`), ...SOURCE_EXTENSIONS.map((extension) => resolve(base, `index${extension}`))]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function productionImportGraph() {
  const pending = [B_ENTRY]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const file = pending.pop()
    if (!file || visited.has(file)) continue
    visited.add(file)
    for (const target of localImportTargets(readFileSync(file, "utf8"))) {
      const dependency = resolveSource(file, target)
      if (dependency && !visited.has(dependency)) pending.push(dependency)
    }
  }
  return [...visited].sort()
}

function graphSource(files: readonly string[]) {
  return files.map((file) => ({
    file: relative(APP_ROOT, file),
    source: readFileSync(file, "utf8"),
  }))
}

const FALSE_OR_TEST_COPY = [
  /\bdemo(?:nstration)?\b/i,
  /\bsimulat(?:e|ed|es|ing|ion|ions)\b/i,
  /\b(?:legacy\s+)?fixtures?\b/i,
  /\bmock(?:ed|s)?\b/i,
  /\bhypoth(?:esis|eses)\b/i,
  /\btest[- ]?tokens?\b/i,
  /\blocal preview\b/i,
  /\bOOKRW\b/i,
  /\b(?:payment\s+)?KYC\b/i,
  /\bcheckout\b/i,
  /\btrust\s+(?:score|axis|axes)\b/i,
  /\bvisit\s+stamps?\b/i,
  /\b(?:wallet|bridge)\s+(?:success|complete|confirmed)\b/i,
  /데모|시뮬레이션|모의\s*(?:성공|결제|인증)|가설|테스트\s*토큰|픽스처|샘플\s*(?:데이터|신호)/i,
] as const

// These exact disclosures belong to the explicitly selected stablecoin
// rehearsal. Do not exempt the whole component: a provider-success assertion,
// unqualified token claim, or the same copy on another surface must still fail.
const STABLECOIN_DISCLOSURES: Readonly<Record<string, ReadonlySet<string>>> = {
  "features/ondo/commerce-b/id-wallet-commerce-b.tsx": new Set([
    "Travel balance is displayed in KRW. Stablecoin funding has its own asset, network and transfer steps. OOKRW is a separate settlement test-token concept, not redeemable won.",
    "여행 잔액은 KRW로 표시합니다. 스테이블코인은 별도 자산·네트워크·전송 단계를 거칩니다. OOKRW는 정산 테스트 토큰 개념이며 상환 가능한 원화가 아닙니다.",
    "旅の残高はKRWで表示します。ステーブルコインは資産・ネットワーク・送信を個別に確認します。OOKRWは精算テストトークンの概念で、換金可能なウォンではありません。",
  ]),
  "features/ondo/commerce-b/stablecoin-funding-b.tsx": new Set([
    "Target: Sui Testnet · simulated. No account login or signature is sent.",
    "대상: Sui Testnet · 시뮬레이션. 실제 로그인·서명은 보내지 않아요.",
    "対象：Sui Testnet・シミュレーション。実際のログインや署名は送信しません。",
    "Interoperability hypothesis", "상호운용 가설 시연", "相互運用の仮説デモ",
    "simulated", "시뮬레이션", "シミュレーション",
    "Sui → OmniOne is a simulated interoperability hypothesis, not a supported native bridge. OOKRW is a settlement test-token concept, not redeemable won. These USDC/USDT samples do not claim native or wrapped token availability. Rates and fees are illustrative; no AMM swap is executed.",
    "Sui → OmniOne은 상호운용 가설 시연이며, 지원이 확인된 네이티브 브리지가 아니에요. OOKRW는 정산 테스트 토큰 개념이지 상환 가능한 원화가 아닙니다. USDC·USDT 샘플은 실제 네이티브·래핑 토큰 지원을 뜻하지 않아요. 환산율·수수료는 예시이며 AMM 스왑은 실행하지 않습니다.",
    "Sui → OmniOneは相互運用の仮説デモで、対応済みのネイティブブリッジではありません。OOKRWは精算テストトークンの概念で、換金可能なウォンではありません。USDC・USDTサンプルは実際のトークン対応を示しません。レート・手数料は例で、AMMスワップは実行しません。",
  ]),
}
const STABLECOIN_DISCLOSURE_PATTERNS = new Set([
  /\bsimulat(?:e|ed|es|ing|ion|ions)\b/i,
  /\bhypoth(?:esis|eses)\b/i,
  /\btest[- ]?tokens?\b/i,
  /\bOOKRW\b/i,
  /데모|시뮬레이션|모의\s*(?:성공|결제|인증)|가설|테스트\s*토큰|픽스처|샘플\s*(?:데이터|신호)/i,
].map(String))
function isExplicitStablecoinDisclosure(file: string, literal: string, pattern: RegExp) {
  return STABLECOIN_DISCLOSURES[file]?.has(literal) === true && STABLECOIN_DISCLOSURE_PATTERNS.has(String(pattern))
}

// These labels describe the optional, review-only collection. Exempt only
// this vocabulary, never provider-success claims or an entire Journey file.
const JOURNEY_VISIT_LABELS: Readonly<Record<string, ReadonlySet<string>>> = {
  "features/ondo/commerce-b/journey-visit-b.tsx": new Set(["About visit stamps"]),
  "features/ondo/identity-b/journey-stamps-b.tsx": new Set([
    "Explore Korea. Review visit stamps will appear here.",
    "Visit stamp ${number}",
  ]),
}
function isJourneyVisitLabel(file: string, literal: string, pattern: RegExp) {
  return String(pattern) === String(/\bvisit\s+stamps?\b/i) && JOURNEY_VISIT_LABELS[file]?.has(literal) === true
}

test("PROD-B-001 canonical / keeps the official guest discovery foundation reachable", () => {
  const paths = productionImportGraph().map((file) => relative(APP_ROOT, file))
  expect(paths).toContain("features/ondo/map/map-entry-b.tsx")
  expect(paths).toContain("features/ondo/place/canonical-place-overlay.tsx")
  expect(paths).toContain("lib/ondo/venues/map-data.ts")
  expect(paths).toContain("data/ondo-venues/canonical-venues-map.json")
})

test("PROD-B-002 official-source discovery truth remains a positive boundary", () => {
  const graph = productionImportGraph().map((file) => readFileSync(file, "utf8")).join("\n")
  expect(graph).toContain("MOIS_LOCALDATA_GENERAL_RESTAURANTS")
  expect(graph).toContain("OFFICIAL_SOURCE")
  expect(graph).toContain("UNKNOWN")
  expect(graph).toContain("canonical-venue-directions")
})

test("PROD-B-003 QA and Labs session seams stay allow-listed, session-only, and separate from device state", () => {
  const source = graphSource(productionImportGraph())
  const queryHits = source.filter(({ source: text }) => (
    /\.get\(\s*["'](?:scenario|qa|qaCase)["']\s*\)/.test(text)
  )).map(({ file }) => file)
  const directQaGlobalHits = source.filter(({ source: text }) => /__ONDO_B_QA__/.test(text)).map(({ file }) => file)
  const qaModule = source.find(({ file }) => file === "features/ondo/shared/ui/use-qa-controls.ts")?.source ?? ""
  const sessionHits = source.filter(({ source: text }) => /\bsessionStorage\b/.test(text)).map(({ file }) => file)
  const legacyKeys = /ondo\.(?:preferences|session)\.v3|ondo\.(?:chat|table-outcomes|labs|accepted-visits)\.v2/
  const legacyHits = source.filter(({ source: text }) => legacyKeys.test(text)).map(({ file }) => file)
  const storageKeys = [...new Set(source.flatMap(({ source: text }) => (
    [...text.matchAll(/["'](ondo(?:-b)?\.[a-z0-9.-]+)["']/gi)].map((match) => match[1])
  )))]
  // These literal identifiers bind a presentation audience/domain. They
  // are not storage keys; all actual session storage remains allow-listed.
  const presentationIdentifiers = new Set(["ondo.demo", "ondo.demo.service", "ondo.sample.partner"])
  const nonDeviceKeys = storageKeys.filter((key) => key !== "ondo-b.device.v1" && !presentationIdentifiers.has(key))

  expect(directQaGlobalHits).toEqual(["features/ondo/shared/ui/use-qa-controls.ts"])
  expect(qaModule).toContain('QA_RUNTIME_ENABLED = process.env.NEXT_PUBLIC_ONDO_QA_CONTROLS === "1"')
  expect(qaModule).toContain("if (!QA_RUNTIME_ENABLED) return")
  expect(qaModule).toContain('window.sessionStorage.getItem(QA_ENABLED_KEY) === "1"')
  const runtimeReader = qaModule.slice(qaModule.indexOf("export function readQaRuntime"))
  expect(runtimeReader).toContain("if (!hasQaSessionOptIn()) return undefined")
  expect(runtimeReader.indexOf("if (!hasQaSessionOptIn()) return undefined"))
    .toBeLessThan(runtimeReader.indexOf("__ONDO_B_QA__"))

  expect({
    queryInjection: queryHits.sort(),
    sessionStorage: sessionHits.sort(),
    legacyStorage: legacyHits,
    nonDeviceStorageKeys: nonDeviceKeys.sort(),
  }).toEqual({
    queryInjection: [
      "features/ondo/shared/ui/use-qa-controls.ts",
    ],
    sessionStorage: [
      "features/ondo/after19/after19-global-b-model.ts",
      "features/ondo/after19/after19-global-b.tsx",
      "features/ondo/after19/after19-place-return-b-model.ts",
      "features/ondo/commerce-b/id-wallet-commerce-b.tsx",
      "features/ondo/connect/tables-entry-b.tsx",
      "features/ondo/experience-b/experience-b.tsx",
      "features/ondo/hackathon-b/hackathon-campaign.ts",
      "features/ondo/hackathon-b/hackathon-client.ts",
      "features/ondo/hackathon-b/hackathon-layer-b.tsx",
      "features/ondo/identity-b/action-gate-contract-b.ts",
      "features/ondo/identity-b/action-gate-coordinator-b.tsx",
      "features/ondo/identity-b/activity-profile-b-provider.tsx",
      "features/ondo/identity-b/ktour-id-setup-b.tsx",
      "features/ondo/identity-b/profile-reputation-b.tsx",
      "features/ondo/identity-b/traveler-id-entry-b.tsx",
      "features/ondo/labs/labs-entry.tsx",
      "features/ondo/local-signal-b/local-signal-layer-b.tsx",
      "features/ondo/map/map-entry-b.tsx",
      "features/ondo/place/canonical-place-overlay.tsx",
      "features/ondo/reservation-b/reservation-b.tsx",
      "features/ondo/settings/account-services-sample-b.tsx",
      "features/ondo/settings/settings-entry-b.tsx",
      "features/ondo/settings/settings-model-b.ts",
      "features/ondo/shared/state/ondo-b-provider.tsx",
      "features/ondo/shared/ui/use-qa-controls.ts",
    ],
    legacyStorage: [
      "features/ondo/after19/after19-global-b-model.ts",
      "features/ondo/identity-b/activity-profile-b-provider.tsx",
      "features/ondo/shared/state/ondo-b-provider.tsx",
    ],
    nonDeviceStorageKeys: [
      "ondo-b.account-services-sample.v1",
      "ondo-b.account.v1",
      "ondo-b.action-gates.v1",
      "ondo-b.activity-profile.v1",
      "ondo-b.after19.preferences.v1",
      "ondo-b.after19.session.v1",
      "ondo-b.current-action.after19.v2",
      "ondo-b.discovery.return-ui.v1",
      "ondo-b.funding-rail.v1",
      "ondo-b.hackathon.holder.v1",
      "ondo-b.hackathon.pending.v1",
      "ondo-b.hackathon.signer.v1",
      "ondo-b.labs.v1",
      "ondo-b.reservation-sample.v1",
      "ondo-b.table-activity.v1",
      "ondo.preferences.v3",
      "ondo.qa.controls.v1",
      "ondo.qa.scenario.v1",
      "ondo.review.flow.v1",
      "ondo.session.v3",
    ],
  })
})

test("PROD-B-004 sample disclosures are explicit without false provider-success copy", () => {
  const source = graphSource(productionImportGraph()).filter(({ file }) => /\.tsx$/.test(file))
  const rawHits = source.flatMap(({ file, source: text }) => {
    const literals = [...text.matchAll(/(["'`])([^"'`\n]{1,500})\1/g)].map((match) => match[2])
    return literals.flatMap((literal) => FALSE_OR_TEST_COPY
      .filter((pattern) => pattern.test(literal))
      .filter((pattern) => {
        if (isExplicitStablecoinDisclosure(file, literal, pattern)) return false
        if (isJourneyVisitLabel(file, literal, pattern)) return false
        // This selector is not consumer copy. The option's visible label uses
        // the existing shared sample disclosure and remains sample-session gated.
        if (file === "features/ondo/map/map-options-b.tsx" && literal === "ondo-b-map-options-demo") return false
        // Opt-in integration test selectors and internal mode discriminants are
        // not consumer copy. Never exempt arbitrary copy or a whole component.
        if (file === "features/ondo/hackathon-b/hackathon-layer-b.tsx") {
          if (String(pattern) === String(/\bdemo(?:nstration)?\b/i)
            && ["hackathon-demo-entry", "hackathon-signer-demo", "demo", "demo-signer"].includes(literal)) return false
          if (String(pattern) === String(/\bmock(?:ed|s)?\b/i) && literal === "mock") return false
        }
        const commerceFile = file === "features/ondo/commerce-b/id-wallet-commerce-b.tsx"
          || file === "features/ondo/commerce-b/wallet-connection-preview-b.tsx"
        const placeFile = file === "features/ondo/place/canonical-place-overlay.tsx"
        const myKoreaFile = file === "features/ondo/my/saved-entry-b.tsx"
        const settingsFile = file === "features/ondo/settings/settings-entry-b.tsx"
        const truthfulLabsFile = file === "features/ondo/labs/labs-entry.tsx"
        const truthfulIntegrationFile = file === "features/ondo/integration-demo-b/integration-demo-b.tsx"
          || file === "features/ondo/integration-demo-b/partner-handoff-b.tsx"
        const sampleDisclosureFile = [
          "features/ondo/app/ondo-app-b.tsx",
          "features/ondo/shared/ui/sample-info-button-b.tsx",
          "features/ondo/map/temperature-timeline-b.tsx",
          "features/ondo/identity-b/kpass-service-card-b.tsx",
        ].includes(file)
        const truthfulIdentityFile = file === "features/ondo/identity-b/ktour-id-setup-b.tsx"
          || file === "features/ondo/identity-b/identity-handoff-step-b.tsx"
          || file === "features/ondo/identity-b/identity-holder-step-b.tsx"
          || file === "features/ondo/identity-b/passport-face-step-b.tsx"
          || file === "features/ondo/identity-b/passport-ocr-step-b.tsx"
          || file === "features/ondo/identity-b/ktour-id-setup-model-b.ts"
          || file === "features/ondo/identity-b/traveler-id-entry-b.tsx"
          || file === "features/ondo/onboarding/official-directory-onboarding.tsx"
        const truthfulAccountFile = file === "features/ondo/identity-b/account-save-gate-b.tsx"
        const truthfulActionGateFile = file === "features/ondo/identity-b/action-gate-coordinator-b.tsx"
        const truthfulAfter19File = file === "features/ondo/after19/after19-global-b.tsx"
        const truthfulVisitFile = file === "features/ondo/commerce-b/visit-stamp-receipt-b.tsx"
          || file === "features/ondo/identity-b/profile-reputation-b.tsx"
        const explicitIdentityEnvironment = String(pattern).includes("simulat")
          || String(pattern).includes("demo")
          || String(pattern).includes("데모|시뮬레이션")
        if ((sampleDisclosureFile || truthfulIntegrationFile || commerceFile) && explicitIdentityEnvironment) return false
        if (truthfulIntegrationFile && String(pattern) === String(/\bcheckout\b/i)) return false
        if (truthfulIdentityFile && explicitIdentityEnvironment) return false
        if (truthfulAfter19File && explicitIdentityEnvironment) return false
        if (truthfulIdentityFile && String(pattern) === String(/\blocal preview\b/i)) return false
        if ((truthfulAccountFile || truthfulActionGateFile) && explicitIdentityEnvironment) return false
        if (truthfulLabsFile) return false
        if (myKoreaFile && explicitIdentityEnvironment && /Labs|wallet|bridge|지갑|체인|ウォレット|ブリッジ/.test(literal)) return false
        if (String(pattern) === String(/\blocal preview\b/i) && commerceFile && literal.startsWith("Device-local preview · no AI call")) return false
        if (String(pattern) === String(/\bOOKRW\b/i) && commerceFile) return false
        if (String(pattern) === String(/\bOOKRW\b/i) && placeFile && /OOKRW Test/.test(literal) && /Confirm payment support|실제 결제 지원/.test(literal)) return false
        if (String(pattern) === String(/\bOOKRW\b/i) && myKoreaFile && /(?:Paid )?19 OOKRW(?: 결제)?/.test(literal)) return false
        if (String(pattern) === String(/\bOOKRW\b/i) && myKoreaFile && literal === "${copy.paid} ${state.commerceSession.chargedDebit} OOKRW") return false
        if (String(pattern) === String(/\bOOKRW\b/i) && myKoreaFile && literal === "${copy.refunded} ${state.commerceSession.chargedDebit} OOKRW") return false
        if (String(pattern) === String(/\bOOKRW\b/i) && settingsFile && /OOKRW Test(?: receipts| 영수증|のレシート)/.test(literal)) return false
        if (String(pattern) === String(/\bcheckout\b/i) && commerceFile && literal === "ondo-b-stable-checkout") return false
        // Internal operation discriminant, never a user-visible success claim.
        if (String(pattern) === String(/\bcheckout\b/i) && literal === "checkout"
          && (commerceFile || file === "features/ondo/commerce-b/commerce-refunds-b.tsx")) return false
        if (String(pattern) === String(/\bcheckout\b/i) && truthfulVisitFile && literal === "checkout-stamp-milestone") return false
        if (String(pattern) === String(/\bcheckout\b/i) && truthfulActionGateFile && /^(?:checkout|Meal offer checkout)$/.test(literal)) return false
        if (String(pattern) === String(/\b(?:payment\s+)?KYC\b/i) && truthfulActionGateFile && /No .*provider is connected|없습니다|接続しません/.test(literal)) return false
        if (String(pattern) === String(/\bvisit\s+stamps?\b/i) && (truthfulVisitFile || settingsFile)) return false
        return true
      })
      .map((pattern) => ({ file, literal: literal.slice(0, 180), pattern: String(pattern) })))
  })
  const hits = [...new Map(rawHits.map((hit) => [`${hit.file}\u0000${hit.pattern}`, hit])).values()]
  expect(hits, JSON.stringify(hits, null, 2)).toEqual([])
  const integration = source.find(({ file }) => file === "features/ondo/integration-demo-b/integration-demo-b.tsx")?.source ?? ""
  expect(integration).toContain("useReviewSampleSession()")
  expect(integration).toContain('data-provenance="SIMULATED"')
  expect(integration).not.toMatch(/fetch\(|XMLHttpRequest|WebSocket|EventSource/)
  const stablecoin = source.find(({ file }) => file === "features/ondo/commerce-b/stablecoin-funding-b.tsx")?.source ?? ""
  expect(stablecoin).toContain("Sample journey · no real funds move")
  expect(stablecoin).toContain("not a supported native bridge")
  expect(stablecoin).toContain("do not claim native or wrapped token availability")
  expect(stablecoin).toContain("not redeemable won")
  expect(stablecoin).not.toMatch(/fetch\(|XMLHttpRequest|WebSocket|EventSource/)
})

test("PROD-B-004S stablecoin disclosure exceptions cannot allow false settlement or other surfaces", () => {
  const path = "features/ondo/commerce-b/stablecoin-funding-b.tsx"
  expect(isExplicitStablecoinDisclosure(path, "Interoperability hypothesis", /\bhypoth(?:esis|eses)\b/i)).toBe(true)
  expect(isExplicitStablecoinDisclosure("features/ondo/map/map-entry-b.tsx", "Interoperability hypothesis", /\bhypoth(?:esis|eses)\b/i)).toBe(false)
  expect(isExplicitStablecoinDisclosure(path, "Bridge confirmed", /\b(?:wallet|bridge)\s+(?:success|complete|confirmed)\b/i)).toBe(false)
  expect(isExplicitStablecoinDisclosure(path, "OOKRW is redeemable won", /\bOOKRW\b/i)).toBe(false)
  expect(isExplicitStablecoinDisclosure(path, "Simulated wallet success", /\bsimulat(?:e|ed|es|ing|ion|ions)\b/i)).toBe(false)
})

test("PROD-B-004J Journey labels cannot exempt provider claims or other surfaces", () => {
  const path = "features/ondo/commerce-b/journey-visit-b.tsx"
  expect(isJourneyVisitLabel(path, "About visit stamps", /\bvisit\s+stamps?\b/i)).toBe(true)
  expect(isJourneyVisitLabel("features/ondo/map/map-entry-b.tsx", "About visit stamps", /\bvisit\s+stamps?\b/i)).toBe(false)
  expect(isJourneyVisitLabel(path, "Verified visit stamp", /\bvisit\s+stamps?\b/i)).toBe(false)
  expect(isJourneyVisitLabel(path, "Wallet success", /\b(?:wallet|bridge)\s+(?:success|complete|confirmed)\b/i)).toBe(false)
})

test("PROD-B-005 six production flows remain the guest foundation, not the whole PRD gate", () => {
  expect(B_PRODUCTION_FLOWS.map((flow) => flow.id)).toEqual([
    "PR-FL-001",
    "PR-FL-002",
    "PR-FL-003",
    "PR-FL-004",
    "PR-FL-005",
    "PR-FL-006",
  ])
  expect(B_PRODUCTION_VISUAL_CASES).toHaveLength(20)
  expect(new Set(B_PRODUCTION_VISUAL_CASES.map((item) => item.id)).size).toBe(20)
  expect(new Set(B_PRODUCTION_VISUAL_CASES.flatMap((item) => item.flowIds))).toEqual(new Set(B_PRODUCTION_FLOWS.map((flow) => flow.id)))
})
