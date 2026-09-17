"use client"

import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode, type RefObject } from "react"
import { CANONICAL_MAP_VENUES_COMPACT } from "@/lib/ondo/venues/map-data"
import { VisitStampReceiptB } from "../commerce-b/visit-stamp-receipt-b"
import { AlertTriangle, ArrowLeft, ArrowRight, Check, ChevronRight, CircleDollarSign, CircleHelp, CircleMinus, Clock3, FlaskConical, Link2, LoaderCircle, ShieldCheck, Stamp, WalletCards } from "lucide-react"
import { estimatedUsdTotal, type BridgePhase } from "../contracts/commerce"
import { createReviewFixtureAuthority, providerUnavailable, reviewFixture, type ReviewFixtureExecution } from "../contracts/execution-mode"
import { InlineNotice, SheetB } from "../shared/ui/sheet-b"
import { useSheetPresence, type SheetPresencePhase } from "../shared/ui/use-sheet-presence"
import { isRenderedFocusable } from "../shared/ui/is-rendered-focusable"
import { useOndoB } from "../shared/state/ondo-b-provider"
import { useBActivityProfile } from "../identity-b/activity-profile-b-provider"
import { JOURNEY_KEEPSAKE_OPEN_EVENT_B } from "../identity-b/journey-stamps-navigation-b"
import type { OndoBLocale } from "../shared/state/ondo-b-preferences"
import { enterReviewSample, qaReviewFixtureOptions, readQaScenario, useQaControls, useReviewSampleSession } from "../shared/ui/use-qa-controls"
import {
  abandonPendingBAction,
  B_ACTION_AXIS_SESSION_EVENT,
  B_ACTION_GATE_CANCEL_EVENT,
  B_ACTION_GATE_COMPLETE_EVENT,
  B_ACTION_GATE_READY_EVENT,
  consumePendingBActionAtMutation,
  createBBadgeActionReturn,
  finalizeConsumedBAction,
  isBActionReturnPending,
  requestBActionGate,
  restoreBActionGateSession,
  restoreConsumedBActionAfterMutationFailure,
  type BBadgeActionReturn,
} from "../identity-b/action-gate-contract-b"
import { EVIDENCE_FIXTURES, LABS_ASSETS, LABS_SAMPLE_CASES, TRAIT_FIXTURES, bridgeStateForPhase, labsSampleVisitImport, labsSignerIssue, nextBridgePhase, type BridgeState, type LabsSampleCase, type LabsSignerIssue, type WalletState } from "./labs-model"
import {
  createLabsBridgeQuote,
  isLabsBridgeQuote,
  readLabsBadgeReview,
  readLabsBridgeReview,
  readLabsWalletReview,
  type LabsBadgeReviewExecution,
  type LabsBadgeReviewValue,
  type LabsBridgeQuote,
  type LabsBridgeReviewExecution,
  type LabsBridgeReviewValue,
  type LabsWalletReviewExecution,
  type LabsWalletReviewValue,
} from "./labs-review-truth-b"
import styles from "./labs.module.css"

const actionGateSessionOptions = qaReviewFixtureOptions

type MintState = "NFT-LOCKED" | "NFT-ELIGIBLE" | "NFT-OPTED-IN" | "NFT-MINTING" | "NFT-MINTED" | "NFT-FAILED"
type TraitRetryState = "idle" | "checking" | "eligible" | "failed"
type TraitVisualState = "eligible" | "ineligible" | "unknown" | "loading" | "stale" | "error"
type LabsAssetVisualState = "available" | "reserved" | "pending" | "stale" | "error"
type LabsSession = {
  acknowledged: boolean
  wallet: WalletState
  bridge: BridgeState
  phase: BridgePhase
  mint: MintState
  consent: boolean
  quoteExpiresAt: number | null
  traitStates: Record<string, TraitRetryState>
  walletReview: LabsWalletReviewExecution | null
  bridgeReview: LabsBridgeReviewExecution | null
  badgeReview: LabsBadgeReviewExecution | null
}

const B_LABS_SESSION_KEY = "ondo-b.labs.v1"
const WALLET_STATES = new Set<WalletState>(["WAL-DISCONNECTED", "WAL-CONNECTING", "WAL-READY", "WAL-FAILED"])
const BRIDGE_STATES = new Set<BridgeState>(["BRG-IDLE", "BRG-QUOTED", "BRG-CONFIRMING", "BRG-PENDING", "BRG-SIMULATED-SUCCESS", "BRG-FAILED", "BRG-CANCELLED", "BRG-EXPIRED"])
const BRIDGE_PHASES = new Set<BridgePhase>(["none", "source_submitted", "source_confirmed", "relaying", "destination_confirmed"])
const MINT_STATES = new Set<MintState>(["NFT-LOCKED", "NFT-ELIGIBLE", "NFT-OPTED-IN", "NFT-MINTING", "NFT-MINTED", "NFT-FAILED"])
const TRAIT_RETRY_STATES = new Set<TraitRetryState>(["idle", "checking", "eligible", "failed"])
const BRIDGE_NO_PHASE_STATES = new Set<BridgeState>(["BRG-IDLE", "BRG-QUOTED", "BRG-CONFIRMING", "BRG-CANCELLED", "BRG-EXPIRED"])
const BRIDGE_IN_FLIGHT_PHASES = new Set<BridgePhase>(["source_submitted", "source_confirmed", "relaying"])
function isCurrentLabsBridgeQuote(value: LabsBridgeQuote | null, now = Date.now()): value is LabsBridgeQuote {
  return isLabsBridgeQuote(value) && value.expiresAt > now
}

function labsAssetVisualState(assetId: string, wallet: WalletState, bridge: BridgeState): LabsAssetVisualState {
  if (wallet === "WAL-FAILED") return "error"
  if (wallet !== "WAL-READY") return "pending"
  if (assetId === "sui-usdc") return "available"
  if (assetId === "sui-usdt") return bridge === "BRG-PENDING" || bridge === "BRG-CONFIRMING" ? "reserved" : "available"
  if (bridge === "BRG-EXPIRED") return "stale"
  if (bridge === "BRG-FAILED") return "error"
  return bridge === "BRG-SIMULATED-SUCCESS" ? "available" : "pending"
}

type LocalizedLabsCopy = Record<OndoBLocale, string>

function labsCopy(locale: OndoBLocale, ko: string, en: string, ja: string) {
  return ({ ko, en, ja } satisfies LocalizedLabsCopy)[locale]
}

function coherentBridgeRestore(bridge: BridgeState | undefined, phase: BridgePhase | undefined) {
  if (!bridge && !phase) return { bridge: undefined, phase: undefined }
  if (!bridge) return { bridge: "BRG-IDLE" as const, phase: "none" as const }
  if (BRIDGE_NO_PHASE_STATES.has(bridge)) {
    return phase == null || phase === "none"
      ? { bridge, phase: "none" as const }
      : { bridge: "BRG-IDLE" as const, phase: "none" as const }
  }
  if (bridge === "BRG-SIMULATED-SUCCESS") {
    return phase === "destination_confirmed"
      ? { bridge, phase }
      : { bridge: "BRG-IDLE" as const, phase: "none" as const }
  }
  if (bridge === "BRG-PENDING" || bridge === "BRG-FAILED") {
    return phase != null && BRIDGE_IN_FLIGHT_PHASES.has(phase)
      ? { bridge, phase }
      : { bridge: "BRG-IDLE" as const, phase: "none" as const }
  }
  return { bridge: "BRG-IDLE" as const, phase: "none" as const }
}

const TRAIT_DISPLAY = {
  "offer-foreign-card": {
    key: "seongsu-card",
    place: { ko: "성수 돼지국밥", en: "Seongsu Dwaeji Gukbap", ja: "聖水テジクッパ" },
    condition: { ko: "해외 발급 카드 안내", en: "Foreign-issued card information", ja: "海外発行カードの案内" },
    policy: { ko: "카드 이용 정책", en: "Card acceptance policy", ja: "カード利用ポリシー" },
  },
  "offer-over19": {
    key: "euljiro-over19",
    place: { ko: "을지로 노가리", en: "Euljiro Nogari", ja: "乙支路ノガリ" },
    condition: { ko: "19세 이상 이용 조건", en: "19+ access condition", ja: "19歳以上の利用条件" },
    policy: { ko: "야간 이용 정책", en: "Night access policy", ja: "夜間利用ポリシー" },
  },
} satisfies Record<string, {
  key: string
  place: LocalizedLabsCopy
  condition: LocalizedLabsCopy
  policy: LocalizedLabsCopy
}>

function readLabsSession(sessionKey: string): Partial<LabsSession> {
  if (typeof window === "undefined") return {}
  try {
    const raw = JSON.parse(window.sessionStorage.getItem(sessionKey) ?? "{}") as unknown
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return {}
    const value = raw as Record<string, unknown>
    const wallet = typeof value.wallet === "string" && WALLET_STATES.has(value.wallet as WalletState) ? value.wallet as WalletState : undefined
    const bridgeCandidate = typeof value.bridge === "string" && BRIDGE_STATES.has(value.bridge as BridgeState) ? value.bridge as BridgeState : undefined
    const phaseCandidate = typeof value.phase === "string" && BRIDGE_PHASES.has(value.phase as BridgePhase) ? value.phase as BridgePhase : undefined
    const { bridge, phase } = coherentBridgeRestore(bridgeCandidate, phaseCandidate)
    const mint = typeof value.mint === "string" && MINT_STATES.has(value.mint as MintState) ? value.mint as MintState : undefined
    const walletReview = readLabsWalletReview(value.walletReview)
    const bridgeReview = readLabsBridgeReview(value.bridgeReview)
    const badgeReview = readLabsBadgeReview(value.badgeReview)
    const traitStates = value.traitStates != null && typeof value.traitStates === "object" && !Array.isArray(value.traitStates)
      ? Object.fromEntries(Object.entries(value.traitStates as Record<string, unknown>)
          .filter((entry): entry is [string, TraitRetryState] => typeof entry[1] === "string" && TRAIT_RETRY_STATES.has(entry[1] as TraitRetryState))
          .slice(0, 20))
      : undefined
    return {
      acknowledged: value.acknowledged === true,
      wallet,
      bridge,
      phase,
      mint,
      consent: value.consent === true,
      quoteExpiresAt: typeof value.quoteExpiresAt === "number" && Number.isFinite(value.quoteExpiresAt) ? value.quoteExpiresAt : undefined,
      traitStates,
      walletReview,
      bridgeReview,
      badgeReview,
    }
  } catch {
    return {}
  }
}

const BRIDGE_COPY: Record<Exclude<BridgePhase, "none">, LocalizedLabsCopy> = {
  source_submitted: { ko: "출발 체인 제출됨 · 시뮬레이션", en: "Source submitted · Simulated", ja: "送信元チェーンに提出済み · シミュレーション" },
  source_confirmed: { ko: "출발 체인 확인됨 · 도착 전", en: "Source confirmed · Destination pending", ja: "送信元チェーンで確認済み · 到着待ち" },
  relaying: { ko: "전달 단계 · 시뮬레이션", en: "Relaying · Simulated", ja: "中継中 · シミュレーション" },
  destination_confirmed: { ko: "도착 단계 확인됨 · 시뮬레이션", en: "Destination confirmed · Simulated", ja: "送信先で確認済み · シミュレーション" },
}

const B_BRIDGE_COPY: Record<Exclude<BridgePhase, "none">, LocalizedLabsCopy> = {
  source_submitted: { ko: "출발 요청 제출", en: "Source submitted", ja: "送信元リクエスト提出" },
  source_confirmed: { ko: "출발 확인 · 도착 대기", en: "Source confirmed · Destination pending", ja: "送信元確認・到着待ち" },
  relaying: { ko: "도착지로 전달 중", en: "Relaying", ja: "送信先へ転送中" },
  destination_confirmed: { ko: "도착 확인", en: "Destination confirmed", ja: "送信先確認" },
}

