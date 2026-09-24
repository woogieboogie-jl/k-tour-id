"use client"

import { useEffect, useRef, useState } from "react"
import { Info } from "lucide-react"
import styles from "./header-credits.module.css"

/** A visual attribution study on a hand-drawn map, not map-provider integration. */
export function HeaderCredits({ enabled, onDetails }: { enabled: boolean; onDetails(): void }) {
  const root = useRef<HTMLDivElement>(null)
  const remaining = useRef(5_000)
  const [expanded, setExpanded] = useState(true)
  const [visible, setVisible] = useState(false)
  const [foreground, setForeground] = useState(true)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    const node = root.current
    if (!node) return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting && entry.intersectionRatio >= .99), { threshold: [0, .99, 1] })
    observer.observe(node)
    const visibility = () => setForeground(document.visibilityState === "visible")
    visibility()
    document.addEventListener("visibilitychange", visibility)
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", visibility) }
  }, [])

  useEffect(() => {
    if (!expanded || !enabled || !visible || !foreground || hovered || focused) return
    const started = performance.now()
    const timer = window.setTimeout(() => setExpanded(false), remaining.current)
    return () => {
      window.clearTimeout(timer)
      remaining.current = Math.max(0, remaining.current - (performance.now() - started))
    }
  }, [expanded, enabled, visible, foreground, hovered, focused])

  return <div ref={root} className={styles.credits} data-testid="header-credits" data-expanded={expanded} aria-label="지도 출처 표기 미리보기"
    onPointerEnter={event => { if (event.pointerType === "mouse") setHovered(true) }}
    onPointerLeave={() => setHovered(false)}
    onFocus={() => setFocused(true)}
    onBlur={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setFocused(false) }}>
    <a href="https://openmaptiles.org/" target="_blank" rel="noreferrer">© OpenMapTiles</a>
    {expanded && <><span aria-hidden="true">·</span><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a></>}
    <button type="button" onClick={onDetails} aria-label="지도 출처 보기" aria-haspopup="dialog"><Info size={15} aria-hidden="true" /></button>
  </div>
}
