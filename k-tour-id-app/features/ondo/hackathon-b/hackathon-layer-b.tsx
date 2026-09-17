"use client"

// Demo entitlement journey (overlay). Server phase drives the UI; the client
// only signs (holder key / Sui signer) and asks the server to verify.
// Consumer copy uses actions ("신원 확인", "혜택 확인", "확인하고 사용하기");
// technology names live in the evidence section.
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Play, Ticket, X } from "lucide-react"
import type { OperationResult } from "@/lib/hackathon/types"
import { requestPlaceServiceReturnB } from "../commerce-b/place-service-registry-b"
import { useOndoB } from "../shared/state/ondo-b-provider"
import { ONDO_MODAL_PRIORITY } from "../shared/ui/modal-layer-priority"
import { useDocumentScrollLock, useModalIsolation } from "../shared/ui/use-modal-isolation"
import { HACKATHON_DEMO_ENTRY, HACKATHON_OPEN_EVENT_B, openHackathonVenueB, readPendingHackathon, writePendingHackathon, type HackathonOpenDetail } from "./hackathon-campaign"
import { ApiError, api, beginZkLogin, canonicalJson, clearJourneySecrets, createDemoSigner, ensureHolderKey, fetchCxBrowserQr, CX_BROWSER_QR, type CxBrowserQr, finishZkLogin, holderSign, readSigner, sha256Hex, signPersonalMessage, signTransactionBytes, fromBase64, type EntitlementInfo, type PublicConfig, type StoredSigner } from "./hackathon-client"
import styles from "./hackathon-b.module.css"

type Locale = "ko" | "en" | "ja"
const T = {
  ko: {
    title: "체험 혜택", sub: "신원 확인 → 패스 → 혜택 확인 → 사용", close: "닫기", back: "같은 장소로 돌아가기",
    steps: ["동의", "신원 확인", "K-Tour 패스", "패스 제시", "혜택 제안", "실행 승인", "실행", "사용 확정", "기록"],
    consentTitle: "이용 조건 확인", consentBody: "해커톤 체험용 비금전 혜택 1회입니다. 실제 결제·예약·매장의 제공 의무가 없고, 신원 확인 결과는 혜택 자격 판단에만 쓰이며 신분증·패스 원문은 체인에 올리지 않습니다.",
    consentCheck: "위 내용을 확인했고 이 장소의 체험 혜택 1회를 진행합니다.", start: "확인하고 시작", startIdentity: "모바일 신분증으로 확인", mockApprove: "샘플 확인 승인", mockCancel: "취소 시뮬레이션", mockFail: "실패 시뮬레이션",
    identityWait: "모바일 신분증 앱에서 확인을 마치면 아래 버튼으로 결과를 가져옵니다.", fetchResult: "결과 확인", sampleInstead: "샘플 결과로 계속 (SIMULATION)",
    cxQrTitle: "실제 OmniOne CX QR",
    cxQrNote: "브라우저가 OmniOne CX 서버에 직접 요청해 발급받은 실제 QR입니다. 배포 서버는 CX에 접근할 수 없어(클라우드 차단) 스캔 결과를 검증하지 못하므로, 아래 진행은 샘플로 기록됩니다.",
    cxQrLoad: "실제 CX QR 받기", cxQrFail: "CX QR을 받지 못했어요 (한국 네트워크에서만 동작합니다)",
    sampleNote: "모바일 운전면허증이 없으면 아래에서 샘플 결과로 진행할 수 있어요. 샘플은 실제 신분증 결과가 아니며 증거에 SIMULATION으로 남습니다.", issuing: "K-Tour 패스를 발급하고 보관 중…", present: "패스 제시", deny: "제시하지 않기",
    presentBody: "이 장소의 혜택 목적으로 최소 항목만 제시합니다.", propose: "혜택 제안 받기", approveTitle: "실행 범위 확인", approveBody: "도우미가 아래 범위 안에서 1회만 실행합니다. 대상·수령 지갑·기한 밖 실행은 계약이 거절합니다.",
    approveCheck: "이 범위에 동의하고 실행 권한을 1회 위임합니다.", signerZk: "Google로 계속 (zkLogin)", signerDemo: "샘플 서명자로 계속", signDelegate: "위임 서명", runAgent: "실행", redeem: "확인하고 사용하기",
    done: "혜택 사용이 확정됐어요", blocked: "사용이 확정되지 않았어요", chainPending: "기록 확인 중", chainConfirmed: "기록 확정", reconcile: "다시 확인", evidence: "증거 보기", cancel: "그만두기",
    sample: "SAMPLE", live: "LIVE", chain: "TESTNET",
  },
  en: {
    title: "Experience perk", sub: "Identity → pass → perk → use", close: "Close", back: "Return to this place",
    steps: ["Consent", "Identity", "K-Tour pass", "Present", "Proposal", "Approve", "Execute", "Confirm", "Record"],
    consentTitle: "Before you start", consentBody: "One non-financial hackathon perk. No payment, reservation or merchant obligation. The identity result is used only for eligibility; ID and pass originals never go on-chain.",
    consentCheck: "I understand and want to use this place's one-time perk.", start: "Confirm and start", startIdentity: "Check with Mobile ID", mockApprove: "Approve sample check", mockCancel: "Simulate cancel", mockFail: "Simulate failure",
    identityWait: "Finish in the Mobile ID app, then fetch the result.", fetchResult: "Fetch result", sampleInstead: "Continue with a sample result (SIMULATION)",
    cxQrTitle: "Live OmniOne CX QR",
    cxQrNote: "This QR was issued by the OmniOne CX server, requested straight from your browser. This deployment cannot reach CX (cloud egress is blocked), so a scan cannot be verified here and continuing below is recorded as a sample.",
    cxQrLoad: "Get a live CX QR", cxQrFail: "Could not reach CX (works from a Korean network)",
    sampleNote: "No mobile driver's licence? Continue with a sample result. It is not a government ID result and is recorded as SIMULATION.", issuing: "Issuing and storing your K-Tour pass…", present: "Present pass", deny: "Don't present",
    presentBody: "Only the minimum claims for this place and purpose are presented.", propose: "Get a perk proposal", approveTitle: "Confirm execution scope", approveBody: "The assistant executes once within this scope. Anything outside target, recipient or expiry is rejected by the contract.",
    approveCheck: "I agree to this scope and delegate a single execution.", signerZk: "Continue with Google (zkLogin)", signerDemo: "Continue with sample signer", signDelegate: "Sign delegation", runAgent: "Execute", redeem: "Confirm and use",
    done: "Perk use confirmed", blocked: "Use was not confirmed", chainPending: "Recording", chainConfirmed: "Recorded", reconcile: "Check again", evidence: "Show evidence", cancel: "Stop",
    sample: "SAMPLE", live: "LIVE", chain: "TESTNET",
  },
} as const
const copyFor = (l: Locale) => (l === "en" ? T.en : T.ko)

