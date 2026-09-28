import { expect, test } from "@playwright/test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")

test("CANONICAL-EXIT-001 the mount owns a keyed venue subject through the shared 260ms presence lifecycle", () => {
  const mount = source("features/ondo/place/canonical-place-mount.tsx")
  const presence = source("features/ondo/shared/ui/use-sheet-presence.ts")

  expect(mount).toContain("useSheetPresence(desiredSubject)")
  expect(mount).toContain('state.tab === "ondo" && state.surface.kind === "venue"')
  expect(mount).toContain("const presented = presence.value")
  expect(mount).toContain('const presentedPhase = desiredSubject?.key === presented?.key && presence.phase === "open" ? "open" : "closing"')
  expect(mount).toContain("key={presented.key}")
  expect(mount).toContain("locale={presented.locale}")
  expect(mount).toContain("presenceState={presentedPhase}")
  expect(mount).toContain("venueId={presented.venueId}")
  expect(presence).toContain("export const SHEET_EXIT_DURATION_MS = 260")
})

test("CANONICAL-EXIT-002 history and destination state mutate immediately while only presentation is retained", () => {
  const place = source("features/ondo/place/canonical-place-overlay.tsx")
  const close = place.slice(place.indexOf("function close()"), place.indexOf("function closeDetails()"))
  const table = place.slice(place.indexOf("function openTableFromPlace()"), place.indexOf("function browseAllTables()"))
  const benefit = place.slice(place.indexOf("function openMealBenefitFromPlace()"), place.indexOf("function openLocalSignalFromPlace()"))

  expect(close).toContain("beginFinalDismiss()")
  expect(close).toContain("closeBDiscoveryPlace()")
  expect(close).toContain('actions.setSurface({ kind: "map" })')
  expect(close).not.toMatch(/setTimeout|requestAnimationFrame/)
  expect(table.indexOf('actions.setTab("tables")')).toBeLessThan(table.indexOf("window.setTimeout"))
  expect(benefit).toContain("actions.openMealBenefitFromPlace(currentVenueId)")
  expect(benefit).not.toMatch(/setTimeout|requestAnimationFrame/)
})

test("CANONICAL-EXIT-003 the last complete visual state is frozen across async facts, save, temperature and locale changes", () => {
  const place = source("features/ondo/place/canonical-place-overlay.tsx")

  expect(place).toContain("type CanonicalPlaceVisualSnapshot")
  expect(place).toContain("if (!closing && !exitRequestedRef.current) visualSnapshotRef.current = liveVisualSnapshot")
  expect(place).toContain("const visualSnapshot = closing || exitRequestedRef.current ? visualSnapshotRef.current : liveVisualSnapshot")
  for (const token of [
    "visualSnapshot.expanded",
    "visualSnapshot.detail",
    "visualSnapshot.detailState",
    "visualSnapshot.openFactKey",
    "visualSnapshot.after19Session",
    "visualSnapshot.after19Unlocked",
    "visualSnapshot.localPulseEvidence",
    "visualSnapshot.saveStatus",
    "visualSnapshot.tableClockNow",
  ]) expect(place).toContain(token)
})

test("CANONICAL-EXIT-004 mobile peek, detail and nested evidence retain modal protection; desktop peek leaves background usable", () => {
  const place = source("features/ondo/place/canonical-place-overlay.tsx")

  expect(place).toContain("const modalPresentation = !desktopLayout || visualSnapshot.expanded")
  expect(place).toContain("const parentModalActive = modalPresentation && Boolean(venueId) && (closing || !after19Handoff)")
  expect(place).toContain("if (!closing || !modalPresentation) return")
  expect(place).toContain('aria-modal={modalPresentation ? "true" : undefined}')
  expect(place).toContain("useModalIsolation(parentModalActive, retainedRootRef)")
  expect(place).toContain("useDocumentScrollLock(parentModalActive)")
  expect(place).toContain("useModalIsolation(Boolean(closing ? visualSnapshot.openFactKey : openFactKey), evidenceLayerRef)")
  expect(place).not.toContain('state.tab === "ondo" && Boolean(venueId)')
  expect(place).toContain("data-place-presence={presenceState}")
  expect(place).toContain('aria-busy={closing ? "true" : undefined}')
  expect(place).toContain("onClickCapture={consumeClosingInput}")
  expect(place).toContain("onPointerDownCapture={consumeClosingInput}")
  expect(place).toContain("onKeyDownCapture={consumeClosingInput}")
  expect(place).toContain("event.nativeEvent.stopImmediatePropagation()")
  expect(place).toContain('window.addEventListener("keydown", consumeClosingKey, true)')
  expect(place).toContain("retainedLayer?.closest(\"[inert],[aria-hidden='true']\")")
  expect(place).toContain("data-modal-layer-priority={ONDO_MODAL_PRIORITY.fullTask}")
})

