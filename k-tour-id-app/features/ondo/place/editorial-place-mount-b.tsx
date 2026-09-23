"use client"

import { useEffect, useLayoutEffect, useMemo, useRef } from "react"
import { MY_KOREA_SAVED_EDITORIAL_OPENER_ATTRIBUTE } from "../my/my-korea-place-return-b"
import { editorialPlaceById, type EditorialPlaceB } from "../pulse-b/japan-first-pulse-model-b"
import { useOndoB } from "../shared/state/ondo-b-provider"
import type { OndoBLocale } from "../shared/state/ondo-b-preferences"
import { isRenderedFocusable } from "../shared/ui/is-rendered-focusable"
import { useSheetPresence } from "../shared/ui/use-sheet-presence"
import { EditorialPlaceOverlayB } from "./editorial-place-overlay-b"

type EditorialPlaceSubject = Readonly<{
  key: EditorialPlaceB["id"]
  editorialPlaceId: EditorialPlaceB["id"]
  locale: OndoBLocale
}>

const FALLBACK_DESTINATIONS = [
  "[data-testid='ondo-b-japan-first-discovery'] > summary",
  "[data-testid='ondo-b-view-toggle']",
  "[data-testid='ondo-b-search']",
  "[aria-current='page']",
  "#ondo-active-panel",
] as const

