"use client"

import { useRef, type ReactNode } from "react"
import { ArrowLeft, ChevronDown, MoreHorizontal, Search, X } from "lucide-react"
import { MapHeaderSpectrumB } from "./map-header-spectrum-b"
import styles from "./map-header-b.module.css"

type Locale = "ko" | "en" | "ja"
const COPY = {
  ko: { back: "뒤로", city: "도시 선택", options: "지도 설정", search: "장소 검색", close: "검색 접기", clear: "검색어 지우기" },
  en: { back: "Back", city: "Choose city", options: "Map options", search: "Search places", close: "Close search", clear: "Clear search" },
  ja: { back: "戻る", city: "都市を選択", options: "地図設定", search: "スポットを検索", close: "検索を閉じる", clear: "検索をクリア" },
} as const

/** Presentation only. The map/history/provider remain the single state owner.
 * The outer measured header includes the expanded search; only the inner shell
 * stays two rows tall, so camera/list padding never guesses its occupied area. */
export function MapHeaderB({ locale, cityLabel, cityStatus, cityStatusCode, onBack, onChooseCity,
  onOptions, optionsOpen, after19Active, filtered, wallet, selectedMood, showSpectrum,
  onMoodChange, spectrumDisabled = false, searchOpen, query, maxLength, onSearchOpen, onSearchClose, onSearchFocus,
  onQueryChange, onSubmitSearch,
}: {
  locale: Locale; cityLabel: string; cityStatus: string; cityStatusCode: string
  onBack(): void; onChooseCity(): void; onOptions(): void; optionsOpen: boolean
  after19Active: boolean; filtered: boolean; wallet: ReactNode
  selectedMood: "cool" | "warm" | "hot" | null; showSpectrum: boolean
  spectrumDisabled?: boolean
  onMoodChange(value: "cool" | "warm" | "hot" | null): void
  searchOpen: boolean; query: string; maxLength: number
  onSearchOpen(): void; onSearchClose(): void; onSearchFocus(): void
  onQueryChange(value: string): void; onSubmitSearch(): void
}) {
  const copy = COPY[locale]
  const inputRef = useRef<HTMLInputElement>(null)
  const searchButton = <button type="button" className={styles.iconButton} data-testid="ondo-b-map-search-toggle" aria-label={`${copy.search}${query ? `: ${query}` : ""}`} aria-expanded={searchOpen} aria-controls="ondo-map-header-search" onClick={searchOpen ? onSearchClose : onSearchOpen}>
    <Search size={21} aria-hidden="true" />{query ? <i className={styles.filterDot} aria-hidden="true" /> : null}
  </button>
  return <header className={styles.header} data-testid="ondo-b-city-header" data-header-version="unified-a" data-search-open={searchOpen}>
    <div className={styles.shell}>
      <div className={styles.navigation}>
        <button type="button" className={styles.iconButton} data-testid="ondo-b-city-back" aria-label={copy.back} onClick={onBack}><ArrowLeft size={21} aria-hidden="true" /></button>
        <button type="button" className={styles.city} data-testid="ondo-b-city-picker" aria-label={`${cityLabel}, ${copy.city}`} aria-haspopup="dialog" onClick={onChooseCity}>
          <h1>{cityLabel}</h1><ChevronDown size={16} aria-hidden="true" />
        </button>
        <small className={styles.srOnly} data-testid="ondo-b-pulse-city-status" data-pulse-city-status={cityStatusCode}>{cityStatus}</small>
        {!showSpectrum ? searchButton : null}
        <div className={styles.wallet}>{wallet}</div>
        <button type="button" className={styles.iconButton} data-testid="ondo-b-map-options-open" aria-label={`${copy.options}${after19Active ? " · 19+" : ""}`} aria-haspopup="dialog" aria-expanded={optionsOpen} onClick={onOptions}>
          <MoreHorizontal size={22} aria-hidden="true" />
          {after19Active ? <span className={styles.ageIndicator} aria-hidden="true">19+</span> : filtered ? <i className={styles.filterDot} aria-hidden="true" /> : null}
        </button>
      </div>
      {showSpectrum ? <div className={styles.discovery}>
        <MapHeaderSpectrumB locale={locale} selected={selectedMood} onChange={onMoodChange} disabled={spectrumDisabled} />
        {searchButton}
      </div> : null}
    </div>
    {searchOpen ? <div id="ondo-map-header-search" className={styles.searchPanel} role="search" data-testid="ondo-b-search-shell">
      <Search size={19} aria-hidden="true" />
      <input ref={inputRef} autoFocus data-testid="ondo-b-search" aria-label={copy.search} placeholder={copy.search} value={query} maxLength={maxLength}
        onFocus={event => { if (!event.currentTarget.dataset.discoveryRestoringFocus) onSearchFocus() }}
        onChange={event => onQueryChange(event.target.value.slice(0, maxLength))}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onSearchClose() }
          if (event.key === "Enter") { event.preventDefault(); onSubmitSearch() }
        }} />
      {query ? <button type="button" className={styles.iconButton} data-testid="ondo-b-map-search-clear" aria-label={copy.clear} onClick={() => { onQueryChange(""); inputRef.current?.focus({ preventScroll: true }) }}><X size={16} aria-hidden="true" /></button> : null}
      <button type="button" className={styles.closeSearch} data-testid="ondo-b-map-search-close" aria-label={copy.close} onClick={onSearchClose}><ChevronDown size={19} aria-hidden="true" /></button>
    </div> : null}
  </header>
}
