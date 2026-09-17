"use client"

import { useEffect, useRef, useState } from "react"
import { Check, ChevronRight, Footprints, LoaderCircle, RotateCcw, Sparkles } from "lucide-react"
import { canonicalMapVenueById } from "@/lib/ondo/venues/map-data"
import type { OndoBLocale } from "../shared/state/ondo-b-preferences"
import { requestJourneyKeepsakeB } from "../identity-b/journey-stamps-navigation-b"
import { useBActivityProfile } from "../identity-b/activity-profile-b-provider"
import { useQaControls } from "../shared/ui/use-qa-controls"
import styles from "./visit-stamp-receipt-b.module.css"

const COPY = {
  en: {
    title: "Remember this visit",
    body: "One stamp per place. No purchase needed.",
    confirm: "Try a visit stamp",
    checking: "Checking visit",
    recorded: "Visit saved",
    duplicate: "Already recorded",
    failed: "Couldn’t save the visit in this tab.",
    retry: "Try again",
    details: "Privacy & visit details",
    boundary: "This is a sample visit, not a location or venue check. It stays in this open session and resets on reload. No purchase or identity check is needed to try it.",
    milestone: "10th place reached",
    milestoneBody: "Keep a souvenir of your first ten places, if you’d like.",
    open: "View souvenir",
    reviewScope: "Review visit · no external visit confirmation",
    unavailable: "Visit checks aren’t connected yet",
    unavailableBody: "No visit is confirmed and no stamp is created here. You can still explore places.",
    unavailableBoundary: "Opening a place or making a payment does not verify a visit. This screen does not collect location evidence or add a visit record.",
  },
  ko: {
    title: "이번 방문 기억하기",
    body: "장소마다 하나씩. 결제 없이도 기록할 수 있어요.",
    confirm: "방문 스탬프 체험",
    checking: "방문 확인 중",
    recorded: "방문 저장됨",
    duplicate: "이미 기록됨",
    failed: "이 탭에 방문 기록을 저장하지 못했어요.",
    retry: "다시 시도",
    details: "개인정보 및 방문 기록 안내",
    boundary: "실제 위치나 매장을 확인하지 않는 샘플 방문 기록이에요. 현재 세션에서만 유지되며 새로고침하면 초기화돼요. 체험에는 결제나 신원 확인이 필요하지 않아요.",
    milestone: "열 번째 장소 도착",
    milestoneBody: "원하면 첫 열 곳의 추억을 기념 배지로 남겨보세요.",
    open: "기념품 보기",
    reviewScope: "검토용 방문 기록 · 외부 방문 확인 없음",
    unavailable: "아직 방문 확인이 연결되지 않았어요",
    unavailableBody: "여기서는 방문을 확인하거나 스탬프를 만들지 않아요. 장소는 계속 둘러볼 수 있어요.",
    unavailableBoundary: "장소를 열거나 결제해도 방문 확인으로 처리되지 않아요. 이 화면에서는 위치 증빙을 수집하거나 방문 기록을 추가하지 않아요.",
  },
  ja: {
    title: "この訪問を記録",
    body: "1か所に1つ。支払いなしで記録できます。",
    confirm: "訪問スタンプを体験",
    checking: "訪問を確認中",
    recorded: "訪問を保存しました",
    duplicate: "記録済みです",
    failed: "このタブに訪問を保存できませんでした。",
    retry: "もう一度試す",
    details: "プライバシー・訪問記録の詳細",
    boundary: "実際の位置や店舗を確認しないサンプル訪問です。このセッション内でのみ保持され、再読み込みでリセットされます。体験に支払いや本人確認は不要です。",
    milestone: "10か所目に到達",
    milestoneBody: "最初の10か所の思い出を、任意の記念バッジにできます。",
    open: "記念アイテムを見る",
    reviewScope: "検証用の訪問記録・外部での訪問確認なし",
    unavailable: "訪問確認はまだ接続されていません",
    unavailableBody: "ここでは訪問の確認やスタンプの追加は行いません。場所の探索は続けられます。",
    unavailableBoundary: "場所を開いたり支払ったりしても、訪問の確認にはなりません。この画面では位置の証拠を収集せず、訪問記録も追加しません。",
  },
} as const

