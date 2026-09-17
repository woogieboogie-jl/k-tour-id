import { chromium, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { captureMobileTf, guardMobileTf } from './mobile-tf-capture.mjs'

const directory = process.env.MOBILE_TF_OUTPUT || 'artifacts/qa/mobile-tf/designer-3'
const selectedScenarios = new Set((process.env.MOBILE_TF_SCENARIOS || '').split(',').filter(Boolean))
const base = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3112'
const failures = [], visits = []
const browser = await chromium.launch({ headless: true })
await mkdir(directory, { recursive: true })
let page, context, scenario, config
const id = name => page.getByTestId(name)
const click = name => id(name).click()
async function snap(label, more = {}) {
  const result = await captureMobileTf(page, directory, `${scenario}-${label}`, { artifact: process.env.MOBILE_TF_ARTIFACT || base, ...config, ...more })
  visits.push({ label: result.label, screenshot: result.screenshot, dialogs: result.dialogs, documentOverflow: result.documentOverflow })
  console.log('CAPTURE', result.label)
}
async function detail(testId) {
  const node = id(testId)
  const details = (await node.evaluate(n => n.tagName)) === 'DETAILS' ? node : node.locator('xpath=ancestor::details').last()
  if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click()
}
async function boot(name, options = {}) {
  scenario = name
  config = { review: 1, locale: 'en', appearance: 'light', width: 390, height: 844, ...options }
  context = await browser.newContext({ viewport: { width: config.width, height: config.height }, reducedMotion: 'reduce', colorScheme: config.appearance })
  await guardMobileTf(context, failures)
  await context.route('https://tiles.openfreemap.org/**', route => route.abort('blockedbyclient'))
  page = await context.newPage()
  page.setDefaultTimeout(10000)
  await page.goto(`${base}/?review=${config.review}`, { waitUntil: 'domcontentloaded' })
  await expect(id('ondo-b-root')).toHaveAttribute('data-hydrated', 'true')
  if (await id('onboarding-guest-skip').isVisible()) await click('onboarding-guest-skip')
  if (config.locale !== 'en' || config.appearance !== 'light') {
    await click('nav-settings')
    if (config.locale !== 'en') {
      await click('settings-language-row')
      await id('settings-language-control').getByRole('radio', { name: config.locale === 'ja' ? '日本語' : '한국어' }).click()
      await page.keyboard.press('Escape')
    }
    await click('settings-appearance-row')
    await click(`settings-appearance-${config.appearance}`)
    await page.keyboard.press('Escape')
  }
}
async function run(name, options, task) {
  if (selectedScenarios.size && !selectedScenarios.has(name)) return
  try { await boot(name, options); await task() }
  catch (error) { failures.push({ kind: 'scenario', scenario, message: error.message }); console.log('GAP', scenario, error.message.slice(0, 180)); try { await snap('blocked') } catch {} }
  finally { await context?.close() }
}
async function setup(method = 'mobile-id', outcome = 'success') {
  await click('nav-id'); await click('kpass-start-setup'); await snap('methods')
  await click(`ktour-id-route-${method}`); await snap(`${method}-consent`)
  if (outcome !== 'success') { await detail('identity-sample-controls'); await id('identity-sample-outcome').selectOption(outcome) }
  await click('k-tour-id-consent-approve')
}
async function handoff() {
  await snap('handoff-ready'); await click('k-tour-id-continue'); await snap('handoff-waiting')
  await click('identity-handoff-approve'); await snap('handoff-approved'); await click('k-tour-id-continue')
  await expect(id('k-tour-id-setup')).toHaveAttribute('data-phase', 'holder_delivery_preview')
}
async function saveCredential() {
  await snap('holder-ready'); await click('k-tour-id-continue'); await expect(id('identity-holder-receipt')).toBeVisible(); await snap('holder-receipt')
  await click('k-tour-id-continue'); await expect(id('k-tour-id-setup')).toHaveAttribute('data-phase', 'credential_ready'); await snap('credential-ready')
}
async function passport() {
  await snap('document-intro'); await click('passport-ocr-start'); await snap('document-permission')
  await click('passport-demo-permission-deny'); await snap('document-denied'); await click('passport-demo-retry'); await click('passport-demo-permission-allow')
  await snap('document-capture'); await click('passport-demo-capture'); await snap('document-checking'); await click('passport-demo-nfc-read'); await snap('document-review')
  await click('k-tour-id-continue'); await snap('face-permission'); await click('passport-face-deny'); await snap('face-denied'); await click('k-tour-id-continue')
  await click('k-tour-id-continue'); await snap('face-capture'); await click('k-tour-id-continue'); await snap('face-review'); await click('k-tour-id-continue')
}
async function funding(rail, cardMethod) {
  await click('nav-id'); await click('wallet-funding-change'); await snap('methods')
  await page.locator(`input[name=funding-source][value=${rail}]`).check(); await click('funding-method-save')
  if (cardMethod) await click(`funding-card-${cardMethod}`)
  await snap('quote')
}

await run('normal', { review: 0 }, async () => {
  await click('nav-id'); await snap('pass')
  await click('kpass-start-setup'); await snap('id-unavailable-methods'); await click('ktour-id-route-passport'); await snap('id-unavailable'); await page.keyboard.press('Escape')
  await click('wallet-funding-change'); await page.locator('input[value=krw_bank]').check(); await snap('bank-unavailable'); await page.keyboard.press('Escape'); await snap('return-pass')
})
await run('mobile-id', {}, async () => {
  await setup(); await handoff(); await saveCredential()
  // The saved-draft entry intentionally has no standalone presentation action.
  await detail('identity-lifecycle-controls'); await click('identity-renew-open'); await snap('renewal-intro'); await page.keyboard.press('Escape'); await snap('return-pass')
})
await run('residence-ko320', { locale: 'ko', appearance: 'dark', width: 320, height: 800 }, async () => {
  await setup('residence-card'); await click('k-tour-id-continue'); await snap('waiting'); await click('identity-handoff-decline'); await snap('declined'); await click('k-tour-id-continue'); await snap('cancelled')
  await click('identity-cancelled-restart'); await handoff(); await saveCredential(); await click('k-tour-id-return'); await snap('return')
})
await run('passport-ja430', { locale: 'ja', appearance: 'dark', width: 430, height: 932 }, async () => {
  await setup('passport', 'manual_review'); await passport(); await expect(id('identity-manual-review')).toBeVisible(); await snap('manual-pending')
  await detail('identity-manual-outcome')
  await id('identity-manual-outcome').selectOption('needs_info'); await click('identity-manual-check'); await snap('manual-needs-info'); await click('identity-manual-add-info'); await snap('manual-add-info')
})
await run('identity-failure', {}, async () => {
  await setup('mobile-id', 'holder_failed'); await handoff(); await click('k-tour-id-continue'); await snap('holder-failed'); await click('k-tour-id-retry'); await saveCredential(); await click('k-tour-id-return'); await snap('return')
})
await run('direct-person-age', {}, async () => {
  await click('nav-id'); await click('travel-pass-readiness-toggle'); await snap('readiness')
  await click('traveler-id-person-check'); await snap('person-account'); await click('direct-person-account-continue'); await snap('person-route'); await click('direct-person-route-mobile-id'); await snap('person-consent'); await click('local-check-boundary-continue'); await snap('person-result')
  await page.keyboard.press('Escape'); await click('traveler-id-age-check'); await snap('age-consent'); await click('local-check-boundary-continue'); await snap('age-result'); await page.keyboard.press('Escape'); await snap('return')
})
for (const [rail, method] of [['krw_bank', null], ['card_wallet', 'card'], ['card_wallet', 'apple_pay']]) {
  await run(`funding-${rail}-${method ?? 'bank'}`, {}, async () => {
    await funding(rail, method); await click('funding-quote-continue'); await snap('authorization')
    if (method === 'card') { await detail('funding-outcome-failed'); await click('funding-outcome-failed') }
    if (!method) { await detail('funding-outcome-unknown'); await click('funding-outcome-unknown') }
    await id('funding-consent').check(); await click('funding-authorize'); await snap('pending'); await page.waitForTimeout(700); await snap('outcome')
    if (method === 'card') { await click('funding-retry'); await snap('retry-quote'); await click('funding-quote-continue'); await id('funding-consent').check(); await click('funding-authorize'); await page.waitForTimeout(1000) }
    if (!method) await click('funding-check-status')
    await snap('receipt'); await click('funding-sample-use'); await snap('wallet-return')
  })
}
await run('stablecoin-usdt-ja320', { locale: 'ja', appearance: 'dark', width: 320, height: 800 }, async () => {
  await funding('digital_dollar'); await click('stablecoin-asset-USDT'); await click('stablecoin-signer-existing_wallet'); await snap('usdt-quote')
  await click('stablecoin-connect'); await snap('connection'); await click('stablecoin-connection-decline'); await snap('connection-declined'); await click('stablecoin-connection-retry'); await click('stablecoin-connection-approve')
  await click('funding-quote-continue'); await snap('transfer-consent'); await id('funding-consent').check(); await click('funding-authorize'); await snap('source-pending')
  await detail('stablecoin-status-unknown'); await click('stablecoin-status-unknown'); await click('stablecoin-check-source'); await snap('source-unknown'); await click('stablecoin-check-source'); await snap('destination-pending'); await click('stablecoin-check-destination'); await snap('receipt'); await click('funding-sample-use'); await snap('wallet-return')
})
await run('commerce', {}, async () => {
  await click('nav-id'); await click('kpass-sample-picker'); await click('kpass-scenario-adult_visitor'); await detail('kpass-service-disclosure'); await snap('capabilities')
  await click('kpass-service-visitor_benefit'); await snap('checkout'); await click('benefit-accept'); await detail('payment-operation-options'); await id('payment-manual-capture').check(); await id('payment-operation-case').selectOption('capture_failure')
  await click('payment-confirm'); await snap('wallet-preparation'); await id('wallet-connect-sheet').getByRole('button', { name: 'Set up travel wallet', exact: true }).click()
  await id('payment-minimum-consent').getByRole('checkbox').check(); await snap('payment-consent')
  await page.evaluate(() => { document.documentElement.style.zoom = '2' }); await snap('payment-consent-zoom200', { diagnostic: 'CSS page zoom 200%, not native text-only zoom' }); await page.evaluate(() => { document.documentElement.style.zoom = '' })
  await click('payment-confirm')
  for (const axis of ['account', 'payment_kyc', 'credential']) { await expect(id('ondo-b-action-gate')).toHaveAttribute('data-active-gate', axis); await snap(`gate-${axis}`); await click('action-gate-confirm') }
  await expect(id('payment-operation')).toHaveAttribute('data-phase', 'authorized'); await snap('authorized-hold'); await click('payment-operation-continue'); await expect(id('payment-operation')).toHaveAttribute('data-phase', 'capture_failed'); await snap('capture-failed'); await click('payment-operation-continue'); await expect(id('payment-receipt')).toBeVisible(); await snap('receipt')
  await detail('checkout-refund-panel'); await id('checkout-refund-amount').fill('5000'); await snap('refund-request'); await click('checkout-refund-submit'); await snap('refund-pending'); await page.waitForTimeout(650); await snap('partial-refund')
  await detail('checkout-refund-case'); await id('checkout-refund-case').selectOption('unknown'); await click('checkout-refund-all'); await click('checkout-refund-submit'); await page.waitForTimeout(800); await snap('refund-unknown'); await click('checkout-refund-check'); await snap('full-refund'); await click('payment-receipt-return'); await snap('receipt-return')
})
await run('reservation', {}, async () => {
  await click('nav-tables'); await click('tables-reservation-open'); await snap('draft'); await detail('reservation-outcome'); await id('reservation-outcome').selectOption('unknown'); await click('reservation-submit'); await snap('pending'); await page.waitForTimeout(750); await snap('unknown'); await click('reservation-query'); await snap('confirmed')
  await detail('reservation-cancel-outcome'); await id('reservation-cancel-outcome').selectOption('failure'); await click('reservation-cancel'); await snap('cancel-decision'); await click('reservation-confirm-cancel'); await page.waitForTimeout(750); await snap('cancel-failed')
})
await run('labs', {}, async () => {
  await click('nav-my'); await click('open-labs'); await snap('boundary'); await click('labs-acknowledge'); await snap('root'); await detail('labs-sample-scenarios'); await id('labs-sample-case').selectOption('oauth_cancel'); await click('labs-connect-wallet'); await expect(id('labs-overlay')).toHaveAttribute('data-wallet-state', 'WAL-FAILED'); await snap('signer-failed'); await click('labs-connect-wallet'); await expect(id('labs-overlay')).toHaveAttribute('data-wallet-state', 'WAL-READY'); await snap('signer-ready')
  await click('labs-bridge-quote'); await snap('bridge-quote'); await click('labs-bridge-confirm'); await snap('bridge-consent'); await click('labs-bridge-submit'); await snap('source-submitted'); await click('labs-bridge-advance'); await snap('source-confirmed'); await click('labs-bridge-advance'); await snap('relaying'); await click('labs-bridge-advance'); await snap('bridge-result')
  await id('trait-seongsu-card').scrollIntoViewIfNeeded(); await snap('traits'); await detail('labs-sample-visit-setup'); await click('labs-load-sample-visits'); await click('visit-proof-check'); await click('labs-back'); await click('nav-id'); await click('journey-stamps-open'); await click('journey-stamps-keepsake'); await id('journey-keepsake-overlay').getByRole('checkbox').check(); await click('labs-badge-mint'); await snap('keepsake-person-choice'); await click('person-route-choice-mobile_id_cx'); await snap('keepsake-person-consent'); await click('action-gate-cancel'); await snap('keepsake-cancel-return')
})
for (const kind of ['person', 'age']) await run(`direct-geometry-${kind}`, {}, async () => {
  await click('nav-id'); await click('travel-pass-readiness-toggle'); await id(`traveler-id-${kind}-check`).scrollIntoViewIfNeeded(); await snap('visible-opener')
  const button = await id(`traveler-id-${kind}-check`).boundingBox()
  await page.mouse.click(button.x + button.width / 2, button.y + button.height / 2)
  await page.waitForTimeout(2000)
  await snap('after-real-click-no-autoscroll')
  const geometry = await page.evaluate(() => {
    const describe = el => { const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {tag:el.tagName,testId:el.getAttribute('data-testid'),className:el.className,rect:{x:r.x,y:r.y,width:r.width,height:r.height},position:s.position,overflow:s.overflow,transform:s.transform,scrollTop:el.scrollTop,inert:el.inert} }
    const dialog=document.querySelector('[data-testid="ondo-b-local-check-walkthrough"]')
    const ancestors=[];for(let e=dialog;e&&ancestors.length<8;e=e.parentElement)ancestors.push(describe(e))
    return {ancestors,active:document.activeElement?describe(document.activeElement):null,center:document.elementFromPoint(innerWidth/2,innerHeight/2)?.outerHTML.slice(0,500)}
  })
  await writeFile(`${directory}/${scenario}-geometry.json`,JSON.stringify(geometry,null,2))
  await page.keyboard.press('Escape'); await page.waitForTimeout(600); await snap('escape-return')
})
await run('passport-en390-supplement', {}, async () => {
  await setup('passport','manual_review'); await passport(); await expect(id('identity-manual-review')).toBeVisible(); await snap('manual-pending'); await detail('identity-manual-outcome'); await id('identity-manual-outcome').selectOption('needs_info'); await click('identity-manual-check'); await snap('manual-needs-info'); await click('identity-manual-add-info'); await snap('manual-add-info')
})
await run('stablecoin-en390-supplement', {}, async () => {
  await funding('digital_dollar'); await click('stablecoin-connect'); await snap('zklogin-connection'); await click('stablecoin-connection-approve'); await click('funding-quote-continue'); await snap('usdc-consent'); await id('funding-consent').check(); await click('funding-authorize'); await snap('source-pending'); await click('stablecoin-check-source'); await snap('destination-pending'); await click('stablecoin-check-destination'); await snap('receipt'); await click('funding-sample-use'); await snap('return')
})
await run('money-ko320-supplement', {locale:'ko',appearance:'dark',width:320,height:800}, async () => {
  await funding('krw_bank'); await click('funding-quote-continue'); await snap('consent'); await id('funding-consent').check(); await click('funding-authorize'); await page.waitForTimeout(1000); await snap('receipt'); await click('funding-sample-use'); await click('kpass-sample-picker'); await click('kpass-scenario-adult_visitor'); await detail('kpass-service-disclosure'); await click('kpass-service-visitor_benefit'); await click('benefit-accept'); await id('payment-minimum-consent').getByRole('checkbox').check(); await snap('checkout-consent'); await click('payment-confirm'); for(const axis of ['account','payment_kyc','credential']) {await expect(id('ondo-b-action-gate')).toHaveAttribute('data-active-gate',axis);await snap(`gate-${axis}`);await click('action-gate-confirm')} await expect(id('payment-receipt')).toBeVisible();await snap('payment-receipt');await detail('checkout-refund-panel');await detail('checkout-refund-case');await id('checkout-refund-case').selectOption('unknown');await click('checkout-refund-submit');await page.waitForTimeout(800);await snap('refund-unknown');await click('checkout-refund-check');await snap('refund-settled');await click('payment-receipt-return');await snap('return')
})
await run('identity-lifecycle-final', {}, async () => {
  await setup(); await handoff(); await saveCredential()
  const availability = [{entry:'newly-saved-traveler',origin:await id('k-tour-id-setup').getAttribute('data-origin'),presentationButtons:await id('k-tour-id-presentation-open').count()}]
  await click('k-tour-id-return'); await expect(id('k-tour-id-setup')).toHaveCount(0); await snap('return-before-manage')
  await click('kpass-manage-setup'); await expect(id('k-tour-id-setup')).toHaveAttribute('data-phase','credential_ready'); await detail('identity-lifecycle-controls'); await snap('manage-lifecycle-controls')
  availability.push({entry:'reopened-manage',origin:await id('k-tour-id-setup').getAttribute('data-origin'),presentationButtons:await id('k-tour-id-presentation-open').count(),renewal:await id('identity-renew-open').isVisible(),deviceRestore:await id('identity-device-recovery-open').isVisible()})
  await writeFile(`${directory}/identity-lifecycle-final-availability.json`,JSON.stringify(availability,null,2))
  scenario='identity-lifecycle-final-renew'
  await click('identity-renew-open'); await expect(id('identity-recovery-intro')).toHaveAttribute('data-recovery-kind','renew'); await snap('intro'); await click('identity-recovery-start'); await snap('same-method'); await click('ktour-id-route-mobile-id'); await snap('consent'); await click('k-tour-id-consent-approve'); await handoff(); await saveCredential()
  await detail('identity-lifecycle-controls')
  scenario='identity-lifecycle-final-device'
  await click('identity-device-recovery-open'); await expect(id('identity-recovery-intro')).toHaveAttribute('data-recovery-kind','device'); await snap('intro'); await click('identity-recovery-start'); await snap('same-method'); await click('ktour-id-route-mobile-id'); await snap('consent'); await click('k-tour-id-cancel'); await expect(id('k-tour-id-setup')).toHaveCount(0); await snap('cancel-return'); await click('kpass-manage-setup'); await expect(id('k-tour-id-setup')).toHaveAttribute('data-phase','credential_ready'); await snap('unchanged-current-pass'); await click('k-tour-id-return'); await expect(id('k-tour-id-setup')).toHaveCount(0)
})
await writeFile(`${directory}/index.json`, JSON.stringify({ base, artifact: process.env.MOBILE_TF_ARTIFACT || base, visits, failures }, null, 2))
await browser.close()
console.log('COMPLETE', visits.length, 'captures;', failures.length, 'failures or gaps')
