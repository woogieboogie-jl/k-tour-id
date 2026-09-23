"use client"

import Image from "next/image"
import { useEffect, useRef } from "react"
import { ArrowUpRight, BookOpenText, ChevronRight, CircleDashed, MapPin, MapPinned, X } from "lucide-react"
import {
  editorialPlacesForStory,
  JAPAN_FIRST_LAUNCH_CONTENT,
  JAPAN_FIRST_FEATURED_CONTENT_IDS,
  JEJU_EDITORIAL_PLACES,
  JEJU_EDITORIAL_SEEDS,
  type EditorialPlaceB,
  type JapanFirstLaunchContentB,
} from "../pulse-b/japan-first-pulse-model-b"
import type { OndoBLocale } from "../shared/state/ondo-b-preferences"
import styles from "./japan-first-discovery-b.module.css"

const COPY = {
  en: {
    eyebrow: "Travel stories",
    title: "Korea, told through local stops",
    seoulTitle: "Seoul stories",
    jejuTitle: "Jeju stories",
    seoulSummary: "City discoveries",
    jejuSummary: "Island discoveries",
    summary: "Stories and places, together",
    body: "Each story keeps its original source. When a place is ready, you can jump straight to its spot on the map.",
    content: "Featured stories",
    jeju: "Jeju",
    jejuBody: "More island ideas",
    jejuSources: "More from Jeju",
    pending: "Story",
    verified: "On the map",
    viewOnMap: "View on map",
    viewSource: "View source",
    viewSources: "View sources",
    method: "About these stories",
    imageCredit: "Image credit: K-Tour ID editorial illustration",
    marker: "Stories",
    language: "App guidance is available in English, Korean and Japanese.",
    sourceBoundary: "Eight place pages and map coordinates were verified on Aug 28, 2026. Two ideas remain link-only.",
    newTab: "opens in a new tab",
    close: "Close Stories",
  },
  ko: {
    eyebrow: "여행 이야기",
    title: "장소로 만나는 한국 이야기",
    seoulTitle: "서울 이야기",
    jejuTitle: "제주 이야기",
    seoulSummary: "도시에서 발견한 장면",
    jejuSummary: "섬에서 발견한 장면",
    summary: "이야기와 장소를 한 흐름으로",
    body: "각 이야기는 원문 출처를 그대로 담고, 장소가 준비되면 지도 위 위치로 바로 이어집니다.",
    content: "추천 이야기",
    jeju: "제주",
    jejuBody: "섬을 더 둘러보기",
    jejuSources: "제주 이야기 더 보기",
    pending: "이야기",
    verified: "지도에서 보기",
    viewOnMap: "지도에서 보기",
    viewSource: "원문 보기",
    viewSources: "출처 보기",
    method: "이야기 안내",
    imageCredit: "이미지 출처: K-Tour ID 편집 일러스트",
    marker: "여행 이야기",
    language: "앱 안내는 한국어·영어·일본어로 제공합니다.",
    sourceBoundary: "장소 페이지와 지도 좌표 8곳을 2026년 8월 28일 확인했습니다. 2곳은 출처 링크만 제공합니다.",
    newTab: "새 탭에서 열림",
    close: "여행 이야기 닫기",
  },
  ja: {
    eyebrow: "旅のストーリー",
    title: "場所から出会う韓国の物語",
    seoulTitle: "ソウルのストーリー",
    jejuTitle: "済州のストーリー",
    seoulSummary: "街で見つけた風景",
    jejuSummary: "島で見つけた風景",
    summary: "ストーリーと場所をひとつの流れに",
    body: "各ストーリーには元の情報源を残し、場所の準備ができたものは地図上のスポットへ直接つながります。",
    content: "おすすめストーリー",
    jeju: "済州",
    jejuBody: "島をもっと見る",
    jejuSources: "済州をもっと見る",
    pending: "ストーリー",
    verified: "地図で見る",
    viewOnMap: "地図で見る",
    viewSource: "元の情報を見る",
    viewSources: "情報源を見る",
    method: "ストーリーについて",
    imageCredit: "画像クレジット：K-Tour ID 編集イラスト",
    marker: "ストーリー",
    language: "アプリの案内は日本語・英語・韓国語に対応しています。",
    sourceBoundary: "8か所の場所ページと地図座標を2026年8月28日に確認しました。2件は情報源リンクのみです。",
    newTab: "新しいタブで開きます",
    close: "ストーリーを閉じる",
  },
} satisfies Record<OndoBLocale, Record<string, string>>

type Copy = typeof COPY.en

