"use client"
import { useEffect, useRef, useState } from "react"
import type { OperationResult } from "@/lib/hackathon/types"
import { nativeEnvironment, nativeOfferContext, nativeOfferContextKey } from "./native-offer-handoff-b"
import { nativeBindingAppBridge, parseNativeBindingLaunch, boundedNativeAppCall, parseNativeAppFlow, cancelNativeAppRequest } from "./native-app-v1-transport-b"
import styles from "./hackathon-b.module.css"
const TEXT = {
  ko: { title: "본인확인 결과와 새 지갑 연결", info: "확인된 CX 결과에 이 지갑의 키 소유 증명을 연결해요. 새 지갑에서만 가능하며, 기존 지갑은 초기화하지 않아요. 연결만으로 패스 발급이나 혜택 실행을 승인하지 않습니다.", start: "새 지갑 연결에 동의하고 열기", check: "연결 결과 확인", cancel: "연결 중단", waiting: "앱 요청 후 이 화면에서 결과를 확인해 주세요. 앱 복귀는 연결 완료를 뜻하지 않아요.", verified: "서버에서 본인확인·지갑 연결을 확인했어요. 다음 패스 요청은 별도로 확인해 주세요.", error: "연결 결과를 확인하지 못했어요. 다시 등록하지 말고 같은 요청의 결과를 확인해 주세요." },
  en: { title: "Connect your identity check to a new wallet", info: "Bind verified CX evidence to proof of this wallet’s key ownership. A fresh wallet is required; an existing wallet is never reset. This does not approve pass issuance or perk execution.", start: "Agree and open new wallet connection", check: "Check connection result", cancel: "Stop connection", waiting: "Check the result here after the app request. Returning from the app does not mean the connection is verified.", verified: "The server verified the identity-to-wallet connection. Review the next pass request separately.", error: "The connection is unconfirmed. Check the same request; do not register again." },
  ja: { title: "本人確認結果を新しいウォレットに接続", info: "確認済みのCX情報と、このウォレットの鍵の所有証明を結び付けます。新しいウォレットが必要で、既存のものは初期化しません。パス発行や特典実行への同意とは別です。", start: "同意して新しいウォレットの接続を開く", check: "接続結果を確認", cancel: "接続を中止", waiting: "アプリでの操作後、この画面で結果を確認してください。戻っただけでは接続完了になりません。", verified: "サーバーで本人確認とウォレットの接続を確認しました。次のパス要求は別途ご確認ください。", error: "接続を確認できませんでした。再登録せず、同じ要求の結果を確認してください。" },
} as const
export function NativeHolderBindingB({ operation, locale, onVerified }: { operation: OperationResult; locale: "ko" | "en" | "ja"; onVerified?(expiresAt: number | null): void }) {
  const t = TEXT[locale], context = nativeOfferContextKey(nativeOfferContext(operation)), latest = useRef(context); latest.current = context
  const [state, setState] = useState<"idle" | "pending" | "verified" | "error" | "cancelled">("idle"), [busy, setBusy] = useState(false)
  const mounted = useRef(true), request = useRef<AbortController | null>(null), nativeRequest = useRef<{ id: string; bridge: NonNullable<ReturnType<typeof nativeBindingAppBridge>> } | null>(null)
  const needsCancel = useRef(false)
  const key = operation.operationId
  const call = async (action: "start" | "status" | "cancel") => {
    if (request.current) return
    const started = latest.current, controller = new AbortController(); request.current = controller; setBusy(true)
    const timer = setTimeout(() => controller.abort(), 15_000)
    try {
      const r = await fetch(`/api/hackathon/v1/operations/${encodeURIComponent(key)}/native-binding/${action}`, { method: action === "status" ? "GET" : "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal, ...(action === "status" ? {} : { headers: { "content-type": "application/json" }, body: "{}" }) })
      const value: unknown = await r.json()
      if (!mounted.current || controller.signal.aborted || latest.current !== started || !r.ok) throw new Error("closed")
      if (action === "start") {
        const launch = parseNativeBindingLaunch(value, key), bridge = nativeBindingAppBridge(nativeEnvironment())
        if (!launch || !bridge) throw new Error("binding_unavailable")
        needsCancel.current = true
        setState("pending")
        const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("")
        nativeRequest.current = { id, bridge }
        const { version: _version, status: _status, ...binding } = launch
        // No private continuation token/DID comes back. The acknowledgement is
        // only a hint, and never triggers issuance, presentation, or signing.
        void boundedNativeAppCall(() => bridge.bind({ requestId: id, binding, ui: { locale, theme: document.documentElement.dataset.theme === "light" ? "light" : "dark" } }), v => parseNativeAppFlow(v, id), { timeoutMs: Math.min(240_000, Date.parse(launch.expiresAt) - Date.now()) }).then(() => { if (nativeRequest.current?.id === id) nativeRequest.current = null })
      } else {
        const d = value as Record<string, unknown> | null
        if (!d || Object.keys(d).length !== 4 || d.version !== "cx-holder-v1" || typeof d.bindingId !== "string" || !/^nhb_[A-Za-z0-9_-]{24}$/.test(d.bindingId) || typeof d.expiresAt !== "string" || !Number.isFinite(Date.parse(d.expiresAt))) throw new Error("invalid")
        const next = action === "cancel" && d.status === "cancelled" ? "cancelled" : d.status === "verified" && Date.parse(d.expiresAt) > Date.now() ? "verified" : ["challenge", "allocating", "allocated", "proved", "confirming", "unknown"].includes(String(d.status)) ? "pending" : "error"
        if (next === "verified" || next === "cancelled") needsCancel.current = false
        setState(next)
        onVerified?.(next === "verified" ? Date.parse(d.expiresAt) : null)
      }
    } catch { if (mounted.current && latest.current === started) { setState("error"); onVerified?.(null) } }
    finally { clearTimeout(timer); if (request.current === controller) { request.current = null; if (mounted.current) setBusy(false) } }
  }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); const n = nativeRequest.current; if (n) void cancelNativeAppRequest(n.bridge, n.id); nativeRequest.current = null
    if (needsCancel.current) { needsCancel.current = false; void fetch(`/api/hackathon/v1/operations/${encodeURIComponent(key)}/native-binding/cancel`, { method: "POST", credentials: "same-origin", cache: "no-store", keepalive: true, headers: { "content-type": "application/json" }, body: "{}" }).catch(() => {}) }
  } }, [key])
  return <section className={styles.card} data-testid="native-holder-binding"><h3>{t.title}</h3><p>{t.info}</p><p role="status">{state === "verified" ? t.verified : state === "error" ? t.error : t.waiting}</p><div className={styles.actions}>
    {state === "idle" ? <button className={styles.primary} disabled={busy} onClick={() => void call("start")} data-testid="native-binding-start">{t.start}</button> : null}
    <button className={styles.secondary} disabled={busy} onClick={() => void call("status")} data-testid="native-binding-status">{t.check}</button>
    {state !== "idle" && state !== "verified" && state !== "cancelled" ? <button className={styles.ghost} disabled={busy} onClick={() => { const n = nativeRequest.current; if (n) void cancelNativeAppRequest(n.bridge, n.id); void call("cancel") }} data-testid="native-binding-cancel">{t.cancel}</button> : null}
  </div></section>
}
