"use client"

import { ArrowRight, Check, ChevronDown, Clock3, Download, FileCheck2, FlaskConical, Landmark, Layers3, RotateCcw, ShieldCheck, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useOndoB } from "../shared/state/ondo-b-provider"
import { SheetB } from "../shared/ui/sheet-b"
import { useReviewSampleSession } from "../shared/ui/use-qa-controls"
import { evaluateKPassService } from "../contracts/kpass-capabilities"
import { B_TABLE_ACTIVITY_CLEAR_EVENT } from "../connect/table-activity-b"
import {
  createIntegrationDemoEngineB, integrationEvidencePayloadB, integrationLedgerSnapshotB, integrationSettlementExportB,
  type IntegrationBusinessSnapshotB, type IntegrationDemoSection, type IntegrationSampleOutcome,
  type MinimalPartnerReceiptB, type PartnerSampleCase, type PartnerSamplePurpose, type SettlementSupportReasonB, type SettlementSupportOutcomeB,
} from "./integration-demo-model-b"
import styles from "./integration-demo-b.module.css"
import { PartnerDeviceSetupB, PartnerRequestHandoffB } from "./partner-handoff-b"

const COPY = {
  en: {
    title: "Partner tools", sample: "Sample responses · no external actions", verify: "Check", settlements: "Settlement", events: "Events",
    partner: "K-Tour ID sample café", ask: "Request only what you need", person: "Identity", age: "19+", visitor_benefit: "Visitor benefit",
    create: "Create request", open: "Review request", holder: "Your choice", shares: "Only this result is shared", allow: "Share result", deny: "Not now", again: "New request", receipt: "Sample receipt",
    allowed: "Eligible at this check", needs_proof: "More information needed", denied: "Not eligible", expired: "Expired", notShared: "Not shared", requestBlocked: "Request not accepted", stale: "Check again", staleNote: "This past result is no longer current. Create a new request.", checked: "Checked", historical: "Result at the time of this sample check.",
    alternate: "Try another case", normal: "Normal request", wrong_audience: "Wrong partner", replay: "Already used request", revoked: "Revoked at verifier", requestExpired: "Expired request", caseNote: "Changes this check only, not your pass.",
    proof: "Update the required information in K-Tour ID.", rejected: "This check does not meet the service conditions.", stopped: "Nothing was shared.", bound: "This request cannot be used here.", refresh: "Create a new request to continue.", ready: "Only the requested service result was returned.",
    settlementEmpty: "No sample payment yet", settlementHint: "Complete a sample checkout in ID · Wallet first.", payment: "Payment", refund: "Refund", merchant: "Merchant net", reconcile: "Reconcile", checkAgain: "Check again", success: "Success", pending: "Pending", failure: "Failure", mismatch: "Mismatch", openStatus: "Ready to reconcile", settled: "Sample reconciled", mismatched: "Needs reconciliation", failed: "Try again", retry: "Retry", payoutNote: "This is a sample reconciliation, not a bank payout.",
    eventsEmpty: "Your actions appear here", eventsHint: "Issue a pass, link a wallet or complete a sample payment.", queued: "Queued", recorded: "Sample recorded", submit: "Record sample", eventNote: "Queue reconstructed from this session. No chain transaction is sent.", issue: "Issue sample benefit", issueNote: "A separate sample campaign issue. Your wallet balance stays the same.", unavailableIssue: "Visitor benefit is not currently available.", eventDetails: "Record details", attempt: "Attempt", current: "Current session", incomplete: "Sample approval and capture are separate. No real payment or chain transaction is sent.",
  },
  ko: {
    title: "파트너 도구", sample: "샘플 응답 · 외부 실행 없음", verify: "자격 확인", settlements: "정산", events: "기록",
    partner: "K-Tour ID 샘플 카페", ask: "필요한 자격만 요청해요", person: "신원", age: "19+", visitor_benefit: "방문자 혜택",
    create: "확인 요청 만들기", open: "요청 확인", holder: "공유할까요?", shares: "이 결과만 공유돼요", allow: "결과 공유", deny: "지금은 안 할게요", again: "새 요청", receipt: "샘플 영수증",
    allowed: "확인 당시 조건 충족", needs_proof: "추가 확인 필요", denied: "이용 조건 미충족", expired: "만료됨", notShared: "공유하지 않았어요", requestBlocked: "요청을 사용할 수 없어요", stale: "다시 확인해 주세요", staleNote: "이전 결과는 현재 유효하지 않아요. 새 요청으로 확인해 주세요.", checked: "확인 시각", historical: "샘플 확인 당시의 결과예요.",
    alternate: "다른 상황 체험", normal: "정상 요청", wrong_audience: "다른 파트너의 요청", replay: "이미 사용한 요청", revoked: "철회된 자격", requestExpired: "만료된 요청", caseNote: "이번 확인만 바뀌며 내 패스는 그대로예요.",
    proof: "K-Tour ID에서 필요한 정보를 확인해 주세요.", rejected: "이 서비스의 이용 조건을 충족하지 않아요.", stopped: "공유하지 않았어요.", bound: "이 요청은 여기에서 사용할 수 없어요.", refresh: "새 요청으로 다시 확인해 주세요.", ready: "요청한 서비스의 결과만 전달했어요.",
    settlementEmpty: "아직 샘플 결제가 없어요", settlementHint: "ID · Wallet에서 샘플 결제를 먼저 완료해 주세요.", payment: "결제", refund: "환불", merchant: "파트너 정산액", reconcile: "대사하기", checkAgain: "다시 조회", success: "정상", pending: "처리 중", failure: "실패", mismatch: "불일치", openStatus: "대사 대기", settled: "샘플 정산 확인", mismatched: "재대사 필요", failed: "재시도 필요", retry: "재시도", payoutNote: "샘플 대사 결과예요. 실제 은행 지급은 아니에요.",
    eventsEmpty: "내 행동이 기록으로 이어져요", eventsHint: "패스를 발급하거나 지갑 연결·샘플 결제를 해보세요.", queued: "대기", recorded: "샘플 기록됨", submit: "샘플 기록", eventNote: "이번 세션에서 복원한 대기열이에요. 체인 전송은 없어요.", issue: "샘플 혜택권 발급", issueNote: "별도 캠페인 발급 예시예요. 지갑 잔액은 변하지 않아요.", unavailableIssue: "현재 방문자 혜택을 이용할 수 없어요.", eventDetails: "기록 상세", attempt: "시도", current: "현재 세션", incomplete: "샘플 승인과 매입은 별도 단계예요. 실제 결제나 체인 전송은 없어요.",
  },
  ja: {
    title: "パートナーツール", sample: "サンプル応答・外部実行なし", verify: "資格確認", settlements: "精算", events: "記録",
    partner: "K-Tour ID サンプルカフェ", ask: "必要な資格だけを確認", person: "本人", age: "19+", visitor_benefit: "旅行者特典",
    create: "確認リクエスト", open: "内容を確認", holder: "共有しますか？", shares: "この結果だけを共有します", allow: "結果を共有", deny: "今はしない", again: "新しいリクエスト", receipt: "サンプル控え",
    allowed: "確認時の条件を満たしました", needs_proof: "追加確認が必要", denied: "条件を満たしません", expired: "期限切れ", notShared: "共有していません", requestBlocked: "リクエストを使用できません", stale: "再確認してください", staleNote: "過去の結果は現在無効です。新しいリクエストで確認してください。", checked: "確認日時", historical: "サンプル確認時点の結果です。",
    alternate: "別のケースを試す", normal: "通常のリクエスト", wrong_audience: "別のパートナー", replay: "使用済みリクエスト", revoked: "資格が取り消された", requestExpired: "期限切れリクエスト", caseNote: "今回の確認だけが変わります。パスは変わりません。",
    proof: "K-Tour IDで必要な情報を確認してください。", rejected: "このサービスの条件を満たしていません。", stopped: "何も共有していません。", bound: "このリクエストはここでは使えません。", refresh: "新しいリクエストで確認してください。", ready: "必要なサービスの結果だけを返しました。",
    settlementEmpty: "サンプル決済はまだありません", settlementHint: "ID · Walletでサンプル決済を完了してください。", payment: "決済", refund: "返金", merchant: "店舗精算額", reconcile: "照合する", checkAgain: "再確認", success: "正常", pending: "処理中", failure: "失敗", mismatch: "不一致", openStatus: "照合待ち", settled: "サンプル照合済み", mismatched: "再照合が必要", failed: "再試行が必要", retry: "再試行", payoutNote: "サンプル照合です。銀行への送金ではありません。",
    eventsEmpty: "操作が記録につながります", eventsHint: "パス発行・ウォレット接続・サンプル決済を試してください。", queued: "待機", recorded: "サンプル記録済み", submit: "サンプルを記録", eventNote: "このセッションから復元したキューです。チェーン送信はありません。", issue: "サンプル特典を発行", issueNote: "別のキャンペーン発行例です。残高は変わりません。", unavailableIssue: "旅行者特典は現在利用できません。", eventDetails: "記録の詳細", attempt: "試行", current: "現在のセッション", incomplete: "サンプル承認と決済確定は別の段階です。実際の決済やチェーン送信はありません。",
  },
} as const

