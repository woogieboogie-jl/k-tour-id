"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import qrcode from "qrcode-generator"
import type { OperationResult } from "@/lib/hackathon/types"
import { canUseNativeOfferHandoff, createNativeOfferHandoff, nativeEnvironment, nativeOfferContext, nativeOfferContextKey, providerStepPolicy } from "./native-offer-handoff-b"
import { nativeBindingAppBridge } from "./native-app-v1-transport-b"
import { NativeHolderBindingB } from "./native-holder-binding-b"
import styles from "./hackathon-b.module.css"

type ProviderView = { phase: "issuance" | "presentation" | "allowed" | "denied" | "failed" | "cancelled" | "expired"; offer: { qrPayload: string } | null; nativeBindingId?: string }
type ProviderAction = "issuance/start" | "issuance/refresh" | "presentation/start" | "presentation/refresh" | "cancel"
const COPY = {
  ko: { issuance: "패스를 받아 보관해 주세요", presentation: "필요한 확인 결과만 제시해요", start: "신분증 앱 요청 열기", instruction: "연결된 신분증 앱에서 QR을 스캔하고 요청을 확인해 주세요. 마친 뒤 이 화면에서 결과를 확인해요.", noOffer: "앱에서 요청을 확인한 뒤 결과를 새로고침해 주세요.", refresh: "결과 확인", cancel: "요청 중단", waiting: "앱의 확인 결과를 기다리고 있어요", denied: "제시가 승인되지 않았어요. 저장은 진행하지 않았어요.", failed: "요청을 완료하지 못했어요. 같은 요청의 결과를 확인해 주세요.", expired: "요청 시간이 지났어요. 저장은 진행하지 않았어요.", cancelled: "요청을 중단했어요", unavailable: "연결 상태를 확인하지 못했어요. 같은 요청의 결과를 다시 확인해 주세요.", qr: "신분증 앱 제출 요청 QR", details: "연결 안내", sameDevice: "이 화면에서 신분증 앱이 자동으로 열리지는 않아요. QR을 읽을 수 있는 연결된 신분증 앱이 필요해요." },
  en: { issuance: "Receive and keep your pass", presentation: "Present only the needed check result", start: "Open ID app request", instruction: "Scan this QR with the connected ID app and review the request. Return here to check the result.", noOffer: "After reviewing the request in your ID app, check its result here.", refresh: "Check result", cancel: "Stop request", waiting: "Waiting for the app’s confirmation", denied: "Presentation was declined. Nothing was saved.", failed: "The request did not finish. Check this same request’s result.", expired: "The request expired. Nothing was saved.", cancelled: "Request stopped", unavailable: "We couldn’t confirm the connection. Check this same request again.", qr: "ID app presentation request QR", details: "Connection details", sameDevice: "This screen does not open an ID app automatically. You need a connected ID app that can scan this QR." },
  ja: { issuance: "パスを受け取り、保管してください", presentation: "必要な確認結果だけを提示します", start: "身分証アプリへの要求を開く", instruction: "接続された身分証アプリでQRを読み取り、要求を確認してください。完了後、この画面で結果を確認します。", noOffer: "身分証アプリで要求を確認した後、この画面で結果を確認してください。", refresh: "結果を確認", cancel: "要求を中止", waiting: "アプリでの確認を待っています", denied: "提示は承認されませんでした。保存は行っていません。", failed: "要求を完了できませんでした。同じ要求の結果を確認してください。", expired: "要求の期限が切れました。保存は行っていません。", cancelled: "要求を中止しました", unavailable: "接続を確認できませんでした。同じ要求の結果を再確認してください。", qr: "身分証アプリ提示要求のQR", details: "接続について", sameDevice: "この画面から身分証アプリは自動で開きません。このQRを読み取れる接続済みの身分証アプリが必要です。" },
} as const
const NATIVE_COPY = {
  ko: { open: "이 앱에서 요청 확인", instruction: "요청을 준비한 뒤 이 앱에서 신분증 확인 화면을 열 수 있어요. 돌아온 뒤 결과 확인을 눌러 주세요.", returned: "앱으로 요청을 전달했어요. 완료나 승인을 뜻하지 않아요. 돌아온 뒤 결과를 확인해 주세요.", failed: "앱 이동 결과를 확인하지 못했어요. 같은 요청의 결과를 확인해 주세요." },
  en: { open: "Review request in this app", instruction: "After preparing the request, you can open the ID screen in this app. Check the result when you return.", returned: "The request was handed to the app, not approved. Check its result when you return.", failed: "We couldn’t confirm the app handoff. Check this same request’s result." },
  ja: { open: "このアプリで要求を確認", instruction: "要求の準備後、このアプリで身分証の確認画面を開けます。戻ったら結果を確認してください。", returned: "アプリに要求を渡しました。完了や承認を意味しません。戻ったら結果を確認してください。", failed: "アプリへの移動を確認できませんでした。同じ要求の結果を確認してください。" },
} as const

