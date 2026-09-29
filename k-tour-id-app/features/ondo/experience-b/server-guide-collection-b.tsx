"use client"

import { BookOpen, ChevronRight, RefreshCw } from "lucide-react"
import { useEffect, useState } from "react"
import { GUIDE_SAVE_V2, isGuideJourney, type GuideCollection } from "@/lib/hackathon/guide-contract"
import { requestHackathonOpenB } from "../hackathon-b/hackathon-campaign"
import { requestExperienceB } from "./experience-model-b"
import { GUIDE_COLLECTION_CHANGED_B, readGuideCollectionB } from "./guide-client-b"
import styles from "./experience-b.module.css"

const COPY = {
  ko: { title: "내 골목 가이드", name: "로바 · 서울", loading: "보관함을 확인하고 있어요", empty: "마음에 드는 가이드를 패스에 담아 다시 읽어요.", access: "저장한 가이드는 확인한 계정의 보관함에서 불러와요.", error: "보관함을 불러오지 못했어요. 저장 여부를 다시 확인해 주세요.", read: "골목 가이드 읽기", saved: "패스에 담은 가이드", pending: "진행 중인 저장 확인", retry: "보관함 새로고침", audit: "저장 완료 · 기록 확인 중", recorded: "저장 완료 · 기록 확인됨" },
  en: { title: "My neighborhood guides", name: "Roba · Seoul", loading: "Checking your collection", empty: "Keep a guide in your pass and read it again later.", access: "Saved guides are loaded from the collection for your verified account.", error: "We couldn’t load your collection. Check the saving result again.", read: "Read neighborhood guide", saved: "Saved in your pass", pending: "Check pending save", retry: "Refresh collection", audit: "Saved · record being checked", recorded: "Saved · record confirmed" },
  ja: { title: "保存した路地ガイド", name: "ロバ・ソウル", loading: "保存内容を確認しています", empty: "気に入ったガイドをパスに保存し、後から読み返せます。", access: "保存したガイドは、確認済みアカウントの保管場所から読み込みます。", error: "保存内容を読み込めませんでした。保存結果をもう一度確認してください。", read: "路地ガイドを読む", saved: "パスに保存したガイド", pending: "進行中の保存を確認", retry: "保存内容を再確認", audit: "保存済み・記録を確認中", recorded: "保存済み・記録確認済み" },
} as const

/** Server collection only. The old IndexedDB record is deliberately never read
 * or promoted, and this read-only view grants no global identity/age authority. */
export function ServerGuideCollectionB({ locale }: { locale: "ko" | "en" | "ja" }) {
  const t = COPY[locale]
  const [collection, setCollection] = useState<GuideCollection | null>(null)
  const [status, setStatus] = useState<"loading" | "loaded" | "access" | "error">("loading")
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    let controller: AbortController | null = null
    let timeout: number | undefined
    const refresh = async () => {
      controller?.abort(); window.clearTimeout(timeout)
      const current = new AbortController(); controller = current
      timeout = window.setTimeout(() => current.abort(), 8000)
      try {
        const value = await readGuideCollectionB(current.signal)
        if (!Array.isArray(value.items) || value.items.length > 1 || value.items.some(item => !item || item.guideId !== GUIDE_SAVE_V2.guideId || item.campaignId !== GUIDE_SAVE_V2.campaignId || item.venueId !== GUIDE_SAVE_V2.venueId || !item.chain || !["pending", "submitted", "confirmed", "failed", "unknown"].includes(item.chain.status)
          || (item.chain.status === "confirmed" && (!item.chain.txHash || !item.chain.confirmedAt)))
          || (value.pendingOperation && (!isGuideJourney(value.pendingOperation) || value.pendingOperation.execution !== "provider"))) throw new Error("guide_contract_mismatch")
        if (alive && controller === current) { setCollection(value); setStatus("loaded") }
      } catch (error) {
        if (alive && controller === current) { setCollection(null); setStatus(error instanceof Error && error.message === "guide_access_required" ? "access" : "error") }
      } finally { if (controller === current) window.clearTimeout(timeout) }
    }
    void refresh()
    const changed = () => { void refresh() }
    window.addEventListener(GUIDE_COLLECTION_CHANGED_B, changed)
    window.addEventListener("focus", changed)
    return () => { alive = false; controller?.abort(); window.clearTimeout(timeout); window.removeEventListener(GUIDE_COLLECTION_CHANGED_B, changed); window.removeEventListener("focus", changed) }
  }, [attempt])
  const saved = collection?.items[0]
  const pending = collection?.pendingOperation
  return <section className={styles.savedGuides} data-testid="server-guide-collection" data-state={status}>
    <h2>{t.title}</h2>
    {!saved ? <p className={styles.collectionHint} role="status">{status === "loading" ? t.loading : status === "access" ? t.access : status === "error" ? t.error : t.empty}</p> : null}
    <button type="button" className={styles.entry} data-testid="server-guide-open" onClick={() => requestExperienceB(GUIDE_SAVE_V2.venueId, "pass")}>
      <BookOpen size={23} aria-hidden="true" /><span><strong>{saved ? t.name : t.read}</strong><small>{saved ? saved.chain.status === "confirmed" ? t.recorded : t.audit : t.name}</small></span><ChevronRight size={18} aria-hidden="true" />
    </button>
    {pending ? <button type="button" className={styles.secondary} data-testid="server-guide-resume" onClick={() => requestHackathonOpenB({ venueId: GUIDE_SAVE_V2.venueId, locale, source: "guide", returnTo: "pass", resumeOperationId: pending.operationId })}>{t.pending}<ChevronRight size={18} aria-hidden="true" /></button> : null}
    {status === "error" || status === "access" ? <button type="button" className={styles.textButton} onClick={() => setAttempt(value => value + 1)}><RefreshCw size={14} aria-hidden="true" /> {t.retry}</button> : null}
  </section>
}
