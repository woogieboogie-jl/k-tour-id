"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { KTourIdMark } from "../shared/ui/ktour-id-mark"
import {
  CalendarClock,
  ChevronRight,
  CircleUserRound,
  Compass,
  MapPinned,
  Settings,
  ShieldCheck,
  UserRoundCheck,
  WalletCards,
} from "lucide-react"
import { useOndoB } from "../shared/state/ondo-b-provider"
import type { OndoBLocale } from "../shared/state/ondo-b-preferences"
import { LocalCheckWalkthroughB, type LocalCheckKind, type LocalCheckOutcome } from "./local-check-walkthrough-b"
import { IdWalletCommerceB } from "../commerce-b/id-wallet-commerce-b"
import { SavedExperienceB } from "../experience-b/saved-experience-b"
import {
  GLOBAL_AFTER19_SESSION_EVENT,
  GLOBAL_AFTER19_SESSION_KEY,
  isGlobalAfter19AgeCurrent,
  persistGlobalAfter19SessionB,
  recordGlobalAfter19ReviewEligibilityB,
  rollbackPersistedGlobalAfter19SessionB,
  restoreGlobalAfter19B,
  sanitizeGlobalAfter19Session,
  type GlobalAfter19SessionB,
} from "../after19/after19-global-b-model"
import { readGuestAfter19MemoryB, writeGuestAfter19MemoryB } from "../after19/after19-guest-memory-b"
import { createReviewFixtureAuthority, reviewFixture } from "../contracts/execution-mode"
import { qaReviewFixtureOptions, useQaControls } from "../shared/ui/use-qa-controls"
import { useSheetPresence } from "../shared/ui/use-sheet-presence"
import {
  B_ACTION_AXIS_SESSION_EVENT,
  DEFAULT_B_ACTION_GATE_SESSION,
  persistBActionGateSession,
  restoreBActionGateSession,
  updateBActionAxisSession,
  type BActionGateSession,
} from "./action-gate-contract-b"
import { ProfileReputationB } from "./profile-reputation-b"
import { JourneyStampsCardB } from "./journey-stamps-b"
import { KPassServiceCardB } from "./kpass-service-card-b"
import { SampleInfoButtonB } from "../shared/ui/sample-info-button-b"
import { evaluateKPassService } from "../contracts/kpass-capabilities"
import { kpassDecisionLabel } from "./kpass-decision-copy"
import { isReviewCredentialDraftB, simulatedCredentialStatusB } from "./ktour-id-setup-model-b"
import { resolveTravelerAxisPresentationB } from "./traveler-id-status-b"
import styles from "./traveler-id-entry-b.module.css"

const actionGateSessionOptions = qaReviewFixtureOptions

