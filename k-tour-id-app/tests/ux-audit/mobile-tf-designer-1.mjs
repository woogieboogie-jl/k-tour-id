import { chromium } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import path from 'node:path'
import { captureMobileTf, guardMobileTf } from './mobile-tf-capture.mjs'

const origin = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3112'
const directory = path.resolve(process.env.MOBILE_TF_OUTPUT || 'artifacts/qa/mobile-tf/designer-1')
const browser = await chromium.launch({ headless: true })
const failures = [], records = []
let context, page
async function fresh(options = {}) {
  if (context) await context.close()
  context = await browser.newContext({ viewport: { width: options.width || 390, height: options.height || 844 }, isMobile: true, hasTouch: true, locale: 'en-US', colorScheme: options.dark ? 'dark' : 'light', reducedMotion: 'reduce' })
  await guardMobileTf(context, failures)
  page = await context.newPage()
  page.setDefaultTimeout(6000)
  await page.goto(new URL(options.url || '/', origin).href, { waitUntil: 'domcontentloaded' })
  await page.getByTestId('ondo-b-root').filter({ has: page.getByTestId('ondo-canvas') }).waitFor()
  await page.waitForFunction(() => document.querySelector('[data-testid="ondo-b-root"]')?.getAttribute('data-hydrated') === 'true')
}
async function capture(label, action = '') {
  const data = await captureMobileTf(page, directory, label, { action, reviewer: 'D1', reducedMotion: true })
  records.push({ label, url: data.url, screenshot: data.screenshot, viewport: data.viewport, appearance: data.appearance, resources: data.resources })
  await writeFile(path.join(directory, 'observations.json'), JSON.stringify({ origin, records, failures }, null, 2))
  const text = await page.locator('body').innerText()
  console.log(JSON.stringify({ label, url: data.url, appearance: data.appearance, dialogs: data.dialogs, controls: data.controls.map(({ text, testId, width, height }) => ({ text, testId, width, height })), text: text.slice(-10000), failures }))
}
await fresh()
await capture('01-nation-initial')
console.log('D1_READY')
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
for await (const line of rl) {
  if (!line.trim()) continue
  try {
    const command = JSON.parse(line)
    if (command.finish) break
    if (command.fresh) await fresh(command)
    if (command.url && !command.fresh) await page.goto(new URL(command.url, origin).href, { waitUntil: 'domcontentloaded' })
    if (command.code) await new Function('page', 'context', `return (async()=>{${command.code}})()`)(page, context)
    if (command.label) await capture(command.label, command.code || command.url || 'fresh')
  } catch (error) {
    console.log(JSON.stringify({ harnessError: error.message }))
  }
}
await context.close()
await browser.close()
console.log(JSON.stringify({ finished: true, captures: records.length, failures }))
