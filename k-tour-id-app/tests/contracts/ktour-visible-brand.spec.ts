import { expect, test } from "@playwright/test"
import { existsSync, readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import ts from "typescript"

// This is a displayed-copy guard, not an internal identifier migration. The
// route/storage/environment keys still use ondo; existing receipt IDs are fixed.
const HISTORICAL_RECEIPTS = new Set([
  "ONDO-LOCAL-20260825-001",
  "ONDO-LOCAL-OP-20260825-001",
  "ONDO-LOCAL-REFUND-20260825-001",
])
const RECEIPT_SOURCE = "features/ondo/commerce-b/stable-commerce-model-b.ts"
const RETIRED_ASSET_REFERENCE = /\/brand\/(?:ondo-[\w.-]+|ktour-id-(?:mark|lockup|logo-source|wordmark)[\w.-]*)/g

function hasRetiredBrand(value: string) {
  // Temperature is still part of the product. These phrases describe a place
  // or traveler signal; a service name such as "온도 테이블" is not exempt.
  const withoutTemperature = value.replace(/(?:장소별|장소|샘플|공개|여행자들의|탐색|데모)\s*온도|온도별 추천/g, "")
  return /\bONDO\b|溫圖|온도/.test(withoutTemperature)
}

function scriptCopy(path: string, source: string) {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const values: Array<{ value: string; line: number }> = []
  function visit(node: ts.Node) {
    const isText = ts.isStringLiteralLike(node) || ts.isJsxText(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)
    if (isText) {
      const parent = node.parent
      const isKey = (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isMethodDeclaration(parent)) && parent.name === node
      const isModule = ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)
      const isType = ts.isLiteralTypeNode(parent)
      const isInternalAttribute = ts.isJsxAttribute(parent) && /^(?:data-|id$|className$)/.test(parent.name.getText(file))
      if (!isKey && !isModule && !isType && !isInternalAttribute) {
        values.push({ value: node.text, line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1 })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return values
}

function jsonCopy(value: unknown): string[] {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap(jsonCopy)
  if (value && typeof value === "object") return Object.values(value).flatMap(jsonCopy)
  return []
}

test("KTOUR-BRAND-001 the scanner distinguishes public copy from keys and true temperature", () => {
  const values = scriptCopy("example.tsx", `
    // ONDO in an architecture comment is not rendered.
    const copy = { "ONDO": "K-Tour ID", title: "ONDO Tables" };
    const key = "ONDO_REVIEW_FIXTURE";
    const view = <div data-testid="ONDO"><span>溫圖</span><img alt="ONDO" /></div>;
  `).filter(({ value }) => hasRetiredBrand(value)).map(({ value }) => value.trim())
  expect(values).toEqual(["ONDO Tables", "溫圖", "ONDO"])
  expect(hasRetiredBrand("온도 테이블")).toBe(true)
  expect(hasRetiredBrand("장소 온도 · 장소 묶음")).toBe(false)
  expect(hasRetiredBrand("탐색 온도 · 온도별 추천")).toBe(false)
  expect(hasRetiredBrand("데모 온도")).toBe(false)
  expect(hasRetiredBrand("이 장소의 공개 온도는 바뀌지 않아요.")).toBe(false)
  expect(hasRetiredBrand("ohayo.global")).toBe(false)
  expect(jsonCopy({ ONDO: "K-Tour ID" })).toEqual(["K-Tour ID"])
})

test("KTOUR-BRAND-002 active packaged values, JSX and CSS fallback content contain no retired brand", async () => {
  const { SOURCE_FILES } = await import("../../scripts/ondo-b-standalone/policy.mjs")
  const files = [...new Set<string>([...SOURCE_FILES, "app/layout.tsx", "app/globals.css"])]
  const residues: Array<{ path: string; line?: number; value: string }> = []
  for (const path of files) {
    const source = readFileSync(path, "utf8")
    if (/\.[cm]?[jt]sx?$/.test(path)) {
      for (const item of scriptCopy(path, source)) {
        if (path === RECEIPT_SOURCE && HISTORICAL_RECEIPTS.has(item.value)) continue
        if (hasRetiredBrand(item.value)) residues.push({ path, ...item })
      }
    } else if (path.endsWith(".json")) {
      for (const value of jsonCopy(JSON.parse(source))) if (hasRetiredBrand(value)) residues.push({ path, value })
    } else if (path.endsWith(".css")) {
      const noComments = source.replace(/\/\*[\s\S]*?\*\//g, "")
      for (const match of noComments.matchAll(/content\s*:\s*["']([^"']*)["']/g)) {
        if (hasRetiredBrand(match[1])) residues.push({ path, value: match[1] })
      }
    }
  }
  expect(residues).toEqual([])
})

test("KTOUR-BRAND-003 active screens and metadata do not reference retired or colored brand assets", async () => {
  const { SOURCE_FILES } = await import("../../scripts/ondo-b-standalone/policy.mjs")
  const files = [...new Set<string>([...SOURCE_FILES, "app/layout.tsx", "app/globals.css", "scripts/ondo-b-standalone/prepare.mjs"])]
  const references = files.flatMap(path => [...readFileSync(path, "utf8").matchAll(RETIRED_ASSET_REFERENCE)].map(match => ({ path, asset: match[0] })))
  expect(references).toEqual([])
})

test("KTOUR-BRAND-004 archived logos remain tracked locally but cannot enter the deployment", async () => {
  const { PUBLIC_FILES, BLOCKED_HTTP_PATHS } = await import("../../scripts/ondo-b-standalone/policy.mjs")
  const archived = [
    "public/brand/ktour-id-lockup-transparent.png",
    "public/brand/ktour-id-lockup.png",
    "public/brand/ktour-id-logo-source.png",
    "public/brand/ktour-id-mark-180.png",
    "public/brand/ktour-id-mark-192.png",
    "public/brand/ktour-id-mark-32.png",
    "public/brand/ktour-id-mark-512.png",
    "public/brand/ktour-id-mark-64.png",
    "public/brand/ktour-id-mark.png",
    "public/brand/ktour-id-wordmark.png",
    "public/brand/ondo-lockup.svg",
    "public/brand/ondo-mark.svg",
    "public/brand/ondo-mark-inverse.svg",
    "public/brand/ondo-mark-micro-24.svg",
    "public/og-ktour-food-v1.png",
  ]
  const ignored = new Set(readFileSync("../.vercelignore", "utf8").split(/\r?\n/).map(line => line.trim()))
  const tracked = new Set(execFileSync("git", ["ls-files", "--error-unmatch", "--", ...archived], { encoding: "utf8" }).trim().split(/\r?\n/))
  for (const path of archived) {
    expect(existsSync(path), path).toBe(true)
    expect(tracked.has(path), path).toBe(true)
    expect(PUBLIC_FILES, path).not.toContain(path)
    expect(BLOCKED_HTTP_PATHS, path).toContain(path.replace(/^public/, ""))
    expect(ignored.has(`k-tour-id-app/${path}`), path).toBe(true)
  }
  expect(PUBLIC_FILES).toContain("public/brand/ktour-id-mono-v1.svg")
  expect(PUBLIC_FILES).toContain("public/og-ktour-korea-v3.png")
})