export function VisitStampReceiptB({ locale, venueId, active = true }: { locale: OndoBLocale; venueId: string; active?: boolean }) {
  const reviewMode = useQaControls()
  const { state, actions } = useBActivityProfile()
  const [failure, setFailure] = useState(false)
  const [duplicate, setDuplicate] = useState(false)
  const [checking, setChecking] = useState(false)
  const retryRef = useRef<HTMLButtonElement>(null)
  const proofFrameRef = useRef<number | null>(null)
  const activeRef = useRef(active)
  activeRef.current = active
  const evidenceId = `visit:${venueId}`
  const recorded = state.acceptedEvidenceIds.includes(evidenceId)
  const copy = COPY[locale]

  useEffect(() => () => {
    if (proofFrameRef.current != null) window.cancelAnimationFrame(proofFrameRef.current)
  }, [])

  useEffect(() => {
    if (active) return
    if (proofFrameRef.current != null) window.cancelAnimationFrame(proofFrameRef.current)
    proofFrameRef.current = null
    setChecking(false)
  }, [active])

  function confirmVisit() {
    if (!reviewMode || !activeRef.current || checking) return
    setFailure(false)
    setDuplicate(false)
    setChecking(true)
    proofFrameRef.current = window.requestAnimationFrame(() => {
      proofFrameRef.current = window.requestAnimationFrame(() => {
        proofFrameRef.current = null
        if (!activeRef.current) return
        const hasLocalPlaceEvidence = Boolean(canonicalMapVenueById(venueId))
        const result = hasLocalPlaceEvidence ? actions.recordUniqueVisit(evidenceId) : "invalid"
        setChecking(false)
        if (result === "accepted") return
        if (result === "duplicate") {
          setDuplicate(true)
          return
        }
        setFailure(true)
        window.requestAnimationFrame(() => retryRef.current?.focus({ preventScroll: true }))
      })
    })
  }

  if (!reviewMode) return (
    <section className={styles.root} data-testid="visit-stamp-receipt" data-mode="unavailable" data-recorded={false} data-proof-state="unavailable" data-stamp-count={0}>
      <div className={styles.heading}>
        <span><Footprints size={20} aria-hidden="true" /></span>
        <div><h3>{copy.unavailable}</h3><p>{copy.unavailableBody}</p></div>
      </div>
      <details className={styles.details} data-testid="visit-stamp-details">
        <summary>{copy.details}<ChevronRight size={16} aria-hidden="true" /></summary>
        <p>{copy.unavailableBoundary}</p>
      </details>
    </section>
  )

  return (
    <section className={styles.root} data-testid="visit-stamp-receipt" data-mode="review" data-recorded={recorded} data-proof-state={checking ? "checking" : recorded ? "saved" : failure ? "failed" : "idle"} data-stamp-count={state.stamps}>
      <div className={styles.heading}>
        <span><Footprints size={20} aria-hidden="true" /></span>
        <div><h3>{recorded && state.stamps === 10 ? copy.milestone : copy.title}</h3><p>{recorded && state.stamps === 10 ? copy.milestoneBody : copy.body}</p></div>
        <strong>{state.stamps}<small>/10</small></strong>
      </div>
      <div className={styles.track} role="img" aria-label={`${state.stamps}/10`}>
        {Array.from({ length: 10 }, (_, index) => <i key={index} data-filled={index < state.stamps}>{index < state.stamps ? <Check size={10} aria-hidden="true" /> : null}</i>)}
      </div>
      {reviewMode || recorded ? <p className={styles.reviewScope} data-testid="visit-review-provenance"><Sparkles size={14} aria-hidden="true" />{copy.reviewScope}</p> : null}
      {failure ? <p className={styles.error} role="alert">{copy.failed}</p> : null}
      {duplicate ? <p className={styles.status} role="status">{copy.duplicate}</p> : null}
      {recorded && state.stamps === 10 ? (
        <button type="button" className={styles.primary} data-testid="checkout-stamp-milestone" onClick={requestJourneyKeepsakeB}><Sparkles size={16} aria-hidden="true" />{copy.open}<ChevronRight size={16} aria-hidden="true" /></button>
      ) : recorded ? (
        <p className={styles.status} role="status"><Check size={15} aria-hidden="true" />{copy.recorded}</p>
      ) : reviewMode ? (
        <button ref={retryRef} type="button" className={styles.primary} data-testid="visit-proof-check" disabled={checking} aria-busy={checking} onClick={confirmVisit}>{checking ? <LoaderCircle className={styles.spinner} size={16} aria-hidden="true" /> : failure ? <RotateCcw size={16} aria-hidden="true" /> : <Footprints size={16} aria-hidden="true" />}{checking ? copy.checking : failure ? copy.retry : copy.confirm}</button>
      ) : <p className={styles.unavailable}><Footprints size={15} aria-hidden="true" />{copy.unavailable}</p>}
      <details className={styles.details} data-testid="visit-stamp-details">
        <summary>{copy.details}<ChevronRight size={14} aria-hidden="true" /></summary>
        <p>{copy.boundary}</p>
      </details>
    </section>
  )
}
