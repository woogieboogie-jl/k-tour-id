"use client"

import type { ButtonHTMLAttributes, KeyboardEvent, ReactNode } from "react"
import { useEffect, useLayoutEffect, useRef } from "react"
import { ArrowLeft, X } from "lucide-react"
import { isRenderedFocusable, isRenderedProgrammaticFocusTarget } from "./is-rendered-focusable"
import { ONDO_MODAL_PRIORITY } from "./modal-layer-priority"
import { useDocumentScrollLock, useModalIsolation, useModalVisualViewport } from "./use-modal-isolation"
import type { SheetPresencePhase } from "./use-sheet-presence"
import styles from "./ui.module.css"

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "[tabindex]:not([tabindex='-1'])",
].join(",")

export type SheetVariant = "peek" | "decision" | "detail" | "full-task"
export type SheetNavigation = "close" | "back" | "none"

type SheetBProps = {
  children: ReactNode
  label: string
  locale: "en" | "ko" | "ja"
  onClose(): void
  showClose?: boolean
  size?: "peek" | "medium" | "full"
  variant?: SheetVariant
  header?: ReactNode
  footer?: ReactNode
  navigation?: SheetNavigation
  onBack?(): void
  suspended?: boolean
  /** A nested task must match visual stacking to focus/isolation ownership. */
  modalPriority?: number
  initialFocusSelector?: string
  /** A caller that explicitly hands focus to a non-modal destination can
   * suppress the usual opener restoration. Omitted preserves the default. */
  shouldRestoreFocus?(): boolean
  presenceState?: Exclude<SheetPresencePhase, "closed">
}

/** Variant B owns this provider-neutral frame so its production graph cannot
 * pull the legacy OndoProvider in through a shared wrapper. */
export function SheetB({ locale, ...props }: SheetBProps) {
  const closeLabel = locale === "ko" ? "닫기" : locale === "ja" ? "閉じる" : "Close"
  const backLabel = locale === "ko" ? "뒤로" : locale === "ja" ? "戻る" : "Back"
  return <SheetBFrame {...props} closeLabel={closeLabel} backLabel={backLabel} />
}

