"use client"

// Demo entitlement journey (overlay). Server phase drives the UI; the client
// only signs (holder key / Sui signer) and asks the server to verify.
// Consumer copy uses actions ("신원 확인", "혜택 확인", "확인하고 사용하기");
// technology names live in the evidence section.
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Ticket, X } from "lucide-react"
import type { OperationResult } from "@/lib/hackathon/types"
import { requestPlaceServiceReturnB } from "../commerce-b/place-service-registry-b"
import { useOndoB } from "../shared/state/ondo-b-provider"
import { ONDO_MODAL_PRIORITY } from "../shared/ui/modal-layer-priority"
import { useDocumentScrollLock, useModalIsolation } from "../shared/ui/use-modal-isolation"
import { HACKATHON_ENABLED, HACKATHON_DEMO_ENTRY, HACKATHON_OPEN_EVENT_B, manualHackathonDetail, openHackathonVenueB, readPendingHackathon, writePendingHackathon, type HackathonOpenDetail } from "./hackathon-campaign"
import { ApiError, api, beginZkLogin, canonicalJson, clearJourneySecrets, createDemoSigner, ensureHolderKey, finishZkLogin, holderSign, readSigner, sha256Hex, signPersonalMessage, signTransactionBytes, fromBase64, type EntitlementInfo, type PublicConfig, type StoredSigner } from "./hackathon-client"
import styles from "./hackathon-b.module.css"
import { journeyStepIndex } from "./hackathon-navigation"

type Locale = "ko" | "en" | "ja"
const T = {
  ko: {
    title: "체험 혜택", sub: "신원 확인 → 패스 → 혜택 확인 → 사용", close: "닫기", back: "같은 장소로 돌아가기",
    steps: ["동의", "신원 확인", "K-Tour 패스", "패스 제시", "혜택 제안", "실행 승인", "실행", "사용 확정", "기록"],
    consentTitle: "이용 조건 확인", consentBody: "해커톤 체험용 비금전 혜택 1회입니다. 실제 결제·예약·매장의 제공 의무가 없고, 신원 확인 결과는 혜택 자격 판단에만 쓰이며 신분증·패스 원문은 체인에 올리지 않습니다.",
    consentCheck: "위 내용을 확인했고 이 장소의 체험 혜택 1회를 진행합니다.", start: "확인하고 시작", startIdentity: "모바일 신분증으로 확인", mockApprove: "샘플 확인 승인",
    identityWait: "모바일 신분증 앱에서 확인을 마치면 아래 버튼으로 결과를 가져옵니다.", fetchResult: "결과 확인",
    sampleNote: "샘플 결과로 확인 과정을 체험합니다. 실제 신분증 확인 결과가 아니며 샘플로 기록됩니다.", issuing: "K-Tour 패스를 발급하고 보관 중…", present: "패스 제시", deny: "제시하지 않기",
    presentBody: "이 장소의 혜택에 필요한 확인 결과와 패스 유효기간만 제시합니다.", propose: "혜택 제안 받기", approveTitle: "진행 범위 확인", approveBody: "허용한 장소·혜택·횟수·기한을 확인해 주세요. 아래 범위의 1회 진행에만 동의합니다.",
    approveCheck: "이 범위에 동의하고 한 번만 진행하도록 승인합니다.", signerZk: "Google로 계속", signerDemo: "샘플 계정으로 계속", signDelegate: "한 번만 진행하도록 승인", runAgent: "혜택 진행", redeem: "확인하고 사용하기",
    done: "혜택 사용이 확정됐어요", blocked: "사용이 확정되지 않았어요", chainPending: "기록 확인 중", chainConfirmed: "기록 확정", reconcile: "다시 확인", evidence: "기술 기록 보기", cancel: "그만두기",
    sample: "SAMPLE", live: "LIVE", chain: "TESTNET",
  },
  en: {
    title: "Experience perk", sub: "Identity → pass → perk → use", close: "Close", back: "Return to this place",
    steps: ["Consent", "Identity", "K-Tour pass", "Present", "Proposal", "Approve", "Execute", "Confirm", "Record"],
    consentTitle: "Before you start", consentBody: "One non-financial hackathon perk. No payment, reservation or merchant obligation. The identity result is used only for eligibility; ID and pass originals never go on-chain.",
    consentCheck: "I understand and want to use this place's one-time perk.", start: "Confirm and start", startIdentity: "Check with Mobile ID", mockApprove: "Approve sample check",
    identityWait: "Finish in the Mobile ID app, then fetch the result.", fetchResult: "Fetch result",
    sampleNote: "Explore the check using a sample result. This is not a real identity check and is recorded as a sample.", issuing: "Issuing and storing your K-Tour pass…", present: "Present pass", deny: "Don't present",
    presentBody: "Share only the check result and pass validity needed for this place's perk.", propose: "Get a perk proposal", approveTitle: "Confirm the scope", approveBody: "Review the place, perk, use limit and expiry. You are approving one action within this scope.",
    approveCheck: "I agree to this scope and approve one action.", signerZk: "Continue with Google", signerDemo: "Continue with sample account", signDelegate: "Approve one action", runAgent: "Continue with perk", redeem: "Confirm and use",
    done: "Perk use confirmed", blocked: "Use was not confirmed", chainPending: "Recording", chainConfirmed: "Recorded", reconcile: "Check again", evidence: "Show technical record", cancel: "Stop",
    sample: "SAMPLE", live: "LIVE", chain: "TESTNET",
  },
  ja: {
    title: "体験特典", sub: "本人確認 → パス → 特典確認 → 利用", close: "閉じる", back: "同じ場所に戻る",
    steps: ["同意", "本人確認", "K-Tourパス", "パスの提示", "特典の提案", "承認", "実行", "利用確認", "記録"],
    consentTitle: "利用条件の確認", consentBody: "ハッカソン体験用の金銭を伴わない1回限りの特典です。実際の決済・予約や店舗の提供義務はありません。本人確認の結果は利用資格の判断にのみ使います。",
    consentCheck: "条件を確認し、この場所の特典を1回体験します。", start: "確認して始める", startIdentity: "モバイル身分証で確認", mockApprove: "サンプル確認を承認",
    identityWait: "身分証アプリで確認後、下のボタンで結果を取得してください。", fetchResult: "結果を確認",
    sampleNote: "サンプル結果で体験できます。実際の身分証確認ではなく、サンプルとして記録されます。", issuing: "K-Tourパスを発行・保存中…", present: "パスを提示", deny: "提示しない",
    presentBody: "この場所の特典に必要な確認結果とパスの有効期間だけを提示します。", propose: "特典の提案を受ける", approveTitle: "進める範囲の確認", approveBody: "場所・特典・回数・期限を確認してください。この範囲の1回の操作だけを承認します。",
    approveCheck: "この範囲に同意し、1回だけの操作を承認します。", signerZk: "Googleで続ける", signerDemo: "サンプルアカウントで続ける", signDelegate: "1回だけの操作を承認", runAgent: "特典を進める", redeem: "確認して利用する",
    done: "特典の利用が確定しました", blocked: "利用は確定していません", chainPending: "記録を確認中", chainConfirmed: "記録済み", reconcile: "再確認", evidence: "技術記録を見る", cancel: "中止する", sample: "サンプル", live: "接続済み", chain: "TESTNET",
  },
} as const
const copyFor = (l: Locale) => T[l]