const COPY = {
  en: {
    eyebrow: "YOUR KOREA, YOUR CONTROL",
    title: "Travel Pass",
    body: "Your places, plans and wallet — ready when you need them.",
    passLabel: "K-Tour ID · KOREA TRAVEL PASS",
    passState: "Guest pass",
    passStateActive: "Account ready",
    passBody: "Explore first. Activate only when saving, joining or paying needs it.",
    passBoundary: "For your trip · not an official ID",
    readiness: "Trip readiness",
    readinessBody: "Check only what you choose or an action needs.",
    accountTitle: "Account",
    accountGuest: "Guest",
    accountActive: "Active",
    accountBody: "No account needed to explore Korea.",
    accountActiveBody: "Ready for saves in this tab. Person, 19+, and payment remain separate.",
    personTitle: "Person",
    personBody: "Person does not prove 19+.",
    ageTitle: "19+",
    ageBody: "19+ does not prove identity.",
    paymentTitle: "Payment",
    paymentBody: "Checked only when a payment action needs it. This is separate from the local travel balance below.",
    credentialTitle: "K-Tour ID",
    credentialBody: "K-Tour ID stays separate from Person and 19+.",
    credentialReady: "Ready",
    credentialEmpty: "Not set up",
    credentialOpen: "Open K-Tour ID",
    notChecked: "Not checked",
    success: "Ready",
    reviewResult: "Review result · no provider check",
    reviewExpired: "Review result expired · no provider check",
    credentialReview: "Review draft · no provider check",
    credentialReviewExpired: "Review draft expired · no provider check",
    cancel: "Not completed",
    failure: "Try again",
    unavailable: "Unavailable",
    unsupported: "Not supported",
    expired: "Expired",
    walletReady: "Travel balance ready",
    walletNotReady: "Set up",
    checkPerson: "Check Person",
    checkAge: "Check 19+",
    prototype: "Privacy & readiness",
    prototypeBody: "This Travel Pass is a travel aid, not an official ID. Account, Person, 19+, K-Tour ID and payment readiness stay independent in this tab.",
    settings: "Settings",
  },
  ko: {
    eyebrow: "나의 한국 여행, 나의 선택",
    title: "여행 패스",
    body: "장소·일정·지갑을 필요한 순간에만 준비해요.",
    passLabel: "K-Tour ID · KOREA TRAVEL PASS",
    passState: "게스트 패스",
    passStateActive: "계정 준비됨",
    passBody: "먼저 둘러보세요. 저장·참여·결제에 필요할 때만 활성화합니다.",
    passBoundary: "나의 여행 패스 · 공식 신분증 아님",
    readiness: "여행 준비 상태",
    readinessBody: "내가 선택하거나 행동에 필요한 항목만 확인해요.",
    accountTitle: "계정",
    accountGuest: "게스트",
    accountActive: "활성",
    accountBody: "한국을 둘러보는 데 계정은 필요 없어요.",
    accountActiveBody: "이 탭에서 저장할 수 있어요. 본인·19+·결제 확인은 별개입니다.",
    personTitle: "본인",
    personBody: "본인 확인은 19+를 증명하지 않습니다.",
    ageTitle: "19+",
    ageBody: "19+는 본인을 증명하지 않습니다.",
    paymentTitle: "결제",
    paymentBody: "결제 작업에 필요할 때만 별도로 확인합니다. 아래 로컬 여행 잔액과는 다른 상태예요.",
    credentialTitle: "K-Tour ID",
    credentialBody: "K-Tour ID는 본인·19+와 별개로 유지됩니다.",
    credentialReady: "준비됨",
    credentialEmpty: "설정 전",
    credentialOpen: "K-Tour ID 열기",
    notChecked: "확인 전",
    success: "준비됨",
    reviewResult: "검토용 결과 · 외부 확인 없음",
    reviewExpired: "검토용 결과 만료 · 외부 확인 없음",
    credentialReview: "검토용 초안 · 외부 확인 없음",
    credentialReviewExpired: "검토용 초안 만료 · 외부 확인 없음",
    cancel: "완료 전",
    failure: "다시 시도",
    unavailable: "이용 불가",
    unsupported: "지원하지 않음",
    expired: "만료됨",
    walletReady: "여행 잔액 준비됨",
    walletNotReady: "설정 필요",
    checkPerson: "본인 확인",
    checkAge: "19+ 확인",
    prototype: "개인정보와 준비 상태",
    prototypeBody: "이 여행 패스는 여행 도구이며 공식 신분증이 아닙니다. 계정·본인·19+·K-Tour ID·결제 준비 상태는 이 탭에서 서로 독립적으로 유지됩니다.",
    settings: "설정",
  },
  ja: {
    eyebrow: "韓国の旅を、自分で管理",
    title: "トラベルパス",
    body: "場所・予定・ウォレットを、必要な時だけ準備します。",
    passLabel: "K-Tour ID · KOREA TRAVEL PASS",
    passState: "ゲストパス",
    passStateActive: "アカウント準備済み",
    passBody: "まずは自由に探せます。保存・参加・支払いで必要になったときだけ準備します。",
    passBoundary: "旅のパス · 公的身分証ではありません",
    readiness: "旅の準備状況",
    readinessBody: "自分で選んだ項目、または操作に必要な項目だけ確認します。",
    accountTitle: "アカウント",
    accountGuest: "ゲスト",
    accountActive: "有効",
    accountBody: "韓国を探すだけなら、アカウントは不要です。",
    accountActiveBody: "このタブで保存できます。本人、19歳以上、決済の確認は別です。",
    personTitle: "本人",
    personBody: "本人確認だけでは、19歳以上であることを証明しません。",
    ageTitle: "19+",
    ageBody: "19歳以上という結果だけでは、本人であることを証明しません。",
    paymentTitle: "決済",
    paymentBody: "支払い操作で必要になったときだけ別に確認します。下のローカル旅行残高とは別の状態です。",
    credentialTitle: "K-Tour ID",
    credentialBody: "K-Tour IDは本人・19歳以上とは別に保たれます。",
    credentialReady: "準備済み",
    credentialEmpty: "未設定",
    credentialOpen: "K-Tour IDを開く",
    notChecked: "未確認",
    success: "準備済み",
    reviewResult: "レビュー用結果 · 外部確認なし",
    reviewExpired: "レビュー用結果は期限切れ · 外部確認なし",
    credentialReview: "レビュー用下書き · 外部確認なし",
    credentialReviewExpired: "レビュー用下書きは期限切れ · 外部確認なし",
    cancel: "未完了",
    failure: "再試行が必要",
    unavailable: "利用不可",
    unsupported: "非対応",
    expired: "期限切れ",
    walletReady: "旅行残高の準備完了",
    walletNotReady: "設定が必要",
    checkPerson: "本人であることを確認",
    checkAge: "19歳以上を確認",
    prototype: "プライバシーと準備状況",
    prototypeBody: "このトラベルパスは旅の補助であり、公的身分証ではありません。アカウント、本人、19歳以上、K-Tour ID、決済準備はこのタブで互いに独立して保たれます。",
    settings: "設定",
  },
} as const

