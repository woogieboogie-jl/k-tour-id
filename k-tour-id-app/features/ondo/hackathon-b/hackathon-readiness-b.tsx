"use client"

import { useEffect, useRef, useState } from "react"
import { X } from "lucide-react"
import { ONDO_MODAL_PRIORITY } from "../shared/ui/modal-layer-priority"
import { useDocumentScrollLock, useModalIsolation } from "../shared/ui/use-modal-isolation"
import { requestPlaceServiceReturnB } from "../commerce-b/place-service-registry-b"
import { B_DISCOVERY_TRAVERSAL_EVENT } from "../map/b-discovery-history"
import type { HackathonOpenDetail } from "./hackathon-campaign"
import styles from "./hackathon-b.module.css"

const COPY = {
  ko: { title: "연동 준비 확인", loading: "앱과 API 연결을 확인하고 있어요", ready: "앱과 API가 연결됐어요", failed: "API 연결을 확인하지 못했어요", body: "이 Preview에서는 인증·AI·서명·체인 실행을 시작하지 않습니다. 실제 CX 연동은 아직 검증 전입니다.", back: "같은 장소로 돌아가기", close: "닫기" },
  en: { title: "Integration readiness", loading: "Checking the app-to-API connection", ready: "App and API are connected", failed: "Could not verify the API connection", body: "Identity, AI, signing and chain execution are disabled in this preview. Live CX verification is still pending.", back: "Return to my place", close: "Close" },
  ja: { title: "連携の準備確認", loading: "アプリとAPIの接続を確認中です", ready: "アプリとAPIが接続されました", failed: "API接続を確認できませんでした", body: "このPreviewでは本人確認・AI・署名・チェーン実行を開始しません。実際のCX連携は未検証です。", back: "元の場所に戻る", close: "閉じる" },
}

/** No journey mount, session creation, signing, pending-operation resume or provider call. */
export function HackathonReadinessB({ detail, onClose }: { detail: HackathonOpenDetail; onClose: () => void }) {
  const c = COPY[detail.locale]
  const rootRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading")
  useModalIsolation(true, rootRef)
  useDocumentScrollLock(true)
  const close = () => {
    onClose()
    window.setTimeout(() => requestPlaceServiceReturnB(detail.venueId, "offer"), 30)
  }
  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/hackathon/v1/config", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Config unavailable")
        const config = await response.json()
        if (config.previewReadOnly !== true || config.isolatedMock !== true || config.capabilities?.chainExecutionEnabled !== false) throw new Error("Unexpected deployment")
        setStatus("ready")
      })
      .catch(() => { if (!controller.signal.aborted) setStatus("failed") })
    return () => controller.abort()
  }, [])
  useEffect(() => {
    const leave = () => onClose()
    window.addEventListener(B_DISCOVERY_TRAVERSAL_EVENT, leave)
    window.addEventListener("popstate", leave)
    return () => {
      window.removeEventListener(B_DISCOVERY_TRAVERSAL_EVENT, leave)
      window.removeEventListener("popstate", leave)
    }
  }, [onClose])
  return <div ref={rootRef} className={styles.root} role="dialog" aria-modal="true" aria-label={c.title} lang={detail.locale} data-testid="hackathon-readiness" data-status={status} data-modal-layer-priority={ONDO_MODAL_PRIORITY.critical} onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); close() } }}>
    <div className={styles.sheet}>
      <header className={styles.head}><div className={styles.headRow}><h2>{c.title}</h2><button type="button" className={styles.close} aria-label={c.close} onClick={close}><X size={18} aria-hidden="true" /></button></div></header>
      <div className={styles.body}><section className={styles.card}>
        <h3 role="status">{c[status]}</h3><p>{c.body}</p>
        <div className={styles.actions}><button type="button" className={styles.primary} data-testid="hackathon-readiness-return" onClick={close}>{c.back}</button></div>
      </section></div>
    </div>
  </div>
}
