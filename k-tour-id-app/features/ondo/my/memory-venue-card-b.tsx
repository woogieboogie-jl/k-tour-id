"use client"

import type { CSSProperties, ReactNode } from "react"
import { useState } from "react"
import { BookOpenText, ChevronRight, ImageOff, Info, Landmark, MapPinned } from "lucide-react"
import type { MyKoreaMemoryCardViewModelB } from "./memory-venue-card-b-model"
import {
  MY_KOREA_SAVED_EDITORIAL_OPENER_ATTRIBUTE,
  MY_KOREA_SAVED_OFFICIAL_OPENER_ATTRIBUTE,
  MY_KOREA_SAVED_DISCOVERY_OPENER_ATTRIBUTE,
} from "./my-korea-place-return-b"
import styles from "./memory-venue-card-b.module.css"

export type MyKoreaMemoryCardActionB = Readonly<{
  label?: string
  onActivate(): void
  testId?: string
  savedOpener?: boolean
}>

export function MyKoreaMemoryVenueCardB({ model, action, utilities, cardTestId, priority = false, fit = "standard" }: {
  model: MyKoreaMemoryCardViewModelB
  action: MyKoreaMemoryCardActionB
  utilities?: ReactNode
  cardTestId?: string
  priority?: boolean
  fit?: "standard" | "compact-column" | "adaptive"
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const hasReadableImage = Boolean(model.media.src) && failedSrc !== model.media.src
  const fallbackLabel = model.media.src ? model.media.failureLabel : model.media.fallbackLabel
  const renderedMediaKind = hasReadableImage ? model.media.kind : "pictogram_fallback"
  const renderedMediaLabel = hasReadableImage ? model.media.label : fallbackLabel
  const mediaStyle = { "--memory-crop": model.media.crop } as CSSProperties

  return (
    <article
      className={styles.card}
      data-testid={cardTestId}
      data-memory-venue-card=""
      data-object-id={model.objectId}
      data-object-namespace={model.objectNamespace}
      data-source-kind={model.source.kind}
      data-official-record={String(model.source.officialRecord)}
      data-record-provenance={model.recordProvenance.sourceId}
      data-configured-media-kind={model.media.kind}
      data-media-kind={renderedMediaKind}
      data-media-source-id={model.media.mediaSourceId}
      data-exact-venue-photo={String(model.media.exactVenuePhoto)}
      data-media-rights={model.media.rights.mode}
      data-fit={fit}
    >
      <button
        className={styles.open}
        type="button"
        onClick={action.onActivate}
        data-testid={action.testId}
        data-saved-place-opener={action.savedOpener ? "" : undefined}
        {...(action.savedOpener && model.objectNamespace === "canonical-venue"
          ? { [MY_KOREA_SAVED_OFFICIAL_OPENER_ATTRIBUTE]: model.objectId }
          : {})}
        {...(action.savedOpener && model.objectNamespace === "jeju-editorial-place"
          ? { [MY_KOREA_SAVED_EDITORIAL_OPENER_ATTRIBUTE]: model.objectId }
          : {})}
        {...(action.savedOpener && model.objectNamespace === "discovery-place"
          ? { [MY_KOREA_SAVED_DISCOVERY_OPENER_ATTRIBUTE]: model.objectId }
          : {})}
        aria-label={action.label || model.accessibleLabel}
      >
        <span className={styles.media} data-media-state={hasReadableImage ? "image" : "fallback"} data-rendered-media-kind={renderedMediaKind} style={mediaStyle}>
          {model.media.src ? (
            <img
              src={model.media.src}
              alt={model.media.alt}
              width={800}
              height={500}
              loading={priority ? "eager" : "lazy"}
              fetchPriority={priority ? "high" : "auto"}
              decoding="async"
              draggable="false"
              hidden={!hasReadableImage}
              onError={() => setFailedSrc(model.media.src)}
            />
          ) : null}
          <span className={styles.fallback} hidden={hasReadableImage} role={hasReadableImage ? undefined : "img"} aria-label={hasReadableImage ? undefined : fallbackLabel}>
            {model.source.kind === "editorial_place" ? <MapPinned size={28} aria-hidden="true" /> : <ImageOff size={28} aria-hidden="true" />}
            <span>{fallbackLabel}</span>
          </span>
          <span className={styles.mediaLabel} data-rendered-media-badge={renderedMediaKind}>{renderedMediaLabel}</span>
        </span>

        <span className={styles.body}>
          <span className={styles.source}>
            <span className={styles.sourceGlyph} data-source-glyph={model.source.kind} aria-hidden="true">
              {model.source.kind === "official_directory" ? <Landmark size={13} /> : <BookOpenText size={13} />}
            </span>
            <small>{model.source.label}</small>
          </span>
          <strong>{model.title}</strong>
          <small className={styles.subtitle}>{model.subtitle}</small>
        </span>
        <ChevronRight className={styles.chevron} size={18} aria-hidden="true" />
      </button>

      <details className={styles.provenance}>
        <summary><Info size={14} aria-hidden="true" /><span>{model.media.disclosureLabel}</span><ChevronRight size={14} aria-hidden="true" /></summary>
        <dl>
          <div><dt>{model.media.recordSourceLabel}</dt><dd>{model.recordProvenance.label}</dd></div>
          <div><dt>{model.media.mediaCreditLabel}</dt><dd>{model.media.mediaCredit}</dd></div>
          <div><dt>{model.media.rightsLabel}</dt><dd>{model.media.rights.label}</dd></div>
        </dl>
      </details>

      <div className={styles.utilities} data-empty={utilities ? "false" : "true"}>{utilities}</div>
    </article>
  )
}

export function MyKoreaMemoryThumbnailB({ model }: { model: MyKoreaMemoryCardViewModelB }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const hasReadableImage = Boolean(model.media.src) && failedSrc !== model.media.src
  const mediaStyle = { "--memory-crop": model.media.crop } as CSSProperties
  return (
    <span className={styles.thumbnail} data-media-state={hasReadableImage ? "image" : "fallback"} data-media-kind={hasReadableImage ? model.media.kind : "pictogram_fallback"} data-media-source-id={model.media.mediaSourceId} data-exact-venue-photo="false" style={mediaStyle}>
      {model.media.src ? <img src={model.media.src} alt="" width={160} height={100} decoding="async" hidden={!hasReadableImage} onError={() => setFailedSrc(model.media.src)} /> : null}
      <span className={styles.thumbnailFallback} hidden={hasReadableImage} aria-hidden="true">
        {model.source.kind === "editorial_place" ? <MapPinned size={20} /> : <ImageOff size={20} />}
      </span>
    </span>
  )
}
