"use client"

import type { ReactNode } from "react"
import { forwardRef, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react"
import {
  BadgeCheck,
  Check,
  ChevronRight,
  CircleUserRound,
  CircleMinus,
  Eye,
  EyeOff,
  Footprints,
  Globe2,
  HandHeart,
  Info,
  Languages,
  LockKeyhole,
  LoaderCircle,
  MapPin,
  Pencil,
  RotateCcw,
  Save,
  ShieldCheck,
  UsersRound,
  X,
} from "lucide-react"
import type { OndoBLocale } from "../shared/state/ondo-b-preferences"
import { qaReviewFixtureOptions, readQaRuntime } from "../shared/ui/use-qa-controls"
import { B_ACTION_AXIS_SESSION_EVENT, B_ACTION_GATE_SESSION_KEY, DEFAULT_B_ACTION_GATE_SESSION, restoreBActionGateSession, type BActionAxis } from "./action-gate-contract-b"
import { resolveTravelerAxisPresentationB } from "./traveler-id-status-b"
import { ONDO_MODAL_PRIORITY } from "../shared/ui/modal-layer-priority"
import { useDocumentScrollLock, useModalIsolation } from "../shared/ui/use-modal-isolation"
import {
  publicBActivityProfile,
  scheduleAfterNextPaintB,
  useBActivityProfile,
  type BActivityProfile,
  type BPublicActivityProfile,
} from "./activity-profile-b-provider"
import styles from "./profile-reputation-b.module.css"

type Props = {
  locale: OndoBLocale
  accountActive: boolean
  personAxis: BActionAxis
  statusClock?: number
  startEditing?: boolean
  entryOrigin?: "my_korea" | "table_host"
  onExit?: () => void
  registerHostExitGuard?: (guard: ProfileHostExitGuardB | null) => void
}

export type ProfileHostExitGuardB = {
  requestExit(continueExit: () => boolean): boolean
  resumeAfterInterruptedExit(): void
}

const COPY = {
  en: {
    profileTitle: "Public profile", private: "Nothing shared", partial: "Selected details shared",
    scope: "Choose only what you want to show.", edit: "Edit", locked: "Set up an account to add profile details.",
    name: "Display name", from: "From", lives: "Lives in", languages: "Languages", include: "Public", exclude: "Private",
    addValue: "Add a value before making this public", self: "You added this", save: "Save changes", saved: "Changes saved", retry: "Try again", cancel: "Cancel",
    saving: "Saving", done: "Done",
    failed: "Couldn’t save. Your current public profile is unchanged.", privacy: "About profile fields",
    boundary: "You add these details yourself. Identity checks never fill them.", publicView: "What others see",
    publicEmpty: "No profile details shared", unchanged: "Current public profile", discardTitle: "Discard your changes?",
    discard: "Discard", keepEditing: "Keep editing", activityTitle: "Activity", activityNote: "Four separate signals",
    identity: "Identity", visit: "Visits", contribution: "Tips", meetup: "Tables", identitySource: "Identity check",
    visitSource: "Place history", contributionSource: "Shared tips", meetupSource: "Joined Tables", noHistory: "Not yet",
    ready: "Ready", reviewCurrent: "Review result · no provider check", reviewExpired: "Review result expired · no provider check", reviewSource: "Review only", one: "One", several: "Several",
    evidenceKind: "Evidence", updated: "Updated", currentSession: "Current session", noUpdate: "No activity yet", openEvidence: "View evidence",
    historyBoundary: "Each signal stands alone. None rates safety, character or expertise.",
  },
  ko: {
    profileTitle: "공개 프로필", private: "공개 정보 없음", partial: "선택한 정보만 공개", scope: "보여줄 항목만 선택하세요.",
    edit: "편집", locked: "계정을 설정하면 프로필 정보를 추가할 수 있어요.", name: "표시 이름", from: "출신 지역",
    lives: "현재 생활권", languages: "사용 언어", include: "공개", exclude: "비공개", addValue: "값을 입력한 뒤 공개할 수 있어요",
    self: "내가 입력", save: "변경사항 저장", saved: "변경사항을 저장했어요", retry: "다시 시도", cancel: "취소",
    saving: "저장 중", done: "완료",
    failed: "저장하지 못했어요. 현재 공개 정보는 그대로예요.", privacy: "프로필 정보 안내",
    boundary: "직접 입력한 정보예요. 본인 확인 정보는 자동으로 채우지 않아요.", publicView: "다른 사람에게 보이는 모습",
    publicEmpty: "공개한 프로필 정보가 없어요", unchanged: "현재 공개 프로필", discardTitle: "변경사항을 버릴까요?",
    discard: "변경사항 버리기", keepEditing: "계속 편집", activityTitle: "활동", activityNote: "서로 다른 네 가지 기록",
    identity: "본인 확인", visit: "방문", contribution: "팁", meetup: "Table", identitySource: "본인 확인",
    visitSource: "장소 기록", contributionSource: "공유한 팁", meetupSource: "참여한 Table", noHistory: "아직 없음",
    ready: "준비됨", reviewCurrent: "검토용 결과 · 외부 확인 없음", reviewExpired: "검토용 결과 만료 · 외부 확인 없음", reviewSource: "검토용", one: "1회", several: "여러 번",
    evidenceKind: "근거", updated: "최근 갱신", currentSession: "현재 세션", noUpdate: "아직 활동 없음", openEvidence: "근거 보기",
    historyBoundary: "각 기록은 서로 독립적이며 안전·성품·전문성 점수가 아니에요.",
  },
  ja: {
    profileTitle: "公開プロフィール", private: "公開情報なし", partial: "選んだ情報だけ公開",
    scope: "表示したい項目だけ選んでください。", edit: "編集", locked: "アカウントを設定すると、プロフィールを追加できます。",
    name: "表示名", from: "出身", lives: "居住地", languages: "使用言語", include: "公開", exclude: "非公開",
    addValue: "入力後に公開できます", self: "自分で入力", save: "変更を保存", saved: "変更を保存しました", retry: "もう一度試す", cancel: "キャンセル",
    saving: "保存中", done: "完了",
    failed: "保存できませんでした。現在の公開内容は変わりません。", privacy: "プロフィール項目について",
    boundary: "自分で入力した情報です。本人確認の情報は自動入力されません。", publicView: "ほかの人に見える内容",
    publicEmpty: "公開中のプロフィール情報はありません", unchanged: "現在の公開プロフィール", discardTitle: "変更を破棄しますか？",
    discard: "変更を破棄", keepEditing: "編集を続ける", activityTitle: "アクティビティ", activityNote: "別々の4つの記録",
    identity: "本人確認", visit: "訪問", contribution: "旅のヒント", meetup: "Table", identitySource: "本人確認",
    visitSource: "場所の履歴", contributionSource: "共有したヒント", meetupSource: "参加したTable", noHistory: "まだなし",
    ready: "準備済み", reviewCurrent: "レビュー用結果 · 外部確認なし", reviewExpired: "レビュー用結果は期限切れ · 外部確認なし", reviewSource: "レビュー用", one: "1件", several: "複数",
    evidenceKind: "根拠", updated: "最終更新", currentSession: "現在のセッション", noUpdate: "アクティビティなし", openEvidence: "根拠を見る",
    historyBoundary: "各記録は独立しています。安全性、人柄、専門性の評価ではありません。",
  },
} as const

const ENTRY_COPY = {
  en: { label: "Public profile", body: "Choose what others can see", close: "Close profile" },
  ko: { label: "공개 프로필", body: "보여줄 정보만 선택", close: "프로필 닫기" },
  ja: { label: "公開プロフィール", body: "表示する情報だけ選択", close: "プロフィールを閉じる" },
} as const

type Draft = {
  displayName: string; from: string; livesIn: string; languages: string
  shareFrom: boolean; shareLivesIn: boolean; shareLanguages: boolean
}

function draftFrom(profile: BActivityProfile): Draft {
  return {
    displayName: profile.displayName,
    from: profile.from.value,
    livesIn: profile.livesIn.value,
    languages: profile.languages.value.join(", "),
    shareFrom: profile.from.consent,
    shareLivesIn: profile.livesIn.consent,
    shareLanguages: profile.languages.consent,
  }
}

function profileFrom(draft: Draft): BActivityProfile {
  const from = draft.from.trim()
  const livesIn = draft.livesIn.trim()
  const languages = draft.languages.split(",").map((item) => item.trim()).filter(Boolean)
  return {
    displayName: draft.displayName,
    from: { value: from, consent: Boolean(from) && draft.shareFrom },
    livesIn: { value: livesIn, consent: Boolean(livesIn) && draft.shareLivesIn },
    languages: { value: languages, consent: languages.length > 0 && draft.shareLanguages },
  }
}

function sameProfile(left: BActivityProfile, right: BActivityProfile) {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function ProfileReputationB({ locale, accountActive, personAxis, statusClock = Date.now(), startEditing = false, entryOrigin, onExit, registerHostExitGuard }: Props) {
  const { state, actions } = useBActivityProfile()
  const copy = COPY[locale]
  const [editing, setEditing] = useState(false)
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  const [savePhase, setSavePhase] = useState<"idle" | "pending" | "saved" | "failed">("idle")
  const [saveAnnouncement, setSaveAnnouncement] = useState("")
  const [draft, setDraft] = useState(() => draftFrom(state.profile))
  const editRef = useRef<HTMLButtonElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const retryRef = useRef<HTMLButtonElement>(null)
  const keepEditingRef = useRef<HTMLButtonElement>(null)
  const discardPromptRef = useRef<HTMLElement>(null)
  const failConsumedRef = useRef(false)
  const startedEditingRef = useRef(false)
  const cancelPendingSaveRef = useRef<(() => void) | null>(null)
  const pendingHostExitRef = useRef<(() => boolean) | null>(null)
  const lastPaintedProfileRef = useRef<ReactNode>(null)
  const hostExitVisualSnapshotRef = useRef<ReactNode>(null)

  useEffect(() => () => {
    cancelPendingSaveRef.current?.()
    pendingHostExitRef.current = null
    hostExitVisualSnapshotRef.current = null
  }, [])

  useEffect(() => { if (!editing) setDraft(draftFrom(state.profile)) }, [editing, state.profile])
  useEffect(() => {
    if (!editing || confirmingDiscard) return
    const frame = window.requestAnimationFrame(() => {
      nameRef.current?.scrollIntoView({ block: "center", behavior: "instant" })
      nameRef.current?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [editing, confirmingDiscard])
  useEffect(() => {
    if (!confirmingDiscard) return
    const frame = window.requestAnimationFrame(() => {
      discardPromptRef.current?.scrollIntoView({ block: "nearest", behavior: "instant" })
      keepEditingRef.current?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [confirmingDiscard])
  useEffect(() => {
    if (!state.hydrated || !accountActive || !startEditing || startedEditingRef.current) return
    startedEditingRef.current = true
    setDraft(draftFrom(state.profile))
    setEditing(true)
  }, [accountActive, startEditing, state.hydrated, state.profile])

  const candidate = useMemo(() => profileFrom(draft), [draft])
  const dirty = editing && !sameProfile(candidate, state.profile)
  const published = useMemo(() => publicBActivityProfile(state.profile), [state.profile])
  const candidatePublic = useMemo(() => publicBActivityProfile(candidate), [candidate])
  const failed = savePhase === "failed"
  const pending = savePhase === "pending"
  const savedResult = savePhase === "saved"
  const editorState = !editing ? "published" : failed ? "save-failed" : pending ? "save-pending" : savedResult ? "saved" : "editing"
  const shownProfile = editing && !failed ? candidatePublic : published
  const partial = Boolean(published.from || published.livesIn || published.languages?.length)
  const personPresentation = resolveTravelerAxisPresentationB(personAxis, statusClock)
  const personVerified = personPresentation.outcome === "success"
  const personReviewResult = personPresentation.reviewResult

  useModalIsolation(confirmingDiscard, discardPromptRef)
  useDocumentScrollLock(confirmingDiscard)

  function finishEditor() {
    setEditing(false); setSavePhase("idle"); setConfirmingDiscard(false); setDraft(draftFrom(state.profile))
    window.requestAnimationFrame(() => editRef.current?.focus({ preventScroll: true }))
  }

  function stopPendingSave() {
    cancelPendingSaveRef.current?.()
    cancelPendingSaveRef.current = null
    setSavePhase("idle")
  }

  function continueWithFrozenHostExit(continueExit: () => boolean) {
    hostExitVisualSnapshotRef.current = lastPaintedProfileRef.current ?? liveProfileSurface
    const exited = continueExit()
    if (!exited) hostExitVisualSnapshotRef.current = null
    return exited
  }

  useEffect(() => {
    if (!registerHostExitGuard) return
    const guard: ProfileHostExitGuardB = {
      requestExit(continueExit) {
        if (confirmingDiscard) {
          pendingHostExitRef.current ??= continueExit
          return false
        }
        if (pending) stopPendingSave()
        if (editing && dirty) {
          pendingHostExitRef.current = continueExit
          setConfirmingDiscard(true)
          return false
        }
        return continueWithFrozenHostExit(continueExit)
      },
      resumeAfterInterruptedExit() {
        hostExitVisualSnapshotRef.current = null
        pendingHostExitRef.current = null
        cancelPendingSaveRef.current?.()
        cancelPendingSaveRef.current = null
        setConfirmingDiscard(false)
        setSavePhase("idle")
        setSaveAnnouncement("")
        setDraft(draftFrom(state.profile))
      },
    }
    registerHostExitGuard(guard)
    return () => registerHostExitGuard(null)
  }, [confirmingDiscard, dirty, editing, pending, registerHostExitGuard, state.profile])

  function keepEditingAfterExitRequest() {
    pendingHostExitRef.current = null
    setConfirmingDiscard(false)
  }

  function discardEditorChanges() {
    const continueHostExit = pendingHostExitRef.current
    pendingHostExitRef.current = null
    if (continueHostExit) {
      if (!continueWithFrozenHostExit(continueHostExit)) pendingHostExitRef.current = continueHostExit
      return
    }
    if (onExit) onExit()
    else finishEditor()
  }

  function exitEntry() {
    if (!onExit) return
    if (confirmingDiscard) return
    if (pending) stopPendingSave()
    if (editing && dirty) {
      setConfirmingDiscard(true)
      return
    }
    onExit()
  }

  function requestCancel() {
    if (pending) stopPendingSave()
    if (dirty) setConfirmingDiscard(true)
    else finishEditor()
  }

  function updateDraft(update: (current: Draft) => Draft) {
    setDraft(update)
    if (savePhase !== "idle") setSavePhase("idle")
    if (saveAnnouncement) setSaveAnnouncement("")
  }

  function saveProfile() {
    if (pending) return
    if (savedResult && !dirty) {
      if (onExit) onExit()
      else finishEditor()
      return
    }
    setSavePhase("pending")
    setSaveAnnouncement("")
    cancelPendingSaveRef.current?.()
    // Local persistence is synchronous. Two animation-frame boundaries keep
    // pending visible for at least one actual paint and cancellable before the
    // mutation begins.
    cancelPendingSaveRef.current = scheduleAfterNextPaintB(window, () => {
        cancelPendingSaveRef.current = null
        const qa = readQaRuntime<{ profile?: "failure" }>()
        const injectedFailure = qa?.profile === "failure" && !failConsumedRef.current
        if (injectedFailure) {
          failConsumedRef.current = true
          if (qa) delete qa.profile
          setSavePhase("failed")
          setSaveAnnouncement(copy.failed)
          window.requestAnimationFrame(() => retryRef.current?.focus({ preventScroll: true }))
          return
        }
        if (!actions.updateProfile(candidate)) {
          setSavePhase("failed")
          setSaveAnnouncement(copy.failed)
          window.requestAnimationFrame(() => retryRef.current?.focus({ preventScroll: true }))
          return
        }
        setSavePhase("saved")
        setSaveAnnouncement(copy.saved)
        window.requestAnimationFrame(() => retryRef.current?.focus({ preventScroll: true }))
    })
  }

  const latestAxisReceipt = (axis: "visit" | "contribution" | "meetup") => [...state.evidenceReceipts].reverse().find((receipt) => receipt.axes.includes(axis)) ?? null
  const axes = [
    { id: "identity" as const, label: copy.identity, value: personVerified ? "verified" : "new", active: personVerified, reviewResult: personReviewResult, icon: personReviewResult ? ShieldCheck : BadgeCheck, source: personReviewResult ? copy.reviewSource : copy.identitySource, text: personReviewResult === "current" ? copy.reviewCurrent : personReviewResult === "expired" ? copy.reviewExpired : personVerified ? copy.ready : copy.noHistory, updatedAt: personAxis.reviewReceipt?.issuedAt ?? (personVerified ? copy.currentSession : null) },
    { id: "visit" as const, label: copy.visit, value: state.reputation.visit, active: state.reputation.visit !== "new", reviewResult: null, icon: Footprints, source: copy.visitSource, text: state.reputation.visit === "new" ? copy.noHistory : state.reputation.visit === "recent" ? copy.one : copy.several, updatedAt: latestAxisReceipt("visit")?.recordedAt ?? null },
    { id: "contribution" as const, label: copy.contribution, value: state.reputation.contribution, active: state.reputation.contribution !== "new", reviewResult: null, icon: HandHeart, source: copy.contributionSource, text: state.reputation.contribution === "new" ? copy.noHistory : state.reputation.contribution === "helpful" ? copy.one : copy.several, updatedAt: latestAxisReceipt("contribution")?.recordedAt ?? null },
    { id: "meetup" as const, label: copy.meetup, value: state.reputation.meetup, active: state.reputation.meetup !== "new", reviewResult: null, icon: UsersRound, source: copy.meetupSource, text: state.reputation.meetup === "new" ? copy.noHistory : state.reputation.meetup === "reliable" ? copy.one : copy.several, updatedAt: latestAxisReceipt("meetup")?.recordedAt ?? null },
  ]

  const liveProfileSurface = !state.hydrated ? (
      <section className={styles.root} data-testid="ondo-b-profile-activity" data-profile-hydration="loading" aria-busy="true">
        <article className={`${styles.profileCard} ${styles.profileLoading}`} aria-hidden="true"><i /><i /><i /></article>
      </section>
    ) : (
    <section className={styles.root} data-testid="ondo-b-profile-activity" data-entry-origin={entryOrigin ?? "travel_pass"}>
      <article className={styles.profileCard} data-testid="ondo-profile-panel" data-state={partial ? "partial" : "private"} data-editor-state={editorState}>
        <header className={styles.cardHeader}>
          <div><h2>{copy.profileTitle}</h2><p>{editing ? copy.scope : partial ? copy.partial : copy.private}</p></div>
          <div className={styles.cardHeaderActions}>
            {accountActive && !editing ? <button ref={editRef} type="button" aria-label={copy.edit} className={styles.editButton} onClick={() => { setSaveAnnouncement(""); setSavePhase("idle"); setDraft(draftFrom(state.profile)); setEditing(true) }}><Pencil size={17} aria-hidden="true" /><span>{copy.edit}</span></button> : null}
            {onExit ? <button type="button" className={styles.exitButton} aria-label={ENTRY_COPY[locale].close} onClick={exitEntry}><X size={18} aria-hidden="true" /></button> : null}
          </div>
        </header>

        <p className={styles.srOnly} role="status" aria-live="polite" aria-atomic="true" data-testid="profile-save-announcement">{saveAnnouncement}</p>

        {!accountActive ? (
          <div className={styles.locked}><LockKeyhole size={20} aria-hidden="true" /><p>{copy.locked}</p></div>
        ) : editing ? (
          <div className={styles.editorLayout}>
            <div className={styles.form}>
              <p className={styles.editorNote}>{copy.boundary}</p>
              <label className={styles.nameField} htmlFor="profile-display-name"><span>{copy.name}</span><input id="profile-display-name" ref={nameRef} name="displayName" aria-label={copy.name} value={draft.displayName} maxLength={40} onChange={(event) => updateDraft((current) => ({ ...current, displayName: event.target.value }))} /></label>
              <ConsentField id="profile-from-b" locale={locale} label={copy.from} icon={<Globe2 size={17} aria-hidden="true" />} value={draft.from} consent={draft.shareFrom} onValue={(from) => updateDraft((current) => ({ ...current, from, shareFrom: from.trim() ? current.shareFrom : false }))} onConsent={(shareFrom) => { updateDraft((current) => ({ ...current, shareFrom })); setSaveAnnouncement(`${copy.from}: ${shareFrom ? copy.include : copy.exclude}`) }} />
              <ConsentField id="profile-lives-in-b" locale={locale} label={copy.lives} icon={<MapPin size={17} aria-hidden="true" />} value={draft.livesIn} consent={draft.shareLivesIn} onValue={(livesIn) => updateDraft((current) => ({ ...current, livesIn, shareLivesIn: livesIn.trim() ? current.shareLivesIn : false }))} onConsent={(shareLivesIn) => { updateDraft((current) => ({ ...current, shareLivesIn })); setSaveAnnouncement(`${copy.lives}: ${shareLivesIn ? copy.include : copy.exclude}`) }} />
              <ConsentField id="profile-languages-b" locale={locale} label={copy.languages} icon={<Languages size={17} aria-hidden="true" />} value={draft.languages} consent={draft.shareLanguages} onValue={(languages) => updateDraft((current) => ({ ...current, languages, shareLanguages: languages.trim() ? current.shareLanguages : false }))} onConsent={(shareLanguages) => { updateDraft((current) => ({ ...current, shareLanguages })); setSaveAnnouncement(`${copy.languages}: ${shareLanguages ? copy.include : copy.exclude}`) }} />
              {failed ? <p className={styles.error}>{copy.failed}</p> : null}
            </div>
            <PublicProfileView locale={locale} profile={shownProfile} unchanged={failed} />
            {savedResult ? <p className={styles.saveResult} data-testid="profile-save-result"><Check size={17} aria-hidden="true" />{copy.saved}</p> : null}
              {confirmingDiscard ? (
                <section
                  ref={discardPromptRef}
                  className={styles.discardPrompt}
                  role="alertdialog"
                  aria-modal="true"
                  aria-label={copy.discardTitle}
                  data-testid="profile-discard-prompt"
                  data-modal-layer-priority={ONDO_MODAL_PRIORITY.finalCritical}
                  onKeyDown={(event) => {
                    if (event.key !== "Escape") return
                    event.preventDefault()
                    event.stopPropagation()
                    keepEditingAfterExitRequest()
                  }}
                >
                  <strong>{copy.discardTitle}</strong>
                  <div><button ref={keepEditingRef} type="button" data-testid="profile-discard-keep" onClick={keepEditingAfterExitRequest}>{copy.keepEditing}</button><button type="button" data-testid="profile-discard-confirm" onClick={discardEditorChanges}>{copy.discard}</button></div>
                </section>
              ) : (
                <div className={styles.formActions}>
                  <button ref={retryRef} type="button" className={styles.saveButton} onClick={saveProfile} disabled={pending || (!dirty && !failed && !savedResult)} aria-busy={pending}>{pending ? <LoaderCircle className={styles.saveSpinner} size={17} aria-hidden="true" /> : failed ? <RotateCcw size={17} aria-hidden="true" /> : savedResult ? <Check size={17} aria-hidden="true" /> : <Save size={17} aria-hidden="true" />}{pending ? copy.saving : failed ? copy.retry : savedResult ? copy.done : copy.save}</button>
                  <button type="button" className={styles.cancelButton} onClick={requestCancel}>{copy.cancel}</button>
                </div>
              )}
          </div>
        ) : <PublicProfileView locale={locale} profile={published} unchanged={false} />}
        <details className={styles.boundary}>
          <summary aria-label={copy.privacy}><Info size={16} aria-hidden="true" /><span>{copy.privacy}</span></summary>
          <span>{copy.boundary}</span>
        </details>
      </article>

      <article className={styles.historyCard} data-testid="ondo-trust-panel">
        <header className={styles.cardHeader}><div><h2>{copy.activityTitle}</h2><p>{copy.activityNote}</p></div></header>
        <div className={styles.axes}>
          {axes.map((axis) => {
            const Icon = axis.icon
            const active = axis.active
            const updated = axis.updatedAt && axis.updatedAt !== copy.currentSession ? axis.updatedAt.slice(0, 16).replace("T", " ") : axis.updatedAt
            return <details key={axis.id} className={styles.axis} data-axis={axis.id} data-axis-state={active ? "recorded" : "empty"} data-review-result={axis.reviewResult ?? "none"} data-testid={`profile-axis-${axis.id}`}>
              <summary aria-label={`${axis.label}: ${axis.text}. ${copy.openEvidence}`}>
                <span className={styles.axisIcon}><Icon size={19} aria-hidden="true" /></span>
                <span className={styles.axisCopy}><strong>{axis.label}</strong><small>{axis.source}</small></span>
                <span className={styles.axisState}>{active ? <Check size={15} aria-hidden="true" /> : <CircleMinus size={15} aria-hidden="true" />}<b>{axis.text}</b></span>
                <ChevronRight className={styles.axisChevron} size={16} aria-hidden="true" />
              </summary>
              <div className={styles.axisEvidence} data-testid={`profile-axis-evidence-${axis.id}`}>
                <span><small>{copy.evidenceKind}</small><strong>{axis.source}</strong></span>
                <span><small>{copy.updated}</small><strong>{updated ?? copy.noUpdate}</strong></span>
              </div>
            </details>
          })}
        </div>
        <details className={styles.boundary}>
          <summary aria-label={copy.privacy}><Info size={16} aria-hidden="true" /><span>{copy.privacy}</span></summary>
          <span>{copy.historyBoundary}</span>
        </details>
      </article>
    </section>
  )

  useLayoutEffect(() => {
    if (hostExitVisualSnapshotRef.current === null) lastPaintedProfileRef.current = liveProfileSurface
  }, [liveProfileSurface])

  return hostExitVisualSnapshotRef.current ?? liveProfileSurface
}

const PublicProfileView = forwardRef<HTMLElement, { locale: OndoBLocale; profile: BPublicActivityProfile; unchanged: boolean }>(function PublicProfileView({ locale, profile, unchanged }, ref) {
  const copy = COPY[locale]
  const hasDetails = Boolean(profile.from || profile.livesIn || profile.languages?.length)
  return (
    <section ref={ref} className={styles.publicView} aria-labelledby="public-profile-view-title" data-testid="public-profile-view" data-public-state={hasDetails ? "partial" : "private"} tabIndex={0}>
      <header><span><Eye size={17} aria-hidden="true" /><strong id="public-profile-view-title">{copy.publicView}</strong></span>{unchanged ? <small>{copy.unchanged}</small> : null}</header>
      <h3>{profile.displayName}</h3>
      {hasDetails ? <dl>
        {profile.from ? <div data-public-field="from"><dt><Globe2 size={15} aria-hidden="true" />{copy.from}</dt><dd>{profile.from}</dd></div> : null}
        {profile.livesIn ? <div data-public-field="lives-in"><dt><MapPin size={15} aria-hidden="true" />{copy.lives}</dt><dd>{profile.livesIn}</dd></div> : null}
        {profile.languages?.length ? <div data-public-field="languages"><dt><Languages size={15} aria-hidden="true" />{copy.languages}</dt><dd>{profile.languages.join(" · ")}</dd></div> : null}
      </dl> : <p><LockKeyhole size={17} aria-hidden="true" />{copy.publicEmpty}</p>}
    </section>
  )
})

type ProfileEntryOrigin = "my_korea" | "table_host"

function nearestScrollOwner(element: HTMLElement): HTMLElement | null {
  let current = element.parentElement
  while (current) {
    const style = window.getComputedStyle(current)
    if (/(auto|scroll)/.test(`${style.overflowY} ${style.overflow}`) && current.scrollHeight > current.clientHeight) return current
    current = current.parentElement
  }
  return null
}

/**
 * Reuses the single profile surface in contextual hosts. The opener stays in
 * the DOM so closing can restore the exact host scroll position and focus
 * without routing through the Travel Pass tab.
 */
export function ProfileReputationEntryB({ locale, accountActive, origin, registerHostExitGuard }: {
  locale: OndoBLocale
  accountActive: boolean
  origin: ProfileEntryOrigin
  registerHostExitGuard?: (guard: ProfileHostExitGuardB | null) => void
}) {
  const copy = ENTRY_COPY[locale]
  const panelId = useId()
  const openerRef = useRef<HTMLButtonElement>(null)
  const returnRef = useRef<{ owner: HTMLElement | null; scrollTop: number; windowY: number } | null>(null)
  const [open, setOpen] = useState(false)
  const [personAxis, setPersonAxis] = useState<BActionAxis>(DEFAULT_B_ACTION_GATE_SESSION.person)
  const [statusClock, setStatusClock] = useState(() => Date.now())

  useEffect(() => {
    let expiryTimer: number | undefined
    const refresh = () => {
      if (expiryTimer !== undefined) window.clearTimeout(expiryTimer)
      expiryTimer = undefined
      try {
        const person = restoreBActionGateSession(window.sessionStorage, new Date(), qaReviewFixtureOptions()).person
        const expiresAt = person.reviewReceipt?.expiresAt ? Date.parse(person.reviewReceipt.expiresAt) : Number.NaN
        const now = Date.now()
        setPersonAxis(person)
        setStatusClock(now)
        if (Number.isFinite(expiresAt) && expiresAt > now) expiryTimer = window.setTimeout(refresh, Math.min(2_147_483_647, Math.max(1, expiresAt - now + 16)))
      } catch { setPersonAxis(DEFAULT_B_ACTION_GATE_SESSION.person); setStatusClock(Date.now()) }
    }
    refresh()
    const sync = (event: StorageEvent) => { if (event.key === B_ACTION_GATE_SESSION_KEY) refresh() }
    window.addEventListener("storage", sync)
    window.addEventListener(B_ACTION_AXIS_SESSION_EVENT, refresh)
    return () => {
      window.removeEventListener("storage", sync)
      window.removeEventListener(B_ACTION_AXIS_SESSION_EVENT, refresh)
      if (expiryTimer !== undefined) window.clearTimeout(expiryTimer)
    }
  }, [])

  function openProfile() {
    const opener = openerRef.current
    if (!opener) return
    const owner = nearestScrollOwner(opener)
    returnRef.current = { owner, scrollTop: owner?.scrollTop ?? 0, windowY: window.scrollY }
    setOpen(true)
  }

  function closeProfile() {
    const snapshot = returnRef.current
    setOpen(false)
    window.requestAnimationFrame(() => {
      if (snapshot?.owner?.isConnected) snapshot.owner.scrollTop = snapshot.scrollTop
      else if (snapshot) window.scrollTo({ top: snapshot.windowY })
      openerRef.current?.focus({ preventScroll: true })
    })
  }

  return (
    <section className={styles.profileEntry} data-testid={`profile-entry-${origin}`} data-entry-origin={origin}>
      <button
        ref={openerRef}
        type="button"
        className={styles.profileEntryButton}
        data-testid={origin === "my_korea" ? "my-korea-profile-open" : "table-host-profile-open"}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={openProfile}
      >
        <span className={styles.profileEntryIcon}><CircleUserRound size={21} aria-hidden="true" /></span>
        <span><strong>{copy.label}</strong><small>{copy.body}</small></span>
        <ChevronRight size={18} aria-hidden="true" />
      </button>
      {open ? (
        <div id={panelId} className={styles.profileEntryPanel} data-testid={`profile-entry-panel-${origin}`}>
          <ProfileReputationB locale={locale} accountActive={accountActive} personAxis={personAxis} statusClock={statusClock} startEditing entryOrigin={origin} onExit={closeProfile} registerHostExitGuard={registerHostExitGuard} />
        </div>
      ) : null}
    </section>
  )
}

function ConsentField({ id, locale, label, icon, value, consent, onValue, onConsent }: {
  id: string; locale: OndoBLocale; label: string; icon: ReactNode; value: string; consent: boolean
  onValue(value: string): void; onConsent(value: boolean): void
}) {
  const copy = COPY[locale]
  const hasValue = Boolean(value.trim())
  const toggleLabel = locale === "ko"
    ? `${label}: ${consent ? "공개 중. 비공개로 변경" : hasValue ? "비공개. 공개로 변경" : copy.addValue}`
    : locale === "ja"
      ? `${label}: ${consent ? "公開中。非公開に変更" : hasValue ? "非公開。公開に変更" : copy.addValue}`
      : `${label}: ${consent ? "public. Make private" : hasValue ? "private. Make public" : copy.addValue}`
  return (
    <div className={styles.consentField} data-visibility={consent ? "public" : "private"}>
      <label className={styles.fieldLabel} htmlFor={id}>{icon}<span>{label}</span></label>
      <span className={styles.srOnly} id={`${id}-source`}>{copy.self}</span>
      <input id={id} name={id} aria-label={label} aria-describedby={`${id}-source`} value={value} maxLength={60} onChange={(event) => onValue(event.target.value)} />
      <button type="button" aria-pressed={consent} aria-label={toggleLabel} disabled={!hasValue} title={!hasValue ? copy.addValue : undefined} onClick={() => onConsent(!consent)}>{consent ? <Eye size={18} aria-hidden="true" /> : <EyeOff size={18} aria-hidden="true" />}<span>{consent ? copy.include : copy.exclude}</span></button>
    </div>
  )
}
