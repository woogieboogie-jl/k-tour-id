import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** Evidence helper only. Does not click, seed product state or change CSS. */
export async function captureMobileTf(page, directory, label, context = {}) {
  await mkdir(directory, { recursive: true })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(400)
  const evidence = await page.evaluate(() => {
    const visible = node => {
      if (node.closest('[inert],[aria-hidden="true"]')) return false
      const style = getComputedStyle(node), rect = node.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth
    }
    const rect = node => {
      const r = node.getBoundingClientRect()
      return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), width: +r.width.toFixed(1), height: +r.height.toFixed(1) }
    }
    const identity = node => ({ tag: node.tagName.toLowerCase(), testId: node.getAttribute('data-testid'), owner: node.closest('[data-testid]')?.getAttribute('data-testid'), text: (node.innerText || node.getAttribute('aria-label') || node.getAttribute('placeholder') || '').trim().slice(0, 180) })
    const typography = [...document.querySelectorAll('h1,h2,h3,h4,p,small,label,summary,button,a,dt,dd,span')]
      .filter(visible)
      .filter(node => [...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim()))
      .map(node => { const s = getComputedStyle(node); return { ...identity(node), ...rect(node), fontFamily: s.fontFamily, fontSize: s.fontSize, lineHeight: s.lineHeight, weight: s.fontWeight, letterSpacing: s.letterSpacing, color: s.color, margin: s.margin, padding: s.padding, overflow: s.overflow, textOverflow: s.textOverflow } })
    const controls = [...document.querySelectorAll('button,a,input,select,textarea,summary,[role="button"]')].filter(visible).map(node => {
      const s = getComputedStyle(node)
      return { ...identity(node), ...rect(node), disabled: Boolean(node.disabled), fontSize: s.fontSize, padding: s.padding, borderRadius: s.borderRadius, partiallyOutsideViewport: node.getBoundingClientRect().top < 0 || node.getBoundingClientRect().bottom > innerHeight || node.getBoundingClientRect().left < 0 || node.getBoundingClientRect().right > innerWidth }
    })
    const dialogs = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].filter(visible).map(node => {
      const s = getComputedStyle(node)
      return { ...identity(node), ...rect(node), padding: s.padding, radius: s.borderRadius, background: s.backgroundColor, overflow: s.overflow, horizontalOverflow: node.scrollWidth > node.clientWidth + 1 }
    })
    return { url: location.href, viewport: { width: innerWidth, height: innerHeight, devicePixelRatio }, appearance: document.querySelector('[data-testid="ondo-b-root"]')?.getAttribute('data-appearance'), documentOverflow: document.documentElement.scrollWidth > innerWidth + 1, dialogs, typography, controls, resources: performance.getEntriesByType('resource').map(r => r.name).filter(n => /\/_next\/static\/.*\.(css|js)(\?|$)/.test(n)) }
  })
  const name = label.replace(/[^a-z0-9-]/gi, '-')
  const screenshot = path.resolve(directory, `${name}.png`)
  await page.screenshot({ path: screenshot, scale: 'css' })
  await writeFile(path.resolve(directory, `${name}.json`), JSON.stringify({ label, capturedAt: new Date().toISOString(), context, screenshot, ...evidence }, null, 2))
  return { label, screenshot, ...evidence }
}

/** Never make provider calls or remote mutations during visual mock reviews. */
export async function guardMobileTf(context, failures) {
  context.on('page', page => page.on('pageerror', error => failures.push({ kind: 'runtime', message: error.message })))
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) || /sumsub|onfido|omni.?one|opendid|fullnode|sui\.io|walletconnect|stripe/i.test(url.hostname)) {
      failures.push({ kind: 'blocked-request', method: request.method(), origin: url.origin })
      return route.abort('blockedbyclient')
    }
    return route.continue()
  })
}
