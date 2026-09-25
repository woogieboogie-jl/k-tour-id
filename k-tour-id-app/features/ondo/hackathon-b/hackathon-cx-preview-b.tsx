"use client"

import { FormEvent, useCallback, useEffect, useRef, useState } from "react"
import { X } from "lucide-react"
import type { OperationResult } from "@/lib/hackathon/types"
import { requestPlaceServiceReturnB } from "../commerce-b/place-service-registry-b"
import { B_DISCOVERY_TRAVERSAL_EVENT } from "../map/b-discovery-history"
import { ONDO_MODAL_PRIORITY } from "../shared/ui/modal-layer-priority"
import { useDocumentScrollLock, useModalIsolation } from "../shared/ui/use-modal-isolation"
import type { HackathonOpenDetail } from "./hackathon-campaign"
import { api, ApiError, type PublicConfig } from "./hackathon-client"
import styles from "./hackathon-b.module.css"
import cxStyles from "./hackathon-cx-preview-b.module.css"

type Locale = "ko" | "en" | "ja"
type Status = "checking" | "access" | "consent" | "identity" | "success" | "error"
const COPY = {
  ko: { title: "Mobile ID 확인", access: "Preview 접근", accessBody: "승인된 테스트 접근 코드를 입력해 주세요.", code: "접근 코드", enter: "확인", consent: "실제 신원 확인을 시작하기 전", consentBody: "이 확인은 이 장소에서 사용할 수 있는지 판단하기 위한 Mobile ID 확인입니다. 패스 발급, AI 제안, 서명, 체인 실행은 시작하지 않습니다.", agree: "내용을 확인했습니다.", begin: "확인 단계로", start: "모바일 신분증 확인 시작", chooseQr: "QR로 확인", chooseApp: "앱으로 확인", qr: "Mobile ID 앱에서 QR을 스캔해 주세요.", app: "Mobile ID 앱 열기", wait: "앱에서 확인을 마친 뒤 결과를 확인해 주세요.", check: "결과 확인", pending: "아직 완료되지 않았어요. 앱에서 확인을 끝낸 뒤 다시 확인해 주세요.", expired: "확인 시간이 만료됐어요. 다시 시작해 주세요.", success: "신원 확인이 완료됐어요", successBody: "서버가 Mobile ID 결과를 확인했습니다. 이 Preview는 여기서 멈추며 혜택이나 패스를 확정하지 않습니다.", close: "같은 장소로 돌아가기", cancel: "취소", retry: "다시 시도", error: "확인을 시작하지 못했어요", retryAccess: "다시 확인", loading: "연결을 확인하고 있어요" },
  en: { title: "Mobile ID check", access: "Preview access", accessBody: "Enter the approved test access code.", code: "Access code", enter: "Continue", consent: "Before the real identity check", consentBody: "This checks Mobile ID eligibility for this place. It does not issue a pass or start AI, signing, chain or benefit execution.", agree: "I understand.", begin: "Continue to check", start: "Start Mobile ID check", chooseQr: "Use QR", chooseApp: "Use app", qr: "Scan this QR in the Mobile ID app.", app: "Open Mobile ID app", wait: "Finish in the app, then request the result.", check: "Check result", pending: "The check is not complete yet. Finish in the app, then try again.", expired: "The check expired. Start again.", success: "Identity check complete", successBody: "The server verified the Mobile ID result. This Preview stops here; no perk or pass is confirmed.", close: "Return to this place", cancel: "Cancel", retry: "Try again", error: "The check could not start", retryAccess: "Try again", loading: "Checking the connection" },
  ja: { title: "Mobile ID確認", access: "Previewへのアクセス", accessBody: "承認されたテスト用アクセスコードを入力してください。", code: "アクセスコード", enter: "確認", consent: "実際の本人確認を始める前に", consentBody: "この場所で利用できるかを確認するMobile ID確認です。パス発行、AI、署名、チェーン、特典実行は開始しません。", agree: "内容を確認しました。", begin: "確認へ進む", start: "Mobile ID確認を開始", chooseQr: "QRで確認", chooseApp: "アプリで確認", qr: "Mobile IDアプリでQRを読み取ってください。", app: "Mobile IDアプリを開く", wait: "アプリで確認後、結果を確認してください。", check: "結果を確認", pending: "まだ完了していません。アプリで確認後、もう一度お試しください。", expired: "確認の有効時間が切れました。もう一度開始してください。", success: "本人確認が完了しました", successBody: "サーバーがMobile IDの結果を確認しました。このPreviewはここで終了し、特典やパスは確定しません。", close: "同じ場所に戻る", cancel: "キャンセル", retry: "もう一度試す", error: "確認を開始できませんでした", retryAccess: "もう一度確認", loading: "接続を確認中です" },
} as const