const STEP_OF_PHASE: Record<string, number> = { consent: 0, identity: 1, issuance: 2, presentation: 3, proposal: 4, delegation: 5, agent: 6, fulfillment: 7, done: 8, cancelled: 1, failed: 1, expired: 1 }

export function HackathonEntitlementLayerB() {
  const [open, setOpen] = useState<HackathonOpenDetail | null>(null)
  useEffect(() => {
    const onOpen = (e: Event) => { const d = (e as CustomEvent<HackathonOpenDetail>).detail; if (d?.venueId) setOpen(d) }
    window.addEventListener(HACKATHON_OPEN_EVENT_B, onOpen)
    // resume after an external app return / reload
    const url = new URL(window.location.href)
    const hk = url.searchParams.get("hk")
    const pending = readPendingHackathon()
    if (pending && (!hk || hk === pending.resumeOperationId)) setOpen(pending)
    // `/hackathon` deep link → jump to the designated venue so the CTA is one tap away
    else if (hk === "start" && HACKATHON_DEMO_ENTRY) openHackathonVenueB(300)
    // `/?hk=auto` (or `hk=auto-execute`) → open the venue and run the whole journey hands-free
    else if ((hk === "auto" || hk === "auto-execute") && HACKATHON_DEMO_ENTRY) openHackathonVenueB(300, hk === "auto" ? "redeem" : "execute")
    if (hk) { url.searchParams.delete("hk"); window.history.replaceState(null, "", url.toString()) }
    return () => window.removeEventListener(HACKATHON_OPEN_EVENT_B, onOpen)
  }, [])
  if (!open) return HACKATHON_DEMO_ENTRY ? <DemoEntryButton /> : null
  return <Journey key={open.resumeOperationId ?? open.venueId} detail={open} onClose={() => setOpen(null)} />
}

/** Floating map shortcut (demo builds only): opens the designated venue's place sheet. */
function DemoEntryButton() {
  const { state } = useOndoB()
  if (state.tab !== "ondo" || state.surface.kind !== "map") return null
  const label = state.locale === "en" ? "Start perk journey" : state.locale === "ja" ? "体験特典を始める" : "체험 혜택 여정 시작"
  const autoLabel = state.locale === "en" ? "Run full journey" : state.locale === "ja" ? "全フロー自動実行" : "전체 플로우 자동 실행"
  const loc = state.locale === "en" ? "en" : state.locale === "ja" ? "ja" : "ko"
  return (
    <div className={styles.entryGroup}>
      <button type="button" className={styles.entry} data-testid="hackathon-demo-entry" onClick={() => openHackathonVenueB()}>
        <Ticket size={16} aria-hidden="true" /><span>{label}</span>
      </button>
      <button type="button" className={styles.entry} data-variant="auto" data-testid="hackathon-demo-entry-auto" onClick={() => openHackathonVenueB(0, "redeem", loc)}>
        <Play size={16} aria-hidden="true" /><span>{autoLabel}</span>
      </button>
    </div>
  )
}

