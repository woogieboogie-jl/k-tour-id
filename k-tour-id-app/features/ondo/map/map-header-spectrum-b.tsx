"use client"

import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react"
import styles from "./map-header-spectrum-b.module.css"

type Band = "cool" | "warm" | "hot"
export type MapHeaderSpectrumValueB = Band | null
export type MapHeaderSpectrumBProps = {
  locale: "ko" | "en" | "ja"
  selected: MapHeaderSpectrumValueB
  onChange(value: MapHeaderSpectrumValueB): void
  disabled?: boolean
}

const BANDS: readonly Band[] = ["cool", "warm", "hot"]
const COPY = {
  ko: {
    all: "전체", reset: "분위기 선택 해제, 전체 보기", group: "탐색 분위기",
    cool: "차분한 무드", warm: "적당한 활기", hot: "활기 있는 발견",
    hint: "세 단계의 편집 추천입니다. 왼쪽은 차분한 무드, 가운데는 적당한 활기, 오른쪽은 활기 있는 발견입니다. 좌우 방향키로 선택하고 전체 버튼으로 해제할 수 있어요. 실시간 인기·혼잡 정보가 아니며 조용함을 보장하지 않아요.",
  },
  en: {
    all: "All", reset: "Clear mood selection, show all", group: "Discovery mood",
    cool: "Calm mood", warm: "Moderate energy", hot: "Lively discoveries",
    hint: "Three editorial recommendation bands: calm on the left, moderate energy in the middle, and lively discoveries on the right. Use the left and right arrow keys to select, or All to clear. This is not live popularity or crowd information and does not guarantee quiet surroundings.",
  },
  ja: {
    all: "すべて", reset: "ムードの選択を解除し、すべて表示", group: "探す場所のムード",
    cool: "落ち着いたムード", warm: "ほどよい活気", hot: "活気ある発見",
    hint: "編集による三段階のおすすめです。左は落ち着いたムード、中央はほどよい活気、右は活気ある発見です。左右の矢印キーで選び、すべてボタンで解除できます。リアルタイムの人気・混雑情報ではなく、静かさを保証するものではありません。",
  },
} as const

