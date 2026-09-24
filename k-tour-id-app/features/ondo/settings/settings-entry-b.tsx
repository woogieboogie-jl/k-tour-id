"use client"

import { useLayoutEffect, useMemo, useRef, useState } from "react"
import {
  Bookmark,
  Check,
  ChevronRight,
  CircleAlert,
  IdCard,
  Languages,
  LockKeyhole,
  Monitor,
  Moon,
  RotateCcw,
  SlidersHorizontal,
  Sun,
  UsersRound,
  WalletCards,
} from "lucide-react"
import { qaReviewFixtureOptions } from "../shared/ui/use-qa-controls"
import type { OndoBAppearancePreference } from "../shared/state/ondo-b-appearance"
import { ONDO_B_DISCOVERY_PREFERENCES, type OndoBDiscoveryPreference, type OndoBLocale } from "../shared/state/ondo-b-preferences"
import { useOndoB } from "../shared/state/ondo-b-provider"
import { SheetB } from "../shared/ui/sheet-b"
import { useSheetPresence } from "../shared/ui/use-sheet-presence"
import {
  readSettingsPrivacySnapshotB,
  SETTINGS_PREFERENCE_SECTIONS_B,
  clearSettingsEditablePreferencesB,
  mergeSettingsPreferenceDraftB,
  settingsPreferenceSummaryB,
  settingsPreferencesEqualB,
  normalizeSettingsPreferencesB,
  unavailableSettingsPrivacySnapshotB,
  type SettingsPreferenceSectionB,
  type SettingsPrivacySnapshotB,
  type SettingsReadinessB,
} from "./settings-model-b"
import styles from "./settings-entry-b.module.css"
import { SampleInfoButtonB } from "../shared/ui/sample-info-button-b"
import { AccountServicesSampleB } from "./account-services-sample-b"

type SettingsSheet = "language" | "appearance" | "preferences" | "privacy" | "delete" | null
const LOCALE_NAME: Record<OndoBLocale, string> = { en: "English", ko: "한국어", ja: "日本語" }
const APPEARANCE_ICON = { system: Monitor, light: Sun, dark: Moon } satisfies Record<OndoBAppearancePreference, typeof Sun>