function SourceLinks({ item, copy, locale }: { item: JapanFirstLaunchContentB; copy: Copy; locale: OndoBLocale }) {
  const links = item.sourceReferences.map((source) => (
    <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
      <span>{source.label}</span><ArrowUpRight aria-hidden="true" size={15} />
      <span className={styles.srOnly}>({copy.newTab})</span>
    </a>
  ))
  if (links.length === 1) return <nav aria-label={`${copy.viewSource}: ${item.title[locale]}`}>{links}</nav>
  return (
    <details className={styles.sourceDisclosure} data-testid={`ondo-b-story-sources-${item.id}`}>
      <summary>{copy.viewSources} ({links.length})<ChevronRight aria-hidden="true" size={15} /></summary>
      <nav aria-label={`${copy.viewSources}: ${item.title[locale]}`}>{links}</nav>
    </details>
  )
}

function Story({ item, copy, locale, compact = false, visualRole = compact ? "compact" : "supporting", onSelectEditorialPlace, onSelectCollection }: {
  item: JapanFirstLaunchContentB
  copy: Copy
  locale: OndoBLocale
  compact?: boolean
  visualRole?: "lead" | "supporting" | "compact"
  onSelectEditorialPlace?(place: EditorialPlaceB): void
  onSelectCollection?(id: "sesame" | "screen"): void
}) {
  const mappedPlace = editorialPlacesForStory(item.id)[0]
  const collection = item.id === "C01" ? "sesame" : item.id === "C18" ? "screen" : null
  return (
    <article className={compact ? styles.compactStory : undefined} data-content-id={item.id} data-editorial-role={visualRole} data-verification={item.sourceVerification} data-place-edge={item.placeEdgeVerification}>
      {item.editorialMedia && !compact ? (
        <figure className={styles.storyMedia} data-rights-mode={item.editorialMedia.rightsMode}>
              <Image
                alt={item.editorialMedia.alt[locale]}
                fill
                sizes="(max-width: 800px) 76vw, 320px"
                src={item.editorialMedia.src}
              />
              <span className={styles.srOnly}>{item.editorialMedia.credit[locale]}</span>
            </figure>
      ) : <small>{item.sourceReferences[0].label}</small>}
      <div className={styles.storyCopy}>
        <strong>{item.title[locale]}</strong>
        {locale === "ja" ? null : <p lang="ja">{item.jaHook}</p>}
        <em>{mappedPlace || (collection && onSelectCollection) ? <MapPin aria-hidden="true" size={14} /> : <CircleDashed aria-hidden="true" size={14} />}{mappedPlace || (collection && onSelectCollection) ? copy.verified : copy.pending}</em>
      </div>
      {collection && onSelectCollection ? <button type="button" className={styles.mapCta} data-testid={`ondo-b-story-collection-${item.id}`} onClick={() => onSelectCollection(collection)}><MapPin aria-hidden="true" size={16} /><span>{copy.viewOnMap}</span><ChevronRight aria-hidden="true" size={15} /></button> : mappedPlace && onSelectEditorialPlace ? <button type="button" className={styles.mapCta} data-testid={`ondo-b-story-map-${item.id}`} data-editorial-story-opener={mappedPlace.id} onClick={() => onSelectEditorialPlace(mappedPlace)}><MapPin aria-hidden="true" size={16} /><span>{copy.viewOnMap}</span><ChevronRight aria-hidden="true" size={15} /></button> : null}
      <SourceLinks item={item} copy={copy} locale={locale} />
    </article>
  )
}