const HOLDER_REQUEST_CONTEXT_COPY = {
  en: {
    requester: "Requested by", purpose: "Purpose", answer: "What is shared", retention: "How long it stays", expires: "Request expires",
    purposes: { person: "Identity check", age: "19+ eligibility", visitor_benefit: "Visitor benefit eligibility" },
    minimalAnswer: "Only the requested eligibility answer (yes/no or cannot confirm) is shared. Your original ID or document is not shared.",
    retentionNote: "This check stays in this page session; nothing is sent externally. Reloading or resetting the sample clears it. Closing this panel does not clear it.",
  },
  ko: {
    requester: "요청한 곳", purpose: "확인 목적", answer: "공유하는 정보", retention: "보관 기간", expires: "요청 만료 시각",
    purposes: { person: "신원 확인", age: "19+ 이용 자격", visitor_benefit: "방문자 혜택 이용 자격" },
    minimalAnswer: "요청한 자격의 충족 여부(예/아니요) 또는 확인 불가만 알려요. 원본 신분증이나 문서는 공유하지 않아요.",
    retentionNote: "이 확인 기록은 현재 페이지에서만 보관하며 외부 전송은 없어요. 새로고침하거나 샘플을 초기화하면 삭제돼요. 창을 닫아도 기록은 남아요.",
  },
  ja: {
    requester: "リクエスト元", purpose: "確認の目的", answer: "共有する情報", retention: "保持期間", expires: "リクエストの有効期限",
    purposes: { person: "本人確認", age: "19+の利用資格", visitor_benefit: "旅行者特典の利用資格" },
    minimalAnswer: "求められた資格の回答（はい／いいえ）、または確認できない旨だけを伝えます。元の身分証や書類は共有しません。",
    retentionNote: "この確認記録はこのページ内のみで保持し、外部には送信しません。再読み込みやサンプルのリセットで消去されます。画面を閉じても記録は残ります。",
  },
} as const

