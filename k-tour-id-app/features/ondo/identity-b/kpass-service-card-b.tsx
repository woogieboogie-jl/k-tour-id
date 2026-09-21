"use client"

import { useState } from "react"
import { createPortal } from "react-dom"
import { ArrowUpRight, Check, ChevronRight, Gift, LockKeyhole, ShieldCheck, SlidersHorizontal, WalletCards, Wine } from "lucide-react"
import { evaluateKPassService, KPASS_DEMO_SCENARIOS, type KPassService } from "../contracts/kpass-capabilities"
import { STABLE_B_OFFER_VENUE_ID } from "../commerce-b/stable-commerce-model-b"
import { useOndoB } from "../shared/state/ondo-b-provider"
import { useReviewSampleSession } from "../shared/ui/use-qa-controls"
import { SheetB } from "../shared/ui/sheet-b"
import { useSheetPresence } from "../shared/ui/use-sheet-presence"
import { kpassDecisionLabel } from "./kpass-decision-copy"
import styles from "./kpass-service-card-b.module.css"

const COPY = {
  ko: { title: "내 자격으로 할 수 있는 일", start: "K-Tour ID 만들기", settings: "샘플 자격 선택", sample: "데모 자격", guest: "게스트", notice: "샘플을 바꾸면 본인·19+·결제 확인을 새로 시작합니다. 실제 자격은 바뀌지 않아요.", error: "변경하지 못했어요. 다시 시도해 주세요.", person: "장소 메모", age: "19+ 테이블", visitor_benefit: "여행 혜택", payment: "여행 결제", allowed: "이용 가능", needs_proof: "확인 필요", denied: "이용 제한", expired: "기간 만료", allowance: "남은 이용한도", scenario: ["기본 여행자", "나이 증명 없음", "19+ 조건 미충족", "체류기간 만료", "확인 보류", "자격 회수", "결제한도 소진", "혜택 사용 완료"] },
  en: { title: "What your pass unlocks", start: "Set up K-Tour ID", settings: "Choose a sample pass", sample: "Demo pass", guest: "Guest", notice: "Changing a sample resets identity, age and payment checks. It does not change any real credential.", error: "Couldn't change the sample. Try again.", person: "Place notes", age: "19+ tables", visitor_benefit: "Travel benefit", payment: "Travel payment", allowed: "Available", needs_proof: "Check needed", denied: "Restricted", expired: "Expired", allowance: "Remaining allowance", scenario: ["Standard traveler", "No age proof", "19+ not eligible", "Stay expired", "Pass on hold", "Pass revoked", "Allowance used", "Benefit used"] },
  ja: { title: "このパスでできること", start: "K-Tour IDを作る", settings: "サンプルの資格を選ぶ", sample: "デモ用パス", guest: "ゲスト", notice: "サンプルを変えると本人・年齢・決済の確認をやり直します。実際の資格には影響しません。", error: "変更できませんでした。もう一度お試しください。", person: "場所のメモ", age: "19+テーブル", visitor_benefit: "旅行特典", payment: "旅行の支払い", allowed: "利用可能", needs_proof: "要確認", denied: "利用制限", expired: "期限切れ", allowance: "利用可能額", scenario: ["通常の旅行者", "年齢の証明なし", "19+条件未達", "滞在期限切れ", "パス確認中", "パス失効", "利用上限到達", "特典使用済み"] },
} as const
const SERVICES = [{ id: "person", icon: ShieldCheck }, { id: "age", icon: Wine }, { id: "visitor_benefit", icon: Gift }, { id: "payment", icon: WalletCards }] as const
const COMPACT_COPY = {
  en: { next: "Your next step", ready: "Your K-Tour ID", manage: "Open K-Tour ID" },
  ko: { next: "다음 여행 준비", ready: "나의 K-Tour ID", manage: "K-Tour ID 열기" },
  ja: { next: "次の旅の準備", ready: "自分のK-Tour ID", manage: "K-Tour IDを開く" },
} as const