const COPY = {
  en: {
    title: "Settings", language: "Language", appearance: "Appearance", system: "System", light: "Light", dark: "Dark", preferences: "Discovery preferences", allPlaces: "All places",
    privacy: "Privacy & data", categories: (count: number) => `${count} ${count === 1 ? "category" : "categories"}`, unavailable: "Unavailable",
    languageError: "Language was not changed. Try again.", appearanceError: "Appearance was not changed. Try again.", save: "Save preferences", clearPreferences: "Clear selections",
    food: "Food", time: "Time", atmosphere: "Atmosphere", dietary: "Dietary needs",
    dietaryTruth: "Dietary choices highlight context. They do not claim confirmed support or hide places.",
    restart: "Set up discovery again", restartError: "Setup was not reset. Try again.", savedOnly: "Saved only on this device",
    discoveryGroup: "Discovery", savedPlaces: "Saved", recentPlaces: "Recent", choices: "Preferences", privateNotes: "Private notes",
    togetherGroup: "Together", tables: "Tables", signals: "Local signals", identityGroup: "ID", account: "Account", person: "Person", age: "19+", payment: "Payment", ktourId: "K-Tour ID",
    balanceGroup: "Travel balance", records: "Records", appGroup: "App settings", after19: "After 19 auto-open", on: "On", off: "Off",
    status: { ready: "Ready", not_set: "Not set", expired: "Expired", failed: "Failed", unavailable: "Unavailable", unsupported: "Unsupported", pending: "In progress" } as Record<SettingsReadinessB, string>,
    storageUnavailable: "Browser storage is unavailable. Explore still works; allow site storage to review or clear saved data.",
    deleteOpen: "Delete saved data", deleteHint: "Remove this browser's saved content", deleteTitle: "Delete saved data?", deleteLead: "This cannot be undone on this device.",
    deleteGroups: ["Places, recent views, preferences and private notes", "Tables, Local Signals, visit stamps and activity", "Account, Person, 19+, Payment and K-Tour ID state", "Travel balance records, After 19 preference and Labs state"],
    deleteKeeps: "Language, appearance and travel intent stay.", keep: "Keep data", delete: "Delete saved data",
    deleteFailed: "Nothing changed. Try again.", deleteRollbackFailed: "Some saved data could not be restored. Reload and review this page before trying again.", deleted: "Saved data deleted.",
  },
  ko: {
    title: "설정", language: "언어", appearance: "화면 모드", system: "기기 설정", light: "라이트", dark: "다크", preferences: "탐색 취향", allPlaces: "모두 보기", privacy: "개인정보·데이터", categories: (count: number) => `${count}개 범주`, unavailable: "사용할 수 없음",
    languageError: "언어를 바꾸지 못했어요. 다시 시도해 주세요.", appearanceError: "화면 모드를 바꾸지 못했어요. 다시 시도해 주세요.", save: "취향 저장", clearPreferences: "선택 비우기",
    food: "음식", time: "시간대", atmosphere: "분위기", dietary: "식이 요구", dietaryTruth: "식이 선택은 탐색 맥락을 강조할 뿐, 지원을 보장하거나 장소를 숨기지 않아요.",
    restart: "탐색 설정 다시 하기", restartError: "처음 설정을 다시 열지 못했어요. 다시 시도해 주세요.", savedOnly: "이 기기에만 저장",
    discoveryGroup: "발견", savedPlaces: "저장", recentPlaces: "최근 본 곳", choices: "취향", privateNotes: "개인 메모",
    togetherGroup: "함께 먹기", tables: "테이블", signals: "로컬 시그널", identityGroup: "ID", account: "계정", person: "본인", age: "19+", payment: "결제", ktourId: "K-Tour ID",
    balanceGroup: "여행 잔액", records: "기록", appGroup: "앱 설정", after19: "After 19 자동 열기", on: "켬", off: "끔",
    status: { ready: "준비됨", not_set: "설정 안 됨", expired: "만료됨", failed: "실패", unavailable: "사용할 수 없음", unsupported: "지원 안 됨", pending: "진행 중" } as Record<SettingsReadinessB, string>,
    storageUnavailable: "브라우저 저장 공간을 사용할 수 없어요. 탐색은 계속할 수 있으며, 저장 내용을 확인하거나 지우려면 사이트 저장을 허용해 주세요.",
    deleteOpen: "저장 내용 삭제", deleteHint: "이 브라우저에 저장한 내용 지우기", deleteTitle: "저장 내용을 삭제할까요?", deleteLead: "이 기기에서는 되돌릴 수 없어요.",
    deleteGroups: ["저장·최근 본 장소, 탐색 취향, 개인 메모", "테이블, 로컬 시그널, 방문 스탬프, 활동 기록", "계정·본인·19+·결제·K-Tour ID 상태", "여행 잔액 기록, After 19 설정, Labs 상태"],
    deleteKeeps: "언어, 화면 모드와 여행 목적은 유지됩니다.", keep: "유지", delete: "저장 내용 삭제", deleteFailed: "변경된 내용이 없어요. 다시 시도해 주세요.",
    deleteRollbackFailed: "일부 저장 내용을 복원하지 못했어요. 새로고침한 뒤 이 페이지를 확인해 주세요.", deleted: "저장 내용을 삭제했어요.",
  },
  ja: {
    title: "設定", language: "言語", appearance: "表示モード", system: "システム", light: "ライト", dark: "ダーク", preferences: "探索の好み", allPlaces: "すべて表示", privacy: "プライバシーとデータ", categories: (count: number) => `${count}カテゴリー`, unavailable: "利用できません",
    languageError: "言語を変更できませんでした。もう一度お試しください。", appearanceError: "表示モードを変更できませんでした。もう一度お試しください。", save: "好みを保存", clearPreferences: "選択をクリア",
    food: "食べ物", time: "時間帯", atmosphere: "雰囲気", dietary: "食事条件", dietaryTruth: "食事条件は探索の文脈を強調します。対応を保証したり、場所を非表示にしたりはしません。",
    restart: "探索設定をやり直す", restartError: "初期設定を開き直せませんでした。もう一度お試しください。", savedOnly: "この端末にのみ保存",
    discoveryGroup: "見つける", savedPlaces: "保存", recentPlaces: "最近見た場所", choices: "好み", privateNotes: "プライベートメモ",
    togetherGroup: "一緒に食べる", tables: "テーブル", signals: "ローカルシグナル", identityGroup: "ID", account: "アカウント", person: "本人", age: "19+", payment: "決済", ktourId: "K-Tour ID",
    balanceGroup: "旅の残高", records: "記録", appGroup: "アプリ設定", after19: "After 19の自動表示", on: "オン", off: "オフ",
    status: { ready: "準備済み", not_set: "未設定", expired: "期限切れ", failed: "失敗", unavailable: "利用できません", unsupported: "非対応", pending: "進行中" } as Record<SettingsReadinessB, string>,
    storageUnavailable: "ブラウザの保存領域を利用できません。探索は続けられます。保存内容の確認や削除にはサイトの保存を許可してください。",
    deleteOpen: "保存データを削除", deleteHint: "このブラウザに保存した内容を消去", deleteTitle: "保存データを削除しますか？", deleteLead: "この端末では元に戻せません。",
    deleteGroups: ["保存・最近見た場所、探索の好み、プライベートメモ", "テーブル、ローカルシグナル、訪問スタンプ、アクティビティ", "アカウント・本人・19+・決済・K-Tour IDの状態", "旅の残高記録、After 19設定、Labsの状態"],
    deleteKeeps: "言語、表示モード、旅の目的は残ります。", keep: "保持する", delete: "保存データを削除", deleteFailed: "変更はありません。もう一度お試しください。",
    deleteRollbackFailed: "一部の保存内容を復元できませんでした。再読み込みしてこのページを確認してください。", deleted: "保存データを削除しました。",
  },
} as const