const BRIDGE_PHASE_ORDER = ["source_submitted", "source_confirmed", "relaying", "destination_confirmed"] as const
const B_BRIDGE_SHORT_COPY: Record<(typeof BRIDGE_PHASE_ORDER)[number], LocalizedLabsCopy> = {
  source_submitted: { ko: "시작", en: "Start", ja: "開始" },
  source_confirmed: { ko: "확인", en: "Check", ja: "確認" },
  relaying: { ko: "이동", en: "Move", ja: "移動" },
  destination_confirmed: { ko: "도착", en: "Arrive", ja: "到着" },
}
const B_LABS_USD_BALANCE = LABS_ASSETS
  .filter((asset) => asset.symbol === "USDC" || asset.symbol === "USDT")
  .reduce((total, asset) => total + Number(asset.amount), 0)
const B_LABS_KRW_BALANCE = Number(LABS_ASSETS.find((asset) => asset.symbol === "OOKRW")?.amount ?? 0)
type LabsOriginTab = "ondo" | "my" | "tables" | "id" | "settings"

type LabsEntryCoreProps = {
  credential?: import("../contracts/kpass-capabilities").KPassDemoCredential | null
  locale: OndoBLocale
  originTab: LabsOriginTab
  stamps: number
  provider: "legacy" | "b"
  sessionKey: string
  onDismiss(): void
  sampleVisit?: ReactNode
  onLoadSampleVisits?: () => boolean
  presenceState?: Exclude<SheetPresencePhase, "closed">
  purpose?: "general" | "keepsake"
}

/** A nested task: the place, receipt, or Journey collection stays mounted below it. */
export function JourneyKeepsakeB() {
  const { state } = useOndoB()
  const { state: activity } = useBActivityProfile()
  const [requestedOrigin, setRequestedOrigin] = useState<{ tab: LabsOriginTab; opener: HTMLElement | null } | null>(null)
  const presence = useSheetPresence(requestedOrigin)
  const lastOriginRef = useRef<typeof requestedOrigin>(null)

  useEffect(() => {
    function open() {
      const active = document.activeElement
      setRequestedOrigin((current) => current ?? {
        tab: state.tab,
        opener: active instanceof HTMLElement && active !== document.body ? active : null,
      })
    }
    window.addEventListener(JOURNEY_KEEPSAKE_OPEN_EVENT_B, open)
    return () => window.removeEventListener(JOURNEY_KEEPSAKE_OPEN_EVENT_B, open)
  }, [state.tab])

  useEffect(() => {
    if (presence.value) {
      lastOriginRef.current = presence.value
      return
    }
    const opener = lastOriginRef.current?.opener
    lastOriginRef.current = null
    if (!opener) return
    // Restore the actual trigger after the retained exit and isolation cleanup.
    // SheetB retains its normal fallback when that trigger no longer exists.
    const timer = window.setTimeout(() => {
      if (isRenderedFocusable(opener)) opener.focus({ preventScroll: true })
    }, 90)
    return () => window.clearTimeout(timer)
  }, [presence.value])

  if (!presence.value) return null
  return <LabsEntryCore
    locale={state.locale}
    credential={state.identityCredential}
    originTab={presence.value.tab}
    stamps={activity.stamps}
    provider="b"
    purpose="keepsake"
    sessionKey={B_LABS_SESSION_KEY}
    presenceState={presence.phase}
    onDismiss={() => setRequestedOrigin(null)}
  />
}

export function LabsEntryB({ presenceState = "open" }: { presenceState?: Exclude<SheetPresencePhase, "closed"> }) {
  const { state, actions } = useOndoB()
  const { state: activity, actions: activityActions } = useBActivityProfile()
  const reviewSample = useReviewSampleSession()
  const originTab = useRef(state.tab).current
  const nextVisit = CANONICAL_MAP_VENUES_COMPACT.find(venue => !activity.acceptedEvidenceIds.includes(`visit:${venue.id}`))
  return (
    <LabsEntryCore
      locale={state.locale}
      credential={state.identityCredential}
      originTab={originTab}
      stamps={activity.stamps}
      sampleVisit={reviewSample && activity.stamps === 9 && nextVisit ? <VisitStampReceiptB key={nextVisit.id} locale={state.locale} venueId={nextVisit.id} /> : undefined}
      onLoadSampleVisits={reviewSample ? () => {
        const evidenceIds = labsSampleVisitImport(CANONICAL_MAP_VENUES_COMPACT.map(venue => venue.id), activity.acceptedEvidenceIds, activity.stamps)
        for (const evidenceId of evidenceIds) {
          const result = activityActions.recordUniqueVisit(evidenceId)
          if (result !== "accepted" && result !== "duplicate") return false
        }
        return true
      } : undefined}
      provider="b"
      sessionKey={B_LABS_SESSION_KEY}
      presenceState={presenceState}
      onDismiss={() => {
        actions.setTab(originTab)
        actions.setSurface({ kind: "map" })
      }}
    />
  )
}

