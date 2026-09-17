import { chromium, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { captureMobileTf, guardMobileTf } from './mobile-tf-capture.mjs'

const origin = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3112'
const output = path.resolve(process.env.KTOUR_TF_OUTPUT || 'artifacts/qa/mobile-tf/coordinator')
const place = 'mois-0021cd596bc5b2a922ad'
const mode = process.argv[2] || 'guide'
const errors = [], observations = []
const browser = await chromium.launch()
let context, page, counter = 0
async function fresh(locale = 'en', width = 390, appearance = 'light') {
  if (context) await context.close()
  context = await browser.newContext({ viewport: { width, height: width === 320 ? 680 : 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' })
  await guardMobileTf(context, errors)
  await context.addInitScript(({ locale, appearance, origin }) => {
    if (location.origin !== origin) return
    localStorage.setItem('ondo-b.device.v1', JSON.stringify({ locale, appearancePreference: appearance, onboarding: 'ONB-COMPLETE' }))
  }, { locale, appearance, origin })
  page = await context.newPage()
  page.setDefaultTimeout(10000)
  await page.goto(`${origin}/?review=1`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('ondo-b-root')).toHaveAttribute('data-hydrated', 'true')
}
async function capture(label, details = {}) {
  const id = `${mode}-${String(++counter).padStart(3, '0')}-${label}`
  const evidence = await captureMobileTf(page, output, id, details)
  observations.push({ label: id, screenshot: evidence.screenshot, ...details })
  console.log(JSON.stringify({ captured: id, dialogs: evidence.dialogs.map(x => x.testId || x.text.slice(0, 70)) }))
}
async function openGuide(scenario = 'success') {
  await page.goto(`${origin}/?venueId=${place}&review=1`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('ondo-b-root')).toHaveAttribute('data-hydrated', 'true')
  await page.getByTestId('canonical-place-details').click()
  await page.getByTestId('experience-open').click()
  await expect(page.getByTestId('experience-public-guide')).toBeVisible()
  if (scenario !== 'success') {
    await page.getByTestId('experience-public-details').locator('summary').click()
    await page.getByTestId('experience-public-scenario').selectOption(scenario)
    await page.getByTestId('experience-public-details').locator('summary').click()
  }
}
async function proposal() {
  await page.getByTestId('experience-add-to-pass').click()
  const flow = page.getByTestId('experience-flow')
  const actions = ['experience-pass-approve', 'k-tour-id-method-mobile-id', 'k-tour-id-consent-approve', 'identity-handoff-approve', 'k-tour-id-continue', 'person-route-choice-mobile_id_cx', 'local-check-boundary-continue', 'action-gate-confirm']
  for (let step = 0; step < 20; step++) {
    let next = ''
    await expect.poll(async () => {
      if (await flow.getAttribute('data-stage') === 'proposal') return 'proposal'
      for (const id of actions) {
        const button = page.getByTestId(id).filter({ visible: true }).first()
        if (!await button.isVisible() || !await button.isEnabled()) continue
        if (await button.evaluate(node => Boolean(node.closest('[inert],[aria-hidden="true"]')))) continue
        if (id === 'person-route-choice-mobile_id_cx' && await button.getAttribute('aria-pressed') === 'true') continue
        next = id; return id
      }
      return 'waiting'
    }, { timeout: 15000 }).not.toBe('waiting')
    if (await flow.getAttribute('data-stage') === 'proposal') break
    await capture(`save-check-${next}`, { stage: await flow.getAttribute('data-stage') })
    await page.getByTestId(next).filter({ visible: true }).first().click()
  }
  await expect(flow).toHaveAttribute('data-stage', 'proposal')
  await capture('save-proposal')
}
async function guide() {
  await fresh()
  await openGuide()
  await capture('public-reader')
  await proposal()
  await page.getByTestId('experience-consent').check()
  await page.getByTestId('experience-approve').click()
  await expect(page.getByTestId('experience-flow')).toHaveAttribute('data-stage', 'complete')
  await capture('saved')
  await page.getByTestId('experience-return').click()
  await expect(page.getByTestId('canonical-place-overlay')).toBeVisible()
  await capture('same-place-return')
  if (mode === 'guide-saved') {
    for (let i = 0; i < 3 && await page.getByRole('dialog').count(); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(400) }
    await page.getByTestId('nav-id').click()
    await expect(page.getByTestId('experience-saved-guide')).toBeVisible()
    await page.getByTestId('experience-saved-guide').scrollIntoViewIfNeeded()
    await capture('saved-guide-pass-card')
    await page.getByTestId('experience-saved-guide').click()
    await expect(page.getByTestId('experience-public-guide')).toBeVisible()
    await capture('saved-guide-reader')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('experience-saved-guide')).toBeVisible()
    await capture('saved-guide-pass-return')
    return
  }
  for (const scenario of ['executionUnknown', 'auditFailure', 'serviceBlocked']) {
    await fresh('ja', 320, 'dark')
    await openGuide(scenario)
    await proposal()
    await page.getByTestId('experience-consent').check()
    await page.getByTestId('experience-approve').click()
    await page.waitForTimeout(1600)
    await capture(`${scenario}-result`, { stage: await page.getByTestId('experience-flow').getAttribute('data-stage') })
    if (scenario === 'executionUnknown') {
      await page.getByTestId('experience-stop').click()
      await capture('stop-pending')
      await page.getByTestId('experience-check-result').click()
      await capture('stop-resolved')
    } else if (scenario === 'auditFailure') {
      await page.getByTestId('experience-audit-retry').click()
      await capture('audit-retry-result')
    }
    await page.getByTestId('experience-return').click()
    await capture(`${scenario}-return`)
  }
}
async function openPartner() {
  await page.locator('[data-testid="review-sample-indicator"]:visible').first().click()
  await page.getByTestId('integration-demo-open').click()
  await expect(page.getByTestId('integration-demo')).toBeVisible()
}
async function partner() {
  await fresh()
  await openPartner()
  await capture('workspace')
  await page.getByTestId('partner-sample-sign-in').click()
  await capture('device-consent')
  await page.getByTestId('partner-device-consent').check()
  await page.getByTestId('partner-device-ready').click()
  await capture('request-purpose')
  await page.getByTestId('integration-verifier-create').click()
  await capture('qr-request')
  await page.getByTestId('integration-holder-open').click()
  await capture('permission')
  await page.getByTestId('partner-camera-deny').click()
  await capture('permission-denied')
  await page.getByTestId('partner-camera-retry').click()
  await page.getByTestId('partner-camera-allow').click()
  await capture('scan')
  await page.getByTestId('partner-qr-scan').click()
  await capture('holder-consent')
  await page.getByTestId('integration-holder-approve').click()
  await capture('needs-proof')
  await page.getByTestId('integration-tab-settlements').click()
  await capture('settlement-empty')
  await page.getByTestId('integration-tab-events').click()
  await capture('events-empty')
  await page.keyboard.press('Escape')
  await page.getByTestId('nav-id').click()
  await page.getByTestId('wallet-link-open').click()
  await page.getByTestId('wallet-setup-scroll').getByRole('button').first().click()
  await expect(page.getByTestId('wallet-balance')).toContainText('60,000')
  await page.getByTestId('wallet-balance-places').click()
  await page.getByTestId('ondo-b-search').fill('Roba')
  const row = page.getByTestId('ondo-b-venue-list').locator(`li[data-venue-id="${place}"] > button`)
  if (!await row.isVisible()) await page.getByTestId('ondo-b-view-toggle').click()
  await row.click()
  await page.getByTestId('peek-place-service').click()
  await page.getByTestId('payment-minimum-consent').getByRole('checkbox').check()
  await page.getByTestId('payment-confirm').click()
  await page.getByTestId('action-gate-confirm').click()
  await page.getByTestId('action-gate-confirm').click()
  await expect(page.getByTestId('payment-receipt')).toBeVisible()
  await page.getByTestId('payment-receipt-return').click()
  for (let i = 0; i < 3 && await page.getByRole('dialog').count(); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(400) }
  await page.getByTestId('nav-id').click()
  await openPartner()
  await page.getByTestId('integration-tab-settlements').click()
  await capture('settlement-ready')
  const select = page.getByTestId('integration-settlement-case')
  await select.locator('..').locator('summary').click()
  await select.selectOption('pending')
  await page.getByTestId('integration-settlement-start').click()
  await page.waitForTimeout(1000)
  await capture('settlement-pending')
  await page.getByTestId('integration-settlement-check').click()
  await capture('settlement-result')
  await page.getByTestId('integration-support-panel').locator(':scope > summary').click()
  await capture('support-reason')
  const supportCase = page.getByTestId('integration-support-case')
  await supportCase.locator('..').locator('summary').click()
  await supportCase.selectOption('unknown')
  await page.getByTestId('integration-support-start').click()
  await capture('support-review')
  await page.getByTestId('integration-support-submit').click()
  await page.waitForTimeout(1000)
  await capture('support-unknown')
  await page.getByTestId('integration-support-check').click()
  await capture('support-ticket')
  await page.getByTestId('integration-support-history').locator(':scope > summary').click()
  await capture('support-history')
  await page.getByTestId('integration-tab-events').click()
  await capture('events-ledger')
  const eventAction = page.getByTestId('integration-event').getByRole('button').first()
  if (await eventAction.isVisible()) { await eventAction.click(); await page.waitForTimeout(1000); await capture('event-record-result') }
  await page.setViewportSize({ width: 320, height: 680 })
  await capture('events-320')
}
try { await mkdir(output, { recursive: true }); if (mode.startsWith('guide')) await guide(); else await partner() }
catch (error) { errors.push({ kind: 'harness-or-product', message: error.message }); if (page) await capture('interrupted').catch(() => {}); console.error(error) }
finally {
  await writeFile(path.join(output, `${mode}-observations.json`), JSON.stringify({ origin, observations, errors }, null, 2))
  await context?.close(); await browser.close()
  console.log(JSON.stringify({ mode, observations: observations.length, errors }))
  if (errors.length) process.exitCode = 1
}