/** A controlled, three-band editorial selector; pointer drafts never filter the map. */
export function MapHeaderSpectrumB({ locale, selected, onChange, disabled = false }: MapHeaderSpectrumBProps) {
  const copy = COPY[locale]
  const [draft, setDraft] = useState<Band | null>(null)
  const [pointerInput, setPointerInput] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const group = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointerId: number; element: HTMLDivElement } | null>(null)
  const currentValue = useRef(selected)
  currentValue.current = selected
  const hintId = useId()
  const visibleBand = draft ?? selected

  function cancelDrag() {
    const active = drag.current
    drag.current = null
    setDraft(null)
    if (active?.element.hasPointerCapture(active.pointerId)) active.element.releasePointerCapture(active.pointerId)
  }

  function commit(next: MapHeaderSpectrumValueB) {
    cancelDrag()
    if (!disabled && next !== currentValue.current) onChange(next)
  }

  useEffect(() => { cancelDrag() }, [disabled, selected])
  useEffect(() => {
    const cancelOnBlur = () => cancelDrag()
    const cancelOutside = (event: globalThis.PointerEvent) => {
      if (drag.current && event.target instanceof Node && !root.current?.contains(event.target)) cancelDrag()
    }
    const cancelWhenHidden = () => { if (document.visibilityState === "hidden") cancelDrag() }
    const useKeyboard = (event: globalThis.KeyboardEvent) => {
      if (!["Shift", "Control", "Alt", "Meta"].includes(event.key)) setPointerInput(false)
    }
    window.addEventListener("blur", cancelOnBlur)
    document.addEventListener("pointerdown", cancelOutside, true)
    document.addEventListener("visibilitychange", cancelWhenHidden)
    document.addEventListener("keydown", useKeyboard, true)
    return () => {
      window.removeEventListener("blur", cancelOnBlur)
      document.removeEventListener("pointerdown", cancelOutside, true)
      document.removeEventListener("visibilitychange", cancelWhenHidden)
      document.removeEventListener("keydown", useKeyboard, true)
      const active = drag.current
      drag.current = null
      if (active?.element.hasPointerCapture(active.pointerId)) active.element.releasePointerCapture(active.pointerId)
    }
  }, [])

  function bandAt(clientX: number): Band {
    const rect = group.current!.getBoundingClientRect()
    const index = Math.max(0, Math.min(2, Math.floor((clientX - rect.left) / (rect.width / 3))))
    return BANDS[index]
  }

  function focusBand(band: Band) {
    // The decorative thumb also has data-band; focus only the radio button.
    group.current?.querySelector<HTMLButtonElement>('button[data-band="' + band + '"]')?.focus({ preventScroll: true })
  }

  function beginDrag(event: PointerEvent<HTMLDivElement>) {
    event.stopPropagation()
    if (disabled || !event.isPrimary || event.button !== 0 || drag.current) return
    event.preventDefault()
    setPointerInput(true)
    const next = bandAt(event.clientX)
    drag.current = { pointerId: event.pointerId, element: event.currentTarget }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDraft(next)
    focusBand(next)
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    event.stopPropagation()
    if (drag.current?.pointerId !== event.pointerId) return
    event.preventDefault()
    setDraft(bandAt(event.clientX))
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    event.stopPropagation()
    if (drag.current?.pointerId !== event.pointerId) return
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
      cancelDrag()
      return
    }
    const next = bandAt(event.clientX)
    commit(next)
    if (!disabled) focusBand(next)
  }

  function handleKeys(event: KeyboardEvent<HTMLDivElement>) {
    setPointerInput(false)
    if (event.key === "Escape" && drag.current) {
      event.preventDefault()
      event.stopPropagation()
      cancelDrag()
      return
    }
    if (disabled || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || !(event.target instanceof HTMLElement)) return
    const focusedBand = event.target.dataset.band
    const focusedIndex = BANDS.findIndex(band => band === focusedBand)
    if (focusedIndex < 0) return
    event.preventDefault()
    event.stopPropagation()
    cancelDrag()
    const selectedIndex = BANDS.findIndex(band => band === currentValue.current)
    const current = selectedIndex < 0 ? focusedIndex : selectedIndex
    const index = event.key === "Home" ? 0 : event.key === "End" ? 2
      : (current + (event.key === "ArrowRight" ? 1 : -1) + BANDS.length) % BANDS.length
    const next = BANDS[index]
    commit(next)
    focusBand(next)
  }

  return <div ref={root} className={styles.root} data-testid="map-temperature-spectrum" data-selected={selected ?? "all"}
    data-disabled={disabled} data-pointer-input={pointerInput} onKeyDown={handleKeys}
    onPointerDown={event => { event.stopPropagation(); if (!disabled) setPointerInput(true) }}
    onClick={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) cancelDrag() }}>
    <button type="button" className={styles.reset} disabled={disabled} data-testid="map-temperature-reset"
      aria-label={copy.reset} aria-pressed={selected === null} onClick={() => commit(null)}>{copy.all}</button>
    <div ref={group} className={styles.bands} role="radiogroup" aria-label={copy.group}
      aria-orientation="horizontal" aria-describedby={hintId} aria-disabled={disabled}
      data-testid="map-temperature-bands" data-draft={draft ?? "none"}
      onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={endDrag}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) cancelDrag() }}
      onPointerCancel={event => { event.stopPropagation(); cancelDrag() }} onLostPointerCapture={cancelDrag}>
      <span className={styles.track} aria-hidden="true" />
      {visibleBand && <span className={styles.thumb} data-band={visibleBand} data-preview={draft !== null}
        data-testid="map-temperature-selected-marker" aria-hidden="true" />}
      {BANDS.map((band, index) => <button key={band} type="button" role="radio" className={styles.band}
        disabled={disabled} data-band={band} data-temperature-band={band} data-preview={draft === band}
        data-testid={"map-temperature-" + band} aria-label={copy[band]} aria-checked={selected === band}
        tabIndex={selected === band || selected === null && index === 0 ? 0 : -1}
        onClick={event => { if (!disabled && event.detail === 0) { setPointerInput(false); commit(band) } }}>
        <i className={styles.detent} aria-hidden="true" />
      </button>)}
    </div>
    <span className={styles.srOnly} id={hintId}>{copy.hint}</span>
  </div>
}
