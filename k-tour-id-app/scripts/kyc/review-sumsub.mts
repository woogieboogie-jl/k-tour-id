/**
 * Interactive browser-only UX fixture, never a server or production route.
 * Run dev:sumsub:local first. This opens the existing app in a fresh browser.
 * All KYC responses are intercepted. No document/camera/provider request runs.
 * Operator controls are in a SEPARATE tab, never injected into the product.
 */
import { chromium } from "@playwright/test"
const base = "http://127.0.0.1:3139"
const smoke = process.argv.includes("--smoke")
const browser = await chromium.launch({ headless: smoke })
// Interactive review should show the product's normal map motion. Reduced
// motion remains an explicit accessibility/smoke option, not a hidden default.
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: smoke || process.argv.includes("--reduced-motion") ? "reduce" : "no-preference", locale: "ko-KR" })
const page = await context.newPage()
const controls = await context.newPage()
let state = "pending"
let locale = "ko"
let navigating = false
const allowed = new Set(["access_required", "pending", "approved", "retry", "rejected", "expired", "offline"])
await context.route("**/*", async route => {
  const url = new URL(route.request().url())
  if (url.origin === base && url.pathname.startsWith("/api/kyc/")) {
    const method = route.request().method()
    if (method === "DELETE") return route.fulfill({ status: 204 })
    if (method === "POST") return route.fulfill({ status: 401, json: { status: "access_required", environment: "sandbox", configured: true } })
    if (state === "offline") return route.fulfill({ status: 503, json: { error: "provider_unavailable" } })
    return route.fulfill({ status: 200, json: { status: state, environment: "sandbox", configured: true } })
  }
  if (url.origin === base || url.hostname === "tiles.openfreemap.org") return route.continue()
  // No SDK, analytics, signing, real provider, or other remote requests.
  return route.abort("blockedbyclient")
})
async function openFlow() {
  if (navigating) return
  navigating = true
  try {
    await page.goto(base + "/?review=0", { waitUntil: "domcontentloaded" })
    await page.waitForFunction(() => document.querySelector('[data-testid="ondo-b-root"]')?.getAttribute("data-hydrated") === "true")
    await page.getByTestId("nav-id").click()
    await page.getByTestId("kpass-start-setup").click()
    const route = page.getByTestId("ktour-id-route-passport")
    if (await route.getAttribute("data-availability") !== "sandbox") throw new Error("Start the isolated Sumsub local server first")
    await route.click()
    await page.getByTestId("k-tour-id-consent-approve").click()
    await page.getByTestId("sumsub-passport-step").waitFor()
    await page.waitForFunction(() => document.querySelector('[data-testid="sumsub-passport-step"] [role="status"]')?.textContent === "")
  } finally { navigating = false }
}
await controls.exposeFunction("__ktourChooseFixture", async (value: string) => {
  if (navigating) return
  if (value === "ko" || value === "en" || value === "ja") locale = value
  else if (allowed.has(value)) state = value
  else return
  await page.evaluate(locale => {
    const key = "ondo-b.device.v1"
    const existing = JSON.parse(localStorage.getItem(key) ?? "{}")
    localStorage.setItem(key, JSON.stringify({ ...existing, locale }))
  }, locale)
  await openFlow()
  await page.bringToFront()
})
await page.addInitScript(() => {
  const key = "ondo-b.device.v1"
  if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ locale: "ko", appearancePreference: "light" }))
})
await controls.setContent('<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>K-Tour ID · 검수 도구</title></head><body></body></html>')
await controls.evaluate(() => {
    document.body.style.cssText = "margin:0;padding:24px;background:#f4f6f4;color:#202622;font:15px/1.6 system-ui"
    const panel = document.createElement("main")
    panel.id = "ktour-review-controller"
    const summary = document.createElement("h1")
    summary.textContent = "화면 시나리오"
    summary.style.fontSize = "24px"
    panel.append(summary)
    const note = document.createElement("p")
    note.textContent = "이 탭은 로컬 검수 도구이며 앱 화면에는 표시되지 않습니다. 상태 버튼은 가짜 API 응답입니다. 실제 공급자·카메라는 연결되지 않으며 문서 업로드와 권한 발급도 하지 않습니다. 실연동 성공 증거가 아닙니다."
    panel.append(note)
    const result = document.createElement("p")
    result.id = "review-result"
    result.setAttribute("role", "status")
    result.textContent = "다른 탭에서 앱을 확인하세요. 접속 코드는 입력할 필요 없습니다."
    for (const [value, label] of [
      ["access_required", "접속 코드"], ["pending", "검토 중"], ["approved", "확인 완료"],
      ["retry", "보완 요청"], ["rejected", "미승인"], ["expired", "만료"], ["offline", "연결 오류"],
      ["ko", "한국어"], ["en", "English"], ["ja", "日本語"],
    ]) {
      const button = document.createElement("button")
      button.type = "button"
      button.dataset.value = value
      button.textContent = label
      button.style.cssText = "min-height:44px;margin:4px;padding:8px 14px;border:1px solid #cbd4ce;background:white;border-radius:12px;color:inherit;font:inherit;cursor:pointer"
      button.onclick = async () => {
        const buttons = [...panel.querySelectorAll("button")]
        buttons.forEach(b => { b.disabled = true })
        result.textContent = "화면을 열고 있습니다…"
        const target = window as typeof window & { __ktourChooseFixture(value: string): Promise<void> }
        try { await target.__ktourChooseFixture(value); result.textContent = "적용했습니다. 다른 탭에서 앱을 확인하세요." }
        catch { result.textContent = "화면을 열지 못했습니다. 로컬 서버를 확인하고 다시 시도해 주세요." }
        finally { buttons.forEach(b => { b.disabled = false }) }
      }
      panel.append(button)
    }
    panel.append(result)
    document.body.append(panel)
})
try {
  if (!smoke && process.argv.includes("--map")) {
    await page.goto(base + "/?review=0&city=seoul", { waitUntil: "domcontentloaded" })
    await page.getByTestId("map-discovery-story-carousel").waitFor()
  } else await openFlow()
  await page.bringToFront()
  console.log("LOCAL FIXTURE ONLY. Clean app tab + separate operator tab; no real KYC or permissions granted.")
  if (smoke) {
    for (const next of ["approved", "retry", "rejected", "expired", "access_required", "offline", "pending"]) {
      await controls.locator(`[data-value="${next}"]`).click()
      await controls.locator("#review-result").filter({ hasText: "적용했습니다" }).waitFor()
      if (next !== "offline") await page.waitForFunction(expected => document.querySelector('[data-testid="sumsub-passport-step"]')?.getAttribute("data-status") === expected, next)
      else if (!await page.getByTestId("sumsub-check-status").isEnabled()) throw new Error("Offline screen has no recovery action")
      if (await page.getByTestId("sumsub-passport-step").getAttribute("data-pass-issued") !== "false") throw new Error("Unexpected permission change")
      if (await page.locator("#ktour-local-fixture-panel, #ktour-review-controller").count()) throw new Error("Operator UI leaked into app")
    }
    for (const next of ["en", "ja", "ko"]) {
      await controls.locator(`[data-value="${next}"]`).click()
      await controls.locator("#review-result").filter({ hasText: "적용했습니다" }).waitFor()
    }
    await browser.close()
  } else await new Promise<void>(resolve => browser.once("disconnected", () => resolve()))
} catch (error) {
  await browser.close()
  console.error(error instanceof Error ? error.message : "Review browser failed")
  process.exitCode = 1
}
