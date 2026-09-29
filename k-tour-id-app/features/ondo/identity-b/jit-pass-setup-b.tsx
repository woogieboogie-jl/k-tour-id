"use client"
import { useEffect, useRef, useState } from "react"
import type { JitIdentityContext, JitIdentityEligibility, JitIdentityRequest } from "@/lib/hackathon/jit-identity-contract"
import { useOndoB } from "../shared/state/ondo-b-provider"
import { SheetB } from "../shared/ui/sheet-b"
import { useSheetPresence } from "../shared/ui/use-sheet-presence"
import { JitIdentityCheckB } from "./jit-identity-check-b"
import { consumeJitRequestReceipt, jitContext, jitIdentityCall, parseJitEligibility } from "./jit-identity-client-b"
import { JIT_IDENTITY_CHANGED } from "./jit-identity-authority-b"
import styles from "./jit-identity-check-b.module.css"

export function useJitIdentityStatusB(enabled: boolean) {
  const [status, setStatus] = useState<JitIdentityEligibility | null>(null)
  useEffect(() => {
    if (!enabled) { setStatus(null); return }
    let current: AbortController | null = null
    const read = () => { current?.abort(); const controller = new AbortController(); current = controller; void jitIdentityCall("identity/eligibility", undefined, controller.signal).then(parseJitEligibility).then(value => { if (!controller.signal.aborted) setStatus(value) }).catch(() => { if (!controller.signal.aborted) setStatus(null) }) }
    read(); window.addEventListener(JIT_IDENTITY_CHANGED, read); window.addEventListener("focus", read)
    const timer = window.setInterval(read, 60_000)
    return () => { current?.abort(); window.clearInterval(timer); window.removeEventListener(JIT_IDENTITY_CHANGED, read); window.removeEventListener("focus", read) }
  }, [enabled])
  return status
}

export function jitPersonLabelB(locale: "ko" | "en" | "ja", status: JitIdentityEligibility | null) {
  const verified = status?.person.state === "verified" && Date.parse(status.person.expiresAt ?? "") > Date.now()
  return locale === "ko" ? verified ? "본인 확인됨 · OmniOne CX" : "행동할 때 확인" : locale === "ja" ? verified ? "本人確認済み · OmniOne CX" : "操作の際に確認" : verified ? "Identity confirmed · OmniOne CX" : "Check when needed"
}

export function JitPassSetupB({ onPassport }: { onPassport?: () => void }) {
  const { state, actions } = useOndoB()
  const presence = useSheetPresence(state.identitySetupOrigin)
  const [context, setContext] = useState<JitIdentityContext | null>(null)
  const [error, setError] = useState(false)
  const live = useRef(true), busy = useRef(false), controller = useRef<AbortController | null>(null)
  const open = Boolean(state.identitySetupOrigin)
  useEffect(() => {
    let current = true
    live.current = open; setError(false); setContext(null)
    if (open) { const intent = crypto.randomUUID(); void jitContext({ action: "pass_setup", purpose: "person", venueId: null, tableId: null }, intent).then(value => { if (current && live.current) setContext(value) }).catch(() => { if (current && live.current) setError(true) }) }
    return () => { current = false; live.current = false; controller.current?.abort() }
  }, [open])
  async function finish(request: JitIdentityRequest) {
    if (busy.current || !live.current) return
    busy.current = true; const current = new AbortController(); controller.current = current
    try { await consumeJitRequestReceipt(request, current.signal); if (live.current && !current.signal.aborted) { window.dispatchEvent(new Event(JIT_IDENTITY_CHANGED)); actions.closeIdentitySetup() } }
    catch { if (live.current) setError(true) }
    finally { busy.current = false }
  }
  if (!presence.value) return null
  const locale = state.locale
  const close = () => { live.current = false; controller.current?.abort(); actions.closeIdentitySetup() }
  return <SheetB locale={locale} label="K-Tour ID · OmniOne CX" header="K-Tour ID" variant="decision" presenceState={presence.phase} onClose={close}>
    <div data-testid="k-tour-id-setup" data-execution="provider">
      {context ? <JitIdentityCheckB key={context.contextDigest} locale={locale} context={context} onAuthorized={request => void finish(request)} onCancel={close} /> : <div className={styles.body}><p role="status">{locale === "ko" ? "본인 확인을 준비하고 있어요." : locale === "ja" ? "本人確認を準備しています。" : "Preparing identity verification."}</p></div>}
      {error ? <p className={styles.body} role="alert">{locale === "ko" ? "결과를 확인하지 못했어요. 자동으로 완료 처리하지 않았어요." : locale === "ja" ? "結果を確認できませんでした。自動で完了にはしていません。" : "The result could not be confirmed. Nothing was marked complete."}</p> : null}
      {onPassport ? <div className={styles.body}><button type="button" data-testid="jit-passport-separate" onClick={onPassport}>{locale === "ko" ? "별도 여권 확인 열기" : locale === "ja" ? "別のパスポート確認を開く" : "Open separate passport verification"}</button></div> : null}
    </div>
  </SheetB>
}