function safeLink(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 16_384) return null
  try { const url = new URL(value); return ["javascript:", "data:", "vbscript:", "file:"].includes(url.protocol) ? null : value } catch { return null }
}

export function HackathonCxPreviewB({ detail, onClose }: { detail: HackathonOpenDetail; onClose: () => void }) {
  const c = COPY[detail.locale]
  const closeLabel = { ko: "닫기", en: "Close", ja: "閉じる" }[detail.locale]
  const [status, setStatus] = useState<Status>("checking")
  const [config, setConfig] = useState<PublicConfig | null>(null)
  const [operation, setOperation] = useState<OperationResult | null>(null)
  const [accessCode, setAccessCode] = useState("")
  const [consent, setConsent] = useState(false)
  const [mobileChoice, setMobileChoice] = useState<boolean | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const rootRef = useRef<HTMLDivElement>(null)
  const closedRef = useRef(false)
  const loadVersionRef = useRef(0)
  useModalIsolation(true, rootRef)
  useDocumentScrollLock(true)

  const dismiss = useCallback((returnToPlace: boolean) => {
    if (closedRef.current) return
    closedRef.current = true
    loadVersionRef.current += 1
    onClose()
    if (returnToPlace) window.setTimeout(() => requestPlaceServiceReturnB(detail.venueId, "offer"), 30)
  }, [detail.venueId, onClose])
  const close = useCallback(() => dismiss(true), [dismiss])

  useEffect(() => {
    closedRef.current = false
    return () => { closedRef.current = true; loadVersionRef.current += 1 }
  }, [])

  useEffect(() => {
    // Discovery Back/Forward already chose its destination. Do not navigate
    // back to this place, cancel the server operation, or apply a late response.
    const leave = () => dismiss(false)
    window.addEventListener(B_DISCOVERY_TRAVERSAL_EVENT, leave)
    window.addEventListener("popstate", leave)
    return () => {
      window.removeEventListener(B_DISCOVERY_TRAVERSAL_EVENT, leave)
      window.removeEventListener("popstate", leave)
    }
  }, [dismiss])

  const applyOperation = useCallback((next: OperationResult | null, checkingResult = false) => {
    if (closedRef.current) return
    const expired = next?.status === "expired" || Boolean(next?.expiresAt && Date.parse(next.expiresAt) <= Date.now())
    if (!next || expired || next.status === "cancelled" || next.status === "failed") {
      setOperation(null); setConsent(false); setMobileChoice(null)
      setError(expired ? c.expired : next?.status === "failed" ? c.error : "")
      setStatus("consent")
      return
    }
    setOperation(next)
    setError("")
    // A create retry can return an existing verified operation. CX-only stops
    // here even though the full journey remains pending in the issuance phase.
    if ((next.status === "pending" || next.status === "succeeded") && next.identity?.mode === "cx" && next.identity.personVerified && !next.identity.handoff) {
      setStatus("success")
    } else if (next.status === "pending" && next.phase === "identity") {
      setStatus("identity")
      if (next.error) setError(next.error.code.includes("expired") ? c.expired : c.error)
      else if (checkingResult && next.identity?.handoff) setError(c.pending)
    } else {
      setError(c.error); setStatus("error")
    }
  }, [c.error, c.expired, c.pending])

  const applyRequestError = useCallback((errorValue: unknown, fallback: string = c.error) => {
    if (closedRef.current) return
    if (errorValue instanceof ApiError && errorValue.status === 401) {
      setError("")
      setStatus("access")
      return
    }
    setError(fallback)
  }, [c.error])

  const authorizedLoad = useCallback(async () => {
    const version = ++loadVersionRef.current
    const next = await api.config()
    const preview = next as PublicConfig & { cxPreview?: boolean }
    if (preview.cxPreview !== true || next.isolatedMock !== false || next.modes?.cx !== "cx") throw new Error("cx_preview_unexpected_config")
    await api.session()
    const ent = await api.entitlements(detail.venueId)
    // Reload does not auto-open or persist a browser operation marker. Reopen
    // the place CTA to resume only the session-bound state returned by the BFF.
    const resumed = ent.operation ? await api.get(ent.operation.operationId) : null
    if (!closedRef.current && version === loadVersionRef.current) {
      setConfig(next)
      applyOperation(resumed)
    }
  }, [detail.venueId, applyOperation])

  useEffect(() => {
    let active = true
    authorizedLoad().catch(errorValue => {
      if (!active) return
      applyRequestError(errorValue, c.error)
      if (!(errorValue instanceof ApiError && errorValue.status === 401)) setStatus("error")
    })
    return () => { active = false; loadVersionRef.current += 1 }
  }, [authorizedLoad, applyRequestError])

  const submitAccess = async (event: FormEvent) => {
    event.preventDefault(); if (busy || !accessCode.trim()) return
    setBusy(true); setError("")
    try {
      const response = await fetch("/api/hackathon/v1/preview/access", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ accessCode }), cache: "no-store" })
      if (response.status === 401) throw new ApiError("cx_preview_access_denied", "Access denied", 401, false)
      if (!response.ok) throw new Error("access_unavailable")
      await authorizedLoad()
      if (!closedRef.current) setAccessCode("")
    } catch (errorValue) { applyRequestError(errorValue, c.retryAccess) } finally { if (!closedRef.current) setBusy(false) }
  }

  const createOperation = async () => {
    if (!consent || busy || !config) return
    setBusy(true); setError("")
    try { applyOperation(await api.create(detail.venueId, config.consentVersion, detail.locale)) }
    catch (errorValue) { applyRequestError(errorValue) }
    finally { if (!closedRef.current) setBusy(false) }
  }
  const startIdentity = async () => {
    if (!operation || busy || mobileChoice === null) return
    setBusy(true); setError("")
    try { applyOperation(await api.identityStart(operation.operationId, mobileChoice)) }
    catch (errorValue) { applyRequestError(errorValue) }
    finally { if (!closedRef.current) setBusy(false) }
  }
  const completeIdentity = async () => {
    if (!operation || busy) return
    if (operation.identity?.handoff && Date.parse(operation.identity.handoff.expiresAt) <= Date.now()) {
      setNow(Date.now()); setError(c.expired); return
    }
    setBusy(true); setError("")
    try {
      applyOperation(await api.identityComplete(operation.operationId), true)
    } catch (errorValue) { applyRequestError(errorValue) }
    finally { if (!closedRef.current) setBusy(false) }
  }
  const cancel = async () => {
    if (busy) return
    setBusy(true); setError("")
    try {
      if (operation && operation.status === "pending") await api.cancel(operation.operationId)
      applyOperation(null)
    } catch (errorValue) { applyRequestError(errorValue) } finally { if (!closedRef.current) setBusy(false) }
  }
  const retryLoad = async () => {
    if (busy) return
    setBusy(true); setStatus("checking"); setError("")
    try { await authorizedLoad() }
    catch (errorValue) {
      applyRequestError(errorValue)
      if (!(errorValue instanceof ApiError && errorValue.status === 401) && !closedRef.current) setStatus("error")
    }
    finally { if (!closedRef.current) setBusy(false) }
  }

  const handoff = operation?.identity?.handoff
  const handoffExpiry = handoff?.expiresAt
  useEffect(() => {
    if (!handoffExpiry) return
    const deadline = Date.parse(handoffExpiry)
    let timer: number | undefined
    const refresh = () => {
      window.clearTimeout(timer)
      const current = Date.now()
      if (closedRef.current) return
      setNow(current)
      if (Number.isFinite(deadline) && deadline > current) {
        timer = window.setTimeout(refresh, Math.min(deadline - current + 1, 2_147_000_000))
      }
    }
    // Suspended mobile tabs may miss their timer; returning from the native app
    // refreshes expiry locally without starting or completing a provider check.
    refresh()
    window.addEventListener("focus", refresh)
    window.addEventListener("pageshow", refresh)
    document.addEventListener("visibilitychange", refresh)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener("focus", refresh)
      window.removeEventListener("pageshow", refresh)
      document.removeEventListener("visibilitychange", refresh)
    }
  }, [handoffExpiry])
  const qr = handoff?.kind === "qr" ? handoff.qrBase64 : null
  const android = handoff?.kind === "app" ? safeLink(handoff.androidLink) : null
  const ios = handoff?.kind === "app" ? safeLink(handoff.iosLink) : null
  const ssPay = handoff?.kind === "app" ? safeLink(handoff.ssPayLink) : null
  const handoffExpired = Boolean(handoffExpiry && (!Number.isFinite(Date.parse(handoffExpiry)) || Date.parse(handoffExpiry) <= now))
  return <div ref={rootRef} className={styles.root} role="dialog" aria-modal="true" aria-label={c.title} lang={detail.locale} data-testid="hackathon-cx-preview" data-status={status} data-modal-layer-priority={ONDO_MODAL_PRIORITY.critical} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); close() } }}>
    <div className={styles.sheet}>
      <header className={styles.head}><div className={styles.headRow}><h2>{c.title}</h2><button type="button" className={styles.close} aria-label={closeLabel} onClick={close}><X size={18} aria-hidden="true" /></button></div><span className={`${styles.badge} ${cxStyles.badge}`} data-tone="live">CX · IDENTITY ONLY</span></header>
      <div className={styles.body}>
        {status === "checking" ? <section className={styles.card}><h3>{c.loading}</h3></section> : null}
        {status === "access" ? <section className={styles.card}><h3>{c.access}</h3><p>{c.accessBody}</p><form onSubmit={submitAccess}><label className={cxStyles.accessField}><span>{c.code}</span><input className={cxStyles.accessInput} type="password" maxLength={128} autoComplete="off" value={accessCode} onChange={event => setAccessCode(event.target.value)} /></label><div className={styles.actions}><button className={styles.primary} type="submit" disabled={busy || !accessCode.trim()}>{c.enter}</button></div></form>{error ? <p className={styles.notice} data-tone="error">{error}</p> : null}</section> : null}
        {status === "consent" ? <section className={styles.card}><h3>{c.consent}</h3><p>{c.consentBody}</p><label className={styles.check}><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} /><span>{c.agree}</span></label><div className={styles.actions}><button className={styles.primary} type="button" disabled={!consent || busy} onClick={createOperation}>{c.begin}</button><button className={styles.ghost} type="button" onClick={close}>{c.cancel}</button></div>{error ? <p className={styles.notice} data-tone="error">{error}</p> : null}</section> : null}
        {status === "identity" && operation && !handoff ? <section className={styles.card}><h3>{c.start}</h3><p>{c.consentBody}</p><div className={styles.actions}><button className={mobileChoice === false ? styles.primary : styles.secondary} type="button" disabled={busy} onClick={() => setMobileChoice(false)}>{c.chooseQr}</button><button className={mobileChoice === true ? styles.primary : styles.secondary} type="button" disabled={busy} onClick={() => setMobileChoice(true)}>{c.chooseApp}</button></div><div className={styles.actions}><button className={styles.primary} type="button" disabled={busy || mobileChoice === null} onClick={startIdentity}>{c.start}</button><button className={styles.ghost} type="button" disabled={busy} onClick={cancel}>{c.cancel}</button></div>{error ? <p className={styles.notice} data-tone="error">{error}</p> : null}</section> : null}
        {status === "identity" && operation && handoff ? <section className={styles.card}><h3>{c.wait}</h3>{qr ? <><img className={styles.qr} alt={c.qr} src={`data:image/png;base64,${qr}`} /><p>{c.qr}</p></> : <div className={styles.actions}>{android ? <a className={styles.secondary} href={android}>{c.app} · Android</a> : null}{ios ? <a className={styles.secondary} href={ios}>{c.app} · iOS</a> : null}{ssPay && !android && !ios ? <a className={styles.secondary} href={ssPay}>{c.app}</a> : null}</div>}<p>{handoffExpired ? c.expired : c.wait}</p><div className={styles.actions}><button className={styles.primary} type="button" disabled={busy || handoffExpired} onClick={completeIdentity}>{c.check}</button><button className={styles.ghost} type="button" disabled={busy} onClick={cancel}>{c.cancel}</button></div>{error ? <p className={styles.notice} data-tone="error">{error}</p> : null}</section> : null}
        {status === "success" ? <section className={styles.card}><h3>{c.success}</h3><p>{c.successBody}</p><div className={styles.actions}><button className={styles.primary} type="button" onClick={close}>{c.close}</button></div></section> : null}
        {status === "error" ? <section className={styles.card}><h3>{c.error}</h3><p className={styles.notice} data-tone="error">{error}</p><div className={styles.actions}><button className={styles.primary} type="button" disabled={busy} onClick={retryLoad}>{c.retry}</button><button className={styles.ghost} type="button" onClick={close}>{c.cancel}</button></div></section> : null}
      </div>
    </div>
  </div>
}
