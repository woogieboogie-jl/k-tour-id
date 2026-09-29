"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import qrcode from "qrcode-generator"
import { isGuideJourney } from "@/lib/hackathon/guide-contract"
import type { OperationResult } from "@/lib/hackathon/types"
import styles from "./hackathon-b.module.css"

type ProviderView = { phase: "issuance" | "presentation" | "allowed" | "denied" | "failed" | "cancelled" | "expired"; offer: { qrPayload: string } | null }
type ProviderAction = "issuance/start" | "issuance/refresh" | "presentation/start" | "presentation/refresh" | "cancel"
const COPY = {
  ko: { issuance: "패스를 받아 보관해 주세요", presentation: "필요한 확인 결과만 제시해요", start: "신분증 앱 요청 열기", instruction: "연결된 신분증 앱에서 QR을 스캔하고 요청을 확인해 주세요. 마친 뒤 이 화면에서 결과를 확인해요.", noOffer: "앱에서 요청을 확인한 뒤 결과를 새로고침해 주세요.", refresh: "결과 확인", cancel: "요청 중단", waiting: "앱의 확인 결과를 기다리고 있어요", denied: "제시가 승인되지 않았어요. 저장은 진행하지 않았어요.", failed: "요청을 완료하지 못했어요. 같은 요청의 결과를 확인해 주세요.", expired: "요청 시간이 지났어요. 저장은 진행하지 않았어요.", cancelled: "요청을 중단했어요", unavailable: "연결 상태를 확인하지 못했어요. 같은 요청의 결과를 다시 확인해 주세요.", qr: "신분증 앱 제출 요청 QR", details: "연결 안내", sameDevice: "이 화면에서 신분증 앱이 자동으로 열리지는 않아요. QR을 읽을 수 있는 연결된 신분증 앱이 필요해요." },
  en: { issuance: "Receive and keep your pass", presentation: "Present only the needed check result", start: "Open ID app request", instruction: "Scan this QR with the connected ID app and review the request. Return here to check the result.", noOffer: "After reviewing the request in your ID app, check its result here.", refresh: "Check result", cancel: "Stop request", waiting: "Waiting for the app’s confirmation", denied: "Presentation was declined. Nothing was saved.", failed: "The request did not finish. Check this same request’s result.", expired: "The request expired. Nothing was saved.", cancelled: "Request stopped", unavailable: "We couldn’t confirm the connection. Check this same request again.", qr: "ID app presentation request QR", details: "Connection details", sameDevice: "This screen does not open an ID app automatically. You need a connected ID app that can scan this QR." },
  ja: { issuance: "パスを受け取り、保管してください", presentation: "必要な確認結果だけを提示します", start: "身分証アプリへの要求を開く", instruction: "接続された身分証アプリでQRを読み取り、要求を確認してください。完了後、この画面で結果を確認します。", noOffer: "身分証アプリで要求を確認した後、この画面で結果を確認してください。", refresh: "結果を確認", cancel: "要求を中止", waiting: "アプリでの確認を待っています", denied: "提示は承認されませんでした。保存は行っていません。", failed: "要求を完了できませんでした。同じ要求の結果を確認してください。", expired: "要求の期限が切れました。保存は行っていません。", cancelled: "要求を中止しました", unavailable: "接続を確認できませんでした。同じ要求の結果を再確認してください。", qr: "身分証アプリ提示要求のQR", details: "接続について", sameDevice: "この画面から身分証アプリは自動で開きません。このQRを読み取れる接続済みの身分証アプリが必要です。" },
} as const

/** Ephemeral provider offer only. No QR, VC, issuer transaction or personal
 * claims enter browser persistence, and no mock holder acknowledgement exists. */