export function JapanFirstDiscoveryB({ locale, city, presentation = "map", open, compactTrigger = false, returnFocusSelector, onOpenChange, onSelectEditorialPlace, onSelectCollection }: { locale: OndoBLocale; city: "seoul" | "jeju"; presentation?: "map" | "list"; open?: boolean; compactTrigger?: boolean; returnFocusSelector?: string; onOpenChange?(open: boolean): void; onSelectEditorialPlace?(place: EditorialPlaceB): void; onSelectCollection?(id: "sesame" | "screen"): void }) {
  const rootRef = useRef<HTMLDetailsElement>(null)
  const summaryRef = useRef<HTMLElement>(null)
  const copy = COPY[locale]
  const cityItems = JAPAN_FIRST_LAUNCH_CONTENT.filter((item) => item.cityIds.includes(city))
  const featured = city === "seoul"
    ? JAPAN_FIRST_FEATURED_CONTENT_IDS.map((id) => cityItems.find((item) => item.id === id)!).filter(Boolean)
    : cityItems
  const remaining = cityItems.filter((item) => !featured.some((featuredItem) => featuredItem.id === item.id))
  const jejuSources = [...new Map(JEJU_EDITORIAL_SEEDS.map((item) => [item.sourceUrl, item])).values()]
  const title = city === "seoul" ? copy.seoulTitle : copy.jejuTitle
  const summary = city === "seoul" ? copy.seoulSummary : copy.jejuSummary
  const closePanel = () => {
    if (rootRef.current) rootRef.current.open = false
    onOpenChange?.(false)
    window.requestAnimationFrame(() => {
      const target = returnFocusSelector ? document.querySelector<HTMLElement>(returnFocusSelector) : summaryRef.current
      target?.focus({ preventScroll: true })
    })
  }

  useEffect(() => {
    if (!open || !compactTrigger) return
    const frame = window.requestAnimationFrame(() => rootRef.current?.querySelector<HTMLButtonElement>("[data-story-close]")?.focus({ preventScroll: true }))
    return () => window.cancelAnimationFrame(frame)
  }, [open, compactTrigger])

  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || !rootRef.current?.open) return
      event.preventDefault()
      event.stopPropagation()
      closePanel()
    }
    document.addEventListener("keydown", closeOnEscape, true)
    return () => document.removeEventListener("keydown", closeOnEscape, true)
  })

  return (
    <details ref={rootRef} open={open} className={styles.root} name="ondo-map-disclosure" data-testid="ondo-b-japan-first-discovery" data-compact-trigger={compactTrigger ? "true" : "false"} data-city-context={city} data-presentation={presentation} data-truth-kind="editorial-collection" data-geometry-basis={city === "jeju" ? "verified-points" : "region"} data-place-point-count={city === "jeju" ? JEJU_EDITORIAL_PLACES.length : 0} onToggle={(event) => onOpenChange?.(event.currentTarget.open)}>
      <summary ref={summaryRef} data-testid="ondo-b-editorial-collection-marker" aria-label={`${title}. ${summary}`}>
        <span className={styles.mark}><BookOpenText aria-hidden="true" size={20} /><b>{copy.marker}</b></span>
        <span>
          <small>{copy.eyebrow}</small>
          <strong>{title}</strong>
          <em>{summary}</em>
        </span>
        <ChevronRight aria-hidden="true" size={18} strokeWidth={2.1} />
      </summary>
      <div className={styles.panel}>
        <header>
          <span><BookOpenText aria-hidden="true" size={18} /><strong>{copy.content}</strong></span>
          <button type="button" className={styles.closePanel} data-story-close aria-label={copy.close} onClick={closePanel}><X aria-hidden="true" size={18} /></button>
          <details className={styles.method}>
            <summary>{copy.method}<ChevronRight aria-hidden="true" size={15} /></summary>
            <p>{copy.body}</p>
            <small>{copy.language}</small>
            <small>{copy.imageCredit}</small>
          </details>
        </header>
        <div className={styles.contentRail} data-testid="ondo-b-editorial-guide-grid">
          {featured.map((item, index) => <Story key={item.id} item={item} copy={copy} locale={locale} visualRole={index === 0 ? "lead" : "supporting"} onSelectEditorialPlace={city === "jeju" ? (place) => { if (rootRef.current) rootRef.current.open = false; onOpenChange?.(false); onSelectEditorialPlace?.(place) } : undefined} onSelectCollection={onSelectCollection ? id => { if (rootRef.current) rootRef.current.open = false; onOpenChange?.(false); onSelectCollection(id) } : undefined} />)}
        </div>
        {remaining.length ? (
          <details className={styles.moreStories} data-testid="ondo-b-japan-more-stories">
            <summary>{locale === "ko" ? `콘텐츠 ${remaining.length}개 더 보기` : locale === "ja" ? `ほかのストーリー${remaining.length}件` : `${remaining.length} more stories`}<ChevronRight aria-hidden="true" size={16} /></summary>
            <div>
              {remaining.map((item) => <Story key={item.id} item={item} copy={copy} locale={locale} compact visualRole="compact" />)}
            </div>
          </details>
        ) : null}
        {city === "jeju" ? (
          <details className={styles.jeju} data-testid="ondo-b-jeju-editorial-seeds" data-seed-count={JEJU_EDITORIAL_SEEDS.length} data-source-type="editorial-research" data-official-record-count="none">
            <summary>
              <MapPinned aria-hidden="true" size={20} />
              <span><strong>{copy.jeju}</strong><small>{copy.jejuBody}</small></span>
              <ChevronRight aria-hidden="true" size={16} />
            </summary>
            <div>
              <strong>{copy.jejuSources}</strong>
              <nav aria-label={copy.jejuSources}>
                {jejuSources.map((source) => (
                  <a key={source.sourceUrl} href={source.sourceUrl} target="_blank" rel="noreferrer">
                    <span>{source.sourceCollection[locale]}</span><ArrowUpRight aria-hidden="true" size={15} />
                    <span className={styles.srOnly}>({copy.newTab})</span>
                  </a>
                ))}
              </nav>
              <small>{copy.sourceBoundary}</small>
            </div>
          </details>
        ) : null}
      </div>
    </details>
  )
}
