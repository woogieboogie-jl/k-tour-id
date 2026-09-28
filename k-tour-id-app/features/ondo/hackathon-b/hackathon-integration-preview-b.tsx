"use client"

import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react"
import { X } from "lucide-react"
import { B_DISCOVERY_TRAVERSAL_EVENT } from "../map/b-discovery-history"
import { ONDO_MODAL_PRIORITY } from "../shared/ui/modal-layer-priority"
import { useDocumentScrollLock, useModalIsolation } from "../shared/ui/use-modal-isolation"
import type { HackathonOpenDetail } from "./hackathon-campaign"
import styles from "./hackathon-b.module.css"
import accessStyles from "./hackathon-cx-preview-b.module.css"

const COPY = {
  ko: { title: "통합 체험 접근 확인", body: "안내받은 비공개 접근 코드를 입력해 주세요. 접근 확인은 신원 확인이나 실행 동의를 대신하지 않습니다.", code: "접근 코드", enter: "확인", close: "닫기", checking: "접근을 확인하고 있어요", denied: "접근 코드를 다시 확인해 주세요.", unavailable: "지금은 통합 체험을 열 수 없어요. 잠시 후 다시 확인해 주세요.", retry: "다시 확인" },
  en: { title: "Integration preview access", body: "Enter your private access code. Access does not replace identity verification or approval to execute.", code: "Access code", enter: "Continue", close: "Close", checking: "Checking access", denied: "Please check your access code.", unavailable: "The integration preview is unavailable. Please try again later.", retry: "Try again" },
  ja: { title: "統合体験へのアクセス", body: "案内された非公開アクセスコードを入力してください。アクセスの確認は本人確認や実行への同意を代替しません。", code: "アクセスコード", enter: "確認", close: "閉じる", checking: "アクセスを確認中です", denied: "アクセスコードを確認してください。", unavailable: "現在、統合体験を開けません。しばらくしてから再確認してください。", retry: "再確認" },
} as const

/** The unchanged Journey is not mounted until the server accepts its own
 * separate HttpOnly access cookie. No access code enters browser storage. */
export function HackathonIntegrationPreviewGate({ detail, onClose, children, hostedSui = false }: { detail: HackathonOpenDetail; onClose: () => void; children: ReactNode; hostedSui?: boolean }) {
  const [authorized, setAuthorized] = useState(false)
  const grant = useCallback(() => setAuthorized(true), [])
  return authorized ? children : <IntegrationAccessForm detail={detail} onClose={onClose} onGranted={grant} hostedSui={hostedSui} />
}

function IntegrationAccessForm({ detail, onClose, onGranted, hostedSui }: { detail: HackathonOpenDetail; onClose: () => void; onGranted: () => void; hostedSui: boolean }) {
  const c = COPY[detail.locale]
  const [status, setStatus] = useState<"checking" | "access" | "unavailable">("checking")
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [denied, setDenied] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const requestRef = useRef<AbortController | null>(null)
  const inFlight = useRef(false)
  useModalIsolation(true, rootRef)
  useDocumentScrollLock(true)

  const check = useCallback(async (signal: AbortSignal) => {
    const response = await fetch("/api/hackathon/v1/config", { credentials: "same-origin", cache: "no-store", signal })
    if (signal.aborted) return
    if (response.status === 401) { setStatus("access"); return }
    if (!response.ok) { setStatus("unavailable"); return }
    const config = await response.json()
    if (signal.aborted) return
    if (config.isolatedMock !== false || (hostedSui ? config.hostedSui !== true || config.modes?.sui !== "testnet" || config.modes?.opendid !== "mock" : config.modes?.cx !== "cx" || config.modes?.opendid !== "opendid")) { setStatus("unavailable"); return }
    onGranted()
  }, [onGranted, hostedSui])

  const retry = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    const controller = new AbortController()
    requestRef.current = controller
    const timeout = window.setTimeout(() => controller.abort(), 8000)
    setStatus("checking")
    try { await check(controller.signal) } catch { if (requestRef.current === controller) setStatus("unavailable") }
    finally { window.clearTimeout(timeout); if (requestRef.current === controller) { requestRef.current = null; inFlight.current = false } }
  }, [check])

  useEffect(() => {
    void retry()
    return () => { const active = requestRef.current; requestRef.current = null; active?.abort(); inFlight.current = false }
  }, [retry])
  useEffect(() => { if (status === "access") inputRef.current?.focus() }, [status])
  useEffect(() => {
    const traversal = () => onClose()
    window.addEventListener(B_DISCOVERY_TRAVERSAL_EVENT, traversal)
    return () => window.removeEventListener(B_DISCOVERY_TRAVERSAL_EVENT, traversal)
  }, [onClose])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (inFlight.current || !/^[A-Za-z0-9_-]{32,128}$/.test(code)) return
    inFlight.current = true
    setBusy(true); setDenied(false)
    const submittedCode = code
    setCode("")
    const controller = new AbortController()
    requestRef.current = controller
    const timeout = window.setTimeout(() => controller.abort(), 8000)
    try {
      const response = await fetch(hostedSui ? "/api/hackathon/v1/hosted/access" : "/api/hackathon/v1/integration/access", { method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ accessCode: submittedCode }), signal: controller.signal })
      if (controller.signal.aborted) return
      if (response.status === 401) { setDenied(true); return }
      if (!response.ok) { setStatus("unavailable"); return }
      // A response alone does not mount the journey: check the protected route
      // again so blocked/missing cookies fail closed, including external returns.
      await check(controller.signal)
    } catch { if (requestRef.current === controller) setStatus("unavailable") }
    finally { window.clearTimeout(timeout); if (requestRef.current === controller) { requestRef.current = null; inFlight.current = false; setBusy(false) } }
  }

  return <div ref={rootRef} className={styles.root} role="dialog" aria-modal="true" aria-labelledby="integration-preview-access-title" lang={detail.locale}
    data-testid="integration-preview-access" data-modal-layer-priority={ONDO_MODAL_PRIORITY.critical}
    onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onClose() } }}>
    <div className={styles.sheet}>
      <header className={styles.head}><div className={styles.headRow}><h2 id="integration-preview-access-title">{c.title}</h2><button type="button" className={styles.close} aria-label={c.close} onClick={onClose}><X size={18} aria-hidden="true" /></button></div></header>
      <div className={styles.body}><section className={styles.card}>
        {status === "checking" ? <p role="status">{c.checking}</p> : status === "unavailable" ? <><p role="status">{c.unavailable}</p><button type="button" className={styles.primary} onClick={() => void retry()}>{c.retry}</button></> : <>
          <p>{c.body}</p><form onSubmit={submit}>
            <label className={accessStyles.accessField}><span>{c.code}</span><input ref={inputRef} className={accessStyles.accessInput} type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} minLength={32} maxLength={128}
              data-testid="integration-preview-access-code" value={code} onChange={event => setCode(event.target.value)} disabled={busy} /></label>
            <div className={styles.actions}><button className={styles.primary} type="submit" data-testid="integration-preview-access-submit" disabled={busy || !/^[A-Za-z0-9_-]{32,128}$/.test(code)}>{c.enter}</button></div>
          </form>{denied ? <p role="alert" className={styles.notice} data-tone="error">{c.denied}</p> : null}
        </>}
      </section></div>
    </div>
  </div>
}