/** Ephemeral provider offer only. No QR, VC, issuer transaction or personal
 * claims enter browser persistence, and no mock holder acknowledgement exists. */
export function GuideProviderStepB({ operation, locale, onOperation, onAccessRequired }: { operation: OperationResult; locale: "ko" | "en" | "ja"; onOperation(value: OperationResult): void; onAccessRequired?(operationId: string): void }) {
  const t = COPY[locale]
  const validOperation = Boolean(providerStepPolicy(operation) && operation.execution === "provider" && operation.identity?.mode !== "mock" && operation.identity?.handoff?.kind !== "mock" && operation.credential?.mode !== "mock")
  const phase = operation.phase === "issuance" ? "issuance" : "presentation"
  const [view, setView] = useState<ProviderView | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [nativeAvailable, setNativeAvailable] = useState(false)
  const [bindingApp, setBindingApp] = useState(false)
  const [nativeSent, setNativeSent] = useState(false)
  const [nativeFailed, setNativeFailed] = useState(false)
  const offerRef = useRef<ReturnType<typeof createNativeOfferHandoff>>(null)
  const context = nativeOfferContext(operation)
  const nativeSupported = nativeAvailable && context.providerSupported
  const contextKey = nativeOfferContextKey(context)
  const currentContext = useRef(context)
  currentContext.current = context
  const inFlight = useRef(false)
  const requestRef = useRef<AbortController | null>(null)
  useEffect(() => {
    setNativeAvailable(canUseNativeOfferHandoff(nativeEnvironment()))
    setBindingApp(nativeBindingAppBridge(nativeEnvironment()) !== null)
    return () => { const active = requestRef.current; requestRef.current = null; active?.abort(); offerRef.current?.invalidate() }
  }, [])
  useEffect(() => {
    if (offerRef.current && !offerRef.current.matches(context, Date.now())) {
      offerRef.current.invalidate(); offerRef.current = null; setView(null)
    }
  }, [contextKey]) // The server operation, not a native return event, owns progression.
  useEffect(() => {
    const expiry = offerRef.current?.expiresAt
    if (!expiry) return
    const timer = window.setTimeout(() => {
      offerRef.current?.invalidate(); offerRef.current = null; setView(null); setError(true)
    }, Math.max(0, expiry - Date.now()))
    return () => window.clearTimeout(timer)
  }, [view])
  const request = async (action: ProviderAction) => {
    if (inFlight.current || !validOperation) return
    const startedContext = nativeOfferContextKey(currentContext.current)
    // Starting a refresh/cancel invalidates the previous native affordance even
    // if its HTTP result is lost. No late button can reuse that offer.
    offerRef.current?.invalidate(); offerRef.current = null; setView(null); setNativeSent(false); setNativeFailed(false)
    inFlight.current = true; setBusy(true); setError(false)
    const controller = new AbortController()
    requestRef.current = controller
    const timer = window.setTimeout(() => controller.abort(), 15000)
    try {
      const response = await fetch(`/api/hackathon/v1/operations/${encodeURIComponent(operation.operationId)}/provider/${action}`, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" }, body: "{}", signal: controller.signal })
      if (requestRef.current !== controller || controller.signal.aborted || nativeOfferContextKey(currentContext.current) !== startedContext) throw new Error("provider_request_closed")
      if (response.status === 401 && requestRef.current === controller) { setView(null); if (onAccessRequired) onAccessRequired(operation.operationId); else setError(true); return }
      if (!response.ok) throw new Error("provider_unavailable")
      const result = await response.json() as { operation: OperationResult; provider: ProviderView }
      if (requestRef.current !== controller || controller.signal.aborted || nativeOfferContextKey(currentContext.current) !== startedContext) throw new Error("provider_request_closed")
      if (!result.operation || !providerStepPolicy(result.operation) || providerStepPolicy(result.operation) !== providerStepPolicy(operation) || result.operation.execution !== "provider" || result.operation.identity?.mode === "mock" || result.operation.identity?.handoff?.kind === "mock" || result.operation.credential?.mode === "mock" || result.operation.operationId !== operation.operationId || result.operation.venueId !== operation.venueId || result.operation.campaignId !== operation.campaignId || result.operation.policyVersion !== operation.policyVersion || !Number.isSafeInteger(result.operation.revision) || result.operation.revision < operation.revision || !result.provider || !["issuance", "presentation", "allowed", "denied", "failed", "cancelled", "expired"].includes(result.provider.phase)) throw new Error("provider_mismatch")
      if (result.provider.offer && (typeof result.provider.offer.qrPayload !== "string" || !result.provider.offer.qrPayload.trim() || result.provider.offer.qrPayload.length > 8192 || result.provider.phase !== result.operation.phase || !["issuance", "presentation"].includes(result.provider.phase))) throw new Error("provider_offer_invalid")
      if (result.provider.nativeBindingId !== undefined && !/^nhb_[A-Za-z0-9_-]{24}$/.test(result.provider.nativeBindingId)) throw new Error("provider_binding_invalid")
      if (requestRef.current === controller) {
        offerRef.current = result.provider.offer ? createNativeOfferHandoff(nativeOfferContext(result.operation), result.provider.offer.qrPayload, Date.now(), result.provider.nativeBindingId) : null
        setView(result.provider); onOperation(result.operation)
      }
    } catch { if (requestRef.current === controller) setError(true) }
    finally { window.clearTimeout(timer); if (requestRef.current === controller) { requestRef.current = null; inFlight.current = false; setBusy(false) } }
  }
  const qr = useMemo(() => {
    if (!view?.offer?.qrPayload) return null
    try { const code = qrcode(0, "M"); code.addData(view.offer.qrPayload); code.make(); return code.createDataURL(5, 12) } catch { return null }
  }, [view?.offer?.qrPayload])
  const qrFailed = Boolean(view?.offer && !qr)
  const qrError = locale === "ko" ? "QR을 표시하지 못했어요. 같은 요청의 결과를 확인하거나 요청을 중단해 주세요." : locale === "ja" ? "QRを表示できませんでした。同じ要求の結果を確認するか、中止してください。" : "The QR could not be displayed. Check the same request or stop it."
  const status = providerStepPolicy(operation) === "v1" && view && ["denied", "expired"].includes(view.phase)
    ? locale === "ko" ? "요청이 승인되지 않았거나 시간이 지났어요. 혜택은 실행하지 않았어요." : locale === "ja" ? "要求が承認されなかったか、期限が切れました。特典は実行していません。" : "The request was declined or expired. The perk was not executed."
    : view && ["denied", "failed", "expired", "cancelled"].includes(view.phase) ? t[view.phase as "denied" | "failed" | "expired" | "cancelled"] : t.waiting
  const nativeOffer = nativeSupported && (!bindingApp || !!view?.nativeBindingId) && offerRef.current?.matches(context, Date.now())
  const openNativeOffer = async () => {
    if (busy || inFlight.current) return
    const key = nativeOfferContextKey(currentContext.current)
    setNativeSent(true)
    const result = bindingApp ? await offerRef.current?.openApp(currentContext.current, nativeEnvironment(), { locale, theme: document.documentElement.dataset.theme === "light" ? "light" : "dark" }) : offerRef.current?.open(currentContext.current, nativeEnvironment())
    if (nativeOfferContextKey(currentContext.current) !== key) return
    if (result === "sent" || result === "already_sent" || result === "failed") setNativeSent(true)
    if (result !== "sent" && result !== "already_sent") setNativeFailed(true)
  }
  return <section className={styles.card} data-testid="guide-provider-step" data-provider-phase={phase}>
    {bindingApp && nativeSupported && phase === "issuance" ? <NativeHolderBindingB key={operation.operationId} operation={operation} locale={locale} /> : null}
    <h3>{t[phase]}</h3>
    {view ? <><p role="status">{status}</p>{qr ? <><img className={styles.qr} alt={t.qr} src={qr} /><p>{nativeSupported ? NATIVE_COPY[locale].instruction : t.instruction}</p></> : qrFailed ? <p role="alert" className={styles.notice}>{qrError}</p> : <p>{t.noOffer}</p>}</> : <p>{nativeSupported ? NATIVE_COPY[locale].instruction : t.sameDevice}</p>}
    {error || !validOperation ? <p role="alert" className={styles.notice}>{t.unavailable}</p> : null}
    {nativeSent && !nativeFailed ? <p role="status" data-testid="guide-provider-native-pending">{NATIVE_COPY[locale].returned}</p> : null}
    {nativeFailed ? <p role="alert">{NATIVE_COPY[locale].failed}</p> : null}
    <div className={styles.actions}>
      {nativeOffer ? <button type="button" className={styles.primary} disabled={busy || nativeSent} onClick={() => void openNativeOffer()} data-testid="guide-provider-native-open">{NATIVE_COPY[locale].open}</button> : null}
      {!view && !error && validOperation ? <button type="button" className={styles.primary} disabled={busy} onClick={() => void request(`${phase}/start`)} data-testid="guide-provider-start">{t.start}</button> : null}
      <button type="button" className={view ? styles.primary : styles.secondary} disabled={busy || !validOperation} onClick={() => void request(`${phase}/refresh`)} data-testid="guide-provider-refresh">{t.refresh}</button>
      <button type="button" className={styles.ghost} disabled={busy || !validOperation} onClick={() => void request("cancel")} data-testid="guide-provider-cancel">{t.cancel}</button>
    </div>
    <details className={styles.card}><summary>{t.details}</summary><p>{nativeSupported ? NATIVE_COPY[locale].instruction : t.sameDevice}</p></details>
  </section>
}
