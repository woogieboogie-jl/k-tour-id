"use client"

import { useRef } from "react"
import { BookOpen, Check, ChevronDown, ChevronRight, FlaskConical, Info, Languages, Layers2, LocateFixed, MoonStar, ShieldCheck, SlidersHorizontal } from "lucide-react"
import { SheetB } from "../shared/ui/sheet-b"
import { sampleInfoCopyB } from "../shared/ui/sample-info-button-b"
import styles from "./map-options-b.module.css"

export type MapOptionsBProps = {
  locale: "en" | "ko" | "ja"
  cityLabel: string
  categories: readonly { id: string; label: string; selected: boolean }[]
  onCategory(id: string): void
  categoryLocked: boolean
  resultLabel: string
  canTilt: boolean
  tilted: boolean
  onTogglePerspective(): void
  locationSummary: string
  locationMessage: string
  locateLabel: string
  onLocate?: () => void
  onPreferences(): void
  onStories?: () => void
  onAfter19?: () => void
  after19Active?: boolean
  languageLabel: string
  onLanguage(): void
  onDemo?: () => void
  onClose(): void
}

const COPY = {
  en: {
    title: "Map options", categories: "Places", map: "Map", more: "Explore your way",
    show: "Show results", perspective: "Map view", flat: "2D", tilted: "2.5D",
    privacy: "Location privacy", preferences: "Discovery preferences", stories: "City guides",
    language: "Language",
    after19: "After 19 picks", after19Body: "Open the age check for night-view recommendations.", after19LockedBody: "Turn off After 19 below to browse every category.", after19Active: "Turn off After 19", after19ActiveBody: "Turn off the current night-view filter.",
  },
  ko: {
    title: "지도 설정", categories: "장소", map: "지도", more: "나에게 맞게",
    show: "결과 보기", perspective: "지도 시점", flat: "2D", tilted: "2.5D",
    privacy: "위치정보 안내", preferences: "탐색 취향", stories: "도시 가이드",
    language: "언어",
    after19: "After 19 추천", after19Body: "19+ 확인을 열어 밤 추천을 볼 수 있어요.", after19LockedBody: "모든 분류를 보려면 아래에서 After 19를 꺼 주세요.", after19Active: "After 19 끄기", after19ActiveBody: "현재 밤 추천 필터를 꺼요.",
  },
  ja: {
    title: "地図設定", categories: "スポット", map: "地図", more: "自分に合わせる",
    show: "結果を見る", perspective: "地図の表示", flat: "2D", tilted: "2.5D",
    privacy: "位置情報について", preferences: "探索の好み", stories: "街のガイド",
    language: "言語",
    after19: "After 19 のおすすめ", after19Body: "年齢確認を開いて夜のおすすめを表示します。", after19LockedBody: "すべてのカテゴリを見るには、下のAfter 19をオフにしてください。", after19Active: "After 19をオフ", after19ActiveBody: "現在の夜表示フィルターをオフにします。",
  },
} as const

/** Presentation only: the map remains the owner of filters, camera, location
 * permission, language and provider/demo state. Navigation handlers close this
 * sheet at the caller before opening a different workflow. */