type IdentityLocale = OndoBLocale
type DirectCheckRun = Readonly<{ check: LocalCheckKind; serial: number; credentialId: string | null }>

function outcomeLabel(locale: IdentityLocale, outcome: LocalCheckOutcome | null) {
  const copy = COPY[locale]
  if (!outcome) return copy.notChecked
  return copy[outcome]
}

function restoredAgeOutcome(session: GlobalAfter19SessionB | null, now = new Date()): LocalCheckOutcome | null {
  if (!session) return null
  if (isGlobalAfter19AgeCurrent(session, now)) return "success"
  return session.expiryNotice || (session.age === "eligible" && session.ageExpiresAt !== null) ? "expired" : null
}

export function TravelerIdEntryB() {
  const { state, actions } = useOndoB()
  // The Pass content retains its scroll position while a check is open.
  // Mount the task at the themed viewport, never inside that scrolled content.
  const checkHost = typeof document === "undefined" ? null : document.querySelector("[data-testid='ondo-canvas']")
  const reviewMode = useQaControls()
  const [personOutcome, setPersonOutcome] = useState<LocalCheckOutcome | null>(null)
  const [ageOutcome, setAgeOutcome] = useState<LocalCheckOutcome | null>(null)
  const [actionSession, setActionSession] = useState<BActionGateSession>(DEFAULT_B_ACTION_GATE_SESSION)
  const [after19Session, setAfter19Session] = useState<GlobalAfter19SessionB | null>(null)
  const [statusClock, setStatusClock] = useState(() => Date.now())
  const [activeCheck, setActiveCheck] = useState<DirectCheckRun | null>(null)
  const directCheckPresence = useSheetPresence(activeCheck)
  const personRef = useRef<HTMLButtonElement>(null)
  const ageRef = useRef<HTMLButtonElement>(null)
  const checkSerialRef = useRef(0)
  const returnFocusCheckRef = useRef<LocalCheckKind | null>(null)
  const locale = state.locale
  const copy = COPY[locale]
  const accountActive = state.account === "ACC-ACTIVE"
  const restoredPerson = resolveTravelerAxisPresentationB(actionSession.person, statusClock)
  const restoredPersonStatus = restoredPerson.outcome
  const personStatus = personOutcome === "success" ? restoredPersonStatus : personOutcome ?? restoredPersonStatus
  const personReviewResult = personStatus === "success" || personStatus === "expired" ? restoredPerson.reviewResult : null
  const restoredAgeStatus = restoredAgeOutcome(after19Session, new Date(statusClock))
  const ageStatus = ageOutcome === "success" ? restoredAgeStatus : ageOutcome ?? restoredAgeStatus
  const ageReviewResult = ageStatus === "success" && after19Session?.eligibilityReceipt?.provenanceTruth === "SIMULATED"
  const payment = resolveTravelerAxisPresentationB(actionSession.payment, statusClock)
  const paymentStatus = payment.outcome
  const paymentReviewResult = payment.reviewResult
  const lifecycleStatus = simulatedCredentialStatusB(state.identityCredential, statusClock)
  const credentialReviewResult = isReviewCredentialDraftB(state.identityCredential)
    ? lifecycleStatus === "simulated_ready" ? "current" : lifecycleStatus
    : null
  const credentialStatus = lifecycleStatus === "simulated_ready" ? "review-draft" : lifecycleStatus
  const credentialLifecycleLabel = state.identityCredential && (lifecycleStatus === "revoked" || lifecycleStatus === "suspended")
    ? kpassDecisionLabel(evaluateKPassService(state.identityCredential, { service: "person", now: statusClock }), locale)
    : null

  useEffect(() => {
    function syncActionSession() {
      const restored = restoreBActionGateSession(window.sessionStorage, new Date(), actionGateSessionOptions())
      persistBActionGateSession(window.sessionStorage, restored, new Date(), actionGateSessionOptions())
      setActionSession(restored)
    }
    syncActionSession()
    window.addEventListener(B_ACTION_AXIS_SESSION_EVENT, syncActionSession)
    return () => {
      window.removeEventListener(B_ACTION_AXIS_SESSION_EVENT, syncActionSession)
    }
  }, [])

  useEffect(() => {
    function syncAfter19Session(event?: Event) {
      if (accountActive) {
        setAfter19Session(restoreGlobalAfter19B(window.localStorage, window.sessionStorage, new Date(), qaReviewFixtureOptions()).session)
        return
      }
      // Guest age evidence is scoped to the current action/component only.
      // It may travel through the same-tab event, but never survives reload.
      window.sessionStorage.removeItem(GLOBAL_AFTER19_SESSION_KEY)
      const next = event instanceof CustomEvent
        ? sanitizeGlobalAfter19Session(event.detail, new Date(), qaReviewFixtureOptions())
        : readGuestAfter19MemoryB(new Date(), qaReviewFixtureOptions())
      setAfter19Session(next)
    }
    syncAfter19Session()
    window.addEventListener(GLOBAL_AFTER19_SESSION_EVENT, syncAfter19Session)
    return () => window.removeEventListener(GLOBAL_AFTER19_SESSION_EVENT, syncAfter19Session)
  }, [accountActive])

  useEffect(() => {
    const now = Date.now()
    setStatusClock(now)
    const credentialExpiry = state.identityCredential?.expiresAt ?? Number.POSITIVE_INFINITY
    const ageExpiry = after19Session?.ageExpiresAt ? Date.parse(after19Session.ageExpiresAt) : Number.POSITIVE_INFINITY
    const personExpiry = actionSession.person.status === "eligible" && actionSession.person.expiresAt
      ? Date.parse(actionSession.person.expiresAt)
      : Number.POSITIVE_INFINITY
    const paymentExpiry = actionSession.payment.status === "eligible" && actionSession.payment.expiresAt
      ? Date.parse(actionSession.payment.expiresAt)
      : Number.POSITIVE_INFINITY
    const expiry = Math.min(credentialExpiry, ageExpiry, personExpiry, paymentExpiry)
    if (!Number.isFinite(expiry)) return
    const delay = expiry - now
    if (delay <= 0) return
    const timer = window.setTimeout(() => setStatusClock(Date.now()), delay + 16)
    return () => window.clearTimeout(timer)
  }, [actionSession.payment.expiresAt, actionSession.payment.status, actionSession.person.expiresAt, actionSession.person.status, after19Session?.ageExpiresAt, state.identityCredential])

  useEffect(() => {
    if (directCheckPresence.phase !== "closed" || activeCheck !== null) return
    const returningCheck = returnFocusCheckRef.current
    if (!returningCheck) return
    returnFocusCheckRef.current = null
    const frame = window.requestAnimationFrame(() => {
      const opener = returningCheck === "person" ? personRef.current : ageRef.current
      if (!opener?.isConnected || opener.closest("[inert],[aria-hidden='true']")) return
      opener.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeCheck, directCheckPresence.phase])

  function openCheck(check: LocalCheckKind) {
    if (state.identityCredential) {
      const decision = evaluateKPassService(state.identityCredential, { service: check === "age" ? "age" : "person" })
      const canProveMissingAge = check === "age" && decision.reason === "age_proof_required"
      if (decision.status !== "allowed" && !canProveMissingAge) { actions.notify(kpassDecisionLabel(decision, locale)); return }
    }
    checkSerialRef.current += 1
    returnFocusCheckRef.current = null
    setActiveCheck({ check, serial: checkSerialRef.current, credentialId: state.identityCredential?.credentialId ?? null })
  }

  function activateDirectAccount() {
    if (!actions.beginAccountActivation()) return false
    if (actions.activateAccount()) return true
    // A refused durable account write must not strand this direct flow in the
    // ephemeral ACC-CREATING state. The visible retry starts from Guest again.
    actions.cancelAccountActivation()
    return false
  }

  function finishCheckRun(returningRun: DirectCheckRun) {
    returnFocusCheckRef.current = returningRun.check
    setActiveCheck((current) => current?.serial === returningRun.serial ? null : current)
  }

  function returnFromCheck(returningRun: DirectCheckRun, outcome: LocalCheckOutcome) {
    const returningCheck = returningRun.check
    // A result from an older picker/persona or an already replaced walkthrough
    // cannot attach evidence to the newly displayed credential.
    if (activeCheck?.serial !== returningRun.serial
      || (outcome !== "cancel" && returningRun.credentialId !== (state.identityCredential?.credentialId ?? null))) return false
    if (returningCheck === "person") {
      if (outcome !== "cancel" && reviewMode) {
        if (outcome === "success" && state.identityCredential
          && evaluateKPassService(state.identityCredential, { service: "person" }).status !== "allowed") {
          setPersonOutcome("failure")
          return false
        }
        setPersonOutcome(outcome)
        const safeOutcome = outcome
        const status = safeOutcome === "success" ? "eligible" : safeOutcome === "failure" ? "failed" : safeOutcome
        const now = new Date()
        const authority = safeOutcome === "success"
          ? createReviewFixtureAuthority({
              qaRuntimeEnabled: reviewMode,
              explicitlyRequested: reviewMode,
              fixtureId: "FX-PER-DIRECT-SUCCESS",
            })
          : null
        const execution = authority
          ? reviewFixture(authority, { outcome: "success", value: { axis: "person" as const }, now })
          : undefined
        const next = updateBActionAxisSession(window.sessionStorage, "person", status, now, {
          ...actionGateSessionOptions(),
          reviewExecution: execution,
        })
        if (next) {
          setActionSession(next)
          window.dispatchEvent(new CustomEvent(B_ACTION_AXIS_SESSION_EVENT, { detail: next }))
        } else {
          setPersonOutcome("failure")
          return false
        }
      }
    }
    if (returningCheck === "age") {
      if (outcome !== "cancel" && reviewMode) setAgeOutcome(outcome)
      if (outcome === "success" && reviewMode) {
        const authority = createReviewFixtureAuthority({ qaRuntimeEnabled: reviewMode, explicitlyRequested: reviewMode, fixtureId: "FX-AGE-SUCCESS" })
        if (!authority) {
          setAgeOutcome("unavailable")
          return false
        }
        const completedAt = new Date()
        const execution = reviewFixture(authority, { outcome: "success", value: { predicate: "AGE_GTE_19" as const, outcome: "eligible" as const }, now: completedAt })
        const decision = state.identityCredential ? evaluateKPassService(state.identityCredential, { service: "age", now: completedAt.getTime() }) : null
        const completingMissingAge = decision?.reason === "age_proof_required"
        if (decision && decision.status !== "allowed" && !completingMissingAge) {
          setAgeOutcome("failure")
          return false
        }
        const eligible = recordGlobalAfter19ReviewEligibilityB(execution, completedAt)
        const next = after19Session?.mode === "manual-off" ? { ...eligible, mode: "manual-off" as const } : eligible
        const previousGuest = accountActive ? null : readGuestAfter19MemoryB(completedAt, qaReviewFixtureOptions())
        let persisted: ReturnType<typeof persistGlobalAfter19SessionB> = null
        const rollbackAge = () => {
          if (persisted) rollbackPersistedGlobalAfter19SessionB(window.sessionStorage, persisted)
          if (previousGuest) writeGuestAfter19MemoryB(previousGuest, completedAt, qaReviewFixtureOptions())
        }
        try {
          if (accountActive) persisted = persistGlobalAfter19SessionB(window.sessionStorage, next, completedAt, qaReviewFixtureOptions())
          const committed = accountActive
            ? persisted ? next : null
            : writeGuestAfter19MemoryB(next, completedAt, qaReviewFixtureOptions())
          if (!committed || committed.age !== "eligible") {
            rollbackAge()
            setAgeOutcome("failure")
            return false
          }
          if (!accountActive) window.sessionStorage.removeItem(GLOBAL_AFTER19_SESSION_KEY)
          if (completingMissingAge && !actions.completeAgeProof(execution)) {
            rollbackAge()
            setAgeOutcome("failure")
            return false
          }
          setAfter19Session(committed)
          window.dispatchEvent(new CustomEvent(GLOBAL_AFTER19_SESSION_EVENT, { detail: committed }))
        } catch {
          rollbackAge()
          setAgeOutcome("failure")
          return false
        }
      }
    }
    // The axis mutation above is committed before the desired check closes.
    // Presence owns only the outer 260ms return transition.
    finishCheckRun(returningRun)
    return true
  }

  return (
    <div className={styles.root}>
      <div className={styles.screen} data-testid="ondo-b-traveler-id" data-page-typography="root" data-visual-direction="apple-wallet-flow8">
        <header className={styles.header} data-page-title-frame>
          <h1 data-page-title>{copy.title}</h1>
          <SampleInfoButtonB />
        </header>

        <div className={styles.passJourney}>
          <section className={styles.pass} aria-label={accountActive ? copy.passStateActive : copy.passState} data-testid="travel-pass-card" data-flow8-object="pass">
            <div className={styles.passGlow} aria-hidden="true" />
            <div className={styles.passTop}><span>{copy.passLabel}</span><MapPinned size={27} strokeWidth={1.55} aria-hidden="true" /></div>
            <div className={styles.passMain}>
              <div><small>{accountActive ? copy.passStateActive : copy.passState}</small><strong>SEOUL — BUSAN — JEJU</strong></div>
              <Compass size={23} aria-hidden="true" />
            </div>
            <small className={styles.passBoundary} data-testid="travel-pass-local-boundary">{copy.passBoundary}</small>
          </section>
          <JourneyStampsCardB locale={locale} />
        </div>

        <div className={styles.walletPane}>
          <KPassServiceCardB paymentReady={paymentStatus === "success"} compact />
          <IdWalletCommerceB />
        </div>

        <SavedExperienceB locale={locale} />

        <details className={styles.readiness} data-testid="travel-pass-status" aria-labelledby="travel-readiness-title">
          <summary className={styles.sectionHeading} data-testid="travel-pass-readiness-toggle">
            <h2 id="travel-readiness-title">{copy.readiness}</h2>
            <ChevronRight size={19} aria-hidden="true" />
          </summary>
          <p className={styles.readinessIntro}>{copy.readinessBody}</p>

          <div className={styles.statusGrid}>
            <article className={styles.statusCard} data-testid="traveler-id-account" data-status={accountActive ? "active" : "guest"}>
              <div className={styles.statusTop}><CircleUserRound size={20} aria-hidden="true" /><span>{accountActive ? copy.accountActive : copy.accountGuest}</span></div>
              <h3>{copy.accountTitle}</h3>
            </article>

            <article className={styles.statusCard} data-testid="traveler-id-person" data-status={personStatus ?? "none"} data-review-result={personReviewResult ?? "none"}>
              <div className={styles.statusTop}>{personReviewResult ? <ShieldCheck size={20} aria-hidden="true" /> : <UserRoundCheck size={20} aria-hidden="true" />}<span>{personReviewResult === "current" ? copy.reviewResult : personReviewResult === "expired" ? copy.reviewExpired : outcomeLabel(locale, personStatus)}</span></div>
              <h3>{copy.personTitle}</h3>
              <button ref={personRef} type="button" aria-label={copy.checkPerson} data-testid="traveler-id-person-check" onClick={() => openCheck("person")}><span className={styles.actionLabel}>{copy.checkPerson}</span><ChevronRight size={17} aria-hidden="true" /></button>
            </article>

            <article className={styles.statusCard} data-testid="traveler-id-age" data-status={ageStatus ?? "none"} data-review-result={ageReviewResult ? "true" : "false"}>
              <div className={styles.statusTop}><CalendarClock size={20} aria-hidden="true" /><span>{ageReviewResult ? copy.reviewResult : outcomeLabel(locale, ageStatus)}</span></div>
              <h3>{copy.ageTitle}</h3>
              <button ref={ageRef} type="button" aria-label={copy.checkAge} data-testid="traveler-id-age-check" onClick={() => openCheck("age")}><span className={styles.actionLabel}>{copy.checkAge}</span><ChevronRight size={17} aria-hidden="true" /></button>
            </article>

            <article className={styles.statusCard} data-testid="traveler-id-credential" data-status={credentialStatus} data-review-result={credentialReviewResult ?? "none"}>
              <div className={styles.statusTop}>{credentialReviewResult ? <ShieldCheck size={20} aria-hidden="true" /> : <KTourIdMark size={20} />}<span>{credentialLifecycleLabel ?? (credentialReviewResult === "current" ? copy.credentialReview : credentialReviewResult === "expired" ? copy.credentialReviewExpired : state.identityCredential ? copy.credentialReady : copy.credentialEmpty)}</span></div>
              <h3>{copy.credentialTitle}</h3>
              <button type="button" aria-label={copy.credentialOpen} data-testid="traveler-id-ktour-id-open" onClick={() => actions.openIdentitySetup("traveler_id")}><span className={styles.actionLabel}>{copy.credentialOpen}</span><ChevronRight size={17} aria-hidden="true" /></button>
            </article>

            <article className={styles.statusCard} data-testid="traveler-id-payment" data-status={paymentStatus ?? "none"} data-review-result={paymentReviewResult ?? "none"}>
              <div className={styles.statusTop}>{paymentReviewResult ? <ShieldCheck size={20} aria-hidden="true" /> : <WalletCards size={20} aria-hidden="true" />}<span>{paymentReviewResult === "current" ? copy.reviewResult : paymentReviewResult === "expired" ? copy.reviewExpired : outcomeLabel(locale, paymentStatus)}</span></div>
              <h3>{copy.paymentTitle}</h3>
            </article>
          </div>
        </details>

        <div className={styles.profilePane}>
          <ProfileReputationB locale={locale} accountActive={accountActive} personAxis={actionSession.person} statusClock={statusClock} />
        </div>

        <footer className={styles.footer}>
          <details>
            <summary>{copy.prototype}</summary>
            <p>{copy.prototypeBody}</p>
            <ul data-testid="traveler-id-axis-details">
              <li><strong>{copy.accountTitle}</strong> · {accountActive ? copy.accountActiveBody : copy.accountBody}</li>
              <li><strong>{copy.personTitle}</strong> · {copy.personBody}</li>
              <li><strong>{copy.ageTitle}</strong> · {copy.ageBody}</li>
              <li><strong>{copy.credentialTitle}</strong> · {copy.credentialBody}</li>
              <li><strong>{copy.paymentTitle}</strong> · {copy.paymentBody}</li>
            </ul>
          </details>
          <button type="button" onClick={() => actions.setTab("settings")}><Settings size={17} aria-hidden="true" />{copy.settings}</button>
        </footer>
      </div>

      {directCheckPresence.value && checkHost ? createPortal(
        <LocalCheckWalkthroughB
          key={directCheckPresence.value.serial}
          locale={locale}
          check={directCheckPresence.value.check}
          origin="traveler_id"
          presenceState={directCheckPresence.phase}
          accountActive={accountActive}
          onActivateAccount={activateDirectAccount}
          boundarySeen={state.localInteractionBoundarySeen}
          onAcknowledgeBoundary={actions.acknowledgeLocalInteractionBoundary}
          onReturn={(outcome) => returnFromCheck(directCheckPresence.value!, outcome)}
        />
      , checkHost) : null}
    </div>
  )
}
