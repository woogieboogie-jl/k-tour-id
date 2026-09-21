import { defineConfig, devices } from "@playwright/test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

// Trace/screenshot writes under this app trigger the dev CSS watcher. Keep all
// outputs outside the source tree; gitignore alone did not prevent HMR reloads.
const evidence = process.env.KTOUR_DISCOVERY_QA_RUN ?? mkdtempSync(path.join(tmpdir(), "ktour-discovery-qa-"))
process.env.KTOUR_DISCOVERY_QA_RUN = evidence
console.log(`Discovery QA evidence: ${evidence}`)

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: ["discovery-preview.spec.ts", "discovery-preview-isolation.spec.ts"],
  outputDir: evidence,
  reporter: [["list"], ["json", { outputFile: path.join(evidence, "results.json") }]],
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3142",
    screenshot: "only-on-failure", trace: "retain-on-failure",
    colorScheme: "light", locale: "ko-KR", timezoneId: "Asia/Seoul",
  },
  projects: [{ name: "discovery-mobile-chromium", use: { ...devices["iPhone 13"], browserName: "chromium", viewport: { width: 390, height: 844 } } }],
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : {
    command: "node scripts/hackathon-local.mjs dev 3142",
    url: "http://127.0.0.1:3142/ondo-b/labs/discovery",
    reuseExistingServer: false,
  },
})
