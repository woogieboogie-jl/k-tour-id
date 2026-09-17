import { defineConfig, devices } from "@playwright/test"
import base from "./playwright.config"

// Bounded cross-engine check of the same public guide and explicit save flow.
// This is desktop-hosted WebKit with an iPhone viewport, not a physical device.
export default defineConfig({
  ...base,
  testMatch: ["tests/e2e/ktour-public-guide-visual.spec.ts"],
  outputDir: "artifacts/qa/mobile-final-webkit",
  workers: 1,
  retries: 0,
  projects: [{
    name: "mobile-webkit",
    use: { ...devices["iPhone 13"], browserName: "webkit" },
  }],
})