export function MapOptionsB({
  locale, cityLabel, categories, onCategory, categoryLocked, resultLabel,
  canTilt, tilted, onTogglePerspective, locationSummary, locationMessage,
  locateLabel, onLocate, onPreferences, onStories, onAfter19, after19Active = false, languageLabel, onLanguage,
  onDemo, onClose,
}: MapOptionsBProps) {
  const copy = COPY[locale]
  // The guide is an existing non-modal details panel, so SheetB cannot infer
  // its focus ownership by looking for a replacement dialog. Mark this one
  // intentional handoff before the caller synchronously closes the sheet.
  const guideOwnsFocus = useRef(false)
  const after19OwnsFocus = useRef(false)
  const openStories = () => {
    guideOwnsFocus.current = true
    onStories?.()
  }
  const openAfter19 = () => {
    after19OwnsFocus.current = true
    onAfter19?.()
  }
  return <SheetB
    locale={locale}
    label={copy.title}
    variant="decision"
    onClose={onClose}
    shouldRestoreFocus={() => !guideOwnsFocus.current && !after19OwnsFocus.current}
    header={<span className={styles.title}>{copy.title}<small>{cityLabel}</small></span>}
    footer={<div className={styles.footer}>
      <button type="button" className={styles.done} data-testid="ondo-b-map-options-done" onClick={onClose}>
        <span>{copy.show}</span><small>{resultLabel}</small>
      </button>
    </div>}
  >
    <div className={styles.body} data-testid="ondo-b-map-options" data-category-locked={String(categoryLocked)}>
      <section className={styles.section} aria-labelledby="ondo-map-options-categories">
        <h2 id="ondo-map-options-categories">{copy.categories}</h2>
        {categoryLocked ? <div className={styles.nightNotice} data-testid="ondo-b-map-options-after19">
          <MoonStar size={20} aria-hidden="true" /><div><strong>{copy.after19}</strong><p>{copy.after19LockedBody}</p></div>
        </div> : <div className={styles.categories} role="group" aria-label={copy.categories} data-testid="ondo-b-map-options-categories">
          {categories.map(category => <button
            key={category.id}
            type="button"
            aria-pressed={category.selected}
            data-category={category.id}
            onClick={() => onCategory(category.id)}
          >
            {category.selected ? <Check size={15} aria-hidden="true" /> : null}
            <span>{category.label}</span>
          </button>)}
        </div>}
      </section>

      <section className={styles.section} aria-labelledby="ondo-map-options-map">
        <h2 id="ondo-map-options-map">{copy.map}</h2>
        <div className={styles.rows}>
          {onAfter19 ? <button type="button" className={styles.row} data-testid="ondo-b-map-options-after19-open" aria-label={after19Active ? copy.after19Active : copy.after19} onClick={openAfter19}>
            <MoonStar size={20} aria-hidden="true" /><span className={styles.rowCopy}>{after19Active ? copy.after19Active : copy.after19}<small>{after19Active ? copy.after19ActiveBody : copy.after19Body}</small></span><ChevronRight size={18} aria-hidden="true" />
          </button> : null}
          {canTilt ? <button type="button" className={styles.row} data-testid="ondo-b-map-options-perspective" aria-pressed={tilted} onClick={onTogglePerspective}>
            <Layers2 size={20} aria-hidden="true" /><span className={styles.rowCopy}>{copy.perspective}</span>
            <span className={styles.value}>{tilted ? copy.tilted : copy.flat}</span>
          </button> : null}
          {onLocate ? <button type="button" className={styles.row} data-testid="ondo-b-map-options-locate" onClick={onLocate}>
            <LocateFixed size={20} aria-hidden="true" /><span className={styles.rowCopy}>{locateLabel}<small>{locationSummary}</small></span>
            <ChevronRight size={18} aria-hidden="true" />
          </button> : null}
          <details className={styles.privacy} data-testid="ondo-b-map-options-location-privacy">
            <summary className={styles.row}>
              <ShieldCheck size={20} aria-hidden="true" /><span className={styles.rowCopy}>{copy.privacy}</span>
              <ChevronDown size={18} aria-hidden="true" />
            </summary>
            <p>{locationMessage}</p>
          </details>
          <details className={styles.privacy} data-testid="ondo-b-map-options-credits">
            <summary className={styles.row}>
              <Info size={20} aria-hidden="true" /><span className={styles.rowCopy}>{locale === "ko" ? "지도 출처" : locale === "ja" ? "地図クレジット" : "Map credits"}</span><ChevronDown size={18} aria-hidden="true" />
            </summary>
            <p className={styles.credits}>
              <a href="https://openfreemap.org/" target="_blank" rel="noreferrer">OpenFreeMap</a>
              <a href="https://openmaptiles.org/" target="_blank" rel="noreferrer">© OpenMapTiles</a>
              <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>
            </p>
          </details>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="ondo-map-options-more">
        <h2 id="ondo-map-options-more">{copy.more}</h2>
        <div className={styles.rows}>
          {onStories ? <button type="button" className={styles.row} data-testid="ondo-b-map-options-stories" onClick={openStories}>
            <BookOpen size={20} aria-hidden="true" /><span className={styles.rowCopy}>{copy.stories}</span><ChevronRight size={18} aria-hidden="true" />
          </button> : null}
          <button type="button" className={styles.row} data-testid="ondo-b-map-options-preferences" onClick={onPreferences}>
            <SlidersHorizontal size={20} aria-hidden="true" /><span className={styles.rowCopy}>{copy.preferences}</span><ChevronRight size={18} aria-hidden="true" />
          </button>
          <button type="button" className={styles.row} data-testid="ondo-b-map-options-language" onClick={onLanguage}>
            <Languages size={20} aria-hidden="true" /><span className={styles.rowCopy}>{copy.language}</span><span className={styles.value}>{languageLabel}</span>
          </button>
          {onDemo ? <button type="button" className={styles.row} data-testid="ondo-b-map-options-demo" onClick={onDemo}>
            <FlaskConical size={20} aria-hidden="true" /><span className={styles.rowCopy}>{sampleInfoCopyB(locale).about}</span><ChevronRight size={18} aria-hidden="true" />
          </button> : null}
        </div>
      </section>
    </div>
  </SheetB>
}
