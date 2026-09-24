import { expect, test } from "@playwright/test"
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const previewRoot = path.join(appRoot, "features/ondo/discovery-preview")
const previewFiles = readdirSync(previewRoot).filter(name => /\.(tsx|ts)$/.test(name))
const read = (relative: string) => readFileSync(path.join(appRoot, relative), "utf8")

test("DISCOVERY-PREVIEW-001 is development-only and production guarded", () => {
  const pageSource = read("app/ondo-b/labs/discovery/page.tsx")
  expect(pageSource).toContain('process.env.NODE_ENV !== "development"')
  expect(pageSource).toContain("notFound()")
  expect(pageSource).toContain('from "@/features/ondo/discovery-preview/discovery-preview"')
  expect(pageSource).not.toMatch(/AppProviders|useBState|wallet|signTransaction|verifySignature/i)
  // This is a source guard only. Verify runtime 404 against a production build separately.
})

test("DISCOVERY-PREVIEW-002 feature source is local editorial state only", () => {
  const source = previewFiles.map(name => readFileSync(path.join(previewRoot, name), "utf8")).join("\n")
  expect(source).not.toMatch(/\b(fetch|XMLHttpRequest|WebSocket)\s*\(/)
  expect(source).not.toMatch(/\b(localStorage|sessionStorage|indexedDB|document\.cookie)\b/)
  expect(source).not.toMatch(/useBState|AppProviders|wallet|signTransaction|verifySignature|zkLogin|OpenDID|OmniOne|Sui|chain/i)
  expect(source).toContain('source: "editorial-demo"')
  expect(source).toContain("Unknown stays unknown")
  expect(source).toContain("Saves last only in this page")
})