function Journey({ detail, onClose }: { detail: HackathonOpenDetail; onClose: () => void }) {
  const locale: Locale = detail.locale === "ja" ? "ko" : detail.locale
  const c = copyFor(locale)
  const [info, setInfo] = useState<EntitlementInfo | null>(null)
  const [config, setConfig] = useState<PublicConfig | null>(null)
  const [op, setOp] = useState<OperationResult | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [consent, setConsent] = useState(false)
  const [approve, setApprove] = useState(false)
  const [evidence, setEvidence] = useState<Record<string, unknown> | null>(null)
  const [signer, setSigner] = useState<StoredSigner | null>(null)
  const vcRef = useRef<unknown>(null)
  const isMobile = typeof navigator !== "undefined" && /Android|iPhone|iPad/i.test(navigator.userAgent)
  // Sit above the place sheet in the app's modal stack: the sheet (and dock)
  // become inert while the journey is open and are restored on close.
  const rootRef = useRef<HTMLDivElement>(null)
  useModalIsolation(true, rootRef)
  useDocumentScrollLock(true)

  const run = useCallback(async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setError(null)
    try { await fn() } catch (e) { setError(e instanceof ApiError ? `${e.message} (${e.code})` : e instanceof Error ? e.message : "unknown error") } finally { setBusy(null) }
  }, [])

  // bootstrap: config + entitlement + resume
  useEffect(() => {
    let alive = true
    ;(async () => {
      await api.session().catch(() => undefined) // one cookie first; parallel calls below then share it
      const [cfg, ent] = await Promise.all([api.config(), api.entitlements(detail.venueId)])
      if (!alive) return
      setConfig(cfg); setInfo(ent)
      const resumeId = detail.resumeOperationId ?? ent.operation?.operationId
      if (resumeId) {
        let current = await api.get(resumeId).catch(() => null)
        // A finished operation is not resumable: drop the stale pending marker and, in
        // autopilot, start a fresh journey instead of re-showing the old result.
        if (current && current.status !== "pending") { writePendingHackathon(null); if (detail.auto) current = null }
        if (current && alive) { setOp(current); setSigner(readSigner(current.operationId)); try { vcRef.current = JSON.parse(sessionStorage.getItem(`ondo-b.hackathon.vc:${current.operationId}`) ?? "null") } catch { vcRef.current = null } }
        // zkLogin callback stored a JWT for this operation?
        const jwt = sessionStorage.getItem(`ondo-b.hackathon.jwt:${resumeId}`)
        if (jwt && current) { sessionStorage.removeItem(`ondo-b.hackathon.jwt:${resumeId}`); run("zk", async () => { setSigner(await finishZkLogin(resumeId, jwt)) }) }
      }
    })().catch((e) => setError(e instanceof Error ? e.message : "load failed"))
    return () => { alive = false }
  }, [detail.venueId, detail.resumeOperationId, run])

  useEffect(() => { if (op && op.status === "pending") writePendingHackathon({ venueId: detail.venueId, locale: detail.locale, resumeOperationId: op.operationId, auto: detail.auto }) }, [op, detail.venueId, detail.locale, detail.auto])

  const close = useCallback((returnToPlace: boolean) => {
    if (op && op.status !== "pending") { writePendingHackathon(null); clearJourneySecrets(op.operationId); try { sessionStorage.removeItem(`ondo-b.hackathon.vc:${op.operationId}`) } catch { /* ignore */ } }
    onClose()
    if (returnToPlace) window.setTimeout(() => requestPlaceServiceReturnB(detail.venueId, "offer"), 30)
  }, [onClose, op, detail.venueId])

  // ── step actions ──────────────────────────────────────────────────
  const start = () => run("start", async () => { setOp(await api.create(detail.venueId, info?.consentVersion ?? config?.consentVersion ?? "", locale)) })
  const identityStart = () => run("identity", async () => { if (op) setOp(await api.identityStart(op.operationId, isMobile)) })
  const identityComplete = (sample?: { outcome: string; subjectSeed: string }) => run("identity", async () => { if (op) setOp(await api.identityComplete(op.operationId, sample)) })
  const issueAndAck = useCallback(() => run("issue", async () => {
    if (!op) return
    const holder = await ensureHolderKey(op.operationId)
    const issued = await api.issue(op.operationId, holder.publicKeyPem, holder.alg)
    vcRef.current = issued.vc
    try { sessionStorage.setItem(`ondo-b.hackathon.vc:${op.operationId}`, JSON.stringify(issued.vc)) } catch { /* ignore */ }
    const cred = issued.result.credential!
    const ackPayload = canonicalJson({ typ: "ondo-kpass-holder-ack/v1", credentialRef: cred.credentialRef, vcId: cred.vcId, holderBinding: cred.holderBinding })
    setOp(await api.holderAck(op.operationId, await holderSign(holder, ackPayload)))
  }), [op, run])
  useEffect(() => { if (op?.phase === "issuance" && !op.credential && !busy) issueAndAck() }, [op?.phase, op?.credential, busy, issueAndAck])

  const present = () => run("present", async () => {
    if (!op) return
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
    const params = await api.zkParams()
    if (!params.configured) throw new Error("zkLogin is not configured (NEXT_PUBLIC_GOOGLE_CLIENT_ID / HK_ZKLOGIN_SALT_SEED)")
    writePendingHackathon({ venueId: detail.venueId, locale: detail.locale, resumeOperationId: op.operationId, auto: detail.auto })
    window.location.assign(await beginZkLogin(op.operationId, params.googleClientId, params.maxEpoch))
  })
  const delegate = () => run("delegate", async () => {
    if (!op || !signer || !op.proposal || !op.presentation?.decisionRef) return
    const message = `ondo-hk-wallet-proof:${op.operationId}:${op.presentation.decisionRef}`
    const prepared = await api.delegationPrepare(op.operationId, { userAddress: signer.address, signer: signer.kind, walletProof: { message, signature: await signPersonalMessage(signer, message) }, approvedProposalDigest: op.proposal.proposalDigest })
    setOp(prepared.result)
    const digest = await sha256Hex(fromBase64(prepared.txBytesB64))
    const userSignature = await signTransactionBytes(signer, prepared.txBytesB64)
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

  // Live CX QR requested by the visitor's browser (see hackathon-client).
  const [cxQr, setCxQr] = useState<CxBrowserQr | null>(null)
  const [cxQrError, setCxQrError] = useState<string | null>(null)
  const loadCxQr = () => run("cxqr", async () => {
    setCxQrError(null)
    try { setCxQr(await fetchCxBrowserQr()) } catch (e) { setCxQrError(e instanceof Error ? e.message : "unknown"); setCxQr(null) }
  })

  // ── autopilot ─────────────────────────────────────────────────────
  // Drives the same step actions a person would tap, one server phase at a time.
  // Stops (and hands back to the UI) on any error, on a real-provider handoff
  // (QR / Mobile ID app, Google zkLogin redirect) or when the chosen end is reached.
  const auto = detail.auto
  const [autoPaused, setAutoPaused] = useState(false)
  const autoFiredRef = useRef("")
  const autoReconcileRef = useRef(0)
  const autoActive = Boolean(auto) && !autoPaused && !error
  useEffect(() => {
    if (!autoActive || busy || !info || !config) return
    const key = op
      ? `${op.phase}:${op.status}:${op.identity?.handoff?.kind ?? ""}:${op.credential ? 1 : 0}:${op.presentation?.decision ?? ""}:${op.proposal ? 1 : 0}:${signer?.kind ?? ""}:${op.delegation?.status ?? ""}:${op.agent?.status ?? ""}:${op.fulfillment?.status ?? ""}`
      : `consent:${info.supported}:${info.redeemed ? 1 : 0}`
    if (autoFiredRef.current === key) return
    autoFiredRef.current = key
    if (!op) {
      // `info.redeemed` refers to the session's last verified subject; with one sample
      // person per operation the server decides at identity time, so start regardless.
      if (info.supported) { setConsent(true); start() }
      return
    }
    if (op.status !== "pending") {
      // done: poll the OmniOne outbox a few times until the record is confirmed
      if (op.phase === "done" && op.chain && (op.chain.status === "pending" || op.chain.status === "submitted" || op.chain.status === "unknown") && autoReconcileRef.current < 6) {
        autoReconcileRef.current += 1
        const t = window.setTimeout(() => { autoFiredRef.current = ""; reconcile() }, 2500)
        return () => window.clearTimeout(t)
      }
      return
    }
    switch (op.phase) {
      case "identity":
        if (!op.identity?.handoff) identityStart()
        // Real CX handoff needs a holder with that credential; autopilot takes the
        // clearly-labelled sample path so the rest of the journey can still be shown.
        else approveSample()
        break
      case "issuance":
        break // handled by the issuance effect above
      case "presentation":
        if (op.presentation?.decision !== "deny") present()
        break
      case "proposal":
        propose()
        break
      case "delegation":
        if (!op.proposal) break
        if (!signer) chooseSigner("demo") // zkLogin needs a Google redirect; autopilot uses the sample signer
        else if (signer.kind === "zklogin" && signer.jwtPending) break
        else if (op.delegation?.status !== "delegated") { setApprove(true); delegate() }
        break
      case "agent":
        if (op.agent?.status === "unknown") reconcile()
        else runAgent()
        break
      case "fulfillment":
        if (auto === "redeem" && op.fulfillment?.status !== "blocked") redeem()
        break
      default:
        break
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoActive, busy, info, config, op, signer])

  const stepIndex = op ? STEP_OF_PHASE[op.phase] ?? 0 : 0
  const modes = info?.modes ?? config?.modes ?? {}
  const tone = (m: string | undefined) => (m === "mock" || m === "rule" || m === "demo-signer" ? "sample" : m === "unconfigured" ? "sample" : "live")
  const stateOf = (i: number) => (op?.status === "cancelled" || op?.status === "failed" || op?.status === "expired" ? (i < stepIndex ? "done" : i === stepIndex ? "blocked" : "todo") : i < stepIndex ? "done" : i === stepIndex ? "current" : "todo")
  const title = useMemo(() => info?.campaign?.title?.[locale] ?? c.title, [info, locale, c.title])
  const stepMeta = stepIndex === 1 && op?.identity?.mode ? op.identity.mode.toUpperCase() : stepIndex === 5 && (signer?.kind ?? op?.delegation?.signer) ? (signer?.kind ?? op?.delegation?.signer) : ""

  return (
    <div ref={rootRef} className={styles.root} role="dialog" aria-modal="true" aria-label={c.title} data-testid="hackathon-layer" data-modal-layer-priority={ONDO_MODAL_PRIORITY.critical}>
      <div className={styles.sheet}>
        <header className={styles.head}>
          <div className={styles.headRow}>
            <h2>{title}</h2>
            <button type="button" className={styles.close} aria-label={c.close} onClick={() => close(true)}><X size={18} /></button>
          </div>
          <div className={styles.progress} role="group" aria-label={`${c.steps[stepIndex]} · ${stepIndex + 1}/${c.steps.length}`}>
            <div className={styles.progressLabel}><span><b>{c.steps[stepIndex]}</b>{stepMeta ? ` · ${stepMeta}` : ""}</span><span>{stepIndex + 1} / {c.steps.length}</span></div>
            <div className={styles.segments} aria-hidden="true">{c.steps.map((s, i) => <span key={s} className={styles.segment} data-state={stateOf(i)} />)}</div>
          </div>
          <div className={styles.chips} aria-label="modes">
            <span className={styles.badge} data-tone={op?.identity ? tone(op.identity.mode) : tone(modes.cx)}>ID {(op?.identity ? op.identity.mode === "cx" : modes.cx === "cx") ? c.live : c.sample}</span>
            <span className={styles.badge} data-tone={tone(modes.opendid)}>PASS {modes.opendid === "opendid" ? c.live : c.sample}</span>
            <span className={styles.badge} data-tone={modes.sui === "testnet" ? "chain" : "sample"}>SUI {modes.sui === "testnet" ? c.chain : "—"}</span>
            <span className={styles.badge} data-tone={modes.omnione === "stage" ? "chain" : "sample"}>OMNIONE {modes.omnione === "stage" ? "STAGE" : "—"}</span>
          </div>
        </header>
        <div className={styles.body}>
          {auto ? (
            <div className={styles.notice} data-tone={autoActive ? "ok" : undefined} data-testid="hackathon-autopilot">
              {autoActive
                ? (locale === "ko" ? `자동 실행 중 · ${auto === "redeem" ? "사용 확정까지" : "실행까지"} 진행합니다` : `Autopilot · running to ${auto === "redeem" ? "confirmation" : "execution"}`)
                : (locale === "ko" ? "자동 실행이 멈췄어요. 아래 버튼으로 직접 진행할 수 있어요." : "Autopilot paused. Continue with the buttons below.")}
              {" "}
              <button type="button" className={styles.ghost} onClick={() => { if (autoActive) setAutoPaused(true); else { setError(null); autoFiredRef.current = ""; setAutoPaused(false) } }} disabled={!!busy}>
                {autoActive ? (locale === "ko" ? "멈추기" : "Pause") : (locale === "ko" ? "다시 자동 실행" : "Resume")}
              </button>
            </div>
          ) : null}
          {error ? <div className={styles.notice} data-tone="error">{error}</div> : null}

          {!op ? (
            <section className={styles.card}>
              <h3>{c.consentTitle}</h3>
              <p>{info?.campaign?.description?.[locale] ?? c.consentBody}</p>
              {info?.redeemed ? <div className={styles.notice} data-tone="ok">{locale === "ko" ? `이미 사용한 혜택이에요 (${info.redeemed.redeemedAt.slice(0, 16).replace("T", " ")})` : `Already used (${info.redeemed.redeemedAt.slice(0, 16).replace("T", " ")})`}</div> : null}
              <label className={styles.check}><input type="checkbox" id="hk-consent" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> <span>{c.consentCheck}</span></label>
              <div className={styles.actions}><button type="button" className={styles.primary} disabled={!consent || !!busy || !info?.supported} onClick={start} data-testid="hackathon-start">{busy === "start" ? <span className={styles.spinner} /> : null}{c.start}</button><button type="button" className={styles.ghost} onClick={() => close(true)}>{c.back}</button></div>
            </section>
          ) : null}

          {op?.phase === "identity" ? (
            <section className={styles.card}>
              <h3>{c.steps[1]} <span className={styles.badge} data-tone={tone(modes.cx)}>{modes.cx === "cx" ? c.live : c.sample}</span></h3>
              {!op.identity?.handoff ? <>
                <p>{locale === "ko" ? "행안부 모바일 신분증(주민등록증·운전면허증)으로 본인 여부만 확인합니다. 생년월일 전체는 받지 않습니다." : "Verifies you with the government Mobile ID. Full date of birth is not received."}</p>
                <div className={styles.actions}><button type="button" className={styles.primary} disabled={!!busy} onClick={identityStart} data-testid="hackathon-identity-start">{c.startIdentity}</button><button type="button" className={styles.ghost} disabled={!!busy} onClick={cancel}>{c.cancel}</button></div>
              </> : op.identity.handoff.kind === "mock" ? <>
                <div className={styles.notice}>{op.identity.handoff.label} · {locale === "ko" ? "배포 서버가 CX에 접근할 수 없어 결과를 샘플로 대체합니다. 서버는 이 결과를 실제 신분증 결과로 표기하지 않습니다." : "The deployed server cannot reach CX, so the result is replaced by a sample; it is never labelled as a government ID result."}</div>
                {CX_BROWSER_QR ? (
                  <section className={styles.card} data-testid="hackathon-cx-browser-qr">
                    <h3>{c.cxQrTitle} <span className={styles.badge} data-tone="live">{c.live}</span></h3>
                    {cxQr ? <img className={styles.qr} alt="OmniOne CX QR" src={`data:image/png;base64,${cxQr.qrBase64}`} /> : null}
                    {cxQr ? <dl className={styles.kv}><dt>provider</dt><dd>{cxQr.provider}</dd><dt>cxId</dt><dd>{cxQr.cxId}</dd></dl> : null}
                    <div className={styles.notice}>{cxQrError ? `${c.cxQrFail} · ${cxQrError}` : c.cxQrNote}</div>
                    <div className={styles.actions}>
                      <button type="button" className={styles.secondary} disabled={busy === "cxqr"} onClick={loadCxQr} data-testid="hackathon-cx-qr-load">{busy === "cxqr" ? <span className={styles.spinner} /> : null}{c.cxQrLoad}</button>
                    </div>
                  </section>
                ) : null}
                <div className={styles.actions}>
                  <button type="button" className={styles.primary} disabled={!!busy} onClick={approveSample} data-testid="hackathon-identity-approve">{busy === "identity" ? <span className={styles.spinner} /> : null}{c.mockApprove}</button>
                </div>
                <div className={styles.actions}>
                  <button type="button" className={styles.secondary} disabled={!!busy} onClick={() => identityComplete({ outcome: "cancelled", subjectSeed: sampleSeed })}>{c.mockCancel}</button>
                  <button type="button" className={styles.secondary} disabled={!!busy} onClick={() => identityComplete({ outcome: "failed", subjectSeed: sampleSeed })}>{c.mockFail}</button>
                </div>
              </> : op.identity.handoff.kind === "qr" ? <>
                <img className={styles.qr} alt="Mobile ID QR" src={`data:image/png;base64,${op.identity.handoff.qrBase64}`} />
                <p>{c.identityWait}</p>
                <div className={styles.actions}><button type="button" className={styles.primary} disabled={!!busy} onClick={() => identityComplete()}>{c.fetchResult}</button><button type="button" className={styles.ghost} disabled={!!busy} onClick={cancel}>{c.cancel}</button></div>
                <div className={styles.notice}>{c.sampleNote}</div>
                <div className={styles.actions}><button type="button" className={styles.secondary} disabled={!!busy} onClick={approveSample} data-testid="hackathon-identity-sample">{c.sampleInstead}</button></div>
              </> : <>
                <div className={styles.actions}>
                  {op.identity.handoff.ssPayLink ? <a className={styles.primary} href={op.identity.handoff.ssPayLink}>Samsung Wallet</a> : null}
                  {op.identity.handoff.androidLink ? <a className={styles.secondary} href={op.identity.handoff.androidLink}>Mobile ID (Android)</a> : null}
                  {op.identity.handoff.iosLink ? <a className={styles.secondary} href={op.identity.handoff.iosLink}>Mobile ID (iOS)</a> : null}
                </div>
                <p>{c.identityWait}</p>
                <div className={styles.actions}><button type="button" className={styles.primary} disabled={!!busy} onClick={() => identityComplete()}>{c.fetchResult}</button><button type="button" className={styles.ghost} disabled={!!busy} onClick={cancel}>{c.cancel}</button></div>
                <div className={styles.notice}>{c.sampleNote}</div>
                <div className={styles.actions}><button type="button" className={styles.secondary} disabled={!!busy} onClick={approveSample} data-testid="hackathon-identity-sample">{c.sampleInstead}</button></div>
              </>}
            </section>
          ) : null}

          {op?.phase === "issuance" ? <section className={styles.card}><h3>{c.steps[2]} <span className={styles.badge} data-tone={tone(modes.opendid)}>{modes.opendid === "opendid" ? c.live : c.sample}</span></h3><p><span className={styles.spinner} />{c.issuing}</p>{op.credential ? <dl className={styles.kv}><dt>VC</dt><dd>{op.credential.vcId}</dd><dt>holder</dt><dd>{op.credential.holderBinding.slice(0, 18)}…</dd></dl> : null}{!busy && op.credential && !op.credential.holderAckAt ? <div className={styles.actions}><button type="button" className={styles.primary} onClick={issueAndAck}>{c.fetchResult}</button></div> : null}</section> : null}

          {op?.phase === "presentation" ? (
            <section className={styles.card}>
              <h3>{c.steps[3]}</h3>
              <p>{c.presentBody}</p>
              <dl className={styles.kv}><dt>{locale === "ko" ? "제시 항목" : "Claims"}</dt><dd>schemaVersion · personVerified · serviceAccess · validUntil · policyVersion · statusRef</dd><dt>{locale === "ko" ? "제시 안 함" : "Not shared"}</dt><dd>{locale === "ko" ? "이름 · 생년월일 · 국적 · 신분증 원문" : "name · DOB · nationality · ID original"}</dd></dl>
              {op.presentation?.decision === "deny" ? <div className={styles.notice} data-tone="error">{locale === "ko" ? `거절됨: ${op.presentation.denyReason}` : `Denied: ${op.presentation.denyReason}`}</div> : null}
              <div className={styles.actions}><button type="button" className={styles.primary} disabled={!!busy} onClick={present} data-testid="hackathon-present">{busy === "present" ? <span className={styles.spinner} /> : null}{c.present}</button><button type="button" className={styles.ghost} disabled={!!busy} onClick={deny}>{c.deny}</button></div>
            </section>
          ) : null}

          {op?.phase === "proposal" ? <section className={styles.card}><h3>{c.steps[4]} <span className={styles.badge} data-tone={tone(modes.ai)}>{modes.ai === "gemini" ? "GEMINI" : "RULE"}</span></h3><p>{locale === "ko" ? "도우미는 허용된 혜택 1개만 제안합니다. 자격 판정은 서버가 이미 끝냈고, 도우미는 금액·대상·계약을 바꿀 수 없습니다." : "The assistant proposes only the one allowed perk. Eligibility was decided by the server; the assistant cannot change amounts, targets or contracts."}</p><div className={styles.actions}><button type="button" className={styles.primary} disabled={!!busy} onClick={propose} data-testid="hackathon-propose">{busy === "propose" ? <span className={styles.spinner} /> : null}{c.propose}</button><button type="button" className={styles.ghost} disabled={!!busy} onClick={cancel}>{c.cancel}</button></div></section> : null}

          {op?.phase === "delegation" && op.proposal ? (
            <section className={styles.card}>
              <h3>{op.proposal.output.title}</h3>
              <p><b>{op.proposal.output.summary}</b></p>
              <p>{op.proposal.output.rationale}</p>
              <h3>{c.approveTitle}</h3>
              <p>{c.approveBody}</p>
              <dl className={styles.kv}>
                <dt>{locale === "ko" ? "행동" : "Action"}</dt><dd>{op.proposal.output.action}</dd>
                <dt>{locale === "ko" ? "대상" : "Target"}</dt><dd>{op.venueId} · {op.campaignId}</dd>
                <dt>{locale === "ko" ? "횟수" : "Uses"}</dt><dd>1</dd>
                <dt>{locale === "ko" ? "기한" : "Expires"}</dt><dd>{op.delegation ? new Date(op.delegation.expiresAtMs).toLocaleTimeString() : "≤ 10 min"}</dd>
                <dt>{locale === "ko" ? "수령 지갑" : "Recipient"}</dt><dd>{signer?.address ? signer.address.slice(0, 12) + "…" : "—"}</dd>
                <dt>{locale === "ko" ? "제안 digest" : "Proposal"}</dt><dd>{op.proposal.proposalDigest.slice(0, 22)}…</dd>
              </dl>
              {!signer || (signer.kind === "zklogin" && signer.jwtPending) ? <div className={styles.actions}>
                <button type="button" className={styles.primary} disabled={!!busy} onClick={() => chooseSigner("zklogin")}>{c.signerZk}</button>
                <button type="button" className={styles.secondary} disabled={!!busy} onClick={() => chooseSigner("demo")} data-testid="hackathon-signer-demo">{c.signerDemo}</button>
              </div> : <>
                <div className={styles.notice}>{signer.kind === "zklogin" ? `zkLogin · ${signer.address.slice(0, 16)}…` : `${c.sample} signer · ${signer.address.slice(0, 16)}…`}</div>
                <label className={styles.check}><input type="checkbox" id="hk-approve" checked={approve} onChange={(e) => setApprove(e.target.checked)} /> <span>{c.approveCheck}</span></label>
                <div className={styles.actions}><button type="button" className={styles.primary} disabled={!approve || !!busy} onClick={delegate} data-testid="hackathon-delegate">{busy === "delegate" ? <span className={styles.spinner} /> : null}{c.signDelegate}</button><button type="button" className={styles.ghost} disabled={!!busy} onClick={cancel}>{c.cancel}</button></div>
              </>}
            </section>
          ) : null}

          {op?.phase === "agent" ? <section className={styles.card}><h3>{c.steps[6]} <span className={styles.badge} data-tone="chain">SUI {c.chain}</span></h3><p>{locale === "ko" ? "위임된 권한 안에서 도우미가 1회 실행하고 결정·실행 기록을 남깁니다." : "The assistant executes once within the delegated scope and records its decision."}</p>{op.delegation?.grant ? <dl className={styles.kv}><dt>grant</dt><dd>{op.delegation.grant.objectId}</dd><dt>tx</dt><dd>{op.delegation.grant.txDigest}</dd></dl> : null}<div className={styles.actions}><button type="button" className={styles.primary} disabled={!!busy} onClick={runAgent} data-testid="hackathon-agent-run">{busy === "agent" ? <span className={styles.spinner} /> : null}{c.runAgent}</button><button type="button" className={styles.ghost} disabled={!!busy} onClick={reconcile}>{c.reconcile}</button></div></section> : null}

          {op?.phase === "fulfillment" ? <section className={styles.card}><h3>{c.steps[7]}</h3>{op.fulfillment?.status === "blocked" ? <div className={styles.notice} data-tone="error">{c.blocked} · {op.fulfillment.reason}</div> : <p>{locale === "ko" ? "실행 기록을 검증한 뒤 현재 자격을 다시 확인하고 1회 사용을 확정합니다." : "Verifies the execution, re-checks eligibility and confirms the single use."}</p>}<div className={styles.actions}>{op.fulfillment?.status !== "blocked" ? <button type="button" className={styles.primary} disabled={!!busy} onClick={redeem} data-testid="hackathon-redeem">{busy === "redeem" ? <span className={styles.spinner} /> : null}{c.redeem}</button> : null}<button type="button" className={styles.ghost} disabled={!!busy} onClick={reconcile}>{c.reconcile}</button></div></section> : null}

          {op && (op.phase === "done" || op.status !== "pending") ? (
            <section className={styles.card}>
              <h3>{op.fulfillment?.status === "redeemed" ? c.done : op.status === "cancelled" ? (locale === "ko" ? "그만두었어요" : "Stopped") : op.status === "expired" ? (locale === "ko" ? "만료됐어요" : "Expired") : c.blocked}</h3>
              {op.fulfillment?.redemptionRef ? <dl className={styles.kv}><dt>{locale === "ko" ? "사용 번호" : "Use ref"}</dt><dd>{op.fulfillment.redemptionRef}</dd><dt>{locale === "ko" ? "시각" : "At"}</dt><dd>{op.fulfillment.redeemedAt}</dd></dl> : null}
              {op.chain ? <div className={styles.notice} data-tone={op.chain.status === "confirmed" ? "ok" : undefined}><span className={styles.badge} data-tone="chain">OMNIONE</span> {op.chain.status === "confirmed" ? c.chainConfirmed : c.chainPending} · {op.chain.status}{op.chain.txHash ? ` · ${op.chain.txHash.slice(0, 18)}…` : ""}{op.chain.lastError ? ` · ${op.chain.lastError}` : ""}</div> : null}
              <div className={styles.actions}>
                {op.chain && op.chain.status !== "confirmed" ? <button type="button" className={styles.secondary} disabled={!!busy} onClick={reconcile}>{c.reconcile}</button> : null}
                <button type="button" className={styles.secondary} disabled={!!busy} onClick={loadEvidence}>{c.evidence}</button>
                <button type="button" className={styles.primary} onClick={() => close(true)} data-testid="hackathon-return">{c.back}</button>
              </div>
            </section>
          ) : null}

          {evidence ? <section className={styles.card}><h3>Evidence</h3><pre className={styles.evidence}>{JSON.stringify(evidence, null, 2)}</pre>{config?.sui.explorer && op?.agent?.txDigest ? <a className={styles.link} href={`${config.sui.explorer}/tx/${op.agent.txDigest}`} target="_blank" rel="noreferrer">Sui explorer · agent tx</a> : null}</section> : null}
        </div>
      </div>
    </div>
  )
}