export function LabsEntryCore({ locale, credential, originTab: originTabValue, stamps, provider, sessionKey, onDismiss, sampleVisit, onLoadSampleVisits, presenceState = "open", purpose = "general" }: LabsEntryCoreProps) {
  const isKeepsake = purpose === "keepsake"
  const liveCredentialRef = useRef(credential)
  liveCredentialRef.current = credential
  const qaControls = useQaControls()
  const [sampleCase, setSampleCase] = useState<LabsSampleCase>("success")
  const sampleCaseRef = useRef<LabsSampleCase>("success")
  const [signerIssue, setSignerIssue] = useState<LabsSignerIssue | null>(null)
  const [sampleHistoryFailed, setSampleHistoryFailed] = useState(false)
  const [duplicateBadge, setDuplicateBadge] = useState(false)
  const sampleTimersRef = useRef(new Set<number>())
  const liveSampleModeRef = useRef(qaControls)
  liveSampleModeRef.current = qaControls
  useEffect(() => () => { for (const timer of sampleTimersRef.current) window.clearTimeout(timer); sampleTimersRef.current.clear() }, [])

  function scheduleSample(callback: () => void, delay: number) {
    const timer = window.setTimeout(() => { sampleTimersRef.current.delete(timer); callback() }, delay)
    sampleTimersRef.current.add(timer)
  }
  function selectSampleCase(next: LabsSampleCase) { sampleCaseRef.current = next; setSampleCase(next) }
  function sampleCaseIs(next: LabsSampleCase, legacyScenario?: string) {
    return (provider === "b" && liveSampleModeRef.current && sampleCaseRef.current === next)
      || Boolean(legacyScenario && readQaScenario() === legacyScenario)
  }
  const originTab = useRef(originTabValue).current
  const [acknowledged, setAcknowledged] = useState(false)
  const [wallet, setWallet] = useState<WalletState>("WAL-DISCONNECTED")
  const [bridge, setBridge] = useState<BridgeState>("BRG-IDLE")
  const [phase, setPhase] = useState<BridgePhase>("none")
  const [mint, setMint] = useState<MintState>(stamps === 10 ? "NFT-ELIGIBLE" : "NFT-LOCKED")
  const [consent, setConsent] = useState(false)
  const [mismatch, setMismatch] = useState(false)
  const [quoteExpiresAt, setQuoteExpiresAt] = useState<number | null>(null)
  const [traitStates, setTraitStates] = useState<Record<string, TraitRetryState>>({})
  const [walletReview, setWalletReview] = useState<LabsWalletReviewExecution | null>(null)
  const [bridgeReview, setBridgeReview] = useState<LabsBridgeReviewExecution | null>(null)
  const [badgeReview, setBadgeReview] = useState<LabsBadgeReviewExecution | null>(null)
  const [sessionLoaded, setSessionLoaded] = useState(false)
  const quoteButtonRef = useRef<HTMLButtonElement>(null)
  const confirmButtonRef = useRef<HTMLButtonElement>(null)
  const submitButtonRef = useRef<HTMLButtonElement>(null)
  const advanceButtonRef = useRef<HTMLButtonElement>(null)
  const progressRef = useRef<HTMLOListElement>(null)
  const bridgeReceiptRef = useRef<HTMLDivElement>(null)
  const walletRetryRef = useRef<HTMLButtonElement>(null)
  const badgeButtonRef = useRef<HTMLButtonElement>(null)
  const badgeSectionRef = useRef<HTMLElement>(null)
  const badgeResultRef = useRef<HTMLDivElement>(null)
  const badgeReturnRef = useRef<BBadgeActionReturn | null>(null)
  const badgeTimerRef = useRef<number | null>(null)
  const bridgeQuoteRef = useRef<LabsBridgeQuote | null>(null)
  const bridgeExecutionRef = useRef<ReviewFixtureExecution<LabsBridgeReviewValue> | null>(null)
  const sessionWasRestored = useRef(false)
  const estimatedTotal = useMemo(() => estimatedUsdTotal(LABS_ASSETS), [])
  const text = (ko: string, en: string, ja: string) => labsCopy(locale, ko, en, ja)
  const sampleCaseLabels: Record<LabsSampleCase, string> = {
    success: text("성공", "Success", "成功"),
    oauth_cancel: text("로그인 취소", "Cancel sign-in", "ログインをキャンセル"),
    epoch_expired: text("서명 세션 만료", "Expired signer session", "署名セッションの期限切れ"),
    salt_recovery: text("서명 복구", "Signer recovery", "署名の復旧"),
    prover_failed: text("증명 서비스 오류", "Proof service error", "証明サービスのエラー"),
    wrong_network: text("다른 네트워크", "Wrong network", "ネットワークの相違"),
    sponsor_denied: text("가스 지원 거절", "Gas sponsorship declined", "ガス支援の拒否"),
    bridge_failed: text("경로 중단", "Route interrupted", "経路の中断"),
    quote_expired: text("견적 만료", "Quote expired", "見積もりの期限切れ"),
    trait_failed: text("상점 조건 확인 오류", "Merchant check error", "店舗条件の確認エラー"),
    mint_failed: text("배지 준비 오류", "Badge creation error", "バッジ作成エラー"),
  }
  const signerIssueCopy = signerIssue === "oauth_cancel"
    ? text("로그인을 취소했어요. 다시 시작할 수 있어요.", "Sign-in was cancelled. You can start again.", "ログインをキャンセルしました。もう一度始められます。")
    : signerIssue === "epoch_expired"
      ? isKeepsake ? text("준비 시간이 만료됐어요. 다시 시작해 주세요.", "Preparation expired. Please start again.", "準備の有効期限が切れました。もう一度始めてください。") : text("서명 세션이 만료됐어요. 다시 로그인하세요.", "The signer session expired. Sign in again.", "署名セッションの期限が切れました。再ログインしてください。")
      : signerIssue === "salt_recovery"
        ? isKeepsake ? text("준비를 다시 완료해야 해요. 다시 시도해 주세요.", "Preparation needs to be restored. Please try again.", "準備を復旧する必要があります。再試行してください。") : text("서명 복구가 필요해요. 샘플 복구 후 이어갈 수 있어요.", "Signer recovery is needed. Retry to recover the sample signer.", "署名の復旧が必要です。再試行するとサンプルを復旧します。")
        : signerIssue === "prover_failed"
          ? isKeepsake ? text("미리보기를 준비하지 못했어요. 다시 시도해 주세요.", "The preview could not be prepared. Please try again.", "プレビューを準備できませんでした。再試行してください。") : text("증명 서비스를 연결하지 못했어요. 다시 시도하세요.", "The proof service did not respond. Try again.", "証明サービスが応答しませんでした。再試行してください。")
          : null
  const bridgeFailureCopy = sampleCase === "wrong_network"
    ? text("Sui Testnet 경로가 필요해요. 새 견적에서 네트워크를 다시 확인하세요.", "This route needs Sui Testnet. Check the network with a fresh quote.", "この経路にはSui Testnetが必要です。新しい見積もりで確認してください。")
    : sampleCase === "sponsor_denied"
      ? text("가스 지원이 승인되지 않았어요. 자산 이동 없이 다시 확인할 수 있어요.", "Gas sponsorship was declined. No assets moved; check again with a fresh quote.", "ガス支援が承認されませんでした。資産移動なしで再確認できます。")
      : text("경로 확인을 완료하지 못했어요. 잔고는 그대로이며 새 예상 조건으로 다시 시작할 수 있어요.", "Route check did not complete. Balances remain unchanged; start again with a fresh quote.", "経路チェックを完了できませんでした。残高は変わらず、新しい見積もりでやり直せます。")
  const labsLabel = isKeepsake ? text("여행 기념", "Travel keepsake", "旅の記念") : provider === "b" ? "Labs" : text("기술 실험실", "Labs", "技術ラボ")
  const labsBoundarySummary = text("기술 세부정보", "Technical details", "技術詳細")
  const labsBoundaryBody = text(
    "예시 데이터를 사용합니다. 실제 돈·계정·외부 서비스와 연결되지 않으며, Sui↔OmniOne 경로·NFT·거래를 만들지 않습니다.",
    "Uses sample data. No real money, accounts, or external services are connected, and no Sui↔OmniOne route, NFT, or transaction is created.",
    "サンプルデータを使用します。実際のお金、アカウント、外部サービスには接続せず、Sui↔OmniOne経路、NFT、取引も作成しません。",
  )
  const labsAssetBoundary = text(
    "USDC와 USDT는 예시에서 서로 다른 자산으로 표시됩니다. OOKRW는 KRW 상환이나 1:1 가치를 보장하지 않습니다.",
    "USDC and USDT remain separate in these examples. OOKRW has no guaranteed KRW redemption or 1:1 value.",
    "USDCとUSDTは例の中でも別の資産として表示します。OOKRWはKRWへの償還や1:1の価値を保証しません。",
  )
  const badgeBody = provider === "b"
    ? text(
        "서로 다른 장소의 방문 기록 열 개를 기념하는 선택 기능입니다.",
        "An optional keepsake for ten distinct visit records.",
        "異なる場所の訪問記録10件を記念する任意機能です。",
      )
    : text(
        "열 번째 시뮬레이션 방문 기록을 기념하는 선택 기능입니다. 신원, 국적, 19+ 또는 부정적 평판은 공개 정보에 넣지 않습니다.",
        "An optional souvenir for the tenth simulated visit record. Identity, nationality, 19+, and negative reputation are not included in public metadata.",
        "10件目の訪問記録を記念する任意のシミュレーションです。本人情報、国籍、19歳以上の情報、否定的な評価は公開メタデータに含まれません。",
      )
  const badgeRequirement = provider === "b"
    ? text(
        "이 브라우저에서 활동한 서로 다른 장소 열 곳을 채우면 선택할 수 있어요.",
        "This becomes optional after local activity across ten different places in this browser.",
        "このブラウザでローカル活動がある場所が10か所になると選べます。",
      )
    : text(
        "서로 다른 시뮬레이션 방문 기록 열 개를 남긴 뒤 선택할 수 있어요.",
        "This becomes optional after ten distinct simulated visit records.",
        "異なる訪問記録を10件残すと選べるようになります。",
      )

  function focusAfterTransition(target: RefObject<HTMLElement | null>) {
    window.requestAnimationFrame(() => target.current?.focus())
  }

  useEffect(() => {
    const stored = readLabsSession(sessionKey)
    if (stored.acknowledged === true) setAcknowledged(true)
    const mayRestoreReviewOutcome = provider !== "b" || qaControls
    const bWalletReady = provider === "b" && qaControls && stored.wallet === "WAL-READY" && stored.walletReview != null
    const restoredWallet = provider === "b"
      ? bWalletReady
        ? "WAL-READY" as const
        : stored.wallet === "WAL-FAILED" && qaControls
          ? "WAL-FAILED" as const
          : "WAL-DISCONNECTED" as const
      : stored.wallet && stored.wallet !== "WAL-CONNECTING"
        ? stored.wallet
        : undefined
    if (mayRestoreReviewOutcome && restoredWallet) setWallet(restoredWallet)
    if (bWalletReady) setWalletReview(stored.walletReview ?? null)

    const bridgeNeedsReview = stored.bridge === "BRG-PENDING" || stored.bridge === "BRG-SIMULATED-SUCCESS"
    const bBridgeReady = bWalletReady && (!bridgeNeedsReview || stored.bridgeReview != null)
    if (!isKeepsake && mayRestoreReviewOutcome && stored.bridge) {
      if (provider !== "b" || bBridgeReady) {
        setBridge(stored.bridge)
        if (stored.phase) setPhase(stored.phase)
        if (provider === "b" && stored.bridgeReview) {
          setBridgeReview(stored.bridgeReview)
          bridgeExecutionRef.current = stored.bridgeReview
          bridgeQuoteRef.current = stored.bridgeReview.value.quote
        }
      } else {
        setBridge("BRG-IDLE")
        setPhase("none")
      }
    }

    if (mayRestoreReviewOutcome && stamps === 10 && stored.mint && stored.mint !== "NFT-MINTING") {
      if (provider !== "b" || stored.mint !== "NFT-MINTED" || stored.badgeReview) {
        setMint(stored.mint)
        if (provider === "b" && stored.badgeReview) setBadgeReview(stored.badgeReview)
      } else {
        setMint(stored.consent === true ? "NFT-OPTED-IN" : "NFT-ELIGIBLE")
      }
    }
    if (mayRestoreReviewOutcome && stamps === 10 && stored.consent === true) setConsent(true)
    if (!isKeepsake && mayRestoreReviewOutcome && typeof stored.quoteExpiresAt === "number") {
      const hasRestorableQuote = provider !== "b"
        || (bWalletReady && (stored.bridgeReview != null || stored.quoteExpiresAt > Date.now()))
      if (hasRestorableQuote) setQuoteExpiresAt(stored.quoteExpiresAt)
      if (hasRestorableQuote && (stored.bridge === "BRG-QUOTED" || stored.bridge === "BRG-CONFIRMING")) {
        bridgeQuoteRef.current = createLabsBridgeQuote(stored.quoteExpiresAt)
      }
    }
    if (!isKeepsake && mayRestoreReviewOutcome && stored.traitStates && typeof stored.traitStates === "object") setTraitStates(stored.traitStates)
    sessionWasRestored.current = true
    setSessionLoaded(true)
  }, [isKeepsake, provider, qaControls, sessionKey, stamps])

  useEffect(() => {
    if (!sessionLoaded || !sessionWasRestored.current) return
    // The focused journey shares the existing receipt and signer, but must not
    // reset or advance the unrelated Labs route, balances, or merchant checks.
    const snapshot: Partial<LabsSession> = isKeepsake
      ? { ...readLabsSession(sessionKey), wallet, mint, consent, walletReview, badgeReview }
      : { acknowledged, wallet, bridge, phase, mint, consent, quoteExpiresAt, traitStates, walletReview, bridgeReview, badgeReview }
    try {
      window.sessionStorage.setItem(sessionKey, JSON.stringify(snapshot))
    } catch {
      // Labs remains a usable in-memory preview when session storage is blocked.
    }
  }, [acknowledged, badgeReview, bridge, bridgeReview, consent, isKeepsake, mint, phase, quoteExpiresAt, sessionKey, sessionLoaded, traitStates, wallet, walletReview])

  useEffect(() => {
    if (stamps === 10 && mint === "NFT-LOCKED") setMint("NFT-ELIGIBLE")
    if (stamps < 10 && mint !== "NFT-LOCKED") {
      setMint("NFT-LOCKED")
      setConsent(false)
      setBadgeReview(null)
    }
  }, [mint, stamps])

  useEffect(() => {
    if (isKeepsake || !sessionLoaded || qaControls || bridge !== "BRG-PENDING") return
    const timer = window.setTimeout(advanceBridge, 650)
    return () => window.clearTimeout(timer)
  }, [bridge, isKeepsake, phase, qaControls, sessionLoaded])

  useEffect(() => {
    if (wallet !== "WAL-FAILED") return
    let secondFrame = 0
    let timeout = 0
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        timeout = window.setTimeout(() => walletRetryRef.current?.focus({ preventScroll: true }), 0)
      })
    })
    return () => {
      window.cancelAnimationFrame(firstFrame)
      window.cancelAnimationFrame(secondFrame)
      window.clearTimeout(timeout)
    }
  }, [wallet])

  useEffect(() => {
    if (provider !== "b") return
    function settleBadge(expected: BBadgeActionReturn) {
      const now = new Date()
      const latest = restoreBActionGateSession(window.sessionStorage, now, actionGateSessionOptions())
      const personReady = latest.person.status === "eligible"
        && latest.person.expiresAt !== null
        && Date.parse(latest.person.expiresAt) > now.getTime()
      const authority = createReviewFixtureAuthority({
        qaRuntimeEnabled: qaControls,
        explicitlyRequested: qaControls,
        fixtureId: sampleCaseIs("mint_failed", "mint-failed") ? "FX-BADGE-FAIL" : "FX-BADGE-SUCCESS",
      })
      const execution = authority
        ? sampleCaseIs("mint_failed", "mint-failed")
          ? reviewFixture<LabsBadgeReviewValue>(authority, { outcome: "failure", now })
          : reviewFixture<LabsBadgeReviewValue>(authority, { outcome: "success", value: { badge: "travel-keepsake" }, now })
        : providerUnavailable("person")
      if (!qaControls || !personReady || execution.result === "PROVIDER_UNAVAILABLE") {
        abandonPendingBAction(window.sessionStorage, expected, now, actionGateSessionOptions())
        badgeReturnRef.current = null
        setBadgeReview(null)
        setMint("NFT-FAILED")
        focusAfterTransition(badgeResultRef)
        return
      }
      const consumed = consumePendingBActionAtMutation(window.sessionStorage, expected, new Set(["person"]), now, { ...actionGateSessionOptions(), credential: liveCredentialRef.current })
      if (!consumed || consumed.cta !== "MINT_BADGE") {
        badgeReturnRef.current = null
        setBadgeReview(null)
        setMint("NFT-FAILED")
        focusAfterTransition(badgeResultRef)
        return
      }
      if (execution.result === "FIXTURE_SUCCESS") {
        if (!finalizeConsumedBAction(window.sessionStorage, consumed, now, actionGateSessionOptions())) {
          badgeReturnRef.current = null
          setBadgeReview(null)
          setMint("NFT-FAILED")
          focusAfterTransition(badgeResultRef)
          return
        }
        setBadgeReview(execution)
        setMint("NFT-MINTED")
        window.dispatchEvent(new CustomEvent(B_ACTION_GATE_COMPLETE_EVENT, { detail: consumed }))
        badgeReturnRef.current = null
        focusAfterTransition(badgeResultRef)
        return
      }
      restoreConsumedBActionAfterMutationFailure(window.sessionStorage, consumed, now, actionGateSessionOptions())
      setBadgeReview(null)
      setMint("NFT-FAILED")
      focusAfterTransition(badgeResultRef)
    }

    function ready(event: Event) {
      const detail = event instanceof CustomEvent ? event.detail as BBadgeActionReturn : null
      if (!detail || detail.cta !== "MINT_BADGE" || badgeReturnRef.current?.tokenId !== detail.tokenId) return
      if (stamps !== 10 || wallet !== "WAL-READY" || !consent || !qaControls) {
        abandonPendingBAction(window.sessionStorage, detail, new Date(), actionGateSessionOptions())
        badgeReturnRef.current = null
        setBadgeReview(null)
        setMint("NFT-FAILED")
        return
      }
      setMint("NFT-MINTING")
      badgeSectionRef.current?.scrollIntoView({ block: "center", behavior: "smooth" })
      badgeTimerRef.current = window.setTimeout(() => {
        badgeTimerRef.current = null
        settleBadge(detail)
      }, 520)
    }

    function cancelled(event: Event) {
      const detail = event instanceof CustomEvent ? event.detail as BBadgeActionReturn : null
      if (!detail || detail.cta !== "MINT_BADGE" || badgeReturnRef.current?.tokenId !== detail.tokenId) return
      badgeReturnRef.current = null
      setBadgeReview(null)
      setMint(consent ? "NFT-OPTED-IN" : "NFT-ELIGIBLE")
      badgeSectionRef.current?.scrollIntoView({ block: "center", behavior: "smooth" })
      window.requestAnimationFrame(() => badgeButtonRef.current?.focus({ preventScroll: true }))
    }

    window.addEventListener(B_ACTION_GATE_READY_EVENT, ready)
    window.addEventListener(B_ACTION_GATE_CANCEL_EVENT, cancelled)
    return () => {
      window.removeEventListener(B_ACTION_GATE_READY_EVENT, ready)
      window.removeEventListener(B_ACTION_GATE_CANCEL_EVENT, cancelled)
      if (badgeTimerRef.current !== null) window.clearTimeout(badgeTimerRef.current)
    }
  }, [consent, provider, qaControls, stamps, wallet])

  function close() {
    if (isKeepsake) {
      // Close is cancellation, including the short ready-to-result interval.
      // Keep the task open if its durable pending action cannot be abandoned.
      if (badgeTimerRef.current !== null) {
        window.clearTimeout(badgeTimerRef.current)
        badgeTimerRef.current = null
      }
      const pendingBadge = badgeReturnRef.current
      const cancelledAt = new Date()
      if (pendingBadge && isBActionReturnPending(pendingBadge, cancelledAt)
        && !abandonPendingBAction(window.sessionStorage, pendingBadge, cancelledAt, actionGateSessionOptions())) {
        setBadgeReview(null)
        setMint("NFT-FAILED")
        focusAfterTransition(badgeResultRef)
        return
      }
      badgeReturnRef.current = null
      if (pendingBadge) window.dispatchEvent(new Event(B_ACTION_AXIS_SESSION_EVENT))
      if (mint === "NFT-MINTING") setMint(consent ? "NFT-OPTED-IN" : "NFT-ELIGIBLE")
      for (const timer of sampleTimersRef.current) window.clearTimeout(timer)
      sampleTimersRef.current.clear()
      if (wallet === "WAL-CONNECTING") {
        setWallet("WAL-DISCONNECTED")
        setWalletReview(null)
      }
    }
    onDismiss()
  }

  function openLabsSample() {
    if (provider === "b" && !qaControls && !enterReviewSample()) return
    setAcknowledged(true)
  }

  const returnLabel = isKeepsake ? text("뒤로", "Back", "戻る") : originTab === "id"
    ? locale === "ko" ? "ID로 돌아가기" : locale === "ja" ? "IDに戻る" : "Return to ID"
    : originTab === "my"
      ? locale === "ko" ? "My Korea로 돌아가기" : locale === "ja" ? "マイ韓国に戻る" : "Return to My Korea"
      : locale === "ko" ? "이전 탭으로 돌아가기" : locale === "ja" ? "前のタブに戻る" : "Return to previous tab"

  function runWalletConnection(reviewEnabled: boolean) {
    setWalletReview(null)
    setSignerIssue(null)
    if (provider === "b" && !reviewEnabled) {
      providerUnavailable("funding")
      setWallet("WAL-FAILED")
      return
    }
    const issue = reviewEnabled ? labsSignerIssue(sampleCaseRef.current) : null
    setWallet("WAL-CONNECTING")
    scheduleSample(() => {
      const fail = issue !== null || readQaScenario() === "labs-wallet-fail"
      setSignerIssue(issue)
      if (provider !== "b") {
        setWallet(fail ? "WAL-FAILED" : "WAL-READY")
        return
      }
      if (!liveSampleModeRef.current) { setWallet("WAL-FAILED"); return }
      const authority = createReviewFixtureAuthority({
        qaRuntimeEnabled: reviewEnabled,
        explicitlyRequested: reviewEnabled,
        fixtureId: fail ? "FX-LABS-WALLET-FAIL" : "FX-LABS-WALLET-SUCCESS",
      })
      const execution = authority
        ? fail
          ? reviewFixture<LabsWalletReviewValue>(authority, { outcome: "failure" })
          : reviewFixture<LabsWalletReviewValue>(authority, { outcome: "success", value: { address: "0x8a71…4d2c" } })
        : providerUnavailable("funding")
      setWalletReview(execution.result === "FIXTURE_SUCCESS" ? execution : null)
      setWallet(execution.result === "FIXTURE_SUCCESS" ? "WAL-READY" : "WAL-FAILED")
    }, 480)
  }

  function connectWallet() {
    if (wallet === "WAL-FAILED") selectSampleCase("success")
    runWalletConnection(qaControls)
  }

  function continueWalletSample() {
    if (!enterReviewSample()) return
    runWalletConnection(true)
  }

  function quoteBridge() {
    if (wallet !== "WAL-READY" || (provider === "b" && !qaControls)) {
      providerUnavailable("chain_transaction")
      setBridge("BRG-FAILED")
      return
    }
    if (bridge === "BRG-FAILED" || bridge === "BRG-EXPIRED") selectSampleCase("success")
    setMismatch(false)
    setPhase("none")
    const expiredFixture = sampleCaseIs("quote_expired", "bridge-expired")
    const expiresAt = expiredFixture ? Date.now() - 1_000 : Date.now() + 120_000
    bridgeQuoteRef.current = createLabsBridgeQuote(expiresAt)
    bridgeExecutionRef.current = null
    setBridgeReview(null)
    setQuoteExpiresAt(expiresAt)
    setBridge("BRG-QUOTED")
    focusAfterTransition(confirmButtonRef)
  }

  function confirmBridge() {
    if (bridge !== "BRG-QUOTED") return
    if (wallet !== "WAL-READY") { setBridge("BRG-FAILED"); return }
    if (mismatch) {
      bridgeQuoteRef.current = null
      bridgeExecutionRef.current = null
      setBridgeReview(null)
      setQuoteExpiresAt(null)
      setBridge("BRG-FAILED")
      focusAfterTransition(quoteButtonRef)
      return
    }
    if (!isCurrentLabsBridgeQuote(bridgeQuoteRef.current) || quoteExpiresAt == null || quoteExpiresAt <= Date.now()) {
      bridgeQuoteRef.current = null
      setBridgeReview(null)
      setBridge("BRG-EXPIRED")
      focusAfterTransition(quoteButtonRef)
      return
    }
    setBridge("BRG-CONFIRMING")
    focusAfterTransition(submitButtonRef)
  }

  function submitBridge() {
    if (bridge !== "BRG-CONFIRMING") return
    if (wallet !== "WAL-READY") { setBridge("BRG-FAILED"); return }
    const quote = bridgeQuoteRef.current
    if (mismatch || !isCurrentLabsBridgeQuote(quote)) {
      bridgeQuoteRef.current = null
      bridgeExecutionRef.current = null
      setBridgeReview(null)
      setQuoteExpiresAt(null)
      setBridge(mismatch ? "BRG-FAILED" : "BRG-EXPIRED")
      focusAfterTransition(quoteButtonRef)
      return
    }
    if (provider === "b") {
      if (sampleCaseIs("wrong_network") || sampleCaseIs("sponsor_denied")) {
        bridgeExecutionRef.current = null
        setBridgeReview(null)
        setBridge("BRG-FAILED")
        focusAfterTransition(quoteButtonRef)
        return
      }
      const fail = sampleCaseIs("bridge_failed", "bridge-failed")
      const authority = createReviewFixtureAuthority({
        qaRuntimeEnabled: qaControls,
        explicitlyRequested: qaControls,
        fixtureId: fail ? "FX-LABS-BRIDGE-FAIL" : "FX-LABS-BRIDGE-SUCCESS",
      })
      const execution = authority
        ? fail
          ? reviewFixture<LabsBridgeReviewValue>(authority, { outcome: "failure" })
          : reviewFixture<LabsBridgeReviewValue>(authority, { outcome: "success", value: { route: "sui-testnet-to-omnione", quote } })
        : providerUnavailable("chain_transaction")
      if (execution.result === "PROVIDER_UNAVAILABLE") {
        bridgeExecutionRef.current = null
        setBridgeReview(null)
        setBridge("BRG-FAILED")
        focusAfterTransition(quoteButtonRef)
        return
      }
      bridgeExecutionRef.current = execution
      setBridgeReview(execution.result === "FIXTURE_SUCCESS" ? execution : null)
    }
    const first = nextBridgePhase("none")
    if (!first) return
    setPhase(first)
    setBridge(bridgeStateForPhase(first))
    focusAfterTransition(qaControls ? advanceButtonRef : progressRef)
  }

  function advanceBridge() {
    if (bridge !== "BRG-PENDING") return
    if (wallet !== "WAL-READY") { setBridge("BRG-FAILED"); return }
    if (mismatch || (provider === "b" && !bridgeExecutionRef.current)) {
      bridgeQuoteRef.current = null
      bridgeExecutionRef.current = null
      setBridgeReview(null)
      setBridge("BRG-FAILED")
      focusAfterTransition(quoteButtonRef)
      return
    }
    const next = nextBridgePhase(phase)
    if (!next) return
    const fail = provider === "b"
      ? bridgeExecutionRef.current?.result !== "FIXTURE_SUCCESS" && phase === "source_confirmed"
      : readQaScenario() === "bridge-failed" && phase === "source_confirmed"
    if (fail) {
      bridgeQuoteRef.current = null
      bridgeExecutionRef.current = null
      setBridgeReview(null)
      setBridge("BRG-FAILED")
      focusAfterTransition(quoteButtonRef)
      return
    }
    if (provider === "b" && next === "destination_confirmed" && bridgeExecutionRef.current?.result !== "FIXTURE_SUCCESS") {
      bridgeQuoteRef.current = null
      bridgeExecutionRef.current = null
      setBridgeReview(null)
      setBridge("BRG-FAILED")
      focusAfterTransition(quoteButtonRef)
      return
    }
    setPhase(next)
    setBridge(bridgeStateForPhase(next))
    focusAfterTransition(next === "destination_confirmed" ? bridgeReceiptRef : qaControls ? advanceButtonRef : progressRef)
  }

  function cancelBridge() {
    if (bridge !== "BRG-QUOTED" && bridge !== "BRG-CONFIRMING") return
    setPhase("none")
    setQuoteExpiresAt(null)
    bridgeQuoteRef.current = null
    bridgeExecutionRef.current = null
    setBridgeReview(null)
    setBridge("BRG-CANCELLED")
    focusAfterTransition(quoteButtonRef)
  }

  function retryTrait(key: string, reviewEnabled = qaControls) {
    if (provider === "b" && !reviewEnabled) {
      providerUnavailable("credential")
      setTraitStates((current) => ({ ...current, [key]: "failed" }))
      return
    }
    if (traitStates[key] === "failed") selectSampleCase("success")
    setTraitStates((current) => ({ ...current, [key]: "checking" }))
    scheduleSample(() => {
      const fails = sampleCaseIs("trait_failed", "trait-retry-fail") || (provider === "b" && !liveSampleModeRef.current)
      setTraitStates((current) => ({ ...current, [key]: fails ? "failed" : "eligible" }))
    }, 420)
  }

  function continueTraitSample(key: string) {
    if (!enterReviewSample()) return
    retryTrait(key, true)
  }

  function mintBadge() {
    if (stamps !== 10 || wallet !== "WAL-READY" || !consent || mint === "NFT-MINTED" || mint === "NFT-MINTING") return
    if (mint === "NFT-FAILED") selectSampleCase("success")
    setBadgeReview(null)
    if (provider === "b") {
      if (!qaControls) {
        providerUnavailable("person")
        setMint("NFT-FAILED")
        return
      }
      const latest = restoreBActionGateSession(window.sessionStorage, new Date(), actionGateSessionOptions())
      const returnTo = latest.pending?.cta === "MINT_BADGE"
        ? latest.pending
        : createBBadgeActionReturn()
      badgeReturnRef.current = returnTo
      badgeSectionRef.current?.scrollIntoView({ block: "center", behavior: "smooth" })
      if (!requestBActionGate(returnTo, actionGateSessionOptions())) {
        badgeReturnRef.current = null
        setBadgeReview(null)
        setMint("NFT-FAILED")
      }
      return
    }
    setMint("NFT-MINTING")
    scheduleSample(() => {
      const fail = readQaScenario() === "mint-failed"
      setMint(fail ? "NFT-FAILED" : "NFT-MINTED")
    }, 520)
  }

  function disconnectWallet() {
    if (!canDisconnect) return
    setWallet("WAL-DISCONNECTED")
    setWalletReview(null)
    setSignerIssue(null)
    setBridge("BRG-IDLE")
    setPhase("none")
    setQuoteExpiresAt(null)
    bridgeQuoteRef.current = null
    bridgeExecutionRef.current = null
    setBridgeReview(null)
  }

  const boundaryDisclosure = provider === "b" ? (
    <details className={`${styles.card} ${styles.disclosure}`} data-testid="labs-boundary-disclosure">
      <summary className={styles.disclosureSummary}><div className={styles.sectionHeading}><span><ShieldCheck size={18} /></span><div><h3>{labsBoundarySummary}</h3></div></div><ChevronRight size={18} /></summary>
      <div className={styles.disclosureBody} data-testid="labs-boundary-details">
        <p className={styles.bodyCopy}>{labsBoundaryBody}</p>
        <p className={styles.finePrint}>{labsAssetBoundary}</p>
        <p className={styles.finePrint}>{text(
          "표시 통화 USD는 Sui Testnet의 USDC·USDT 예시를 합친 값이고, KRW는 OmniOne 가설의 OOKRW 예시입니다. 심사 fixture만 사용합니다.",
          "Display currency USD combines sample USDC and USDT on Sui Testnet; KRW represents sample OOKRW on the OmniOne hypothesis. Review fixture only.",
          "表示通貨USDはSui Testnet上のサンプルUSDC・USDTの合計で、KRWはOmniOne仮説上のサンプルOOKRWです。レビューfixtureのみを使用します。",
        )}</p>
        <p className={styles.finePrint}>{text(
          "대상 네트워크: Sui Testnet · 시뮬레이션",
          "Target network: Sui Testnet · Simulated",
          "対象ネットワーク：Sui Testnet · シミュレーション",
        )}</p>
        {bridgeReview ? <p className={styles.finePrint}>{text("심사 fixture · 시뮬레이션 · 잔고와 거래는 변경되지 않음", "Review fixture · Simulated · balances and transactions unchanged", "レビューfixture・シミュレーション・残高と取引は変更なし")}</p> : null}
        {badgeReview ? <p className={styles.finePrint}>{text("배지 심사 fixture · 게시 없음", "Badge review fixture · nothing published", "バッジレビューfixture・公開なし")}</p> : null}
        {walletReview ? <p className={styles.finePrint} data-testid="labs-wallet-review-provenance" data-review-provenance="simulated">{text("샘플 서명 주소 · 0x8a71…4d2c", "Sample signer address · 0x8a71…4d2c", "サンプル署名アドレス · 0x8a71…4d2c")}</p> : null}
      </div>
    </details>
  ) : null
  const labsTargetTruth = provider === "b" ? (
    <div className={styles.targetTruth} data-testid="labs-target-truth" data-review-provenance="simulated">
      <ShieldCheck size={17} aria-hidden="true" />
      <span><strong>{text("USD → KRW 샘플", "USD → KRW sample", "USD → KRW サンプル")}</strong><small>{text("샘플 화면 · 실제 송금 없음", "Sample only · no money moves", "サンプル画面・送金なし")}</small><small>{text("잔고는 그대로 유지돼요", "Balances stay unchanged", "残高は変更されません")}</small></span>
    </div>
  ) : null

  if (!acknowledged && !isKeepsake) {
    return (
      <LabsSheet provider={provider} locale={locale} label={labsLabel} onClose={close} size="full" presenceState={presenceState}>
        <div className={styles.boundary}>
          <span className={styles.labMark}><FlaskConical size={24} /></span>
          {provider === "b" ? null : <p className={styles.eyebrow}>{text("기술 실험실 · 시뮬레이션", "LABS · SIMULATED", "技術ラボ · シミュレーション")}</p>}
          <h2>{labsLabel}</h2>
          <p>{provider === "b" ? text("지갑·경로·여행 기념 기능을 직접 살펴보세요.", "Try wallet, route, and travel-keepsake concepts.", "ウォレット、経路、旅の記念機能を試せます。") : text("기술 가설을 보여주는 실험 영역입니다. 실제 자산 이동이나 운영 서비스가 아닙니다.", "This is an experimental area for technical hypotheses. It does not move real assets or represent a production service.", "技術的な仮説を体験する実験エリアです。実際の資産移動や運用中のサービスではありません。")}</p>
          {labsTargetTruth}
          {provider === "b" ? boundaryDisclosure : <InlineNotice tone="warm"><AlertTriangle size={18} /><span>{qaControls
            ? text("지갑, 잔고, 체인 연결과 기념 배지 결과는 반복해도 같은 테스트용 미리보기입니다.", "Wallet, balance, bridge, and badge results here are deterministic fixtures.", "ウォレット、残高、チェーン接続、記念バッジの結果は、何度試しても同じテスト用プレビューです。")
            : text("지갑, 잔고, 체인 연결과 기념 배지는 모두 재현 가능한 미리보기 결과입니다.", "Wallet, balance, bridge, and badge results are reproducible previews.", "ウォレット、残高、チェーン接続、記念バッジは、すべて再現可能なプレビューです。")}</span></InlineNotice>}
          <button type="button" className={styles.primary} onClick={openLabsSample} data-testid="labs-acknowledge">{provider === "b" ? text("Labs 열기", "Open Labs", "Labsを開く") : text("이해하고 보기", "I understand", "内容を確認して見る")}</button>
          <button type="button" className={styles.textButton} onClick={close}>{returnLabel}</button>
        </div>
      </LabsSheet>
    )
  }

  const canDisconnect = wallet !== "WAL-CONNECTING" && bridge !== "BRG-PENDING" && mint !== "NFT-MINTING"
  const phaseCopy = phase === "none" ? null : (provider === "b" ? B_BRIDGE_COPY : BRIDGE_COPY)[phase][locale]
  const bridgePhaseIndex = phase === "none" ? -1 : BRIDGE_PHASE_ORDER.indexOf(phase)
  const walletOutcomeId = "labs-wallet-outcome"
  const displayedAssets = provider === "b"
    ? [
        { id: "display-usd", stateAssetId: "sui-usdc", label: "USD", detail: null, amount: `$${B_LABS_USD_BALANCE.toFixed(2)}`, estimated: null },
        { id: "display-krw", stateAssetId: "omnione-ookrw", label: "KRW", detail: null, amount: `₩${B_LABS_KRW_BALANCE.toLocaleString("en-US")}`, estimated: null },
      ]
    : LABS_ASSETS.map((asset) => ({
        id: asset.id,
        stateAssetId: asset.id,
        label: asset.symbol,
        detail: text(
          `네트워크 식별자: ${asset.chain} · ${asset.representation === "native" ? "기본형" : asset.representation === "wrapped" ? "연결형" : "테스트 토큰"}`,
          `${asset.chain} · ${asset.representation.replace("_", " ")}`,
          `ネットワーク：${asset.chain} · ${asset.representation === "native" ? "ネイティブ" : asset.representation === "wrapped" ? "ブリッジ形式" : "テストトークン"}`,
        ),
        amount: asset.symbol === "OOKRW" ? Number(asset.amount).toLocaleString("en-US") : asset.amount,
        estimated: asset.estimatedUsd ? `≈ $${asset.estimatedUsd} · 2026-08-19` : null,
      }))

  const sampleScenarioControls = provider === "b" && qaControls ? <details className={styles.sampleScenarios} data-testid="labs-sample-scenarios">
          <summary><FlaskConical size={16} aria-hidden="true" /><span>{text("샘플 시나리오", "Sample scenarios", "サンプルシナリオ")}</span><ChevronRight size={16} aria-hidden="true" /></summary>
          <label><span>{text("다음 실행", "Next attempt", "次の実行")}</span><select
            data-testid="labs-sample-case"
            value={sampleCase}
            disabled={wallet === "WAL-CONNECTING" || bridge === "BRG-PENDING" || mint === "NFT-MINTING"}
            onChange={(event) => {
              const next = event.target.value as LabsSampleCase
              if (!LABS_SAMPLE_CASES.includes(next)) return
              selectSampleCase(next)
              if (next === "epoch_expired" && wallet === "WAL-READY") {
                setWalletReview(null)
                setSignerIssue("epoch_expired")
                setWallet("WAL-FAILED")
              }
            }}>
            {LABS_SAMPLE_CASES.filter(value => !isKeepsake || ["success", "oauth_cancel", "epoch_expired", "salt_recovery", "prover_failed", "mint_failed"].includes(value)).map(value => <option key={value} value={value}>{sampleCaseLabels[value]}</option>)}
          </select></label>
          <small>{text("다음 행동에 적용돼요. 재시도하면 성공 경로로 돌아갑니다.", "Applies to the next action. Retry returns to the success path.", "次の操作に適用します。再試行すると成功経路に戻ります。")}</small>
          {mint === "NFT-MINTED" && badgeReview ? <><button type="button" className={styles.secondary} data-testid="labs-badge-repeat" onClick={() => setDuplicateBadge(true)}>{text("같은 배지 다시 요청", "Repeat this badge request", "同じバッジを再要求")}</button>{duplicateBadge ? <p role="status" data-testid="labs-badge-duplicate">{text("이미 준비된 배지를 반환했어요. 새 배지는 만들지 않았습니다.", "Returned the existing badge. No second badge was created.", "既存のバッジを返しました。新しいバッジは作成していません。")}</p> : null}</> : null}
        </details> : null

  return (
    <LabsSheet provider={provider} locale={locale} label={labsLabel} onClose={close} showClose={false} size="full" presenceState={presenceState} initialFocusSelector="[data-testid='labs-back']" modalPriority={isKeepsake ? 142 : undefined}>
      <div className={`${styles.body} ${isKeepsake ? styles.keepsakeBody : ""}`} data-wallet-state={wallet} data-bridge-state={isKeepsake ? undefined : bridge} data-bridge-phase={isKeepsake ? undefined : phase} data-mint-state={mint} data-testid={isKeepsake ? "journey-keepsake-overlay" : "labs-overlay"}>
        <header className={styles.header}>
          <button type="button" data-sheet-initial-focus data-testid="labs-back" onClick={close} aria-label={returnLabel}><ArrowLeft size={20} /></button>
          <div>{provider === "b" ? null : <p className={styles.eyebrow}>{text("기술 실험실 · 시뮬레이션", "LABS · SIMULATED", "技術ラボ · シミュレーション")}</p>}<h2>{labsLabel}</h2></div>
          {provider === "b" ? null : <span className={styles.truthBadge}>{text("시뮬레이션", "SIMULATED", "シミュレーション")}</span>}
        </header>

        {isKeepsake && mint === "NFT-MINTED" ? <section className={styles.keepsakeSuccess} aria-labelledby="journey-keepsake-success-title">
          <div ref={badgeResultRef} className={styles.keepsakeSuccessResult} tabIndex={-1} role="status" data-testid="labs-badge-result" data-review-provenance={badgeReview ? "simulated" : undefined}>
            <span className={styles.keepsakeSuccessMark}><Stamp size={32} strokeWidth={1.5} aria-hidden="true" /></span>
            <p className={styles.keepsakeSuccessContext}>{text("서로 다른 장소 열 곳의 추억", "Ten different places. A journey to remember.", "異なる10か所の、旅の思い出。")}</p>
            <h3 id="journey-keepsake-success-title">{text("여행 기념 배지가 준비됐어요", "Your travel keepsake is ready", "旅の記念バッジを準備しました")}</h3>
            <p className={styles.finePrint} data-testid="journey-keepsake-truth">{text("샘플 미리보기예요. 공개된 내용은 없습니다.", "Sample preview only. Nothing was published.", "サンプルプレビューです。公開された内容はありません。")}</p>
          </div>
          <button type="button" className={styles.primary} data-testid="journey-keepsake-done" onClick={close}>{text("내 기록으로 돌아가기", "Back to my journey", "旅の記録に戻る")}</button>
        </section> : <>
        {isKeepsake ? <div className={styles.keepsakeIntro} data-testid="journey-keepsake-truth">
          <p>{text("서로 다른 장소 열 곳, 나만의 여행 기념.", "Ten different places. One keepsake of your journey.", "異なる10か所。旅を振り返るひとつの記念。")}</p>
          <span>{text("선택 사항이에요. 방문 기록은 그대로이며, 할인이나 입장 혜택은 제공하지 않아요.", "Entirely optional. Your visit records stay unchanged. This does not provide discounts or admission.", "任意の機能です。訪問記録は変わらず、割引や入場特典はありません。")}</span>
          <small>{text("샘플 미리보기예요. 아무것도 공개하거나 외부로 보내지 않습니다.", "Sample preview only. Nothing is published or sent outside this app.", "サンプルプレビューです。公開したり、アプリの外へ送信したりすることはありません。")}</small>
        </div> : labsTargetTruth}
        {!isKeepsake ? sampleScenarioControls : null}
        {provider === "b" ? null : <InlineNotice tone="neutral"><ShieldCheck size={18} /><span>{text("실제 자산 이동이나 운영 서비스가 아닙니다.", "No real assets move and this is not a production service.", "実際の資産移動はなく、運用中のサービスでもありません。")}</span></InlineNotice>}

        <section className={styles.card} aria-labelledby="labs-signer-title">
          <div className={styles.sectionHeading}><span><WalletCards size={18} /></span><div><h3 id="labs-signer-title">{isKeepsake ? text("기념 배지 준비", "Keepsake preparation", "記念バッジの準備") : provider === "b" ? text("지갑 서명", "Wallet signer", "ウォレット署名") : text("Sui zkLogin · 서명 방식 식별자", "Sui zkLogin signer", "Sui zkLogin · 署名方式")}</h3></div></div>
          <p className={styles.bodyCopy}>{isKeepsake ? text("기념 배지를 선택하기 전에 미리보기를 준비해요. 준비만으로 배지가 만들어지지는 않습니다.", "Set up the preview before choosing your keepsake. Setup alone does not create it.", "記念バッジを選ぶ前にプレビューを準備します。準備だけでバッジは作成されません。") : provider === "b" ? text("경로를 시작할 서명을 준비합니다.", "Prepare the signer used to start the route.", "経路を開始する署名を準備します。") : text("Sui 주소와 트랜잭션 서명 경로를 보여줍니다. K-Tour ID 계정, 본인 확인(KYC) 또는 멀티체인 지갑을 만들지는 않습니다.", "Shows a Sui address and transaction-signing route. It does not create a K-Tour ID account, KYC, or multichain wallet.", "Suiアドレスとトランザクションの署名経路を表示します。K-Tour ID アカウント、本人確認（KYC）、マルチチェーンウォレットは作成されません。")}</p>
          {wallet === "WAL-READY" ? provider === "b"
            ? <div className={styles.readySummary}><Check size={17} aria-hidden="true" /><span><strong>{text("준비됨", "Ready", "準備完了")}</strong><small>{isKeepsake ? text("샘플 미리보기", "Sample preview", "サンプルプレビュー") : text("샘플 서명", "Sample signer", "サンプル署名")}</small></span></div>
            : <div><small className={styles.identifierLabel}>{text("미리보기 주소 식별자", "Preview address identifier", "プレビュー用アドレス識別子")}</small><code className={styles.address}>{qaControls ? "0x8a71…ondo_fixture" : "0x8a71…ondo_preview"}</code></div> : null}
          {wallet === "WAL-FAILED" ? <div id={walletOutcomeId} className={styles.walletOutcome} role="alert" aria-atomic="true" data-testid="labs-wallet-outcome" data-signer-issue={signerIssue ?? "provider"}><AlertTriangle size={17} /><span>{provider === "b"
            ? signerIssueCopy ?? (isKeepsake ? text("준비를 완료하지 못했어요. 아무것도 보내지 않았습니다.", "Preparation did not finish. Nothing was sent.", "準備を完了できませんでした。何も送信していません。") : text("서명 준비를 완료하지 못했어요. 아무것도 제출되지 않았습니다.", "Signer preparation did not complete. Nothing was submitted.", "署名の準備を完了できませんでした。何も送信されていません。"))
            : qaControls
              ? text("테스트용 연결을 완료하지 못했어요. K-Tour ID 계정, 본인 확인(KYC), 멀티체인 지갑, 실제 자산, 거래 또는 실제 계정에는 아무 영향이 없습니다.", "The test connection did not complete. No K-Tour ID account, KYC, multichain wallet, real asset, transaction, or real account was affected.", "テスト接続を完了できませんでした。K-Tour ID アカウント、本人確認（KYC）、マルチチェーンウォレット、実際の資産・取引・アカウントには影響ありません。")
              : text("미리보기 연결을 완료하지 못했어요. K-Tour ID 계정, 본인 확인(KYC), 멀티체인 지갑, 실제 자산, 거래 또는 실제 계정에는 아무 영향이 없습니다.", "The preview connection did not complete. No K-Tour ID account, KYC, multichain wallet, real asset, transaction, or real account was affected.", "プレビュー接続を完了できませんでした。K-Tour ID アカウント、本人確認（KYC）、マルチチェーンウォレット、実際の資産・取引・アカウントには影響ありません。")}</span></div> : null}
          {wallet === "WAL-DISCONNECTED" || (wallet === "WAL-FAILED" && (provider !== "b" || qaControls)) ? <button ref={walletRetryRef} type="button" className={styles.secondary} onClick={connectWallet} aria-describedby={wallet === "WAL-FAILED" ? walletOutcomeId : undefined} data-testid="labs-connect-wallet">{wallet === "WAL-FAILED"
            ? text("다시 시도", "Try again", "もう一度試す")
            : provider === "b"
              ? isKeepsake ? text("미리보기 준비", "Set up preview", "プレビューを準備") : text("서명 준비", "Prepare signer", "署名を準備")
              : qaControls
              ? text("서명 기능 연결 시뮬레이션", "Simulate signer connection", "署名機能の接続をシミュレーション")
              : text("미리보기 서명 기능 연결", "Connect preview signer", "プレビュー用署名機能を接続")}</button> : null}
          {wallet === "WAL-FAILED" && provider === "b" && !qaControls ? <button ref={walletRetryRef} type="button" className={styles.primary} onClick={continueWalletSample} aria-describedby={walletOutcomeId} data-testid="labs-wallet-sample">{text("샘플로 계속", "Continue with sample", "サンプルで続ける")}</button> : null}
          {wallet === "WAL-CONNECTING" ? <button type="button" className={styles.secondary} aria-busy="true" disabled>{isKeepsake ? text("준비 중", "Preparing", "準備中") : text("연결 중", "Connecting", "接続中")}</button> : null}
          {wallet === "WAL-READY" ? <button type="button" className={styles.textButton} disabled={!canDisconnect} onClick={disconnectWallet}>{isKeepsake ? text("준비 취소", "Reset preparation", "準備をリセット") : text("연결 해제", "Disconnect", "接続を解除")}</button> : null}
        </section>

        {!isKeepsake ? <><section className={styles.card} aria-labelledby="labs-assets-title">
          <div className={styles.sectionHeading}><span><CircleDollarSign size={18} /></span><div><h3 id="labs-assets-title">{provider === "b" ? text("자산", "Assets", "資産") : text("자산별 잔고", "Balances by asset", "資産別残高")}</h3><p>{provider === "b" ? text("각 자산은 따로 유지됩니다", "Each asset stays separate", "各資産は分けて表示されます") : text(`예상 USD 환산액 · $${estimatedTotal.toFixed(2)}`, `Estimated USD value · $${estimatedTotal.toFixed(2)}`, `推定USD換算額 · $${estimatedTotal.toFixed(2)}`)}</p></div></div>
          <div className={styles.assetList} data-testid={provider === "b" ? "labs-consumer-balances" : undefined}>
            {displayedAssets.map((asset) => {
              const assetState = labsAssetVisualState(asset.stateAssetId, wallet, bridge)
              const AssetStateIcon = assetState === "available"
                ? Check
                : assetState === "reserved"
                  ? CircleMinus
                  : assetState === "error"
                    ? AlertTriangle
                    : Clock3
              const assetStateLabel = assetState === "available"
                ? text("사용 가능", "Available", "利用可能")
                : assetState === "reserved"
                  ? text("경로에 예약됨", "Reserved", "経路に予約済み")
                  : assetState === "pending"
                    ? text("준비 대기", "Pending", "準備待ち")
                    : assetState === "stale"
                      ? text("업데이트 필요", "Stale", "更新が必要")
                      : text("확인 필요", "Error", "確認が必要")
              return <div key={asset.id} className={styles.assetRow} data-asset-state={assetState}>
                <div><strong>{asset.label}</strong>{asset.detail ? <span>{asset.detail}</span> : null}</div>
                <div><strong>{asset.amount}</strong><em data-status={assetState}><AssetStateIcon size={13} aria-hidden="true" />{assetStateLabel}</em>{asset.estimated ? <span>{asset.estimated}</span> : null}</div>
              </div>
            })}
          </div>
          {provider === "b" ? null : <p className={styles.finePrint}>{text("USDC·USDT·OOKRW는 자산 식별자입니다. USDC와 USDT는 서로 다른 자산으로 보관하며, OOKRW 테스트 토큰은 KRW 상환이나 1:1 가치를 보증하지 않습니다.", "USDC and USDT remain separate assets. OOKRW test token does not guarantee KRW redemption or 1:1 value.", "USDC・USDT・OOKRWは資産の識別子です。USDCとUSDTは別々の資産として保持され、OOKRWテストトークンはKRWへの償還や1:1の価値を保証しません。")}</p>}
        </section>

        <section className={styles.card} aria-labelledby="labs-bridge-title">
          <div className={styles.sectionHeading}><span><Link2 size={18} /></span><div><h3 id="labs-bridge-title">{provider === "b" ? text("환전 경로", "Exchange route", "交換ルート") : text("체인 연결 가설 시뮬레이션", "Bridge hypothesis simulation", "チェーン接続仮説のシミュレーション")}</h3><p>{provider === "b" ? text("USD에서 KRW로", "USD to KRW", "USDからKRWへ") : text("경로 식별자: Sui Testnet → OmniOne · 가설", "Sui Testnet → OmniOne hypothesis", "経路：Sui Testnet → OmniOne · 仮説")}</p></div></div>
          {provider === "b" ? null : <InlineNotice tone="warm"><AlertTriangle size={17} /><span>{text("Sui↔OmniOne 경로는 연결되어 있지 않습니다.", "No Sui↔OmniOne route is connected.", "Sui↔OmniOneの経路は接続されていません。")}</span></InlineNotice>}
          <div className={styles.route}><span>{provider === "b" ? "USD $13.50" : "13.50 USDT"}</span><ArrowRight size={18} /><span>{provider === "b" ? "KRW ₩13,460" : "13,460 OOKRW"}</span></div>
          {provider === "b" ? <ol ref={progressRef} className={styles.bridgeTimeline} role="status" aria-live="polite" aria-label={phaseCopy ?? text("경로 진행 단계", "Route progress", "経路の進行")} tabIndex={-1}>{BRIDGE_PHASE_ORDER.map((bridgePhase, index) => {
            const status = bridgePhaseIndex < 0 ? "upcoming" : index < bridgePhaseIndex || (bridge === "BRG-SIMULATED-SUCCESS" && index === bridgePhaseIndex) ? "complete" : index === bridgePhaseIndex ? "current" : "upcoming"
            return <li key={bridgePhase} data-status={status} aria-current={status === "current" ? "step" : undefined}><span>{status === "complete" ? <Check size={12} aria-hidden="true" /> : index + 1}</span><small>{B_BRIDGE_SHORT_COPY[bridgePhase][locale]}</small></li>
          })}</ol> : null}
          {provider !== "b" && phaseCopy ? <div className={styles.progress} role="status" aria-live="polite" tabIndex={-1}><span className={phase === "destination_confirmed" ? styles.completeDot : styles.pendingDot} /><strong>{phaseCopy}</strong></div> : null}
          {bridge === "BRG-IDLE" || bridge === "BRG-FAILED" || bridge === "BRG-CANCELLED" || bridge === "BRG-EXPIRED" ? <button ref={quoteButtonRef} type="button" className={styles.primary} onClick={quoteBridge} disabled={wallet !== "WAL-READY"} data-testid="labs-bridge-quote">{wallet === "WAL-READY"
            ? bridge === "BRG-EXPIRED"
              ? text("새 예상 조건 받기", "Get a new quote", "新しい見積もりを取得")
              : text("예상 조건 보기", "View quote", "見積もりを見る")
            : text("서명 기능 연결 후 예상 조건 보기", "Connect signer for quote", "署名機能を接続して見積もりを見る")}</button> : null}
          {bridge === "BRG-QUOTED" ? <><div className={styles.quote} data-testid="labs-quote"><span>{text("예상 경로 수수료", "Estimated route fee", "推定経路手数料")}</span><strong>$0.04</strong><small>{quoteExpiresAt != null && quoteExpiresAt <= Date.now()
            ? provider === "b" ? text("예상 조건 만료", "Quote expired", "見積もり期限切れ") : text("예상 조건 만료 · 시뮬레이션", "Quote expired · Simulated", "見積もり期限切れ · シミュレーション")
            : provider === "b" ? text("최대 2분 동안 유효", "Valid for up to 2 min", "最長2分間有効") : text("최대 2분 동안 유효 · 시뮬레이션", "Valid for up to 2 min · Simulated", "最長2分間有効 · シミュレーション")}</small></div><button ref={confirmButtonRef} type="button" className={styles.primary} onClick={confirmBridge} disabled={mismatch} data-testid="labs-bridge-confirm">{text("예상 조건 확인", "Confirm quote", "見積もりを確認")}</button><button type="button" className={styles.secondary} onClick={cancelBridge} data-testid="labs-bridge-cancel">{text("취소", "Cancel", "キャンセル")}</button></> : null}
          {bridge === "BRG-CONFIRMING" ? <><p className={styles.routeConsequence}><ShieldCheck size={15} aria-hidden="true" />{text("실제 자산 이동 없음", "No real assets move", "実際の資産移動なし")}</p><button ref={submitButtonRef} type="button" className={styles.primary} onClick={submitBridge} disabled={mismatch} data-testid="labs-bridge-submit">{provider === "b" ? text("경로 계속", "Continue route", "経路を続ける") : text("체인 연결 시뮬레이션 시작", "Start bridge simulation", "ブリッジのシミュレーションを開始")}</button><button type="button" className={styles.secondary} onClick={cancelBridge} data-testid="labs-bridge-cancel">{text("취소", "Cancel", "キャンセル")}</button></> : null}
          {bridge === "BRG-PENDING" && qaControls ? <button ref={advanceButtonRef} type="button" className={styles.primary} onClick={advanceBridge} disabled={mismatch} data-testid="labs-bridge-advance">{provider === "b" ? text("다음 단계", "Next step", "次のステップ") : text("다음 테스트 단계", "Advance fixture phase", "次のテスト段階へ")}<ChevronRight size={17} /></button> : null}
          {bridge === "BRG-SIMULATED-SUCCESS" ? <><div role="status" aria-live="polite"><InlineNotice tone="success"><Check size={18} /><span>{provider === "b" ? text("도착 단계까지 확인했어요. 잔고는 그대로입니다.", "Route check reached the destination step. Balances remain unchanged.", "送信先ステップまで確認しました。残高は変わりません。") : text("도착 단계까지 확인된 시뮬레이션입니다. 실제 자산은 바뀌지 않았습니다.", "The simulation reached destination confirmation. No real assets changed.", "送信先での確認まで完了したシミュレーションです。実際の資産は変更されていません。")}</span></InlineNotice></div><div ref={bridgeReceiptRef} className={styles.bridgeReceipt} data-testid="labs-bridge-receipt" data-review-provenance={provider === "b" && bridgeReview ? "simulated" : undefined} tabIndex={-1}><strong>{provider === "b" ? text("샘플 결과", "Sample result", "サンプル結果") : text("예상 전후 · 읽기 전용", "Projected before and after · Read only", "推定前後 · 閲覧のみ")}</strong><span>{provider === "b" ? "USD" : text("Sui Testnet의 USDT", "USDT on Sui Testnet", "Sui TestnetのUSDT")} <b>{provider === "b" ? "$13.50 → $0.00" : "13.50 → 0.00"}</b></span><span>{provider === "b" ? "KRW" : text("OmniOne 가설의 OOKRW", "OOKRW on OmniOne hypothesis", "OmniOne仮説のOOKRW")} <b>{provider === "b" ? "₩18,000 → ₩31,460" : "18,000 → 31,460"}</b></span><small>{provider === "b" ? text("샘플 전용 · 잔고와 거래는 그대로", "Sample only · balances and transactions unchanged", "サンプルのみ・残高と取引は変更なし") : text("실제 잔고나 거래는 변경되지 않았습니다.", "Actual balances and transactions were not changed.", "実際の残高や取引は変更されていません。")}</small></div></> : null}
          {bridge === "BRG-FAILED" ? <div role="alert" data-testid="labs-bridge-failure"><InlineNotice tone="danger"><AlertTriangle size={17} /><span>{provider === "b" ? bridgeFailureCopy : text("시뮬레이션 실패 · 현재 단계와 모든 잔고는 그대로예요. 새 예상 조건으로 다시 시작할 수 있습니다.", "Simulation failed. The current phase and every balance remain unchanged. You can restart with a fresh quote.", "シミュレーションに失敗しました。現在の段階とすべての残高は変わっていません。新しい見積もりでやり直せます。")}</span></InlineNotice></div> : null}
          {bridge === "BRG-CANCELLED" ? <div role="status" aria-live="polite"><InlineNotice tone="neutral"><span>{provider === "b" ? text("경로 확인을 취소했어요. 잔고는 그대로입니다.", "Route check cancelled. Balances remain unchanged.", "経路チェックをキャンセルしました。残高は変わりません。") : text("시뮬레이션을 취소했어요. 잔고는 바뀌지 않았으며, 새 예상 조건으로 다시 시작할 수 있습니다.", "Simulation cancelled. Balances did not change, and you can restart with a fresh quote.", "シミュレーションをキャンセルしました。残高は変わっていません。新しい見積もりでやり直せます。")}</span></InlineNotice></div> : null}
          {bridge === "BRG-EXPIRED" ? <InlineNotice tone="warm"><AlertTriangle size={17} /><span>{text("예상 조건이 만료되어 제출하지 않았어요. 새 예상 조건을 받아 계속해 주세요.", "The quote expired, so nothing was submitted. Get a new quote to continue.", "見積もりの有効期限が切れたため、送信されませんでした。新しい見積もりを取得して続けてください。")}</span></InlineNotice> : null}
          {qaControls ? <button type="button" className={styles.inlineLink} onClick={() => setMismatch((current) => !current)}>{text("예상 조건 불일치 예시 보기", "View quote mismatch example", "見積もり不一致の例を見る")}</button> : null}
          {qaControls && mismatch ? <InlineNotice tone="danger"><AlertTriangle size={17} /><span>{text("자산·체인·금액이 예상 조건과 달라 진행하지 않았어요.", "The asset, chain, or amount did not match the quote, so nothing was submitted.", "資産・チェーン・金額が見積もりと一致しないため、送信されませんでした。")}</span></InlineNotice> : null}
        </section>

        <details className={`${styles.card} ${styles.disclosure}`} open={provider !== "b" && qaControls ? true : undefined}>
          <summary className={styles.disclosureSummary}><div className={styles.sectionHeading}><span><ShieldCheck size={18} /></span><div><h3>{text("증거 변환 경계", "Evidence adapter boundaries", "証明データ変換の境界")}</h3><p>{text("계약 명세만 제공 · 기술 세부정보", "CONTRACT ONLY · Technical details", "契約仕様のみ · 技術詳細")}</p></div></div><ChevronRight size={18} /></summary>
          <div className={styles.disclosureBody}>
            <p className={styles.bodyCopy}>{text("OpenDID와 EAS는 표준 식별자입니다. 두 표준의 증거를 각각 변환한 뒤 하나의 공통 형식으로 맞춥니다. EAS 연동은 설계만 있고 아직 구현되지 않았습니다.", "OpenDID and EAS remain separate adapters normalized into a canonical envelope. A live EAS implementation is deferred.", "OpenDIDとEASは別々の標準として扱い、それぞれの証明データを共通形式に変換します。EASとの実接続は設計段階で、まだ実装されていません。")}</p>
            <div className={styles.evidenceList}>{EVIDENCE_FIXTURES.map((evidence) => <article key={evidence.id}><span>{text(`표준 식별자: ${evidence.sourceStandard}`, evidence.sourceStandard, `標準：${evidence.sourceStandard}`)}</span><strong>{text(
              evidence.claimType === "person" ? "본인 확인" : evidence.claimType === "visit" ? "방문 기록" : evidence.claimType === "age_over_19" ? "19+ 확인" : "상점 이용 조건",
              evidence.claimType.replace("_", " "),
              evidence.claimType === "person" ? "本人確認" : evidence.claimType === "visit" ? "訪問記録" : evidence.claimType === "age_over_19" ? "19歳以上の確認" : "店舗の利用条件",
            )}</strong><small>{text(`${evidence.sourceStandard} 변환 규칙 · 계약 명세만 제공`, `${evidence.sourceStandard} adapter · ${evidence.provenance.truth}`, `${evidence.sourceStandard}変換ルール · 契約仕様のみ`)}</small></article>)}</div>
          </div>
        </details>

        <section className={styles.card} aria-labelledby="labs-traits-title">
          <div className={styles.sectionHeading}><span><ShieldCheck size={18} /></span><div><h3 id="labs-traits-title">{text("상점 이용 조건", "Merchant conditions", "店舗の利用条件")}</h3><p>{text("조건별로 따로 확인", "Checked one condition at a time", "条件ごとに個別確認")}</p></div></div>
          {TRAIT_FIXTURES.map((trait) => {
            const key = `${trait.merchantId}:${trait.offerId}`
            const retryState = traitStates[key] ?? "idle"
            const display = TRAIT_DISPLAY[trait.offerId as keyof typeof TRAIT_DISPLAY]
            const receiptState: Exclude<TraitVisualState, "loading"> = trait.result
            const statusKey: TraitVisualState = retryState === "eligible"
              ? "eligible"
              : retryState === "checking"
                ? "loading"
                : retryState === "failed"
                  ? "error"
                  : receiptState
            const positive = statusKey === "eligible"
            const status = statusKey === "eligible"
              ? text("조건 충족", "Available", "利用可能")
              : statusKey === "ineligible"
                ? text("조건 미충족", "Unavailable", "利用不可")
                : statusKey === "loading"
                  ? text("확인 중", "Checking", "確認中")
                  : statusKey === "stale"
                    ? text("오래됨", "Stale", "期限切れ")
                    : statusKey === "error"
                      ? text("오류", "Error", "エラー")
                      : text("알 수 없음", "Unknown", "不明")
            const StatusIcon = positive
              ? Check
              : statusKey === "ineligible"
                ? CircleMinus
                : statusKey === "stale"
                  ? Clock3
                  : statusKey === "loading"
                    ? LoaderCircle
                    : statusKey === "error"
                      ? AlertTriangle
                      : CircleHelp
            const checkedAt = new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "Asia/Seoul" }).format(new Date(trait.checkedAt))
            return <article className={styles.traitRow} key={key} data-trait-state={retryState} data-trait-status={statusKey} data-testid={`trait-${display.key}`} aria-labelledby={`trait-${display.key}-place`}>
              <header className={styles.traitHeading}><span><strong id={`trait-${display.key}-place`}>{display.place[locale]}</strong><small>{display.condition[locale]}</small></span><em data-status={statusKey}><StatusIcon className={statusKey === "loading" ? styles.traitSpinner : undefined} size={14} aria-hidden="true" />{status}</em></header>
              <p className={styles.traitSummary}>{retryState === "checking"
                ? text("이 조건을 다시 확인하고 있어요.", "Checking this condition again.", "この条件を再確認しています。")
                : retryState === "eligible"
                ? text("이 특정 이용 조건은 충족됩니다. 장소 전체의 이용 가능 여부는 별도로 확인해 주세요.", "This specific access condition is met. Confirm overall venue availability separately.", "この利用条件は満たしています。店舗全体の利用可否は別途ご確認ください。")
                : retryState === "failed"
                  ? text("다시 확인하지 못했어요. 최신 장소 안내를 확인해 주세요.", "The condition still could not be checked. Review the venue’s latest information.", "再確認できませんでした。店舗の最新情報をご確認ください。")
                  : trait.result === "ineligible"
                    ? text("이 특정 이용 조건은 충족되지 않았어요.", "This specific condition is not met.", "この条件は満たしていません。")
                  : trait.result === "stale"
                    ? text("이 조건의 확인 시점이 지났어요.", "This condition check is out of date.", "この条件の確認期限が切れています。")
                    : text("이 조건을 확인하지 못했어요. 최신 장소 안내를 확인해 주세요.", "This condition could not be checked. Review the venue’s latest information.", "この条件を確認できませんでした。店舗の最新情報をご確認ください。")}</p>
              <details className={styles.traitDetails}><summary>{text("확인 상세", "Check details", "確認の詳細")}</summary><dl className={styles.traitFacts}><div><dt>{text("확인일", "Checked", "確認日")}</dt><dd>{checkedAt}</dd></div><div><dt>{text("조건", "Condition", "条件")}</dt><dd>{display.policy[locale]}</dd></div><div><dt>{text("정책", "Policy", "ポリシー")}</dt><dd>{trait.policyId}</dd></div></dl></details>
              <button type="button" className={styles.secondary} disabled={retryState === "checking"} onClick={() => retryState === "failed" && provider === "b" && !qaControls ? continueTraitSample(key) : retryTrait(key)} data-testid={`trait-retry-${display.key}`} aria-label={retryState === "failed" && provider === "b" && !qaControls ? text(`${display.place.ko} 샘플로 계속`, `Continue ${display.place.en} with sample`, `${display.place.ja}をサンプルで続ける`) : text(`${display.place.ko}의 ${display.condition.ko} 다시 확인`, `Retry ${display.condition.en} for ${display.place.en}`, `${display.place.ja}の${display.condition.ja}を再確認`)}>{retryState === "checking" ? text("다시 확인 중", "Checking again", "再確認中") : retryState === "failed" && provider === "b" && !qaControls ? text("샘플로 계속", "Continue with sample", "サンプルで続ける") : text("이 조건 다시 확인", "Retry this condition", "この条件を再確認")}</button>
            </article>
          })}
          <p className={styles.finePrint}>{text("각 결과는 표시된 조건 하나에만 해당하며 다른 조건과 합산하지 않습니다.", "Each result applies only to the condition shown and is never combined into a score.", "各結果は表示された条件だけに適用され、スコアには集約されません。")}</p>
        </section>

        <details className={`${styles.card} ${styles.disclosure}`} open={provider !== "b" && qaControls ? true : undefined}>
          <summary className={styles.disclosureSummary}><div className={styles.sectionHeading}><span><FlaskConical size={18} /></span><div><h3>{text("AMM · 교환 방식 식별자", "AMM", "AMM · 交換方式")}</h3><p>{text("설계만 제공 · 사용 불가", "DEFERRED · Not available", "設計のみ · 利用不可")}</p></div></div><ChevronRight size={18} /></summary>
          <div className={styles.disclosureBody}><p className={styles.bodyCopy}>{text("AMM 교환은 이번 후보 범위에 포함되지 않습니다.", "AMM swaps are not included in this candidate.", "AMM交換は今回の候補範囲に含まれていません。")}</p></div>
        </details>

        </> : null}

        <section ref={badgeSectionRef} className={styles.card} aria-labelledby="labs-badge-title" data-return-section="travel-keepsake">
          <div className={styles.sectionHeading}><span>{isKeepsake ? <Stamp size={18} /> : <FlaskConical size={18} />}</span><div><h3 id="labs-badge-title">{provider === "b" ? text("여행 기념 배지", "Travel keepsake badge", "旅の記念バッジ") : text("기념 배지 시뮬레이션", "Souvenir badge simulation", "記念バッジのシミュレーション")}</h3><p>{stamps}/10</p></div></div>
          <p className={styles.bodyCopy}>{badgeBody}</p>
          {provider === "b" && qaControls && stamps < 9 && onLoadSampleVisits ? <details className={styles.sampleScenarios} data-testid="labs-sample-visit-setup">
            <summary><FlaskConical size={16} aria-hidden="true" /><span>{text("샘플 여행으로 체험", "Try a sample trip", "サンプル旅行で体験")}</span><ChevronRight size={16} aria-hidden="true" /></summary>
            <p>{text("기존 기록을 남겨두고 방문 9개까지 준비해요. 마지막 방문은 따로 확인합니다.", "Keep existing visits and prepare a nine-visit sample trip. Check the last visit separately.", "既存の記録を残し、9件までサンプルを用意します。最後の訪問は別に確認します。")}</p>
            <button type="button" className={styles.secondary} data-testid="labs-load-sample-visits" onClick={() => setSampleHistoryFailed(!onLoadSampleVisits())}>{text("방문 9개 샘플 불러오기", "Load 9-visit sample", "9件の訪問サンプルを読み込む")}</button>
            {sampleHistoryFailed ? <p role="alert">{text("일부 기록을 준비하지 못했어요. 기존 기록은 유지돼요. 다시 시도하세요.", "Some visits could not be prepared. Existing records remain; try again.", "一部を準備できませんでした。既存の記録は残っています。再試行してください。")}</p> : null}
          </details> : null}
          {sampleVisit}
          {provider === "b" && qaControls && stamps === 10 ? <p className={styles.visitMilestone} role="status" data-testid="labs-visit-milestone"><Check size={16} aria-hidden="true" />{text("서로 다른 방문 10개가 준비됐어요", "10 distinct visit records are ready", "異なる訪問記録が10件になりました")}</p> : null}
          {stamps < 10 ? <InlineNotice tone="neutral"><span>{badgeRequirement}</span></InlineNotice> : null}
          {stamps === 10 && mint !== "NFT-MINTED" ? <label className={styles.consent}><input type="checkbox" checked={consent} onChange={(event) => { setConsent(event.target.checked); setMint(event.target.checked ? "NFT-OPTED-IN" : "NFT-ELIGIBLE") }} /> <span>{isKeepsake ? text("이 기념 배지 미리보기에 장소 활동 기록만 사용하는 데 동의해요.", "I agree to use only my place activity for this keepsake preview.", "この記念バッジのプレビューに、場所の活動記録だけを使うことに同意します。") : provider === "b" ? text("공개 배지에 들어갈 장소 활동만 사용해요.", "Use only place activity in the public badge.", "公開バッジには場所のアクティビティだけを使います。") : text("공개 기념 배지 시뮬레이션에 동의해요.", "I consent to the public badge simulation.", "公開用の記念バッジ・シミュレーションに同意します。")}</span></label> : null}
          {stamps === 10 && mint !== "NFT-MINTED" ? <button ref={badgeButtonRef} type="button" className={styles.primary} onClick={mintBadge} disabled={!consent || wallet !== "WAL-READY" || mint === "NFT-MINTING"} data-testid="labs-badge-mint" data-execution-mode={provider === "b" ? qaControls ? "review" : "normal" : undefined}>{wallet !== "WAL-READY"
            ? isKeepsake ? text("먼저 미리보기를 준비해 주세요", "Set up the preview first", "先にプレビューを準備してください") : text("서명 기능 연결 필요", "Signer connection required", "署名機能の接続が必要です")
            : mint === "NFT-MINTING"
              ? provider === "b" ? text("배지 준비 중", "Preparing badge", "バッジを準備中") : text("시뮬레이션 중", "Simulating", "シミュレーション中")
              : provider === "b" ? text("배지 준비", "Prepare badge", "バッジを準備") : text("시뮬레이션 시작", "Start simulation", "シミュレーションを開始")}</button> : null}
          {mint === "NFT-MINTED" ? <div ref={badgeResultRef} tabIndex={-1} data-testid="labs-badge-result" data-review-provenance={provider === "b" && badgeReview ? "simulated" : undefined}><InlineNotice tone="success"><Check size={18} /><span>{provider === "b" ? text("여행 기념 배지가 준비됐어요. 공개된 내용은 없습니다.", "Your travel keepsake is ready. Nothing was published.", "旅の記念バッジを準備しました。公開された内容はありません。") : text("기념 배지 시뮬레이션 완료 · 실제 NFT나 거래는 생성되지 않았습니다.", "Badge simulation complete. No real NFT or transaction was created.", "記念バッジのシミュレーションが完了しました。実際のNFTや取引は作成されていません。")}</span></InlineNotice></div> : null}
          {mint === "NFT-FAILED" ? <div ref={badgeResultRef} tabIndex={-1} data-testid="labs-badge-result"><InlineNotice tone="danger"><AlertTriangle size={17} /><span>{provider === "b" ? text("배지 정보를 준비하지 못했어요. 게시된 내용은 없습니다.", "Badge preparation did not complete. Nothing was published.", "バッジ情報を準備できませんでした。公開された内容はありません。") : text("기념 배지 시뮬레이션을 완료하지 못했어요. 공개 기록은 생성되지 않았습니다.", "Badge simulation did not complete. No public record was created.", "記念バッジのシミュレーションを完了できませんでした。公開記録は作成されていません。")}</span></InlineNotice></div> : null}
        </section>
        {isKeepsake ? <details className={`${styles.card} ${styles.disclosure}`} data-testid="journey-keepsake-details">
          <summary className={styles.disclosureSummary}><strong>{text("개인정보 및 미리보기 안내", "Privacy & preview details", "プライバシー・プレビューの詳細")}</strong><ChevronRight size={18} aria-hidden="true" /></summary>
          <div className={styles.disclosureBody}>
            <p className={styles.finePrint} data-testid="journey-keepsake-privacy">{text("개인정보, 국적, 나이 확인 결과는 기념 배지에 포함되지 않습니다. 만들기 전에 별도의 동의와 본인 확인이 필요해요.", "Personal details, nationality, and age-check results are not included. Creating a keepsake requires separate consent and a Person check.", "個人情報、国籍、年齢確認の結果は含まれません。作成には別途の同意と本人確認が必要です。")}</p>
            <p className={styles.finePrint}>{text("미리보기 준비에는 샘플 서명을 사용합니다. 실제 지갑 연결, 배지·NFT 발행, 거래 또는 공개 게시를 하지 않습니다.", "Preview preparation uses a sample signer. No real wallet is connected and no badge, NFT, transaction, or public post is created.", "プレビューの準備にはサンプル署名を使います。実際のウォレット接続、バッジ・NFTの発行、取引、公開投稿は行いません。")}</p>
            {sampleScenarioControls}
          </div>
        </details> : provider === "b" ? boundaryDisclosure : null}
        </>}
      </div>
    </LabsSheet>
  )
}

function LabsSheet({ provider: _provider, locale, ...props }: ComponentProps<typeof SheetB> & {
  provider: "legacy" | "b"
  locale: OndoBLocale
}) {
  return <SheetB {...props} locale={locale} />
}