function SheetBFrame({
  children,
  label,
  onClose,
  showClose = true,
  size = "medium",
  variant,
  header,
  footer,
  navigation,
  onBack,
  suspended = false,
  modalPriority: priorityOverride,
  initialFocusSelector,
  shouldRestoreFocus,
  presenceState = "open",
  closeLabel,
  backLabel,
}: Omit<SheetBProps, "locale"> & { closeLabel: string; backLabel: string }) {
  const layerRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  const onBackRef = useRef(onBack)
  const shouldRestoreFocusRef = useRef(shouldRestoreFocus)
  const semanticVariant = variant ?? (size === "peek" ? "peek" : size === "full" ? "full-task" : "decision")
  const modalPriority = priorityOverride ?? (semanticVariant === "peek"
    ? ONDO_MODAL_PRIORITY.peek
    : semanticVariant === "decision"
      ? ONDO_MODAL_PRIORITY.decision
      : semanticVariant === "detail"
        ? ONDO_MODAL_PRIORITY.detail
        : ONDO_MODAL_PRIORITY.fullTask)
  const navigationKind = navigation ?? (showClose ? "close" : "none")
  const variantClass = semanticVariant === "full-task" ? styles.fulltask : styles[semanticVariant]
  const closing = presenceState === "closing"
  const closingRef = useRef(closing)
  closingRef.current = closing
  const presentationRef = useRef({ children, footer, header, label })
  // Domain state is allowed to settle as soon as close is accepted. Keep the
  // last painted sheet content immutable for the retained exit so controls do
  // not disable, counters do not jump, and copy does not morph on the way out.
  if (!closing) presentationRef.current = { children, footer, header, label }
  const presentation = closing ? presentationRef.current : { children, footer, header, label }

  useLayoutEffect(() => {
    onCloseRef.current = onClose
    onBackRef.current = onBack
    shouldRestoreFocusRef.current = shouldRestoreFocus
  }, [onBack, onClose, shouldRestoreFocus])

  useLayoutEffect(() => {
    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement && activeElement !== document.body && !dialogRef.current?.contains(activeElement)) {
      returnFocusRef.current = activeElement
    }
  }, [])

  useModalIsolation(!suspended, layerRef)
  useDocumentScrollLock(true)
  useModalVisualViewport(layerRef)

  useEffect(() => {
    if (suspended) return
    const dialog = dialogRef.current
    const activeAtMount = document.activeElement
    const preferredCandidate = (initialFocusSelector ? dialog?.querySelector<HTMLElement>(initialFocusSelector) : null)
      ?? dialog?.querySelector<HTMLElement>("[data-sheet-initial-focus]")
    const preferred = preferredCandidate && isRenderedProgrammaticFocusTarget(preferredCandidate) ? preferredCandidate : null
    const first = preferred
      ?? Array.from(dialog?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).find(isRenderedFocusable)
      ?? dialog
    const focusInitial = () => {
      // React can reuse the focused navigation button while one semantic
      // sheet replaces another (Privacy → Delete). That inherited focus is
      // not an explicit user choice in the new dialog, so the new sheet's
      // declared initial target must still win. Preserve only focus that moved
      // elsewhere inside this dialog after it mounted.
      if (dialog?.contains(document.activeElement) && document.activeElement !== activeAtMount) return
      first?.focus({ preventScroll: true })
    }
    let focusFrame = window.requestAnimationFrame(() => {
      focusFrame = window.requestAnimationFrame(focusInitial)
    })
    const focusRecoveryTimer = window.setTimeout(() => {
      if (dialogRef.current && !dialogRef.current.contains(document.activeElement)) focusInitial()
    }, 160)

    const interceptEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || !dialogRef.current?.contains(document.activeElement)) return
      // A nested task owns Escape even when its node is inside this sheet.
      // Covered parent sheets must not dismiss the whole return journey.
      if (document.activeElement?.closest('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]') !== dialogRef.current) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (closingRef.current) return
      onCloseRef.current()
    }
    document.addEventListener("keydown", interceptEscape, true)
    return () => {
      document.removeEventListener("keydown", interceptEscape, true)
      window.cancelAnimationFrame(focusFrame)
      window.clearTimeout(focusRecoveryTimer)
      window.setTimeout(() => {
        if (shouldRestoreFocusRef.current?.() === false) return
        const previous = returnFocusRef.current
        const remainingDialogs = Array.from(document.querySelectorAll<HTMLElement>("[role='dialog'][aria-modal='true'], [role='alertdialog'][aria-modal='true']"))
          .filter((candidate) => !candidate.closest("[inert],[aria-hidden='true']"))
          .sort((left, right) => Number(right.closest<HTMLElement>("[data-modal-layer-priority]")?.dataset.modalLayerPriority ?? 0)
            - Number(left.closest<HTMLElement>("[data-modal-layer-priority]")?.dataset.modalLayerPriority ?? 0))
        const remainingDialog = remainingDialogs[0]
        if (remainingDialog && !remainingDialog.contains(previous)) {
          if (remainingDialog.contains(document.activeElement)) return
          const target = Array.from(remainingDialog.querySelectorAll<HTMLElement>(FOCUSABLE)).find(isRenderedFocusable) ?? remainingDialog
          target.focus({ preventScroll: true })
        } else if (previous && isRenderedFocusable(previous)) previous.focus({ preventScroll: true })
        else Array.from(document.querySelectorAll<HTMLElement>("[data-sheet-return-focus], [data-testid='canonical-place-details'], [data-testid='place-details'], [aria-current='page']"))
          .find(isRenderedFocusable)?.focus({ preventScroll: true })
      }, 80)
    }
  }, [initialFocusSelector, suspended])

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (closing) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (suspended) return
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      onCloseRef.current()
      return
    }
    if (event.key !== "Tab") return
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
      .filter(isRenderedFocusable)
    if (!focusable.length) {
      event.preventDefault()
      dialogRef.current?.focus()
      return
    }
    const first = focusable[0]
    const last = focusable.at(-1)!
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const navigate = navigationKind === "back" ? () => (onBackRef.current ?? onCloseRef.current)() : () => onCloseRef.current()
  const navigationControl = navigationKind === "none" ? null : (
    <button
      type="button"
      data-sheet-initial-focus
      data-sheet-navigation={navigationKind}
      className={styles.close}
      onClick={navigate}
      aria-label={navigationKind === "back" ? backLabel : closeLabel}
    >
      {navigationKind === "back" ? <ArrowLeft size={20} aria-hidden="true" /> : <X size={19} aria-hidden="true" />}
    </button>
  )

  return (
    <div
      ref={layerRef}
      className={styles.layer}
      data-sheet-layer="true"
      data-sheet-variant={semanticVariant}
      data-ondo-layer={semanticVariant}
      data-modal-layer-priority={modalPriority}
      style={priorityOverride === undefined ? undefined : { zIndex: modalPriority }}
      data-sheet-presence={presenceState}
      onClickCapture={(event) => {
        if (!closing) return
        event.preventDefault()
        event.stopPropagation()
      }}
      onPointerDownCapture={(event) => {
        if (!closing) return
        event.preventDefault()
        event.stopPropagation()
      }}
      onKeyDownCapture={(event) => {
        if (!closing) return
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      <button type="button" tabIndex={-1} className={styles.backdrop} onClick={() => onCloseRef.current()} aria-hidden="true" disabled={suspended || closing} />
      <section
        ref={dialogRef}
        className={`${styles.sheet} ${variantClass}`}
        data-testid="ondo-sheet"
        data-sheet-size={size}
        data-sheet-variant={semanticVariant}
        data-sheet-navigation={navigationKind}
        role={suspended ? undefined : "dialog"}
        aria-modal={suspended ? undefined : "true"}
        aria-label={presentation.label}
        aria-busy={closing ? "true" : undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        {presentation.header ? (
          <header className={styles.sheetHeader} data-sheet-header="true">
            {navigationKind === "back" ? navigationControl : <span className={styles.headerSpacer} aria-hidden="true" />}
            <div className={styles.headerContent}>{presentation.header}</div>
            {navigationKind === "close" ? navigationControl : <span className={styles.headerSpacer} aria-hidden="true" />}
          </header>
        ) : (
          <>
            {semanticVariant === "full-task" ? null : <div className={styles.grabber} aria-hidden="true" />}
            {navigationControl}
          </>
        )}
        <div className={styles.viewport} data-sheet-scroll-owner="true">{presentation.children}</div>
        {presentation.footer ? <footer className={styles.sheetFooter} data-sheet-footer="true">{presentation.footer}</footer> : null}
      </section>
    </div>
  )
}

type IconActionProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children" | "title"> & {
  icon: ReactNode
  label: string
}

/** Icon-only controls keep a required, action-oriented accessible name. */
export function IconAction({ icon, label, className, ...props }: IconActionProps) {
  const accessibleName = label.trim()
  if (!accessibleName) throw new Error("IconAction requires a non-empty localized label")
  return <button {...props} type={props.type ?? "button"} className={`${styles.iconAction}${className ? ` ${className}` : ""}`} aria-label={accessibleName}><span aria-hidden="true">{icon}</span></button>
}

export function InlineNotice({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warm" | "danger" | "success" }) {
  return <div className={`${styles.notice} ${styles[`notice_${tone}`]}`}>{children}</div>
}