function isAvailableDestination(element: HTMLElement) {
  if (!element.isConnected || element.closest("[inert],[aria-hidden='true']")) return false
  const style = window.getComputedStyle(element)
  if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function focusDestination(element: HTMLElement) {
  if (isRenderedFocusable(element)) {
    element.focus({ preventScroll: true })
    return
  }
  const previousTabIndex = element.getAttribute("tabindex")
  element.setAttribute("tabindex", "-1")
  element.focus({ preventScroll: true })
  if (document.activeElement !== element) {
    if (previousTabIndex == null) element.removeAttribute("tabindex")
    else element.setAttribute("tabindex", previousTabIndex)
    return
  }
  element.addEventListener("blur", () => {
    if (previousTabIndex == null) element.removeAttribute("tabindex")
    else element.setAttribute("tabindex", previousTabIndex)
  }, { once: true })
}

function foremostRemainingDialog() {
  return Array.from(document.querySelectorAll<HTMLElement>("[role='dialog'][aria-modal='true'],[role='alertdialog'][aria-modal='true']"))
    .filter(isAvailableDestination)
    .sort((left, right) => Number(right.closest<HTMLElement>("[data-modal-layer-priority]")?.dataset.modalLayerPriority ?? 0)
      - Number(left.closest<HTMLElement>("[data-modal-layer-priority]")?.dataset.modalLayerPriority ?? 0))[0] ?? null
}

export function EditorialPlaceMountB() {
  const { state } = useOndoB()
  const desiredEditorialPlaceId = state.tab === "ondo" && state.surface.kind === "editorial_place"
    && editorialPlaceById(state.surface.editorialPlaceId)
    ? state.surface.editorialPlaceId
    : null
  const desiredSubject = useMemo<EditorialPlaceSubject | null>(() => desiredEditorialPlaceId ? {
    key: desiredEditorialPlaceId,
    editorialPlaceId: desiredEditorialPlaceId,
    locale: state.locale,
  } : null, [desiredEditorialPlaceId, state.locale])
  // Capture before the child modal's layout effect isolates the map/My Korea
  // branch. Browsers may blur an element as soon as one of its ancestors
  // becomes inert, which is too late for an exact opener handoff.
  const activeAtSelection = useMemo<HTMLElement | null>(() => desiredEditorialPlaceId
    && typeof document !== "undefined"
    && document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null, [desiredEditorialPlaceId])
  const presence = useSheetPresence(desiredSubject)
  const presented = presence.value
  // Discovery/history and tab state are allowed to move immediately. Treat
  // the retained subject as closing in that very render, before the shared
  // presence hook can commit its layout-effect transition, so no post-exit
  // state is captured as the final painted editorial frame.
  const presentedPhase = desiredSubject?.key === presented?.key && presence.phase === "open" ? "open" : "closing"
  const exactOpenerRef = useRef<HTMLElement | null>(null)
  const openerSelectorRef = useRef<string | null>(null)
  const destinationSelectorsRef = useRef<readonly string[]>(FALLBACK_DESTINATIONS)
  const restoreAfterExitRef = useRef(false)
  const desiredWasOpenRef = useRef(false)
  const desiredKeyRef = useRef<EditorialPlaceB["id"] | null>(null)
  const restorationSerialRef = useRef(0)

  useLayoutEffect(() => {
    if (!desiredSubject) {
      if (desiredWasOpenRef.current) {
        restoreAfterExitRef.current = true
        restorationSerialRef.current += 1
      }
      desiredWasOpenRef.current = false
      return
    }

    const freshSubject = !desiredWasOpenRef.current || desiredKeyRef.current !== desiredSubject.key
    desiredWasOpenRef.current = true
    if (!freshSubject) return

    desiredKeyRef.current = desiredSubject.key
    restoreAfterExitRef.current = false
    restorationSerialRef.current += 1
    const escapedId = CSS.escape(desiredSubject.editorialPlaceId)
    const collectionSelector = `[data-discovery-place-opener='${escapedId}']`
    const mapSelector = `[data-editorial-place-opener='${escapedId}']`
    const savedSelector = `[${MY_KOREA_SAVED_EDITORIAL_OPENER_ATTRIBUTE}='${escapedId}']`
    const storySelector = `[data-editorial-story-opener='${escapedId}']`
    const selectors = [collectionSelector, mapSelector, savedSelector, storySelector, ...FALLBACK_DESTINATIONS]
    const active = activeAtSelection ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    const activeSelector = selectors.find((selector) => active?.matches(selector) || active?.closest(selector)) ?? null
    exactOpenerRef.current = activeSelector
      ? active?.matches(activeSelector) ? active : active?.closest<HTMLElement>(activeSelector) ?? null
      : null
    openerSelectorRef.current = activeSelector
    destinationSelectorsRef.current = activeSelector
      ? [activeSelector, ...selectors.filter((selector) => selector !== activeSelector)]
      : selectors
  }, [activeAtSelection, desiredSubject])

  useEffect(() => {
    if (presence.value !== null || !restoreAfterExitRef.current) return
    restoreAfterExitRef.current = false
    const serial = restorationSerialRef.current
    const exactOpener = exactOpenerRef.current
    const exactSelector = openerSelectorRef.current
    const selectors = destinationSelectorsRef.current
    exactOpenerRef.current = null
    openerSelectorRef.current = null
    let frame: number | null = null
    let timer: number | null = null
    let attempts = 0

    const restore = () => {
      frame = null
      timer = null
      if (restorationSerialRef.current !== serial || desiredWasOpenRef.current) return

      const remainingDialog = foremostRemainingDialog()
      if (remainingDialog) {
        if (remainingDialog.contains(document.activeElement)) return
        const dialogTarget = Array.from(remainingDialog.querySelectorAll<HTMLElement>("a[href],button:not([disabled]),summary,[tabindex]:not([tabindex='-1'])"))
          .find(isRenderedFocusable) ?? remainingDialog
        focusDestination(dialogTarget)
        return
      }

      if (exactOpener && exactSelector && exactOpener.matches(exactSelector) && isAvailableDestination(exactOpener)) {
        focusDestination(exactOpener)
        return
      }

      for (const selector of selectors) {
        const destination = Array.from(document.querySelectorAll<HTMLElement>(selector)).find(isAvailableDestination)
        if (!destination) continue
        focusDestination(destination)
        return
      }

      attempts += 1
      if (attempts < 24) timer = window.setTimeout(restore, 50)
    }

    frame = window.requestAnimationFrame(restore)
    return () => {
      if (frame != null) window.cancelAnimationFrame(frame)
      if (timer != null) window.clearTimeout(timer)
    }
  }, [presence.value])

  if (!presented) return null
  return (
    <EditorialPlaceOverlayB
      key={presented.key}
      editorialPlaceId={presented.editorialPlaceId}
      locale={presented.locale}
      presenceState={presentedPhase}
    />
  )
}