test("CANONICAL-EXIT-005 exact opener focus waits for DOM removal and rapid replacement cancels stale restoration", () => {
  const mount = source("features/ondo/place/canonical-place-mount.tsx")

  expect(mount).toContain("if (presence.value !== null || !restoreAfterExitRef.current) return")
  expect(mount).toContain("exactOpener?.isConnected")
  expect(mount).toContain("exactOpener.matches(openerSelector)")
  expect(mount).toContain("isRenderedFocusable(exactOpener)")
  expect(mount).toContain("focusFirstAvailableDestination")
  expect(mount).toContain("[openerSelector, ...FALLBACK_DESTINATIONS]")
  expect(mount).toContain("desiredKeyRef.current !== desiredSubject.key")
  expect(mount).toContain("restoreAfterExitRef.current = false")
  expect(mount).toContain("key={presented.key}")
  expect(source("features/ondo/place/canonical-place-overlay.tsx")).toContain("if (wasClosingRef.current && !closing) exitRequestedRef.current = false")
})

test("CANONICAL-EXIT-006 only true final destinations dismiss; detail back, save, directions and child tasks retain the place", () => {
  const place = source("features/ondo/place/canonical-place-overlay.tsx")
  const detailBack = place.slice(place.indexOf("function closeDetails()"), place.indexOf("function handleDetailKeyDown"))
  const save = place.slice(place.indexOf("function toggleSave()"), place.indexOf("function openPulseAlternative"))
  const localSignal = place.slice(place.indexOf("function openLocalSignalFromPlace()"), place.indexOf("function openAfter19FromPlace()"))

  expect(detailBack).toContain('goBackFromBDiscovery("detail")')
  expect(detailBack).not.toContain("beginFinalDismiss")
  expect(save).toContain("actions.toggleSavedVenue")
  expect(save).toContain("actions.saveVenue")
  expect(save).not.toContain("beginFinalDismiss")
  expect(localSignal).toContain("actions.openLocalSignal(currentVenueId)")
  expect(localSignal).not.toContain("beginFinalDismiss")
  expect(place).toContain('target="_blank" rel="noreferrer" data-testid="canonical-venue-directions"')
})

test("CANONICAL-EXIT-007 every painted surface exits for 260ms with a reduced-motion immediate alternative", () => {
  const css = source("features/ondo/place/canonical-place.module.css")

  expect(css).toContain('.peek[data-place-presence="closing"]')
  expect(css).toContain('.layer[data-place-presence="closing"] .backdrop')
  expect(css).toContain('.layer[data-place-presence="closing"] .detail')
  expect(css).toContain('.layer[data-place-presence="closing"] .evidenceBackdrop')
  expect(css).toContain('.layer[data-place-presence="closing"] .evidenceDrawer')
  expect(css).toMatch(/canonicalPlacePeekExit 260ms/)
  expect(css).toMatch(/canonicalPlaceBackdropExit 260ms/)
  expect(css).toMatch(/canonicalPlaceDetailExit 260ms/)
  expect(css).toMatch(/@keyframes canonicalPlaceDetailExit[\s\S]*to \{ opacity: 0; transform: translateY\(32px\); \}/)
  expect(css).toMatch(/@keyframes canonicalPlaceExitRight[\s\S]*to \{ opacity: 0; transform: translateX\(40px\); \}/)
  expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*data-place-presence="closing"[\s\S]*animation: none !important/)
  expect(css).not.toContain('[data-place-presence="closing"] { pointer-events: none; }')
})