export function KPassServiceCardB({ paymentReady = false, compact = false }: { paymentReady?: boolean; compact?: boolean }) {
  const { state, actions } = useOndoB()
  const sample = useReviewSampleSession()
  const [picker, setPicker] = useState(false)
  const [error, setError] = useState(false)
  const presence = useSheetPresence(picker ? true : null)
  // A Pass card lives inside the scrolling tab. Mount the modal in the same
  // stationary canvas as the other identity checks, never in that scroll box.
  const pickerHost = typeof document === "undefined" ? null : document.querySelector("[data-testid='ondo-canvas']")
  const copy = COPY[state.locale]
  const compactCopy = COMPACT_COPY[state.locale]
  const credential = state.identityCredential
  function openService(service: KPassService) {
    if (service === "age") actions.setTab("tables")
    else if (service === "person") actions.openLocalSignal(STABLE_B_OFFER_VENUE_ID)
    else actions.openMealBenefitFromPlace(STABLE_B_OFFER_VENUE_ID)
  }
  const services = <div className={styles.services}>{SERVICES.map(({ id, icon: Icon }) => {
        const decision = evaluateKPassService(credential, { service: id, paymentKyc: paymentReady, amountKrw: 22_000 })
        return <button key={id} type="button" className={styles.service} data-testid={`kpass-service-${id}`} data-status={decision.status} onClick={() => openService(id)} aria-label={`${copy[id]} · ${kpassDecisionLabel(decision, state.locale)}`}><Icon size={20} aria-hidden="true" /><span><strong>{copy[id]}</strong>{credential ? <small>{decision.status === "allowed" ? copy.allowed : kpassDecisionLabel(decision, state.locale)}</small> : null}</span>{decision.status === "allowed" ? <Check size={18} aria-hidden="true" /> : <LockKeyhole size={16} aria-hidden="true" />}</button>
      })}</div>
  return <>
    <section className={styles.card} data-testid="kpass-service-card" data-compact={compact} aria-labelledby="kpass-service-title">
      <header><div>{compact ? null : <span>K-Tour ID</span>}<h2 id="kpass-service-title">{compact ? credential ? compactCopy.ready : compactCopy.next : copy.title}</h2></div>{sample ? <button type="button" className={styles.iconButton} onClick={() => setPicker(true)} aria-label={copy.settings} data-testid="kpass-sample-picker"><SlidersHorizontal size={20} aria-hidden="true" /></button> : null}</header>
      {!credential ? <button className={styles.primary} type="button" data-testid="kpass-start-setup" onClick={() => actions.openIdentitySetup("traveler_id")}><ShieldCheck size={20} aria-hidden="true" />{copy.start}<ArrowUpRight size={18} aria-hidden="true" /></button> : <>
        <div className={styles.allowance}><span>{copy.allowance}</span><strong>{new Intl.NumberFormat(state.locale, { style: "currency", currency: "KRW", maximumFractionDigits: 0 }).format(Math.max(0, credential.claims.paymentLimitKrw - credential.claims.paymentSpentKrw))}</strong></div>
        {compact ? <button className={styles.manage} type="button" data-testid="kpass-manage-setup" onClick={() => actions.openIdentitySetup("traveler_id")}><span>{compactCopy.manage}</span><ArrowUpRight size={18} aria-hidden="true" /></button> : null}
      </>}
      {compact ? <details className={styles.disclosure} data-testid="kpass-service-disclosure"><summary data-testid="kpass-service-toggle"><span>{copy.title}</span><ChevronRight size={18} aria-hidden="true" /></summary>{services}</details> : services}
    </section>
    {presence.value && pickerHost ? createPortal(<SheetB locale={state.locale} label={copy.settings} variant="decision" header={<span>{copy.sample}</span>} presenceState={presence.phase} onClose={() => setPicker(false)}><div className={styles.picker} data-testid="kpass-sample-picker-body"><h2>{copy.settings}</h2><p>{copy.notice}</p><div role="group" aria-label={copy.settings}>{["guest" as const, ...KPASS_DEMO_SCENARIOS].map((scenario, index) => <button type="button" key={scenario} data-testid={`kpass-scenario-${scenario}`} aria-pressed={scenario === "guest" ? !credential : Boolean(credential && state.identityDemoScenario === scenario)} onClick={() => { const ok = actions.setIdentityDemoScenario(scenario); setError(!ok); if (ok) setPicker(false) }}><span>{index === 0 ? copy.guest : copy.scenario[index - 1]}</span><ArrowUpRight size={17} aria-hidden="true" /></button>)}</div>{error ? <p role="alert">{copy.error}</p> : null}</div></SheetB>, pickerHost) : null}
  </>
}