const SUPPORT_COPY = {
  en: { title: "Settlement support", reason: "What needs checking?", mismatch: "Amounts do not match", payment: "Payment question", refund: "Refund question", start: "Review request", review: "Review these amounts", pending: "Sending sample request", unknown: "Check this request first", failed: "Request not sent", stale: "Amounts changed. Review again.", submitted: "Sample ticket created", consent: "Send sample request", cancel: "Cancel request", check: "Check request", retry: "Retry same request", frozen: "These amounts are fixed for this request. Only this summary is included; no visitor details.", boundary: "Sample support only. Nothing is sent to a partner or changes your balance.", sample: "Sample response", success: "Success", failure: "Failure", unknownCase: "Result unknown", download: "Export sample summary", exportFailed: "Could not create the file. Try again.", ticket: "Sample ticket" },
  ko: { title: "정산 문의", reason: "무엇을 확인할까요?", mismatch: "금액 불일치", payment: "결제 문의", refund: "환불 문의", start: "문의 내용 확인", review: "이 금액으로 문의해요", pending: "샘플 문의 처리 중", unknown: "이 문의부터 확인해 주세요", failed: "문의를 보내지 못했어요", stale: "금액이 바뀌었어요. 다시 확인해 주세요.", submitted: "샘플 문의 번호를 만들었어요", consent: "샘플 문의 보내기", cancel: "문의 취소", check: "같은 문의 조회", retry: "같은 문의 재시도", frozen: "이번 문의에 포함되는 금액이에요. 방문자 정보 없이 이 요약만 포함해요.", boundary: "샘플 문의예요. 파트너에게 전송되거나 잔액이 바뀌지 않아요.", sample: "샘플 응답", success: "성공", failure: "실패", unknownCase: "결과 불명", download: "샘플 요약 내보내기", exportFailed: "파일을 만들지 못했어요. 다시 시도해 주세요.", ticket: "샘플 문의 번호" },
  ja: { title: "精算の問い合わせ", reason: "何を確認しますか？", mismatch: "金額が合わない", payment: "決済について", refund: "返金について", start: "内容を確認", review: "この金額で問い合わせ", pending: "サンプル申請を処理中", unknown: "まずこの申請を確認", failed: "送信できませんでした", stale: "金額が変わりました。再確認してください。", submitted: "サンプル受付番号を作成", consent: "サンプル申請を送信", cancel: "申請をキャンセル", check: "同じ申請を確認", retry: "同じ申請を再試行", frozen: "この申請の金額は固定です。旅行者情報を含めず、この要約だけを使用します。", boundary: "サンプルのみです。店舗への送信や残高の変更はありません。", sample: "サンプル応答", success: "成功", failure: "失敗", unknownCase: "結果不明", download: "サンプル要約を保存", exportFailed: "ファイルを作成できませんでした。再試行してください。", ticket: "サンプル受付番号" },
} as const