export function HackathonEntitlementLayerB() {
  const [open, setOpen] = useState<HackathonOpenDetail | null>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!HACKATHON_ENABLED) return
    const onOpen = (e: Event) => {
      const d = manualHackathonDetail((e as CustomEvent<unknown>).detail)
      if (d) { openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setOpen(d) }
    }
    window.addEventListener(HACKATHON_OPEN_EVENT_B, onOpen)
    // resume after an external app return / reload
    const url = new URL(window.location.href)
    const hk = url.searchParams.get("hk")
    const pending = readPendingHackathon()
    if (pending && (!hk || hk === pending.resumeOperationId)) setOpen(pending)
    // `/hackathon` deep link → jump to the designated venue so the CTA is one tap away
    else if (hk === "start" && HACKATHON_DEMO_ENTRY) openHackathonVenueB(300)
    // Legacy automatic-entry links are view-only shortcuts. They never open or approve a journey.
    else if ((hk === "auto" || hk === "auto-execute" || hk === "step") && HACKATHON_DEMO_ENTRY) openHackathonVenueB(300)
    if (hk) { url.searchParams.delete("hk"); window.history.replaceState(null, "", url.toString()) }
    return () => window.removeEventListener(HACKATHON_OPEN_EVENT_B, onOpen)
  }, [])
  if (!HACKATHON_ENABLED) return null
  if (!open) return HACKATHON_DEMO_ENTRY ? <DemoEntryButton /> : null
  return <Journey key={open.resumeOperationId ?? open.venueId} detail={open} onClose={() => {
    setOpen(null)
    window.setTimeout(() => {
      const opener = openerRef.current
      const target = opener?.isConnected && !opener.closest("[inert]") ? opener : document.querySelector<HTMLElement>("[data-testid='hackathon-entitlement-open']")
      target?.focus({ preventScroll: true })
    }, 100)
  }} />
}

/** Floating map shortcut (demo builds only): opens the designated venue's place sheet. */
function DemoEntryButton() {
  const { state } = useOndoB()
  if (state.tab !== "ondo" || state.surface.kind !== "map") return null
  const label = state.locale === "en" ? "Start perk journey" : state.locale === "ja" ? "体験特典を始める" : "체험 혜택 여정 시작"
  return (
    <div className={styles.entryGroup}>
      <button type="button" className={styles.entry} data-testid="hackathon-demo-entry" onClick={() => openHackathonVenueB()}>
        <Ticket size={16} aria-hidden="true" /><span>{label}</span>
      </button>
    </div>
  )
}