export function GuideProviderStepB({ operation, locale, onOperation, onAccessRequired }: { operation: OperationResult; locale: "ko" | "en" | "ja"; onOperation(value: OperationResult): void; onAccessRequired?(operationId: string): void }) {
  const t = COPY[locale]
  const phase = operation.phase === "issuance" ? "issuance" : "presentation"
  const [view, setView] = useState<ProviderView | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const inFlight = useRef(false)
  const requestRef = useRef<AbortController | null>(null)
  useEffect(() => () => { const active = requestRef.current; requestRef.current = null; active?.abort() }, [])
  const request = async (action: ProviderAction) => {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError(false)
    const controller = new AbortController()
    requestRef.current = controller
    const timer = window.setTimeout(() => controller.abort(), 15000)
    try {
      const response = await fetch(`/api/hackathon/v1/operations/${encodeURIComponent(operation.operationId)}/provider/${action}`, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" }, body: "{}", signal: controller.signal })
      if (requestRef.current !== controller || controller.signal.aborted) throw new Error("provider_request_closed")
      if (response.status === 401 && requestRef.current === controller) { setView(null); if (onAccessRequired) onAccessRequired(operation.operationId); else setError(true); return }
      if (!response.ok) throw new Error("provider_unavailable")
      const result = await response.json() as { operation: OperationResult; provider: ProviderView }
      if (requestRef.current !== controller || controller.signal.aborted) throw new Error("provider_request_closed")
      if (!isGuideJourney(result.operation) || result.operation.execution !== "provider" || result.operation.identity?.mode === "mock" || result.operation.identity?.handoff?.kind === "mock" || result.operation.credential?.mode === "mock" || result.operation.operationId !== operation.operationId || !result.provider || !["issuance", "presentation", "allowed", "denied", "failed", "cancelled", "expired"].includes(result.provider.phase)) throw new Error("provider_mismatch")
      if (result.provider.offer && (typeof result.provider.offer.qrPayload !== "string" || result.provider.offer.qrPayload.length > 8192)) throw new Error("provider_offer_invalid")
      if (requestRef.current === controller) { setView(result.provider); onOperation(result.operation) }
    } catch { if (requestRef.current === controller) setError(true) }
    finally { window.clearTimeout(timer); if (requestRef.current === controller) { requestRef.current = null; inFlight.current = false; setBusy(false) } }
  }
  const qr = useMemo(() => {
    if (!view?.offer?.qrPayload) return null
    try { const code = qrcode(0, "M"); code.addData(view.offer.qrPayload); code.make(); return code.createDataURL(5, 12) } catch { return null }
  }, [view?.offer?.qrPayload])
  const qrFailed = Boolean(view?.offer && !qr)
  const qrError = locale === "ko" ? "QR을 표시하지 못했어요. 앱 연결은 시작되지 않았어요. 같은 요청의 결과를 확인하거나 요청을 중단해 주세요." : locale === "ja" ? "QRを表示できませんでした。アプリへの引き渡しは完了していません。同じ要求の結果を確認するか、中止してください。" : "The QR could not be displayed. App handoff is not complete. Check the same request or stop it."
  const status = view && ["denied", "failed", "expired", "cancelled"].includes(view.phase) ? t[view.phase as "denied" | "failed" | "expired" | "cancelled"] : t.waiting
  return <section className={styles.card} data-testid="guide-provider-step" data-provider-phase={phase}>
    <h3>{t[phase]}</h3>
    {view ? <><p role="status">{status}</p>{qr ? <><img className={styles.qr} alt={t.qr} src={qr} /><p>{t.instruction}</p></> : qrFailed ? <p role="alert" className={styles.notice}>{qrError}</p> : <p>{t.noOffer}</p>}</> : <p>{t.sameDevice}</p>}
    {error ? <p role="alert" className={styles.notice}>{t.unavailable}</p> : null}
    <div className={styles.actions}>
      {!view && !error ? <button type="button" className={styles.primary} disabled={busy} onClick={() => void request(`${phase}/start`)} data-testid="guide-provider-start">{t.start}</button> : null}
      <button type="button" className={view ? styles.primary : styles.secondary} disabled={busy} onClick={() => void request(`${phase}/refresh`)} data-testid="guide-provider-refresh">{t.refresh}</button>
      <button type="button" className={styles.ghost} disabled={busy} onClick={() => void request("cancel")} data-testid="guide-provider-cancel">{t.cancel}</button>
    </div>
    <details className={styles.card}><summary>{t.details}</summary><p>{t.sameDevice}</p></details>
  </section>
}