const SUPPORT_HISTORY_COPY = {
  en: { newRequest: "Start a new request", history: "Submitted requests", historyNote: "Saved for this sample session. Each request keeps its original amounts, not your current balance.", submittedOn: "Submitted" },
  ko: { newRequest: "새 문의 시작", history: "보낸 문의 내역", historyNote: "이번 샘플 세션에 보관돼요. 현재 잔액이 아닌, 문의 당시 금액을 유지해요.", submittedOn: "접수 일시" },
  ja: { newRequest: "新しい問い合わせ", history: "送信済みの問い合わせ", historyNote: "このサンプルセッション内で保存します。現在の残高ではなく、申請時の金額を保持します。", submittedOn: "受付日時" },
} as const

type Props = { onClose(): void; open?: boolean; initialSection?: IntegrationDemoSection }

export function IntegrationDemoB(props: Props) {
  const sampleMode = useReviewSampleSession()
  return sampleMode ? <EnabledIntegrationDemoB {...props} /> : null
}

function EnabledIntegrationDemoB({ onClose, open = true, initialSection = "verify" }: Props) {
  const { state } = useOndoB()
  const copy = COPY[state.locale]
  const holderContextCopy = HOLDER_REQUEST_CONTEXT_COPY[state.locale]
  const supportCopy = SUPPORT_COPY[state.locale]
  const supportHistoryCopy = SUPPORT_HISTORY_COPY[state.locale]
  const [section, setSection] = useState<IntegrationDemoSection>(initialSection)
  const [purpose, setPurpose] = useState<PartnerSamplePurpose>("age")
  const [sampleCase, setSampleCase] = useState<PartnerSampleCase>("normal")
  const [outcome, setOutcome] = useState<IntegrationSampleOutcome>("success")
  const [issueResult, setIssueResult] = useState<string | null>(null)
  const [receiptClock, setReceiptClock] = useState(0)
  const [supportReason, setSupportReason] = useState<SettlementSupportReasonB>("mismatch")
  const [supportOutcome, setSupportOutcome] = useState<SettlementSupportOutcomeB>("success")
  const [exportError, setExportError] = useState(false)
  const [counterReady, setCounterReady] = useState(false)
  const holderConsentHeading = useRef<HTMLHeadingElement>(null)
  const supportReasonInput = useRef<HTMLSelectElement>(null)
  const focusNewSupport = useRef(false)
  const engineRef = useRef<ReturnType<typeof createIntegrationDemoEngineB> | null>(null)
  engineRef.current ??= createIntegrationDemoEngineB(true)
  const engine = engineRef.current
  const [view, setView] = useState(engine.read)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const exportUrls = useRef(new Set<string>())
  const snapshot: IntegrationBusinessSnapshotB = { credential: state.identityCredential, walletReady: state.commerceWalletStatus === "ready", commerce: state.commerceSession }
  const snapshotRef = useRef(snapshot)
  snapshotRef.current = snapshot
  const ledger = integrationLedgerSnapshotB(state.commerceSession)
  const benefit = evaluateKPassService(state.identityCredential, { service: "visitor_benefit" })
  const update = () => setView(engine.read())
  useEffect(() => {
    if (open && !view.support && focusNewSupport.current) {
      focusNewSupport.current = false
      supportReasonInput.current?.focus()
    }
  }, [open, view.support])
  useEffect(() => {
    engine.sync(snapshotRef.current)
    setView(engine.read())
  }, [engine, state.identityCredential, state.commerceWalletStatus, state.commerceSession])
  useEffect(() => () => { for (const timer of timers.current) clearTimeout(timer); for (const url of exportUrls.current) URL.revokeObjectURL(url) }, [])
  useEffect(() => {
    const clear = () => {
      for (const timer of timers.current) clearTimeout(timer)
      timers.current.clear()
      for (const url of exportUrls.current) URL.revokeObjectURL(url)
      exportUrls.current.clear()
      engine.reset(); setIssueResult(null); setExportError(false); setView(engine.read())
    }
    window.addEventListener(B_TABLE_ACTIVITY_CLEAR_EVENT, clear)
    return () => window.removeEventListener(B_TABLE_ACTIVITY_CLEAR_EVENT, clear)
  }, [engine])
  useEffect(() => {
    if (!open || !view.partner?.receipt) return
    const refresh = () => setReceiptClock(value => value + 1)
    const now = Date.now()
    const credential = state.identityCredential
    const deadlines = [view.partner.expiresAt, credential?.expiresAt, credential?.claims.stayPeriod?.validFrom, credential?.claims.stayPeriod?.validUntil, credential?.claims.visitorBenefit.expiresAt]
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > now)
    // One clock-boundary update, not a render loop or polling the provider.
    const timer = deadlines.length ? setTimeout(refresh, Math.min(2_147_483_647, Math.max(1, Math.min(...deadlines) - now + 16))) : null
    document.addEventListener("visibilitychange", refresh)
    return () => { if (timer !== null) clearTimeout(timer); document.removeEventListener("visibilitychange", refresh) }
  }, [open, view.partner, state.identityCredential, receiptClock])
  function delayed(callback: () => void) {
    const timer = setTimeout(() => { timers.current.delete(timer); callback(); update() }, 500)
    timers.current.add(timer)
  }
  function reconcile(retry = false) {
    engine.beginSettlement(snapshotRef.current)
    update()
    delayed(() => engine.finishSettlement(snapshotRef.current, retry ? "success" : outcome))
  }
  function record(eventRef: string, retry = false) {
    engine.submitEvent(eventRef)
    update()
    delayed(() => engine.finishEvent(eventRef, retry ? "success" : outcome === "mismatch" ? "failure" : outcome))
  }
  function sendSupport() {
    const request = engine.read().support
    if (!request || engine.submitSupport(snapshotRef.current, request.operationRef)?.phase !== "pending") { update(); return }
    update()
    const preparedOutcome = supportOutcome
    delayed(() => engine.finishSupport(request.operationRef, preparedOutcome))
  }
  function downloadSummary() {
    const summary = integrationSettlementExportB(snapshotRef.current)
    if (!summary) { setExportError(true); return }
    try {
      const url = URL.createObjectURL(new Blob([JSON.stringify(summary, null, 2)], { type: "application/json" }))
      exportUrls.current.add(url)
      const link = document.createElement("a")
      link.href = url; link.download = "ondo-sample-settlement.json"
      link.click()
      const timer = setTimeout(() => { timers.current.delete(timer); URL.revokeObjectURL(url); exportUrls.current.delete(url) }, 1_000)
      timers.current.add(timer)
      setExportError(false)
    } catch { setExportError(true) }
  }
  function receiptNote(receipt: MinimalPartnerReceiptB) {
    if (receipt.reason === "consent_denied") return copy.stopped
    if (["wrong_audience", "context_changed"].includes(receipt.reason)) return copy.bound
    if (["request_replayed", "request_expired"].includes(receipt.reason) || receipt.decision === "expired") return copy.refresh
    return receipt.decision === "allowed" ? copy.ready : receipt.decision === "needs_proof" ? copy.proof : copy.rejected
  }
  function receiptTitle(receipt: MinimalPartnerReceiptB) {
    if (receipt.reason === "consent_denied") return copy.notShared
    if (["wrong_audience", "context_changed", "request_replayed"].includes(receipt.reason)) return copy.requestBlocked
    return copy[receipt.decision]
  }
  const money = (amount: number) => `₩${amount.toLocaleString(state.locale === "ko" ? "ko-KR" : state.locale === "ja" ? "ja-JP" : "en-US")}`
  const sections = ["verify", "settlements", "events"] as const
  const icons = { verify: ShieldCheck, settlements: Landmark, events: Layers3 }
  const partner = view.partner
  const support = view.support
  const receiptStale = engine.partnerReceiptState(state.identityCredential)?.status === "stale"
  const checkedTime = (value: number) => new Intl.DateTimeFormat(state.locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" }).format(value)
  const requestExpiryTime = (value: number) => new Intl.DateTimeFormat(state.locale, { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" }).format(value)

  useEffect(() => {
    if (!open || partner?.phase !== "consent") return
    const frame = window.requestAnimationFrame(() => holderConsentHeading.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [open, partner?.phase, partner?.requestRef])

  if (!open) return null

  return <SheetB locale={state.locale} onClose={onClose} label={copy.title} variant="detail" header={<span className={styles.heading}><FlaskConical size={18} aria-hidden="true" />{copy.title}</span>}>
    <div className={styles.root} data-testid="integration-demo" data-provenance="SIMULATED" data-section={section}>
      <p className={styles.boundary}>{copy.sample}</p>
      <div className={styles.tabs} role="tablist" aria-label={copy.title}>
        {sections.map((item, index) => { const Icon = icons[item]; return <button key={item} id={`integration-tab-${item}`} role="tab" aria-selected={section === item} aria-controls={`integration-panel-${item}`} tabIndex={section === item ? 0 : -1} data-testid={`integration-tab-${item}`} onClick={() => { setSection(item); setOutcome("success") }} onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
          event.preventDefault()
          const next = event.key === "Home" ? 0 : event.key === "End" ? 2 : (index + (event.key === "ArrowRight" ? 1 : 2)) % 3
          setSection(sections[next]); setOutcome("success")
          document.getElementById(`integration-tab-${sections[next]}`)?.focus()
        }}><Icon size={17} aria-hidden="true" /><span>{copy[item]}</span></button> })}
      </div>
      <section id={`integration-panel-${section}`} role="tabpanel" aria-labelledby={`integration-tab-${section}`} className={styles.panel}>
        {section === "verify" ? !counterReady ? <PartnerDeviceSetupB locale={state.locale} onReady={() => setCounterReady(true)} /> : <>
          {!partner || partner.phase === "result" ? <div className={styles.choices} role="group" aria-label={copy.ask}>{(["person", "age", "visitor_benefit"] as const).map(item => <button key={item} aria-pressed={purpose === item} onClick={() => setPurpose(item)}>{copy[item]}</button>)}</div> : null}
          {partner?.phase === "result" && partner.receipt ? <div className={styles.result} role="status" data-testid="integration-verifier-result" data-status={receiptStale ? "stale" : partner.receipt.decision} data-receipt-decision={partner.receipt.decision} data-receipt-current={!receiptStale}>
            <span className={styles.resultIcon}>{receiptStale ? <RotateCcw size={26} /> : partner.receipt.decision === "allowed" ? <Check size={26} /> : partner.receipt.decision === "expired" ? <Clock3 size={26} /> : <X size={26} />}</span>
            <h2>{receiptStale ? copy.stale : receiptTitle(partner.receipt)}</h2><p>{receiptStale ? copy.staleNote : receiptNote(partner.receipt)}</p>
            <time className={styles.checkedTime} data-testid="integration-receipt-checked-at" dateTime={new Date(partner.receipt.checkedAt).toISOString()}>{copy.checked} · {checkedTime(partner.receipt.checkedAt)}</time>
            <details className={styles.details}><summary>{copy.receipt}<ChevronDown size={16} /></summary><p>{copy.historical}</p><code>{partner.receipt.receiptRef}</code><small>{copy[partner.receipt.purpose]} · {receiptTitle(partner.receipt)}</small></details>
          </div> : partner?.phase === "consent" ? <div className={styles.holderRequest} data-testid="integration-holder-request" data-phase={partner.phase}>
            <h2 ref={holderConsentHeading} tabIndex={-1}>{copy.holder}</h2>
            <dl lang={state.locale} className={styles.holderRequestContext} data-testid="partner-holder-request-context">
              <div><dt>{holderContextCopy.requester}</dt><dd>{copy.partner}</dd></div>
              <div><dt>{holderContextCopy.purpose}</dt><dd>{holderContextCopy.purposes[partner.purpose]}</dd></div>
              <div><dt>{holderContextCopy.answer}</dt><dd>{holderContextCopy.minimalAnswer}</dd></div>
              <div><dt>{holderContextCopy.retention}</dt><dd>{holderContextCopy.retentionNote}</dd></div>
              <div><dt>{holderContextCopy.expires}</dt><dd><time dateTime={new Date(partner.expiresAt).toISOString()}>{requestExpiryTime(partner.expiresAt)}</time></dd></div>
            </dl>
          </div> : partner ? <div className={styles.card} data-testid="integration-holder-request" data-phase={partner.phase}>
            <small>{copy.partner}</small>
            <h2>{copy[partner.purpose]}</h2><p>{copy.ask}</p>
            <div className={styles.predicate}><ShieldCheck size={21} aria-hidden="true" /><strong>{copy[partner.purpose]}</strong><span>?</span></div>
          </div> : <div className={styles.intro}><ShieldCheck size={30} aria-hidden="true" /><h2>{copy.partner}</h2><p>{copy.ask}</p></div>}
          {partner?.phase === "request" ? <PartnerRequestHandoffB key={partner.requestRef} request={partner} locale={state.locale} onOpen={() => { engine.openConsent(); update() }} onCancel={() => { engine.openConsent(); engine.resolveHolder(snapshotRef.current.credential, "deny"); update() }} />
            : partner?.phase === "consent" ? <div className={styles.stack}><button className={styles.primary} data-testid="integration-holder-approve" onClick={() => { engine.resolveHolder(snapshotRef.current.credential, "approve"); update() }}>{copy.allow}</button><button className={styles.secondary} data-testid="integration-holder-deny" onClick={() => { engine.resolveHolder(snapshotRef.current.credential, "deny"); update() }}>{copy.deny}</button></div>
              : <button className={styles.primary} data-testid="integration-verifier-create" onClick={() => { engine.startRequest(snapshotRef.current.credential, purpose, sampleCase); update() }}>{partner ? copy.again : copy.create}<ArrowRight size={17} /></button>}
          {!partner || partner.phase === "result" ? <details className={styles.details}><summary>{copy.alternate}<ChevronDown size={16} /></summary><select aria-label={copy.alternate} data-testid="integration-verifier-case" value={sampleCase} onChange={event => setSampleCase(event.target.value as PartnerSampleCase)}>{(["normal", "wrong_audience", "replay", "expired", "revoked"] as const).map(item => <option key={item} value={item}>{item === "expired" ? copy.requestExpired : copy[item]}</option>)}</select><p>{copy.caseNote}</p></details> : null}
        </> : section === "settlements" ? <>
          {ledger ? <>
            <div className={styles.amountCard}><small>{copy.merchant}</small><strong>{money(ledger.merchantNetKrw)}</strong><dl><div><dt>{copy.payment}</dt><dd>{money(ledger.paymentKrw)}</dd></div><div><dt>{copy.refund}</dt><dd>{money(ledger.refundKrw)}</dd></div></dl></div>
            <div className={styles.status} role="status" data-testid="integration-settlement-state" data-status={view.settlement?.phase ?? "open"}><Landmark size={20} /><strong>{view.settlement ? view.settlement.phase === "open" ? copy.openStatus : copy[view.settlement.phase] : copy.openStatus}</strong></div>
            <p className={styles.note}>{copy.payoutNote}</p>
            {view.settlement?.phase === "pending" ? <button className={styles.primary} data-testid="integration-settlement-check" onClick={() => { engine.finishSettlement(snapshotRef.current, "success"); update() }}>{copy.checkAgain}</button> : view.settlement?.phase !== "settled" ? <button className={styles.primary} data-testid="integration-settlement-start" onClick={() => reconcile(view.settlement?.phase === "failed" || view.settlement?.phase === "mismatched")}>{view.settlement?.phase === "failed" || view.settlement?.phase === "mismatched" ? copy.retry : copy.reconcile}</button> : null}
          </> : <div className={styles.intro}><Landmark size={30} /><h2>{copy.settlementEmpty}</h2><p>{copy.settlementHint}</p></div>}
          <details className={styles.details}><summary>{copy.alternate}<ChevronDown size={16} /></summary><select aria-label={copy.alternate} data-testid="integration-settlement-case" value={outcome} onChange={event => setOutcome(event.target.value as IntegrationSampleOutcome)}>{(["success", "pending", "failure", "mismatch"] as const).map(item => <option key={item} value={item}>{copy[item]}</option>)}</select></details>
          {ledger?.balanced ? <>
            <details className={styles.details} data-testid="integration-support-panel"><summary>{supportCopy.title}<ChevronDown size={16} /></summary>
              <div className={styles.supportBody}>
                <p className={styles.note}>{supportCopy.boundary}</p>
                {!support || support.phase === "stale" ? <>
                  {support ? <p role="status">{supportCopy.stale}</p> : null}
                  <label className={styles.supportLabel}>{supportCopy.reason}<select ref={supportReasonInput} data-testid="integration-support-reason" value={supportReason} onChange={event => setSupportReason(event.target.value as SettlementSupportReasonB)}>{(["mismatch", "payment", "refund"] as const).map(reason => <option key={reason} value={reason}>{supportCopy[reason]}</option>)}</select></label>
                  <button className={styles.secondary} data-testid="integration-support-start" onClick={() => { engine.startSupport(snapshotRef.current, supportReason); update() }}>{supportCopy.start}</button>
                </> : <div className={styles.supportRequest} data-testid="integration-support-request" data-phase={support.phase} data-operation-ref={support.operationRef} data-reason={support.reason}>
                  <strong role="status">{supportCopy[support.phase]}</strong><small>{supportCopy[support.reason]}</small>
                  <dl className={styles.supportAmounts}><div><dt>{copy.payment}</dt><dd>{money(support.summary.paymentKrw)}</dd></div><div><dt>{copy.refund}</dt><dd>{money(support.summary.refundKrw)}</dd></div><div><dt>{copy.merchant}</dt><dd>{money(support.summary.merchantNetKrw)}</dd></div></dl>
                  <p className={styles.note}>{supportCopy.frozen}</p>
                  {support.phase === "review" || support.phase === "failed" ? <><button className={styles.primary} data-testid="integration-support-submit" onClick={sendSupport}>{support.phase === "failed" ? supportCopy.retry : supportCopy.consent}</button><button className={styles.secondary} data-testid="integration-support-cancel" onClick={() => { engine.cancelSupport(support.operationRef); update() }}>{supportCopy.cancel}</button></>
                    : support.phase === "pending" || support.phase === "unknown" ? <button className={styles.primary} data-testid="integration-support-check" onClick={() => { engine.finishSupport(support.operationRef, "success"); update() }}>{supportCopy.check}</button>
                      : support.ticket ? <div><small>{supportCopy.ticket}</small><code data-testid="integration-support-ticket">{support.ticket.ticketRef}</code></div> : null}
                </div>}
                {support?.phase === "submitted" ? <button className={styles.secondary} data-testid="integration-support-new" onClick={() => { if (engine.newSupport(support.operationRef)) focusNewSupport.current = true; update() }}>{supportHistoryCopy.newRequest}<ArrowRight size={17} aria-hidden="true" /></button> : null}
                {view.supportHistory.length ? <details className={styles.details} data-testid="integration-support-history">
                  <summary>{supportHistoryCopy.history} · {view.supportHistory.length}<ChevronDown size={16} aria-hidden="true" /></summary>
                  <p className={styles.note}>{supportHistoryCopy.historyNote}</p>
                  <ol className={styles.supportHistory}>{view.supportHistory.map(entry => <li key={entry.operationRef} className={styles.supportRequest} data-testid="integration-support-history-item" data-operation-ref={entry.operationRef} data-reason={entry.reason}>
                    <strong>{supportCopy[entry.reason]}</strong>
                    <div><small>{supportCopy.ticket}</small><code data-testid="integration-support-history-ticket">{entry.ticket.ticketRef}</code></div>
                    <small>{supportHistoryCopy.submittedOn} · <time dateTime={new Date(entry.ticket.createdAt).toISOString()}>{checkedTime(entry.ticket.createdAt)}</time></small>
                    <dl className={styles.supportAmounts}><div><dt>{copy.payment}</dt><dd>{money(entry.summary.paymentKrw)}</dd></div><div><dt>{copy.refund}</dt><dd>{money(entry.summary.refundKrw)}</dd></div><div><dt>{copy.merchant}</dt><dd>{money(entry.summary.merchantNetKrw)}</dd></div></dl>
                  </li>)}</ol>
                </details> : null}
                <details className={styles.details}><summary>{supportCopy.sample}<ChevronDown size={16} /></summary><select aria-label={supportCopy.sample} data-testid="integration-support-case" value={supportOutcome} onChange={event => setSupportOutcome(event.target.value as SettlementSupportOutcomeB)}>{(["success", "failure", "unknown"] as const).map(item => <option key={item} value={item}>{item === "unknown" ? supportCopy.unknownCase : supportCopy[item]}</option>)}</select></details>
              </div>
            </details>
            <button className={styles.secondary} data-testid="integration-settlement-export" onClick={downloadSummary}><Download size={17} aria-hidden="true" />{supportCopy.download}</button>
            {exportError ? <p className={styles.note} role="alert">{supportCopy.exportFailed}</p> : null}
          </> : null}
        </> : <>
          <div className={styles.eventHeading}><strong>{copy.current}</strong><span>{view.events.length}</span></div>
          {!view.events.length ? <div className={styles.intro}><Layers3 size={30} /><h2>{copy.eventsEmpty}</h2><p>{copy.eventsHint}</p></div> : <ol className={styles.eventList}>{view.events.map(event => <li key={event.eventRef} data-testid="integration-event" data-event-type={event.eventType} data-event-state={event.phase}>
            <span className={styles.eventIcon}>{event.phase === "recorded" ? <Check size={20} /> : event.phase === "failed" ? <RotateCcw size={20} /> : <FileCheck2 size={20} />}</span>
            <div><strong>{event.eventType}</strong><small>{copy[event.phase]}</small></div>
            {event.phase !== "recorded" ? <button className={styles.iconButton} data-testid={`integration-event-${event.eventType}`} aria-label={`${event.phase === "failed" ? copy.retry : event.phase === "pending" ? copy.checkAgain : copy.submit} · ${event.eventType}`} onClick={() => event.phase === "pending" ? (engine.finishEvent(event.eventRef, "success"), update()) : record(event.eventRef, event.phase === "failed")}><ArrowRight size={18} /></button> : null}
            <details className={styles.eventDetails}><summary>{copy.eventDetails}<ChevronDown size={14} /></summary><small>{copy.attempt} {event.attempts}</small><code>{JSON.stringify(integrationEvidencePayloadB(event), null, 2)}</code>{event.receipt ? <code>{event.receipt.receiptRef}</code> : null}</details>
          </li>)}</ol>}
          <p className={styles.note}>{copy.eventNote}</p>
          <details className={styles.details}><summary>{copy.alternate}<ChevronDown size={16} /></summary><select aria-label={copy.alternate} data-testid="integration-event-case" value={outcome === "mismatch" ? "failure" : outcome} onChange={event => setOutcome(event.target.value as IntegrationSampleOutcome)}>{(["success", "pending", "failure"] as const).map(item => <option key={item} value={item}>{copy[item]}</option>)}</select><p>{copy.incomplete}</p></details>
          <div className={styles.issue}><button className={styles.secondary} data-testid="integration-voucher-issue" disabled={benefit.status !== "allowed"} onClick={() => { const result = engine.issueVoucher(snapshotRef.current.credential); setIssueResult(result?.status ?? null); update() }}>{copy.issue}</button><p>{benefit.status !== "allowed" || (issueResult && issueResult !== "allowed") ? copy.unavailableIssue : copy.issueNote}</p></div>
        </>}
      </section>
    </div>
  </SheetB>
}
