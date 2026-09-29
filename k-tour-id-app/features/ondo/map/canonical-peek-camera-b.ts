import type { Map as MapLibreMap } from "maplibre-gl"

type Box = { left: number; right: number; top: number; bottom: number }
type Point = { x: number; y: number }

/** Find the nearest space for a point and its below-point place label. */
export function canonicalPeekTarget(point: Point, map: Box, peek: Box, chrome: readonly Box[], labelHalfWidth: number): Point | null {
  // DOMRect coordinates live on its prototype; object spread drops them.
  const bounds = { left: map.left, right: map.right, top: map.top, bottom: map.bottom }
  const regions = [
    { ...bounds, bottom: Math.min(map.bottom, peek.top - 8) },
    { ...bounds, right: Math.min(map.right, peek.left - 8) },
    { ...bounds, left: Math.max(map.left, peek.right + 8) },
  ]
  const candidates = regions.flatMap(region => {
    const left = region.left + labelHalfWidth
    const right = region.right - labelHalfWidth
    const top = Math.max(region.top + 40, ...chrome.filter(box => box.right > region.left && box.left < region.right).map(box => box.bottom + 40))
    const bottom = region.bottom - 64
    if (left > right || top > bottom) return []
    return [{ x: Math.max(left, Math.min(right, point.x)), y: Math.max(top, Math.min(bottom, point.y)) }]
  })
  return candidates.sort((a, b) => (a.x - point.x) ** 2 + (a.y - point.y) ** 2 - ((b.x - point.x) ** 2 + (b.y - point.y) ** 2))[0] ?? null
}

/** Layout-only protection for the centered PC peek. Never follows a user's pan. */
export function observeCenteredCanonicalPeek(map: MapLibreMap, venue: { id: string; longitude: number; latitude: number; label: string }) {
  const container = map.getContainer()
  const canvas = container.closest('[data-testid="ondo-canvas"]')
  if (!canvas) return () => undefined
  const centered = window.matchMedia("(min-width: 1024px) and (min-height: 501px)")
  let peek: HTMLElement | null = null
  let search: HTMLElement | null = null
  let alive = true
  let userMoved = false
  let waitingForCamera = false
  let frame = 0
  const selectedPoint = () => {
    const rect = container.getBoundingClientRect()
    const point = map.project([venue.longitude, venue.latitude])
    return { x: rect.left + point.x, y: rect.top + point.y }
  }
  const publish = () => {
    if (!alive || !peek || !centered.matches) return
    const point = selectedPoint()
    container.dataset.peekSelectedPinX = point.x.toFixed(2)
    container.dataset.peekSelectedPinY = point.y.toFixed(2)
  }
  const adjust = () => {
    if (!alive || userMoved || !centered.matches || !peek?.isConnected || peek.dataset.placePresence === "closing") return
    if (map.isMoving()) { waitingForCamera = true; return }
    const chrome = Array.from(canvas.querySelectorAll<HTMLElement>('[data-testid="ondo-b-city-header"], [data-testid="ondo-b-search"]'))
      .filter(node => node.getClientRects().length > 0).map(node => node.getBoundingClientRect())
    const point = selectedPoint()
    const target = canonicalPeekTarget(point, container.getBoundingClientRect(), peek.getBoundingClientRect(), chrome, Math.min(172, Math.max(64, venue.label.length * 6 + 24)))
    // Pan only: keep zoom, pitch, padding and the existing history owner intact.
    // Perspective means one center-relative pixel pan is not an exact pin
    // displacement. Re-project a bounded number of times in the same frame.
    for (let attempt = 0; target && attempt < 4; attempt += 1) {
      const current = selectedPoint()
      if (Math.hypot(current.x - target.x, current.y - target.y) <= 1) break
      map.panBy([current.x - target.x, current.y - target.y], { duration: 0 })
    }
    publish()
  }
  const schedule = () => {
    if (!alive || userMoved) return
    window.cancelAnimationFrame(frame)
    frame = window.requestAnimationFrame(() => { frame = window.requestAnimationFrame(adjust) })
  }
  const resize = new ResizeObserver(schedule)
  resize.observe(container)
  const findPeek = () => {
    const nextSearch = canvas.querySelector<HTMLElement>('[data-testid="ondo-b-search"]')
    if (nextSearch !== search) {
      if (search) resize.unobserve(search)
      search = nextSearch
      if (search) resize.observe(search)
      schedule()
    }
    const next = canvas.querySelector<HTMLElement>('[data-testid="canonical-place-peek"]')
    const ownPeek = next?.dataset.venueId === venue.id ? next : null
    if (ownPeek === peek) return
    if (peek) resize.unobserve(peek)
    peek = ownPeek
    if (!peek) return
    resize.observe(peek)
    schedule()
    void Promise.all(peek.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation => animation.finished.catch(() => undefined))).then(schedule)
  }
  const mutations = new MutationObserver(findPeek)
  mutations.observe(canvas, { childList: true, subtree: true })
  const onMoveEnd = () => {
    publish()
    if (waitingForCamera) { waitingForCamera = false; schedule() }
  }
  const onUserMove = () => { userMoved = true; waitingForCamera = false; window.cancelAnimationFrame(frame) }
  for (const event of ["pointerdown", "wheel", "keydown"]) container.addEventListener(event, onUserMove, { passive: true })
  map.on("moveend", onMoveEnd)
  centered.addEventListener("change", schedule)
  findPeek()
  return () => {
    alive = false
    window.cancelAnimationFrame(frame)
    resize.disconnect()
    mutations.disconnect()
    map.off("moveend", onMoveEnd)
    centered.removeEventListener("change", schedule)
    for (const event of ["pointerdown", "wheel", "keydown"]) container.removeEventListener(event, onUserMove)
    delete container.dataset.peekSelectedPinX
    delete container.dataset.peekSelectedPinY
  }
}
