"use client"

import { type ReactNode, useEffect, useState } from "react"
import type { GuideReadiness } from "@/lib/hackathon/guide-contract"
import type { HackathonOpenDetail } from "../hackathon-b/hackathon-campaign"
import { GuideAccessGateB } from "./guide-access-b"
import type { GuideAccessProfileB } from "./guide-access-contract-b"
import { SheetB } from "../shared/ui/sheet-b"
import { ONDO_MODAL_PRIORITY } from "../shared/ui/modal-layer-priority"
import { B_DISCOVERY_TRAVERSAL_EVENT } from "../map/b-discovery-history"
import { readGuideReadinessB, validGuideReadinessB } from "./guide-client-b"
import { requestExperienceB } from "./experience-model-b"
import styles from "./experience-b.module.css"

const COPY = {
  ko: { title: "가이드 담기", checking: "저장 기능을 확인하고 있어요", unavailable: "지금은 패스에 담을 수 없어요", body: "저장에 필요한 연결을 준비 중이에요. 가이드는 확인 절차 없이 계속 읽을 수 있어요.", error: "연결 상태를 확인하지 못했어요. 잠시 후 다시 확인해 주세요.", read: "가이드 계속 읽기", retry: "다시 확인", details: "연결 상태", configured: "설정됨 · 실제 완료 전", needed: "준비 필요", expired: "이용 기한 종료", identity: "신원 확인", credential: "패스 발급·제시", execution: "저장 실행", audit: "저장 기록", login: "계정 승인", ai: "저장 제안", campaign: "가이드 저장" },
  en: { title: "Save guide", checking: "Checking saving availability", unavailable: "Saving isn’t available yet", body: "We’re preparing the connections needed to save. You can keep reading without verification.", error: "We couldn’t check the connection. Please try again shortly.", read: "Keep reading", retry: "Check again", details: "Connection status", configured: "Configured · not yet completed", needed: "Setup needed", expired: "Availability ended", identity: "Identity check", credential: "Pass issue and presentation", execution: "Saving action", audit: "Saving record", login: "Account approval", ai: "Saving proposal", campaign: "Guide saving" },
  ja: { title: "ガイドを保存", checking: "保存機能を確認しています", unavailable: "現在、パスには保存できません", body: "保存に必要な接続を準備しています。本人確認なしで、引き続きガイドを読めます。", error: "接続状態を確認できませんでした。しばらくしてから再確認してください。", read: "ガイドを読み続ける", retry: "再確認", details: "接続状態", configured: "設定済み・未完了", needed: "準備が必要", expired: "利用期間終了", identity: "本人確認", credential: "パスの発行・提示", execution: "保存の実行", audit: "保存の記録", login: "アカウント承認", ai: "保存の提案", campaign: "ガイド保存" },
} as const

/** No operation, access cookie or provider call is created by readiness. Never
 * downgrade a v2 save to the historical v1 hosted execution or local simulator. */
export function GuideReadinessBoundaryB({ detail, onClose, children, requiresAccessRecheck = false }: { detail: HackathonOpenDetail; onClose(restore?: boolean): void; children(profile: GuideAccessProfileB): ReactNode; requiresAccessRecheck?: boolean }) {
  const t = COPY[detail.locale]
  const [readiness, setReadiness] = useState<GuideReadiness | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let alive = true
    setReadiness(null); setError(false)
    const timer = window.setTimeout(() => { if (alive) setError(true); controller.abort() }, 8000)
    void readGuideReadinessB(controller.signal).then(value => {
      if (!validGuideReadinessB(value)) throw new Error("guide_contract_mismatch")
      if (alive) setReadiness(value)
    }).catch(() => { if (alive && !controller.signal.aborted) setError(true) })
      .finally(() => window.clearTimeout(timer))
    return () => { alive = false; window.clearTimeout(timer); controller.abort() }
  }, [attempt])
  useEffect(() => {
    const leave = () => onClose(false)
    window.addEventListener(B_DISCOVERY_TRAVERSAL_EVENT, leave)
    return () => window.removeEventListener(B_DISCOVERY_TRAVERSAL_EVENT, leave)
  }, [onClose])
  if (readiness?.ready && readiness.blockers.length === 0 && readiness.accessProfile !== "unavailable") return <GuideAccessGateB profile={readiness.accessProfile} detail={detail} onClose={onClose} requiresAccessRecheck={requiresAccessRecheck}>{children(readiness.accessProfile)}</GuideAccessGateB>
  const expired = readiness?.checks.some(check => check.id === "campaign" && check.status === "expired")
  const expiredCopy = detail.locale === "ko" ? { title: "저장 기간이 끝났어요", body: "새로 패스에 담기는 종료됐지만, 가이드는 계속 읽을 수 있어요." } : detail.locale === "ja" ? { title: "保存の受付は終了しました", body: "新たにパスへ保存する期間は終了しましたが、ガイドは引き続き読めます。" } : { title: "Saving has closed", body: "The saving period has ended. You can still read the guide." }
  const read = () => { onClose(); window.setTimeout(() => requestExperienceB(detail.venueId, detail.returnTo === "pass" ? "pass" : "place"), 180) }
  return <SheetB locale={detail.locale} label={t.title} header={t.title} variant="decision" modalPriority={ONDO_MODAL_PRIORITY.critical} onClose={onClose}
    footer={<div className={styles.footer}><button type="button" className={styles.primary} onClick={read} data-testid="guide-keep-reading">{t.read}</button><button type="button" className={styles.secondary} onClick={() => setAttempt(value => value + 1)} disabled={!readiness && !error}>{t.retry}</button></div>}>
    <div className={styles.body} data-testid="guide-save-readiness" data-ready="false">
      <h1 className={styles.readinessTitle}>{!readiness && !error ? t.checking : expired ? expiredCopy.title : t.unavailable}</h1><p className={styles.lead} role="status">{error ? t.error : expired ? expiredCopy.body : t.body}</p>
      {readiness ? <details className={styles.details}><summary>{t.details}</summary><dl className={styles.receipt}>{readiness.checks.map(check => <div key={check.id}><dt>{t[check.id]}</dt><dd>{check.status === "configured" ? t.configured : check.status === "expired" ? t.expired : t.needed}</dd></div>)}</dl></details> : null}
    </div>
  </SheetB>
}
