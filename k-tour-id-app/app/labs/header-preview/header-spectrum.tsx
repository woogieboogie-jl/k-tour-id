"use client"

import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react"
import styles from "./header-spectrum.module.css"

type Band = "cool" | "warm" | "hot"
export type HeaderSpectrumValue = "all" | Band

const BANDS: readonly { value: Band; label: string }[] = [
  { value: "cool", label: "차분한 무드" },
  { value: "warm", label: "적당한 활기" },
  { value: "hot", label: "활기 있는 발견" },
]

/** Three discrete recommendations, never a continuous or live crowd reading. */
export function HeaderSpectrum({ value, onChange, onOpen, disabled = false }: {
  value: HeaderSpectrumValue
  onChange(value: HeaderSpectrumValue): void
  onOpen?(): void
  disabled?: boolean
}) {
  const [draft, setDraft] = useState<Band | null>(null)
  const [pointerInput, setPointerInput] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const group = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointerId: number; element: HTMLDivElement } | null>(null)
  const currentValue = useRef(value)
  currentValue.current = value
  const hintId = useId()
  const visibleBand = draft ?? (value === "all" ? null : value)

  function cancelDrag() {
    const active = drag.current
    drag.current = null
    setDraft(null)
    if (active?.element.hasPointerCapture(active.pointerId)) active.element.releasePointerCapture(active.pointerId)
  }

  function commit(next: HeaderSpectrumValue) {
    cancelDrag()
    if (!disabled && next !== currentValue.current) onChange(next)
    // This inline control never restores focus to a trigger or another surface.
  }

  useEffect(() => { cancelDrag() }, [disabled, value])
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
    return BANDS[index].value
  }

  function beginDrag(event: PointerEvent<HTMLDivElement>) {
    event.stopPropagation()
    if (disabled || !event.isPrimary || event.button !== 0 || drag.current) return
    event.preventDefault()
    setPointerInput(true)
    onOpen?.()
    const next = bandAt(event.clientX)
    drag.current = { pointerId: event.pointerId, element: event.currentTarget }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDraft(next)
    event.currentTarget.querySelector<HTMLButtonElement>('button[data-band="' + next + '"]')?.focus({ preventScroll: true })
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
    // The decorative thumb also has data-band; focus only its radio button.
    if (!disabled) group.current?.querySelector<HTMLButtonElement>('button[data-band="' + next + '"]')?.focus({ preventScroll: true })
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
    const focusedIndex = BANDS.findIndex(band => band.value === focusedBand)
    if (focusedIndex < 0) return
    event.preventDefault()
    event.stopPropagation()
    cancelDrag()
    onOpen?.()
    // After pointer dragging, start the next key action at the committed band.
    const selectedIndex = BANDS.findIndex(band => band.value === currentValue.current)
    const current = selectedIndex < 0 ? focusedIndex : selectedIndex
    const index = event.key === "Home" ? 0 : event.key === "End" ? 2
      : (current + (event.key === "ArrowRight" ? 1 : -1) + BANDS.length) % BANDS.length
    const next = BANDS[index].value
    commit(next)
    group.current?.querySelector<HTMLButtonElement>('button[data-band="' + next + '"]')?.focus({ preventScroll: true })
  }

  return <div ref={root} className={styles.root} data-testid="header-spectrum" data-selected={value}
    data-disabled={disabled} data-pointer-input={pointerInput} onKeyDown={handleKeys}
    onPointerDown={event => { event.stopPropagation(); if (!disabled) setPointerInput(true) }} onClick={event => event.stopPropagation()}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) cancelDrag() }}>
    <button type="button" className={styles.reset} disabled={disabled} data-testid="header-spectrum-reset"
      aria-label="분위기 선택 해제, 전체 보기" aria-pressed={value === "all"}
      onClick={() => { if (!disabled) { onOpen?.(); commit("all") } }}>전체</button>
    <div ref={group} className={styles.bands} role="radiogroup" aria-label="탐색 분위기"
      aria-orientation="horizontal" aria-describedby={hintId} aria-disabled={disabled}
      data-testid="header-spectrum-bands" data-draft={draft ?? "none"}
      onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={endDrag}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) cancelDrag() }}
      onPointerCancel={event => { event.stopPropagation(); cancelDrag() }} onLostPointerCapture={cancelDrag}>
      <span className={styles.track} aria-hidden="true" />
      {visibleBand && <span className={styles.thumb} data-band={visibleBand} data-preview={draft !== null}
        data-testid="header-spectrum-selected-marker" aria-hidden="true" />}
      {BANDS.map((band, index) => <button key={band.value} type="button" role="radio" className={styles.band}
        disabled={disabled} data-band={band.value} data-preview={draft === band.value}
        data-testid={"header-spectrum-" + band.value} aria-label={band.label} aria-checked={value === band.value}
        tabIndex={value === band.value || value === "all" && index === 0 ? 0 : -1}
        onClick={event => { if (!disabled && event.detail === 0) { setPointerInput(false); onOpen?.(); commit(band.value) } }}>
        <i className={styles.detent} aria-hidden="true" />
      </button>)}
    </div>
    <span className={styles.srOnly} id={hintId}>세 단계의 편집 추천입니다. 왼쪽은 차분한 무드, 가운데는 적당한 활기, 오른쪽은 활기 있는 발견입니다. 좌우 방향키로 선택하고 전체 버튼으로 해제할 수 있어요. 실시간 인기·혼잡 정보가 아니며 조용함을 보장하지 않아요.</span>
  </div>
}
