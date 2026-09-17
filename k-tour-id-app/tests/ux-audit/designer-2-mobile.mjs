import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import path from 'node:path'
import { captureMobileTf, guardMobileTf } from './mobile-tf-capture.mjs'

// Local evidence harness. Run only after the coordinator releases a browser slot.
// Preferences are the only seeded state. Every account, visit, Table and badge
// transition must use visible product controls. No application source changes.
const origin = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3112'
const directory = path.resolve(process.env.MOBILE_TF_OUTPUT || 'artifacts/qa/mobile-tf-designer-2')
await mkdir(directory, { recursive: true })
const browser = await chromium.launch({ headless: true })
const failures = [], records = []
let context, page, display
async function fresh(options = {}) {
  if (context) await context.close()
  display = { locale: 'en', theme: 'light', width: 390, height: 844, review: 1, ...options }
  context = await browser.newContext({ viewport: { width: display.width, height: display.height }, isMobile: true, hasTouch: true, locale: display.locale === 'ko' ? 'ko-KR' : display.locale === 'ja' ? 'ja-JP' : 'en-US', colorScheme: display.theme, reducedMotion: 'reduce' })
  await guardMobileTf(context, failures)
  await context.addInitScript(({ locale, theme }) => {
    if (!location.protocol.startsWith('http')) return
    localStorage.setItem('ondo-b.device.v1', JSON.stringify({ locale, appearancePreference: theme, onboarding: 'ONB-COMPLETE' }))
  }, display)
  page = await context.newPage()
  page.setDefaultTimeout(6500)
  await page.goto(`${origin}/?review=${display.review}`, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-testid="ondo-b-root"][data-hydrated="true"]').waitFor({ timeout: 45000 })
}
async function capture(label, detail = {}) {
  const record = await captureMobileTf(page, directory, `${String(records.length + 1).padStart(3, '0')}-${label}`, { ...display, ...detail })
  records.push({ label: record.label, screenshot: record.screenshot, url: record.url, viewport: record.viewport, context: { ...display, ...detail } })
  await writeFile(path.join(directory, 'index.json'), JSON.stringify({ origin, records, failures }, null, 2))
  console.log(JSON.stringify({ captured: record.label, viewport: record.viewport, overflow: record.documentOverflow }))
}
async function inspect() {
  console.log(JSON.stringify(await page.evaluate(() => ({
    text: document.body.innerText.slice(-13000),
    controls: [...document.querySelectorAll('button,input,textarea,select,summary')].filter(e => !e.closest('[inert],[aria-hidden="true"]') && e.getClientRects().length).map(e => ({ testId: e.getAttribute('data-testid'), tag: e.tagName, text: (e.innerText || e.getAttribute('aria-label') || '').slice(0, 100), disabled: Boolean(e.disabled) })),
  }))))
}
try {
  await fresh()
  console.log('DESIGNER_2_READY')
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line.trim()) continue
    try {
      const command = JSON.parse(line)
      if (command.finish) break
      if (command.fresh) await fresh(command.fresh)
      if (command.code) await new Function('page', 'context', 'capture', 'display', `return (async()=>{${command.code}})()`)(page, context, capture, display)
      if (command.label) await capture(command.label, command.detail || {})
      if (command.inspect) await inspect()
    } catch (error) { console.log(JSON.stringify({ commandError: error.message })) }
  }
} finally {
  await context?.close()
  await browser.close()
  await writeFile(path.join(directory, 'index.json'), JSON.stringify({ origin, records, failures, closed: true }, null, 2))
  console.log(JSON.stringify({ closed: true, captures: records.length, failures }))
}
