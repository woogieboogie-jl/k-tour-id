import { defineConfig, devices } from "@playwright/test"

// The coordinator owns this dedicated server. Do not auto-start or silently
// reuse another worktree's server, inherit real provider secrets, or target prod.
const baseURL = process.env.HARVEY_PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3137"
const target = new URL(baseURL)
if (target.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)) {
  throw new Error("Harvey fixture E2E requires an explicitly managed loopback HTTP server")
}

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: ["ktour-harvey-integration.spec.ts", "ktour-harvey-final-review.spec.ts"],
  outputDir: "artifacts/qa/harvey-integration-fixtures",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["json", { outputFile: "artifacts/qa/harvey-integration-fixtures/results.json" }]],
  use: {
    baseURL, locale: "en-US", timezoneId: "Asia/Seoul", colorScheme: "light",
    serviceWorkers: "block", screenshot: "only-on-failure", trace: "retain-on-failure",
  },
  projects: [{ name: "harvey-fixture-mobile-chromium", use: { ...devices["iPhone 13"], browserName: "chromium", viewport: { width: 390, height: 844 } } }],
})
