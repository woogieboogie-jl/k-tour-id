"use client"

import { type ReactNode, useEffect, useRef, useState } from "react"
import { ChevronRight, MapPin, X } from "lucide-react"
import { SheetB } from "../shared/ui/sheet-b"
import type { OndoBLocale } from "../shared/state/ondo-b-preferences"
import { commonPlaceTitleB } from "./common-place-experience-b"
import styles from "./content-place-shell-b.module.css"

/** Content and directory picks use the same detail/peek interaction. On map
 * keeps this exact native place selected; it is not a synonym for Back. */
export function ContentPlaceShellB({ placeId, name, locale, onClose, onMap, children, initialFocusSelector, mapTestId = "research-on-map" }: {
  placeId: string; name: string; locale: OndoBLocale; onClose(): void; onMap(): void; children: ReactNode; initialFocusSelector?: string; mapTestId?: string
}) {
  const [peek, setPeek] = useState(false)
  const peekRef = useRef<HTMLDivElement>(null)
  useEffect(() => { setPeek(false) }, [placeId])
  useEffect(() => { if (peek) peekRef.current?.focus({ preventScroll: true }) }, [peek])
  const map = locale === "ko" ? "지도에서 보기" : locale === "ja" ? "地図で見る" : "On map"
  const close = locale === "ko" ? "장소 닫기" : locale === "ja" ? "場所を閉じる" : "Close place"
  if (peek) return <div ref={peekRef} tabIndex={-1} className={styles.peek} data-testid="content-place-peek" data-place-id={placeId} aria-label={name} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onClose() } }}>
    <div><MapPin size={20} aria-hidden="true" /><h2>{name}</h2><button type="button" aria-label={close} onClick={onClose}><X size={20} aria-hidden="true" /></button></div>
    <button type="button" className={styles.details} data-testid="content-place-details" onClick={() => setPeek(false)}>{commonPlaceTitleB(locale)}<ChevronRight size={18} aria-hidden="true" /></button>
  </div>
  // Discovery history owns the exact story/list/My Korea return focus. A
  // delayed generic sheet restore would steal it after that owner completes.
  return <SheetB locale={locale} label={name} onClose={onClose} variant="detail" initialFocusSelector={initialFocusSelector} shouldRestoreFocus={() => false} header={commonPlaceTitleB(locale)} footer={<div className={styles.footer}><button type="button" data-testid={mapTestId} onClick={() => { onMap(); setPeek(true) }}><MapPin size={18} aria-hidden="true" />{map}</button></div>}>{children}</SheetB>
}