function Journey({ detail, onClose }: { detail: HackathonOpenDetail; onClose: () => void }) {
  const locale: Locale = detail.locale
  const c = copyFor(locale)
  const tr = (ko: string, en: string, ja: string) => locale === "ko" ? ko : locale === "ja" ? ja : en
  const [info, setInfo] = useState<EntitlementInfo | null>(null)
  const [config, setConfig] = useState<PublicConfig | null>(null)
  const [op, setOp] = useState<OperationResult | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [consent, setConsent] = useState(false)
  const [approve, setApprove] = useState(false)
  const [evidence, setEvidence] = useState<Record<string, unknown> | null>(null)
  const [signer, setSigner] = useState<StoredSigner | null>(null)
  const [viewStep, setViewStep] = useState<number | null>(null)
  const inFlightRef = useRef(false)
  const closedRef = useRef(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const vcRef = useRef<unknown>(null)
  const isMobile = typeof navigator !== "undefined" && /Android|iPhone|iPad/i.test(navigator.userAgent)
  // Sit above the place sheet in the app's modal stack: the sheet (and dock)
  // become inert while the journey is open and are restored on close.
  const rootRef = useRef<HTMLDivElement>(null)
  useModalIsolation(true, rootRef)
  useDocumentScrollLock(true)
  useEffect(() => { closedRef.current = false; return () => { closedRef.current = true } }, [])

  const run = useCallback(async (label: string, fn: () => Promise<void>) => {
    // React state updates are asynchronous: a same-frame double tap must not sign twice.
    if (inFlightRef.current) return
    inFlightRef.current = true
    setBusy(label); setError(null)
    try { await fn() } catch (e) { setError(e instanceof ApiError ? `${e.message} (${e.code})` : e instanceof Error ? e.message : "unknown error") } finally { inFlightRef.current = false; setBusy(null) }
  }, [])

  // Scope or recipient changes cannot inherit a previous checkbox approval.
  useEffect(() => { setApprove(false) }, [op?.proposal?.proposalDigest, op?.presentation?.decisionRef, signer?.address])
  useEffect(() => {
    setViewStep(null)
    bodyRef.current?.scrollTo({ top: 0 })
    if (!op) return
    const frame = requestAnimationFrame(() => {
      const heading = bodyRef.current?.querySelector<HTMLElement>("h3")
      if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }) }
    })
    return () => cancelAnimationFrame(frame)
  }, [op?.phase, op?.status])

  // bootstrap: config + entitlement + resume
  useEffect(() => {
    let alive = true
    ;(async () => {
      await api.session() // one cookie first; never proceed after a failed session bootstrap
      const [cfg, ent] = await Promise.all([api.config(), api.entitlements(detail.venueId)])
      if (!alive) return
      setConfig(cfg); setInfo(ent)
      const resumeId = detail.resumeOperationId ?? ent.operation?.operationId
      if (resumeId) {
        let current = await api.get(resumeId).catch(() => null)
        if (current && current.status !== "pending") writePendingHackathon(null)
        if (current && alive) { setOp(current); setSigner(readSigner(current.operationId)); try { vcRef.current = JSON.parse(sessionStorage.getItem(`ondo-b.hackathon.vc:${current.operationId}`) ?? "null") } catch { vcRef.current = null } }
        // OAuth return restores the view only; finishing sign-in requires a fresh tap.
      }
    })().catch((e) => setError(e instanceof Error ? e.message : "load failed"))
    return () => { alive = false }
  }, [detail.venueId, detail.resumeOperationId, run])

  useEffect(() => { if (op && op.status === "pending") writePendingHackathon({ venueId: detail.venueId, locale: detail.locale, resumeOperationId: op.operationId }) }, [op, detail.venueId, detail.locale])

  const close = useCallback((returnToPlace: boolean) => {
    closedRef.current = true
    if (op && op.status !== "pending") { writePendingHackathon(null); clearJourneySecrets(op.operationId); try { sessionStorage.removeItem(`ondo-b.hackathon.vc:${op.operationId}`) } catch { /* ignore */ } }
    onClose()
    if (returnToPlace) window.setTimeout(() => requestPlaceServiceReturnB(detail.venueId, "offer"), 30)
  }, [onClose, op, detail.venueId])

  // ── step actions ──────────────────────────────────────────────────
  const start = () => run("start", async () => { if (consent && info?.supported) setOp(await api.create(detail.venueId, info?.consentVersion ?? config?.consentVersion ?? "", locale)) })
  const identityStart = () => run("identity", async () => { if (op) setOp(await api.identityStart(op.operationId, isMobile)) })
  const identityComplete = (sample?: { outcome: string; subjectSeed: string }) => run("identity", async () => { if (op) setOp(await api.identityComplete(op.operationId, sample)) })
  const issueAndAck = useCallback(() => run("issue", async () => {
    if (!op) return
    const holder = await ensureHolderKey(op.operationId)
    const issued = await api.issue(op.operationId, holder.publicKeyPem, holder.alg)
    // Never acknowledge holder storage if the browser rejected it. Retrying uses
    // the same holder and the server's idempotent issuance envelope.
    sessionStorage.setItem(`ondo-b.hackathon.vc:${op.operationId}`, JSON.stringify(issued.vc))
    vcRef.current = issued.vc
    const cred = issued.result.credential!
    const ackPayload = canonicalJson({ typ: "ondo-kpass-holder-ack/v1", credentialRef: cred.credentialRef, vcId: cred.vcId, holderBinding: cred.holderBinding })
    setOp(await api.holderAck(op.operationId, await holderSign(holder, ackPayload)))
  }), [op, run])

  const present = () => run("present", async () => {
    if (!op) return
    if (!vcRef.current) throw new Error(tr("보관된 패스를 찾지 못했어요. 중지 후 다시 시작해 주세요.", "The saved pass is unavailable. Stop this journey and start again.", "保存したパスが見つかりません。中止してからやり直してください。"))
    const holder = await ensureHolderKey(op.operationId)
    const req = await api.presentationRequest(op.operationId)
    const p = req.result.presentation!
    const vc = vcRef.current as { credentialSubject?: Record<string, unknown> } | null
    const disclosed: Record<string, unknown> = {}
    for (const k of p.requestedClaims) if (vc?.credentialSubject && k in vc.credentialSubject) disclosed[k] = vc.credentialSubject[k]
    const vcDigest = await sha256Hex(new TextEncoder().encode(canonicalJson(vc)))
    const payload = canonicalJson({ typ: "ondo-kpass-vp/v1", presentationId: p.presentationId, nonce: p.nonce, audience: "ondo-hackathon-verifier", purpose: "redeem_demo_entitlement", venueId: op.venueId, campaignId: op.campaignId, vcDigest, disclosed })
    setOp(await api.presentationSubmit(op.operationId, p.presentationId, disclosed, await holderSign(holder, payload)))
  })
  const deny = () => run("present", async () => { if (op) setOp(await api.presentationDeny(op.operationId)) })
  const propose = () => run("propose", async () => { if (op) setOp(await api.proposal(op.operationId, locale)) })
  const chooseSigner = (kind: "zklogin" | "demo") => run("signer", async () => {
    if (!op) return
    if (kind === "demo") { setSigner(createDemoSigner(op.operationId)); return }
    if (config?.isolatedMock !== false) throw new Error(tr("이 체험에서는 Google 연결을 사용하지 않아요.", "Google sign-in is disabled for this isolated experience.", "この体験ではGoogle連携を使用しません。"))
    const jwt = sessionStorage.getItem(`ondo-b.hackathon.jwt:${op.operationId}`)
    if (jwt) { setSigner(await finishZkLogin(op.operationId, jwt)); sessionStorage.removeItem(`ondo-b.hackathon.jwt:${op.operationId}`); return }
    const params = await api.zkParams()
    if (!params.configured) throw new Error(tr("Google 연결이 준비되지 않았어요.", "Google sign-in is not configured.", "Google連携の準備ができていません。"))
    writePendingHackathon({ venueId: detail.venueId, locale: detail.locale, resumeOperationId: op.operationId })
    window.location.assign(await beginZkLogin(op.operationId, params.googleClientId, params.maxEpoch))
  })
  const delegate = () => run("delegate", async () => {
    if (!approve || !op || !signer || !op.proposal || !op.presentation?.decisionRef) return
    // Every retry, including a rejected signature, requires a fresh approval.
    setApprove(false)
    const message = `ondo-hk-wallet-proof:${op.operationId}:${op.presentation.decisionRef}`
    const walletSignature = await signPersonalMessage(signer, message)
    if (closedRef.current) return
    const prepared = await api.delegationPrepare(op.operationId, { userAddress: signer.address, signer: signer.kind, walletProof: { message, signature: walletSignature }, approvedProposalDigest: op.proposal.proposalDigest })
    // Leaving while the request is pending must not trigger a later signature.
    if (closedRef.current) return
    setOp(prepared.result)
    const digest = await sha256Hex(fromBase64(prepared.txBytesB64))
    if (closedRef.current) return
    const userSignature = await signTransactionBytes(signer, prepared.txBytesB64)
    if (closedRef.current) return
    setOp(await api.delegationSubmit(op.operationId, digest, userSignature))
  })
  const runAgent = () => run("agent", async () => { if (op) setOp(await api.agentRun(op.operationId)) })
  const redeem = () => run("redeem", async () => { if (op) setOp(await api.redeem(op.operationId, `ui-${op.operationId}`)) })
  const reconcile = () => run("reconcile", async () => { if (op) setOp(await api.reconcile(op.operationId)) })
  const cancel = () => run("cancel", async () => { if (op) setOp(await api.cancel(op.operationId)) })
  const loadEvidence = () => run("evidence", async () => { if (op) setEvidence(await api.evidence(op.operationId)) })

  // Sample identity seed: one synthetic person per operation so the demo can be
  // replayed (the server still enforces one redemption per subject+campaign).
  const sampleSeed = op ? `sample-${op.operationId}`.slice(0, 64) : "sample-person-1"
  const approveSample = () => identityComplete({ outcome: "verified", subjectSeed: sampleSeed })

  const stepIndex = journeyStepIndex(op)
  const activePhase = op?.status === "pending" ? op.phase : null
  const delegationNeedsCheck = Boolean(op?.delegation && op.delegation.status !== "awaiting_signature")
  const delegationMayStop = !op?.delegation?.userTxDigest || op.delegation.status === "failed"
  const reviewing = viewStep !== null && viewStep < stepIndex
  const shownStep = reviewing ? viewStep : stepIndex
  const reviewStep = (step: number | null) => {
    setApprove(false)
    setViewStep(step)
    bodyRef.current?.scrollTo({ top: 0 })
    // The clicked history button may unmount; keep keyboard/Escape ownership
    // inside this dialog instead of dropping focus onto the inert place sheet.
    requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>(`[data-testid='${step === null ? "hackathon-step-back" : "hackathon-step-live"}']`)?.focus({ preventScroll: true }))
  }
  const modes = info?.modes ?? config?.modes ?? {}
  const isolated = config?.isolatedMock !== false
  const stateOf = (i: number) => (op?.status === "cancelled" || op?.status === "failed" || op?.status === "expired" ? (i < stepIndex ? "done" : i === stepIndex ? "blocked" : "todo") : i < stepIndex ? "done" : i === stepIndex ? "current" : "todo")
  const title = useMemo(() => info?.campaign?.title?.[locale] ?? c.title, [info, locale, c.title])

  return (
    <div ref={rootRef} className={styles.root} role="dialog" aria-modal="true" aria-label={c.title} lang={locale} data-testid="hackathon-layer" data-locale={locale} data-phase={op?.phase ?? "consent"} data-reviewing={reviewing} data-status={op?.status ?? "pending"} data-chain-status={op?.chain?.status ?? "none"} data-modal-layer-priority={ONDO_MODAL_PRIORITY.critical} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); close(true) } }}>
      <div className={styles.sheet}>
        <header className={styles.head}>
          <div className={styles.headRow}>
            <h2>{title}</h2>
            <button type="button" className={styles.close} aria-label={c.close} data-testid="hackathon-close" onClick={() => close(true)}><X size={18} aria-hidden="true" /></button>
          </div>
          <div className={styles.progress} role="group" aria-label={`${c.steps[stepIndex]} · ${stepIndex + 1}/${c.steps.length}`}>
            <div className={styles.progressLabel}><span><b>{c.steps[stepIndex]}</b></span><span>{stepIndex + 1} / {c.steps.length}</span></div>
            <div className={styles.segments} aria-hidden="true">{c.steps.map((s, i) => <span key={s} className={styles.segment} data-state={stateOf(i)} />)}</div>
          </div>
          <span className={styles.badge} data-tone="sample">{tr("체험용 · 실제 혜택 아님", "Preview · not a real perk", "体験用・実際の特典ではありません")}</span>
        </header>
        {op && stepIndex > 0 ? <nav className={styles.stepNav} aria-label={tr("진행 단계 돌아보기", "Review journey steps", "進んだステップを確認")}>
          <button type="button" className={styles.ghost} disabled={shownStep <= 0 || !!busy} onClick={() => reviewStep(Math.max(0, shownStep - 1))} data-testid="hackathon-step-back">{tr("이전 단계 보기", "Review previous", "前のステップを見る")}</button>
          {reviewing ? <button type="button" className={styles.secondary} onClick={() => reviewStep(null)} data-testid="hackathon-step-live">{tr("현재 단계로", "Back to current", "現在のステップへ")}</button> : null}
        </nav> : null}
        <div ref={bodyRef} className={styles.body}>
          {reviewing && op ? <section className={styles.card} data-testid="hackathon-step-review">
            <h3>{c.steps[shownStep]}</h3>
            <p>{tr("이미 진행한 단계의 기록입니다. 돌아보아도 인증·동의·실행이 다시 이루어지지 않습니다.", "A read-only record of an earlier step. Reviewing never repeats verification, consent or execution.", "進んだステップの記録です。確認しても本人確認・同意・実行は繰り返されません。")}</p>
            <dl className={styles.kv}>
              <dt>{tr("장소의 혜택", "Place perk", "この場所の特典")}</dt><dd>{title}</dd>
              {shownStep === 0 ? <><dt>{tr("동의 시각", "Consented at", "同意した日時")}</dt><dd>{op.consent?.acceptedAt ?? "—"}</dd></> : null}
              {shownStep === 1 ? <><dt>{tr("확인 방식", "Check type", "確認方法")}</dt><dd>{op.identity?.mode === "mock" ? c.sampleNote : tr("연결된 신분증 서비스", "Connected identity service", "接続された身分証サービス")}</dd></> : null}
              {shownStep === 2 ? <><dt>{tr("패스 유효기한", "Pass valid until", "パスの有効期限")}</dt><dd>{op.credential?.validUntil ?? "—"}</dd></> : null}
              {shownStep === 3 ? <><dt>{tr("제시 결과", "Presentation decision", "提示の結果")}</dt><dd>{op.presentation?.decision === "allow" ? tr("제시됨", "Presented", "提示済み") : tr("승인되지 않음", "Not approved", "未承認")}</dd></> : null}
              {shownStep === 4 ? <><dt>{tr("확인한 제안", "Reviewed proposal", "確認した提案")}</dt><dd>{op.proposal?.output.summary ?? "—"}</dd></> : null}
              {shownStep === 5 ? <><dt>{tr("수령 계정", "Recipient", "受取アカウント")}</dt><dd>{op.delegation?.recipient ?? "—"}</dd><dt>{tr("횟수", "Uses", "回数")}</dt><dd>1</dd></> : null}
              {shownStep === 6 ? <><dt>{tr("진행 결과", "Execution result", "実行結果")}</dt><dd>{op.agent?.status === "executed" ? tr("진행 완료", "Executed", "実行済み") : tr("확인 필요", "Needs checking", "確認が必要")}</dd></> : null}
              {shownStep === 7 ? <><dt>{tr("체험 번호", "Experience ref", "体験番号")}</dt><dd>{op.fulfillment?.redemptionRef ?? "—"}</dd></> : null}
            </dl>
          </section> : <>
          {isolated ? <div className={styles.notice} data-testid="hackathon-isolated-notice">{tr("외부 서비스에 연결하지 않는 샘플 체험입니다. 실제 신원 확인이나 혜택 사용은 이루어지지 않습니다.", "This isolated sample does not connect to external services or verify a real identity or perk use.", "外部サービスに接続しないサンプル体験です。実際の本人確認や特典利用は行いません。")}</div> : null}
          {error ? <div className={styles.notice} data-tone="error" role="alert">{error}</div> : null}

          {!op ? (
            <section className={styles.card}>
              <h3>{c.consentTitle}</h3>
              <p>{c.consentBody}</p>
              {info?.redeemed ? <div className={styles.notice} data-tone="ok">{tr("이미 사용한 혜택이에요", "Already used", "利用済みの特典です")} ({info.redeemed.redeemedAt.slice(0, 16).replace("T", " ")})</div> : null}
              <label className={styles.check}><input type="checkbox" id="hk-consent" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> <span>{c.consentCheck}</span></label>
              <div className={styles.actions}><button type="button" className={styles.primary} disabled={!consent || !!busy || !info?.supported} onClick={start} data-testid="hackathon-start">{busy === "start" ? <span className={styles.spinner} /> : null}{c.start}</button><button type="button" className={styles.ghost} onClick={() => close(true)}>{c.back}</button></div>
            </section>
          ) : null}

          {activePhase === "identity" && op ? (
            <section className={styles.card}>
              <h3>{c.steps[1]}</h3>
              {!op.identity?.handoff ? <>
                <p>{isolated ? c.sampleNote : tr("연결된 신분증 서비스에서 확인을 시작합니다. 결과를 받은 뒤 다음 단계로 진행합니다.", "Start a check with the connected identity service, then retrieve the result.", "接続された身分証サービスで確認後、結果を取得して次に進みます。")}</p>
                <div className={styles.actions}><button type="button" className={styles.primary} disabled={!!busy} onClick={identityStart} data-testid="hackathon-identity-start">{isolated ? tr("샘플 확인 시작", "Start sample check", "サンプル確認を始める") : c.startIdentity}</button><button type="button" className={styles.ghost} disabled={!!busy} onClick={cancel} data-testid="hackathon-cancel">{c.cancel}</button></div>
              </> : op.identity.handoff.kind === "mock" ? <>
                <div className={styles.notice}>{c.sampleNote}</div>
                <div className={styles.actions}>
                  <button type="button" className={styles.primary} disabled={!!busy} onClick={approveSample} data-testid="hackathon-identity-approve">{busy === "identity" ? <span className={styles.spinner} /> : null}{c.mockApprove}</button>
                  <button type="button" className={styles.ghost} disabled={!!busy} onClick={cancel} data-testid="hackathon-cancel">{c.cancel}</button>
                </div>
              </> : op.identity.handoff.kind === "qr" ? <>
                <img className={styles.qr} alt="Mobile ID QR" src={`data:image/png;base64,${op.identity.handoff.qrBase64}`} />
                <p>{c.identityWait}</p>
                <div className={styles.actions}><button type="button" className={styles.primary} disabled={!!busy} onClick={() => identityComplete()}>{c.fetchResult}</button><button type="button" className={styles.ghost} disabled={!!busy} onClick={cancel} data-testid="hackathon-cancel">{c.cancel}</button></div>
              </> : <>
                <div className={styles.actions}>
                  {!isolated && op.identity.handoff.ssPayLink ? <a className={styles.primary} href={op.identity.handoff.ssPayLink}>Samsung Wallet</a> : null}
                  {!isolated && op.identity.handoff.androidLink ? <a className={styles.secondary} href={op.identity.handoff.androidLink}>Mobile ID (Android)</a> : null}
                  {!isolated && op.identity.handoff.iosLink ? <a className={styles.secondary} href={op.identity.handoff.iosLink}>Mobile ID (iOS)</a> : null}
                </div>
                <p>{c.identityWait}</p>
                <div className={styles.actions}><button type="button" className={styles.primary} disabled={!!busy} onClick={() => identityComplete()}>{c.fetchResult}</button><button type="button" className={styles.ghost} disabled={!!busy} onClick={cancel} data-testid="hackathon-cancel">{c.cancel}</button></div>
              </>}
            </section>
          ) : null}

          {activePhase === "issuance" && op ? <section className={styles.card}>
            <h3>{c.steps[2]}</h3>
            <p>{busy === "issue" ? c.issuing : tr("이 체험에서 사용할 패스를 받아 보관합니다.", "Receive and keep a pass for this experience.", "この体験で使うパスを受け取り、保存します。")}</p>
            <div className={styles.actions}><button type="button" className={styles.primary} disabled={!!busy} onClick={issueAndAck} data-testid="hackathon-issue">{busy === "issue" ? <span className={styles.spinner} /> : null}{tr("패스 받기", "Get pass", "パスを受け取る")}</button><button type="button" className={styles.ghost} disabled={!!busy} onClick={cancel} data-testid="hackathon-cancel">{c.cancel}</button></div>
          </section> : null}

          {activePhase === "presentation" && op ? (
            <section className={styles.card}>
              <h3>{c.steps[3]}</h3>
              <p>{c.presentBody}</p>
              <p>{tr("이름·생년월일·국적·신분증 원문은 제시하지 않습니다.", "Your name, date of birth, nationality and original ID are not shared.", "氏名・生年月日・国籍・身分証の原文は提示しません。")}</p>
              {op.presentation?.decision === "deny" ? <div className={styles.notice} data-tone="error">{tr("패스 제시가 승인되지 않았어요.", "Pass presentation was not approved.", "パスの提示は承認されていません。")}</div> : null}
              <div className={styles.actions}><button type="button" className={styles.primary} disabled={!!busy} onClick={present} data-testid="hackathon-present">{busy === "present" ? <span className={styles.spinner} /> : null}{c.present}</button><button type="button" className={styles.ghost} disabled={!!busy} onClick={deny} data-testid="hackathon-presentation-deny">{c.deny}</button></div>
            </section>
          ) : null}

          {activePhase === "proposal" && op ? <section className={styles.card}><h3>{c.steps[4]}</h3><p>{tr("이 장소에서 체험할 수 있는 혜택 하나를 확인합니다. 내용을 보고 진행 여부를 직접 선택해 주세요.", "Review the one available experience perk, then choose whether to continue.", "この場所で体験できる特典を1つ確認し、進めるかどうか選んでください。")}</p><div className={styles.actions}><button type="button" className={styles.primary} disabled={!!busy} onClick={propose} data-testid="hackathon-propose">{busy === "propose" ? <span className={styles.spinner} /> : null}{c.propose}</button><button type="button" className={styles.ghost} disabled={!!busy} onClick={cancel} data-testid="hackathon-cancel">{c.cancel}</button></div></section> : null}

          {activePhase === "delegation" && op && op.proposal ? (
            <section className={styles.card}>
              <h3>{op.proposal.output.title}</h3>
              <p><b>{op.proposal.output.summary}</b></p>
              <p>{op.proposal.output.rationale}</p>
              <h3>{c.approveTitle}</h3>
              <p>{c.approveBody}</p>
              <dl className={styles.kv}>
                <dt>{tr("대상", "Perk", "対象")}</dt><dd>{title}</dd>
                <dt>{tr("횟수", "Uses", "回数")}</dt><dd>1</dd>
                <dt>{tr("기한", "Expires", "期限")}</dt><dd>{op.delegation ? new Date(op.delegation.expiresAtMs).toLocaleTimeString(locale) : tr("승인 후 최대 10분", "Up to 10 minutes after approval", "承認から最大10分")}</dd>
                <dt>{tr("수령 계정", "Recipient", "受取アカウント")}</dt><dd>{signer?.address ? signer.address.slice(0, 12) + "…" : "—"}</dd>
              </dl>
              {delegationNeedsCheck ? <>
                <div className={styles.notice}>{tr("이전 요청의 결과를 확인하고 있어요. 확인 전에는 새로 승인하거나 실행하지 않습니다.", "Checking the previous request. No new approval or execution is sent while its result is uncertain.", "前のリクエストの結果を確認しています。確認前に新たな承認や実行は行いません。")}</div>
                <div className={styles.actions}><button type="button" className={styles.primary} disabled={!!busy} onClick={reconcile} data-testid="hackathon-reconcile">{c.reconcile}</button>{delegationMayStop ? <button type="button" className={styles.ghost} disabled={!!busy} onClick={cancel} data-testid="hackathon-cancel">{c.cancel}</button> : null}</div>
              </> : !signer || (signer.kind === "zklogin" && signer.jwtPending) ? <div className={styles.actions}>
                {!isolated && modes.zklogin === "google" ? <button type="button" className={styles.primary} disabled={!!busy} onClick={() => chooseSigner("zklogin")} data-testid="hackathon-signer-google">{c.signerZk}</button> : null}
                {isolated || modes.zklogin !== "google" ? <button type="button" className={styles.secondary} disabled={!!busy} onClick={() => chooseSigner("demo")} data-testid="hackathon-signer-demo">{c.signerDemo}</button> : null}
              </div> : <>
                <div className={styles.notice}>{signer.kind === "zklogin" ? tr("Google 계정 연결됨", "Google account connected", "Googleアカウント接続済み") : tr("샘플 계정이 준비됐어요", "Sample account ready", "サンプルアカウントの準備ができました")}</div>
                <label className={styles.check}><input type="checkbox" id="hk-approve" checked={approve} onChange={(e) => setApprove(e.target.checked)} /> <span>{c.approveCheck}</span></label>
                <div className={styles.actions}><button type="button" className={styles.primary} disabled={!approve || !!busy} onClick={delegate} data-testid="hackathon-delegate">{busy === "delegate" ? <span className={styles.spinner} /> : null}{c.signDelegate}</button><button type="button" className={styles.ghost} disabled={!!busy} onClick={cancel} data-testid="hackathon-cancel">{c.cancel}</button></div>
              </>}
            </section>
          ) : null}

          {activePhase === "agent" && op ? <section className={styles.card}><h3>{c.steps[6]}</h3><p>{op.agent?.status === "unknown" || op.agent?.status === "queued" ? tr("진행한 요청의 결과를 확인하고 있어요. 새로 실행하지 않고 기존 결과만 다시 확인합니다.", "Your request is being checked. Check its result without starting it again.", "送信したリクエストを確認中です。再実行せず、結果だけを確認します。") : tr("확인한 범위 안에서 한 번만 진행합니다. 아래 버튼을 눌러 시작해 주세요.", "Continue once within the approved scope. Tap below when ready.", "承認した範囲内で1回だけ進めます。下のボタンを押してください。")}</p><div className={styles.actions}>{op.agent?.status !== "unknown" && op.agent?.status !== "queued" ? <button type="button" className={styles.primary} disabled={!!busy} onClick={runAgent} data-testid="hackathon-agent-run">{busy === "agent" ? <span className={styles.spinner} /> : null}{c.runAgent}</button> : null}<button type="button" className={styles.ghost} disabled={!!busy} onClick={reconcile} data-testid="hackathon-reconcile">{c.reconcile}</button></div></section> : null}

          {activePhase === "fulfillment" && op ? <section className={styles.card}><h3>{c.steps[7]}</h3>{op.fulfillment?.status === "blocked" ? <div className={styles.notice} data-tone="error">{c.blocked}</div> : <p>{tr("진행 결과와 이용 조건을 다시 확인한 뒤 1회 사용을 확정합니다.", "Re-check the result and eligibility before confirming a single use.", "結果と利用条件を再確認し、1回の利用を確定します。")}</p>}<div className={styles.actions}>{op.fulfillment?.status !== "blocked" ? <button type="button" className={styles.primary} disabled={!!busy} onClick={redeem} data-testid="hackathon-redeem">{busy === "redeem" ? <span className={styles.spinner} /> : null}{c.redeem}</button> : null}<button type="button" className={styles.ghost} disabled={!!busy} onClick={reconcile} data-testid="hackathon-reconcile">{c.reconcile}</button></div></section> : null}

          {op && (op.phase === "done" || op.status !== "pending") ? (
            <section className={styles.card}>
              <h3>{op.fulfillment?.status === "redeemed" ? isolated ? tr("샘플 체험을 마쳤어요", "Sample experience complete", "サンプル体験が完了しました") : c.done : op.status === "cancelled" ? tr("그만두었어요", "Stopped", "中止しました") : op.status === "expired" ? tr("만료됐어요", "Expired", "期限切れです") : c.blocked}</h3>
              {op.fulfillment?.redemptionRef ? <dl className={styles.kv}><dt>{tr("체험 번호", "Experience ref", "体験番号")}</dt><dd>{op.fulfillment.redemptionRef}</dd><dt>{tr("시각", "At", "時刻")}</dt><dd>{op.fulfillment.redeemedAt}</dd></dl> : null}
              {op.chain ? <div className={styles.notice} data-tone={op.chain.status === "confirmed" ? "ok" : undefined}>{isolated ? tr("샘플 기록입니다. 실제 외부 기록은 생성하지 않았습니다.", "This is a sample record. No real external record was created.", "サンプル記録です。実際の外部記録は作成していません。") : op.chain.status === "confirmed" ? c.chainConfirmed : c.chainPending}</div> : null}
              <div className={styles.actions}>
                {op.chain && op.chain.status !== "confirmed" ? <button type="button" className={styles.secondary} disabled={!!busy} onClick={reconcile} data-testid="hackathon-reconcile">{c.reconcile}</button> : null}
                <button type="button" className={styles.primary} onClick={() => close(true)} data-testid="hackathon-return">{c.back}</button>
              </div>
            </section>
          ) : null}
          </>}

          {op ? <details className={styles.card} data-testid="hackathon-technical-details">
            <summary>{tr("기술 정보", "Technical details", "技術情報")}</summary>
            <pre className={styles.evidence}>{JSON.stringify({ modes, isolatedMock: isolated, credential: op.credential, presentation: op.presentation, proposalDigest: op.proposal?.proposalDigest, grant: op.delegation?.grant, chain: op.chain }, null, 2)}</pre>
          </details> : null}
          {op ? <button type="button" className={styles.secondary} disabled={!!busy} onClick={loadEvidence} data-testid="hackathon-evidence">{c.evidence}</button> : null}
          {evidence ? <section className={styles.card}><h3>{c.evidence}</h3><pre className={styles.evidence}>{JSON.stringify(evidence, null, 2)}</pre>{!isolated && config?.sui.explorer && op?.agent?.txDigest ? <a className={styles.link} href={`${config.sui.explorer}/tx/${op.agent.txDigest}`} target="_blank" rel="noreferrer">Sui explorer · agent tx</a> : null}</section> : null}
        </div>
      </div>
    </div>
  )
}
