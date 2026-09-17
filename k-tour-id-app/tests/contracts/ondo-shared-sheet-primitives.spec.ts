import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { expect, test } from "@playwright/test"

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")

test("SHARED-SHEET-001 legacy size calls map to the semantic sheet contract", () => {
  for (const path of [
    "features/ondo/shared/ui/sheet.tsx",
    "features/ondo/shared/ui/sheet-b.tsx",
  ]) {
    const sheet = source(path)

    expect(sheet).toContain('export type SheetVariant = "peek" | "decision" | "detail" | "full-task"')
    expect(sheet).toContain('size?: "peek" | "medium" | "full"')
    expect(sheet).toContain("variant?: SheetVariant")
    expect(sheet).toContain("header?: ReactNode")
    expect(sheet).toContain("footer?: ReactNode")
    expect(sheet).toContain("data-sheet-scroll-owner=\"true\"")
    expect(sheet).toContain("useDocumentScrollLock(true)")
    expect(sheet).toContain("useModalVisualViewport(layerRef)")
    expect(sheet).toContain("data-sheet-navigation={navigationKind}")
    expect(sheet).toContain("IconAction requires a non-empty localized label")
    expect(sheet).toContain("preferredCandidate && isRenderedProgrammaticFocusTarget(preferredCandidate)")
    expect(sheet).not.toContain("aria-hidden={suspended")
  }
})

test("SHARED-SHEET-005 explicit dialog headings may receive programmatic focus without entering the tab order", () => {
  const focusability = source("features/ondo/shared/ui/is-rendered-focusable.ts")

  expect(focusability).toContain("export function isRenderedProgrammaticFocusTarget")
  expect(focusability).toContain('element.tabIndex < 0 && !element.hasAttribute("tabindex")')
  expect(focusability).toContain("element.tabIndex >= 0 && isRenderedProgrammaticFocusTarget(element)")
})

test("SHARED-SHEET-002 the viewport is the only scrolling sheet region and keeps actions outside it", () => {
  const css = source("features/ondo/shared/ui/ui.module.css")

  expect(css).toMatch(/\.sheet\s*\{[^}]*overflow:\s*hidden/s)
  expect(css).toMatch(/\.viewport\s*\{[^}]*overflow-y:\s*auto/s)
  expect(css).toMatch(/\.sheetHeader\s*\{[^}]*flex:\s*0 0 auto/s)
  expect(css).toMatch(/\.sheetFooter\s*\{[^}]*flex:\s*0 0 auto/s)
  expect(css).toMatch(/\.sheetFooter\s*\{[^}]*env\(safe-area-inset-bottom\)/s)
  expect(css).toMatch(/\.iconAction\s*\{[^}]*width:\s*48px[^}]*height:\s*48px/s)
})

test("SHARED-SHEET-003 semantic heights and short-landscape composition stay within the visible viewport", () => {
  const css = source("features/ondo/shared/ui/ui.module.css")
  const shell = source("features/ondo/app/ondo-shell.module.css")

  expect(css).toMatch(/\.peek\s*\{[^}]*32dvh/s)
  expect(css).toMatch(/\.decision\s*\{[^}]*72dvh/s)
  expect(css).toMatch(/\.detail\s*\{[^}]*88dvh/s)
  expect(css).toMatch(/\.fulltask\s*\{[^}]*height:\s*100%/s)
  expect(css).toContain("--ondo-sheet-viewport-height")
  expect(css).toContain("@media (min-width: 700px) and (max-height: 500px)")
  expect(css).toMatch(/\.sheet:not\(\.peek\):not\(\.fulltask\)\s*\{[^}]*width:\s*min\(430px, 100%\)/s)

  expect(shell).toContain("@media (min-width: 801px) and (max-height: 500px)")
  expect(shell).toMatch(/grid-template-columns:\s*repeat\(5, 1fr\)/)
  expect(shell).toMatch(/\.stage\[data-variant="B"\] \.navLabel\s*\{[^}]*display:\s*none/s)
})

test("SHARED-SHEET-004 nested ownership is reference counted and restores document and accessibility state", () => {
  const isolation = source("features/ondo/shared/ui/use-modal-isolation.ts")

  expect(isolation).toContain("let documentScrollLockCount = 0")
  expect(isolation).toContain("documentScrollLockCount += 1")
  expect(isolation).toContain("documentScrollLockCount = Math.max(0, documentScrollLockCount - 1)")
  expect(isolation).toContain("current.owners.add(owner)")
  expect(isolation).toContain("current.owners.delete(owner)")
  expect(isolation).toContain("if (current.owners.size) return")
  expect(isolation).toContain('window.visualViewport?.removeEventListener("resize", schedule)')
  expect(isolation).toContain('window.visualViewport?.removeEventListener("scroll", schedule)')
  expect(isolation).not.toMatch(/localStorage|sessionStorage|indexedDB|credential|access.?token/i)
})

test("SHARED-SHEET-006 non-scrolling chrome owns its rounded paint boundary without redundant blur", () => {
  const css = source("features/ondo/shared/ui/ui.module.css")
  const header = css.match(/\.sheetHeader\s*\{([^}]+)\}/s)?.[1] ?? ""
  const footer = css.match(/\.sheetFooter\s*\{([^}]+)\}/s)?.[1] ?? ""
  expect(header).toContain("border-top-left-radius: inherit")
  expect(header).toContain("border-top-right-radius: inherit")
  expect(footer).toContain("border-bottom-left-radius: inherit")
  expect(footer).toContain("border-bottom-right-radius: inherit")
  for (const chrome of [header, footer]) {
    expect(chrome).toContain("background: var(--ondo-surface-raised)")
    expect(chrome).not.toMatch(/backdrop-filter\s*:/)
  }
})