const SECTION_ICONS: Record<SettingsPreferenceSectionB, typeof Bookmark> = { food: Bookmark, dietary: CircleAlert }

function readPrivacySnapshot(state: Parameters<typeof readSettingsPrivacySnapshotB>[0]["state"]): SettingsPrivacySnapshotB | null {
  if (typeof window === "undefined") return null
  try {
    return readSettingsPrivacySnapshotB({ state, deviceStorage: window.localStorage, sessionStorage: window.sessionStorage, ...qaReviewFixtureOptions() })
  } catch {
    // Some privacy modes reject access while resolving the Storage objects,
    // before `getItem` can be attempted. Never present that as empty data.
    return unavailableSettingsPrivacySnapshotB(state)
  }
}

function Fact({ label, value }: { label: string; value: string | number }) {
  return <div className={styles.fact}><span>{label}</span><strong>{value}</strong></div>
}

function Axis({ label, status, copy }: { label: string; status: SettingsReadinessB; copy: Record<SettingsReadinessB, string> }) {
  return <div className={styles.axis} data-status={status}><strong>{label}</strong><span>{copy[status]}</span></div>
}

export function SettingsEntryB() {
  const { state, actions } = useOndoB()
  const [sheet, setSheet] = useState<SettingsSheet>(null)
  const [draftPreferences, setDraftPreferences] = useState<OndoBDiscoveryPreference[]>([])
  const [languageError, setLanguageError] = useState(false)
  const [appearanceError, setAppearanceError] = useState(false)
  const [preferenceError, setPreferenceError] = useState(false)
  const [resetError, setResetError] = useState(false)
  const [deleteError, setDeleteError] = useState<"unchanged" | "uncertain" | null>(null)
  const [deleting, setDeleting] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const privacyRowRef = useRef<HTMLButtonElement>(null)
  const locale = state.locale
  const sheetPresence = useSheetPresence(sheet)
  const copy = COPY[locale]
  const preferenceSummary = settingsPreferenceSummaryB(locale, state.discoveryPreferences)
  const CurrentAppearanceIcon = APPEARANCE_ICON[state.appearancePreference]
  const privacySnapshot = useMemo(() => readPrivacySnapshot(state), [state, sheet])
  const draftDirty = !settingsPreferencesEqualB(draftPreferences, state.discoveryPreferences)

  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const active = document.activeElement
      if (active && active !== document.body && active.isConnected) return
      headingRef.current?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [])

  function closeSheet() {
    setSheet(null); setLanguageError(false); setAppearanceError(false); setPreferenceError(false); setResetError(false); setDeleteError(null); setDeleting(false)
  }

  function openPreferences() {
    setDraftPreferences([...state.discoveryPreferences]); setPreferenceError(false); setResetError(false); setSheet("preferences")
  }

  function togglePreference(id: OndoBDiscoveryPreference) {
    setPreferenceError(false)
    setDraftPreferences((current) => current.includes(id) ? current.filter((preference) => preference !== id) : normalizeSettingsPreferencesB([...current, id]))
  }

  function savePreferences() {
    const next = mergeSettingsPreferenceDraftB(state.discoveryPreferences, draftPreferences)
    if (!actions.setDiscoveryPreferences(next)) { setPreferenceError(true); return }
    closeSheet()
  }

  function changeLanguage(next: OndoBLocale) {
    setLanguageError(false)
    if (!actions.setLocale(next)) setLanguageError(true)
  }

  function changeAppearance(next: OndoBAppearancePreference) {
    setAppearanceError(false)
    if (!actions.setAppearancePreference(next)) setAppearanceError(true)
  }

  function confirmDelete() {
    if (deleting) return
    setDeleting(true); setDeleteError(null)
    window.requestAnimationFrame(() => {
      const result = actions.clearBDeviceContent()
      setDeleting(false)
      if (!result.ok) { setDeleteError(result.rollback === "complete" ? "unchanged" : "uncertain"); return }
      actions.notify(COPY[state.locale].deleted)
      closeSheet()
    })
  }

  return (
    <div className={styles.page} data-testid="ondo-b-settings-entry" data-page-typography="root" data-visual-direction="quiet-mobile-settings">
      <header className={styles.header} data-page-title-frame><h1 data-page-title ref={headingRef} tabIndex={-1}>{copy.title}</h1><SampleInfoButtonB /></header>
      <div className={styles.rows}>
        <button type="button" className={styles.row} onClick={() => { setLanguageError(false); setSheet("language") }} data-testid="settings-language-row">
          <span className={styles.rowIcon} aria-hidden="true"><Languages size={21} /></span><span className={styles.rowCopy}><strong>{copy.language}</strong><span className={styles.rowValue}>{LOCALE_NAME[locale]}</span></span><ChevronRight className={styles.chevron} size={19} aria-hidden="true" />
        </button>
        <button type="button" className={styles.row} onClick={() => { setAppearanceError(false); setSheet("appearance") }} data-testid="settings-appearance-row">
          <span className={styles.rowIcon} aria-hidden="true"><CurrentAppearanceIcon size={21} /></span><span className={styles.rowCopy}><strong>{copy.appearance}</strong><span className={styles.rowValue}>{copy[state.appearancePreference]}</span></span><ChevronRight className={styles.chevron} size={19} aria-hidden="true" />
        </button>
        <button type="button" className={styles.row} onClick={openPreferences} data-testid="ondo-b-discovery-settings">
          <span className={styles.rowIcon} aria-hidden="true"><SlidersHorizontal size={21} /></span><span className={styles.rowCopy}><strong>{copy.preferences}</strong><span className={styles.rowValue}>{preferenceSummary.total === 0 ? copy.allPlaces : <>{preferenceSummary.labels.map((label) => <span key={label} className={styles.summaryChip}>{label}</span>)}{preferenceSummary.overflow > 0 ? <span className={styles.summaryCount}>+{preferenceSummary.overflow}</span> : null}</>}</span></span><ChevronRight className={styles.chevron} size={19} aria-hidden="true" />
        </button>
        <button ref={privacyRowRef} type="button" className={styles.row} onClick={() => { setDeleteError(null); setSheet("privacy") }} data-sheet-return-focus="true" data-testid="ondo-b-device-data-settings" data-status={privacySnapshot?.storageAvailable === false ? "unavailable" : "ready"}>
          <span className={styles.rowIcon} aria-hidden="true"><LockKeyhole size={21} /></span><span className={styles.rowCopy}><strong>{copy.privacy}</strong><span className={styles.rowValue}>{privacySnapshot?.storageAvailable === false ? copy.unavailable : copy.categories(privacySnapshot?.categoryCount ?? 0)}</span></span><ChevronRight className={styles.chevron} size={19} aria-hidden="true" />
        </button>
      </div>

      {sheetPresence.value === "language" ? <SheetB key="language" presenceState={sheetPresence.phase} locale={locale} label={copy.language} onClose={closeSheet} variant="decision" header={<span>{copy.language}</span>}><div className={styles.sheetBody}>
        <div className={styles.languageList} role="radiogroup" aria-label={copy.language} data-testid="settings-language-control">{(["ko", "en", "ja"] as const).map((choice) => <button key={choice} type="button" className={styles.languageChoice} role="radio" aria-checked={locale === choice} onClick={() => changeLanguage(choice)}><strong>{LOCALE_NAME[choice]}</strong><span className={styles.choiceMark} aria-hidden="true">{locale === choice ? <Check size={16} /> : null}</span></button>)}</div>
        {languageError ? <p className={styles.inlineError} role="alert" data-testid="ondo-b-language-error">{copy.languageError}</p> : null}
      </div></SheetB> : null}

      {sheetPresence.value === "appearance" ? <SheetB key="appearance" presenceState={sheetPresence.phase} locale={locale} label={copy.appearance} onClose={closeSheet} variant="decision" header={<span>{copy.appearance}</span>}><div className={styles.sheetBody}>
        <div className={styles.appearanceList} role="radiogroup" aria-label={copy.appearance} data-testid="settings-appearance-control">{(["system", "light", "dark"] as const).map((choice) => { const Icon = APPEARANCE_ICON[choice]; return <button key={choice} type="button" className={styles.appearanceChoice} role="radio" aria-checked={state.appearancePreference === choice} data-testid={`settings-appearance-${choice}`} onClick={() => changeAppearance(choice)}><span className={styles.appearanceIcon} aria-hidden="true"><Icon size={21} /></span><strong>{copy[choice]}</strong><span className={styles.choiceMark} aria-hidden="true">{state.appearancePreference === choice ? <Check size={16} /> : null}</span></button> })}</div>
        {appearanceError ? <p className={styles.inlineError} role="alert" data-testid="ondo-b-appearance-error">{copy.appearanceError}</p> : null}
      </div></SheetB> : null}

      {sheetPresence.value === "preferences" ? <SheetB key="preferences" presenceState={sheetPresence.phase} locale={locale} label={copy.preferences} onClose={closeSheet} variant="detail" header={<span>{copy.preferences}</span>} footer={<div className={styles.sheetFooter}><button type="button" className={styles.primary} disabled={!draftDirty} onClick={savePreferences} data-testid="settings-preferences-save">{copy.save}</button></div>}><div className={styles.sheetBody}>
        {SETTINGS_PREFERENCE_SECTIONS_B.map((section) => { const Icon = SECTION_ICONS[section.id]; return <fieldset className={styles.preferenceSection} key={section.id}><legend>{copy[section.id]}</legend><div className={styles.preferenceChoices}>{section.preferences.map((id) => { const option = ONDO_B_DISCOVERY_PREFERENCES.find((candidate) => candidate.id === id)!; const selected = draftPreferences.includes(id); return <button key={id} type="button" className={styles.preferenceChoice} aria-pressed={selected} data-testid={`settings-preference-${id}`} onClick={() => togglePreference(id)}>{selected ? <Check size={15} aria-hidden="true" /> : <Icon size={15} aria-hidden="true" />}{option.label[locale]}</button> })}</div>{section.id === "dietary" ? <p className={styles.dietaryNote}><CircleAlert size={15} aria-hidden="true" /><span>{copy.dietaryTruth}</span></p> : null}</fieldset> })}
        {preferenceError ? <p className={styles.inlineError} role="alert" data-testid="ondo-b-preferences-error">{copy.status.failed}</p> : null}
        {resetError ? <p className={styles.inlineError} role="alert" data-testid="ondo-b-onboarding-reset-status">{copy.restartError}</p> : null}
        <div className={styles.secondaryActions}><button type="button" className={styles.secondaryAction} onClick={() => setDraftPreferences(clearSettingsEditablePreferencesB(draftPreferences))} disabled={settingsPreferenceSummaryB(locale, draftPreferences).total === 0} data-testid="settings-preferences-clear"><strong>{copy.clearPreferences}</strong><RotateCcw size={17} aria-hidden="true" /></button><button type="button" className={styles.secondaryAction} data-testid="ondo-b-onboarding-reset" onClick={() => { closeSheet(); actions.beginOnboarding() }}><strong>{copy.restart}</strong><ChevronRight size={17} aria-hidden="true" /></button></div>
      </div></SheetB> : null}

      {sheetPresence.value === "privacy" ? <SheetB key="privacy" presenceState={sheetPresence.phase} locale={locale} label={copy.privacy} onClose={closeSheet} variant="detail" header={<span>{copy.privacy}</span>}><div className={styles.sheetBody}>
        <AccountServicesSampleB locale={locale} />
        {!privacySnapshot?.storageAvailable ? <p className={styles.inlineWarning} role="status" data-testid="ondo-b-storage-unavailable">{copy.storageUnavailable}</p> : <><p className={styles.scopeLine}><LockKeyhole size={17} aria-hidden="true" /><span>{copy.savedOnly}</span></p><div className={styles.dataGroups}>
          <section className={styles.dataGroup} aria-labelledby="settings-discovery-data"><h3 id="settings-discovery-data">{copy.discoveryGroup}</h3><div className={styles.factGrid}><Fact label={copy.savedPlaces} value={privacySnapshot.discovery.saved} /><Fact label={copy.recentPlaces} value={privacySnapshot.discovery.recent} /><Fact label={copy.choices} value={privacySnapshot.discovery.preferences} /><Fact label={copy.privateNotes} value={privacySnapshot.discovery.privateNotes} /></div></section>
          <section className={styles.dataGroup} aria-labelledby="settings-together-data"><h3 id="settings-together-data">{copy.togetherGroup}</h3><div className={styles.factGrid}><Fact label={copy.tables} value={privacySnapshot.together.tables} /><Fact label={copy.signals} value={privacySnapshot.together.signals} /></div></section>
          <section className={styles.dataGroup} aria-labelledby="settings-id-data"><h3 id="settings-id-data">{copy.identityGroup}</h3><div className={styles.axisList}><Axis label={copy.account} status={privacySnapshot.identity.account} copy={copy.status} /><Axis label={copy.person} status={privacySnapshot.identity.person} copy={copy.status} /><Axis label={copy.age} status={privacySnapshot.identity.age} copy={copy.status} /><Axis label={copy.payment} status={privacySnapshot.identity.payment} copy={copy.status} /><Axis label={copy.ktourId} status={privacySnapshot.identity.ktourId} copy={copy.status} /></div></section>
          <section className={styles.dataGroup} aria-labelledby="settings-balance-data"><h3 id="settings-balance-data">{copy.balanceGroup}</h3><div className={styles.axisList}><Axis label={copy.balanceGroup} status={privacySnapshot.balance.status} copy={copy.status} /><div className={styles.axis}><strong>{copy.records}</strong><span>{privacySnapshot.balance.records}</span></div></div></section>
          <section className={styles.dataGroup} aria-labelledby="settings-app-data"><h3 id="settings-app-data">{copy.appGroup}</h3><div className={styles.axisList}><div className={styles.axis}><strong>{copy.language}</strong><span>{LOCALE_NAME[privacySnapshot.app.locale]}</span></div><div className={styles.axis}><strong>{copy.appearance}</strong><span>{copy[privacySnapshot.app.appearancePreference]}</span></div><div className={styles.axis}><strong>{copy.after19}</strong><span>{privacySnapshot.app.after19AutoOpen ? copy.on : copy.off}</span></div></div></section>
        </div><div className={styles.dangerZone}><p>{copy.deleteHint}</p><button type="button" className={styles.destructive} onClick={() => { setDeleteError(null); setSheet("delete") }} data-testid="ondo-b-clear-device-open">{copy.deleteOpen}</button></div></>}
      </div></SheetB> : null}

      {sheetPresence.value === "delete" ? <SheetB key="delete" presenceState={sheetPresence.phase} locale={locale} label={copy.deleteTitle} onClose={closeSheet} navigation="back" onBack={() => { setDeleteError(null); setSheet("privacy") }} variant="decision" header={<span>{copy.deleteTitle}</span>} initialFocusSelector="[data-settings-keep]" footer={<div className={styles.sheetFooter}><button type="button" className={styles.quiet} data-settings-keep="true" disabled={deleting} onClick={() => { setDeleteError(null); setSheet("privacy") }}>{copy.keep}</button><button type="button" className={styles.destructive} disabled={deleting} onClick={confirmDelete}>{copy.delete}</button></div>}><div className={styles.sheetBody} data-testid="ondo-b-clear-device-confirm"><div className={styles.deleteSummary}><p>{copy.deleteLead}</p><ul className={styles.deleteGroups}>{copy.deleteGroups.map((label, index) => <li key={label}>{index === 0 ? <Bookmark size={18} aria-hidden="true" /> : index === 1 ? <UsersRound size={18} aria-hidden="true" /> : index === 2 ? <IdCard size={18} aria-hidden="true" /> : <WalletCards size={18} aria-hidden="true" />}<span>{label}</span></li>)}</ul><p className={styles.kept}>{copy.deleteKeeps}</p>{deleteError ? <p className={styles.inlineError} role="alert" data-testid="ondo-b-clear-device-error">{deleteError === "unchanged" ? copy.deleteFailed : copy.deleteRollbackFailed}</p> : null}</div></div></SheetB> : null}
    </div>
  )
}
