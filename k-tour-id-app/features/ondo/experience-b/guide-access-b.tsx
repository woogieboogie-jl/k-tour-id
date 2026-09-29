"use client"

import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react"
import { SheetB } from "../shared/ui/sheet-b"
import { ONDO_MODAL_PRIORITY } from "../shared/ui/modal-layer-priority"
import type { HackathonOpenDetail } from "../hackathon-b/hackathon-campaign"
import { guideAccessEndpointB, validGuideConfigB, type GuideAccessProfileB } from "./guide-access-contract-b"
import { requestExperienceB } from "./experience-model-b"
import styles from "./experience-b.module.css"

const COPY = {
  ko: { title: "가이드 저장 접근", checking: "저장 접근을 확인하고 있어요", body: "안내받은 접근 코드를 입력해 주세요. 신원 확인과 저장 승인은 다음 단계에서 따로 진행해요.", code: "접근 코드", submit: "계속", denied: "접근 코드를 다시 확인해 주세요.", unavailable: "저장 연결을 확인하지 못했어요. 같은 화면에서 다시 확인하거나 가이드를 계속 읽어 주세요.", retry: "접근 다시 확인", read: "가이드 계속 읽기" },
  en: { title: "Access guide saving", checking: "Checking access to saving", body: "Enter the access code you were given. Identity verification and saving approval happen separately in the next steps.", code: "Access code", submit: "Continue", denied: "Please check your access code.", unavailable: "We couldn’t confirm the saving connection. Check again here or keep reading the guide.", retry: "Check access again", read: "Keep reading" },
  ja: { title: "ガイド保存へのアクセス", checking: "保存へのアクセスを確認しています", body: "案内されたアクセスコードを入力してください。本人確認と保存の承認は、次のステップで別途行います。", code: "アクセスコード", submit: "続ける", denied: "アクセスコードを確認してください。", unavailable: "保存への接続を確認できませんでした。この画面で再確認するか、ガイドを読み続けてください。", retry: "アクセスを再確認", read: "ガイドを読み続ける" },
} as const

/** Dedicated guide boundary: never selects another gate after denial/failure.
 * Access codes stay in transient input state; the server owns its HttpOnly cookie. */
export function GuideAccessGateB({ profile, detail, onClose, children, requiresAccessRecheck = false }: { profile: GuideAccessProfileB; detail: HackathonOpenDetail; onClose(restore?: boolean): void; children: ReactNode; requiresAccessRecheck?: boolean }) {
  const t = COPY[detail.locale]
  const [status, setStatus] = useState<"checking" | "code" | "unavailable" | "recheck" | "authorized">(requiresAccessRecheck ? "recheck" : "checking")
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [denied, setDenied] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const requestRef = useRef<AbortController | null>(null)
  const inFlight = useRef(false)
  const check = useCallback(async (controller: AbortController) => {
    const response = await fetch("/api/hackathon/v1/config", { credentials: "same-origin", cache: "no-store", signal: controller.signal })
    if (requestRef.current !== controller || controller.signal.aborted) return
    if (response.status === 401) { setStatus("code"); return }
    if (!response.ok) { setStatus("unavailable"); return }
    const config = await response.json()
    if (requestRef.current !== controller || controller.signal.aborted) return
    setStatus(validGuideConfigB(config, profile) ? "authorized" : "unavailable")
  }, [profile])
  const execute = useCallback(async (submittedCode?: string) => {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setDenied(false)
    const controller = new AbortController(); requestRef.current = controller
    const timeout = window.setTimeout(() => controller.abort(), 8000)
    if (submittedCode === undefined) setStatus("checking")
    try {
      if (submittedCode !== undefined) {
        const response = await fetch(guideAccessEndpointB(profile), { method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal,
          headers: { "content-type": "application/json" }, body: JSON.stringify({ accessCode: submittedCode }) })
        if (requestRef.current !== controller || controller.signal.aborted) return
        if (response.status === 401) { setDenied(true); setStatus("code"); return }
        if (!response.ok) { setStatus("unavailable"); return }
      }
      // A successful POST without a usable cookie/config never grants the view.
      await check(controller)
    } catch { if (requestRef.current === controller) setStatus("unavailable") }
    finally { window.clearTimeout(timeout); if (requestRef.current === controller) { requestRef.current = null; inFlight.current = false; setBusy(false) } }
  }, [check, profile])
  useEffect(() => { if (!requiresAccessRecheck) void execute(); return () => { const active = requestRef.current; requestRef.current = null; active?.abort(); inFlight.current = false } }, [execute, requiresAccessRecheck])
  useEffect(() => { if (status === "code") inputRef.current?.focus() }, [status])
  if (status === "authorized") return children
  const read = () => { onClose(); window.setTimeout(() => requestExperienceB(detail.venueId, detail.returnTo === "pass" ? "pass" : "place"), 180) }
  const submit = (event: FormEvent) => { event.preventDefault(); if (!/^[A-Za-z0-9_-]{32,128}$/.test(code) || inFlight.current) return; const value = code; setCode(""); void execute(value) }
  const recheckCopy = detail.locale === "ko" ? "저장 접근을 다시 확인해 주세요. 진행 중인 요청을 새로 만들거나 실행하지 않아요." : detail.locale === "ja" ? "保存へのアクセスを再確認してください。進行中の要求を作り直したり、再実行したりはしません。" : "Please check access again. Your pending request will not be recreated or executed again."
  return <SheetB locale={detail.locale} label={t.title} header={t.title} variant="decision" modalPriority={ONDO_MODAL_PRIORITY.critical} onClose={onClose}
    footer={<div className={styles.footer}><button type="button" className={styles.secondary} onClick={read} data-testid="guide-access-keep-reading">{t.read}</button></div>}>
    <section className={styles.body} data-testid="guide-access" data-profile={profile} data-state={status}>
      {status === "checking" ? <p role="status">{t.checking}</p> : status === "unavailable" || status === "recheck" ? <><p role={status === "recheck" ? "status" : "alert"}>{status === "recheck" ? recheckCopy : t.unavailable}</p><button type="button" className={styles.primary} onClick={() => void execute()} disabled={busy} data-testid="guide-access-retry">{t.retry}</button></> : <>
        <p className={styles.lead}>{t.body}</p>
        <form onSubmit={submit}>
          <label className={styles.accessField}><span>{t.code}</span><input ref={inputRef} type="password" value={code} onChange={event => setCode(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} minLength={32} maxLength={128} disabled={busy} data-testid="guide-access-code" /></label>
          <button type="submit" className={styles.primary} disabled={busy || !/^[A-Za-z0-9_-]{32,128}$/.test(code)} data-testid="guide-access-submit">{t.submit}</button>
        </form>
        {denied ? <p role="alert">{t.denied}</p> : null}
      </>}
    </section>
  </SheetB>
}
