// Audit-only snapshots and geometry. No app edits, provider calls or real actions.
import { chromium, expect } from "@playwright/test"
import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

const baseURL = "http://127.0.0.1:3137"
const venue = "mois-0021cd596bc5b2a922ad"
const output = resolve("artifacts/qa/global-mobile-visual-20260917")
await mkdir(output, { recursive: true })
const config = await fetch(`${baseURL}/api/hackathon/v1/config`).then(r => r.json())
if (!config.isolatedMock) throw new Error("Audit requires isolated local server")
const browser = await chromium.launch({ headless: true })
const rows = [], errors = []

async function capture(page, id) {
  await page.waitForTimeout(300)
  const data = await page.evaluate(() => {
    const rect = node => { const r = node.getBoundingClientRect(); return { x:r.x,y:r.y,w:r.width,h:r.height,bottom:r.bottom,right:r.right } }
    const shown = node => { const s=getComputedStyle(node),r=node.getBoundingClientRect(); return s.display!=="none"&&s.visibility!=="hidden"&&r.width>1&&r.height>1&&!node.closest('[inert],[aria-hidden="true"]') }
    const selector = '[data-testid="canonical-place-overlay"] article > header,[data-testid="ondo-sheet"] > header,[data-sheet-header], [role="dialog"][aria-modal="true"] header'
    const headers = [...new Set(document.querySelectorAll(selector))].filter(shown).map(node => {
      const ancestors = []; let parent=node.parentElement
      while(parent&&parent!==document.body){ const s=getComputedStyle(parent);if(/hidden|clip|auto|scroll/.test(s.overflowY))ancestors.push({testid:parent.dataset.testid,class:parent.className,rect:rect(parent),scrollTop:parent.scrollTop,overflow:s.overflowY});parent=parent.parentElement }
      return {rect:rect(node),text:node.innerText,ancestors,children:[...node.children].map(child=>({tag:child.tagName,text:child.textContent?.trim().slice(0,90),rect:rect(child),font:getComputedStyle(child).fontSize,line:getComputedStyle(child).lineHeight}))}
    })
    const scopes=[...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].filter(shown)
    const scope=scopes.at(-1)??document.querySelector('[data-testid="ondo-scroll-region"]')??document.body
    const controls=[...scope.querySelectorAll('button,a,summary,input,select,textarea')].filter(shown).map(node=>({id:node.dataset.testid??null,text:(node.innerText||node.getAttribute('aria-label')||'').trim().slice(0,150),rect:rect(node),font:getComputedStyle(node).fontSize}))
    return {viewport:{w:innerWidth,h:innerHeight},documentWidth:document.documentElement.scrollWidth,headers,dialogs:scopes.map(node=>({id:node.dataset.testid,rect:rect(node)})),text:scope.innerText.slice(0,7000),controls}
  })
  await page.screenshot({ path:resolve(output,`${id}.png`),scale:"css" })
  rows.push({id,...data})
  console.log(JSON.stringify({id,headers:data.headers.map(h=>({y:h.rect.y,h:h.rect.h,children:h.children.map(c=>({text:c.text,y:c.rect.y,h:c.rect.h})),scroll:h.ancestors.map(a=>a.scrollTop)})),dialogs:data.dialogs.map(d=>d.id),controls:data.controls.length}))
}

async function runProfile(profile, full) {
  const context=await browser.newContext({baseURL,viewport:{width:profile.w,height:profile.h},isMobile:profile.w<600,hasTouch:profile.w<600,serviceWorkers:"block"})
  await context.route("**/*",route=>{
    const r=route.request(),u=new URL(r.url())
    if(u.origin!==baseURL||!["GET","HEAD"].includes(r.method())) return route.abort("blockedbyclient")
    return route.continue()
  })
  await context.addInitScript(({locale,theme})=>localStorage.setItem("ondo-b.device.v1",JSON.stringify({locale,appearancePreference:theme,onboarding:"ONB-COMPLETE"})),{locale:profile.locale,theme:profile.theme})
  const page=await context.newPage();page.setDefaultTimeout(8000)
  const prefix=`${profile.locale}-${profile.theme}-${profile.w}x${profile.h}`
  const go=async path=>{await page.goto(path,{waitUntil:"domcontentloaded"});await expect(page.getByTestId("ondo-b-root")).toHaveAttribute("data-hydrated","true")}
  const snap=name=>capture(page,`${prefix}-${name}`)
  const place=async()=>{await go(`/?venueId=${venue}&review=1`);await page.getByTestId("canonical-place-details").click()}
  const attempt=async(name,fn)=>{try{await fn()}catch(error){errors.push({profile:prefix,name,error:error.message.split("\n").slice(0,4).join(" ")});console.log(`AUDIT_ERROR ${prefix} ${name}: ${error.message.split("\n")[0]}`)}}
  try {
    await attempt("place",async()=>{
      await place();await snap("place-open")
      await page.mouse.move(Math.min(profile.w-40,250),Math.min(profile.h-120,550));await page.mouse.wheel(0,320);await snap("place-scroll")
      await page.getByTestId("canonical-journey-open").click();await snap("visit")
      await page.keyboard.press("Escape");await snap("place-return-visit")
    })
    await attempt("guide",async()=>{await place();await page.getByTestId("experience-open").click();await snap("guide");await page.getByTestId("experience-add-to-pass").click();await snap("guide-account-gate");await page.keyboard.press("Escape");await page.keyboard.press("Escape");await snap("place-return-guide")})
    await attempt("payment",async()=>{await place();await page.getByTestId("canonical-meal-benefit-open").click();await snap("payment-review")})
    await attempt("pass",async()=>{
      await go("/?review=1");await page.getByTestId("nav-id").click();await snap("pass")
      await page.getByTestId("travel-pass-readiness-toggle").click();await snap("pass-readiness")
      await page.getByTestId("traveler-id-person-check").click();await snap("identity-account")
      if(full){await page.getByTestId("direct-person-account-continue").click();await snap("identity-method");await page.getByTestId("direct-person-route-mobile-id").click();await snap("identity-consent")}
    })
    if(full){
      await attempt("map",async()=>{await go("/?review=1");await snap("map-entry");await go("/?city=seoul&review=1");await snap("map-city");await page.getByTestId("ondo-b-map-options-open").click();await snap("map-options")})
      await attempt("reservation",async()=>{await place();await page.getByTestId("place-reservation-open").click();await snap("reservation")})
      await attempt("table",async()=>{await place();await page.getByTestId("canonical-place-table").click();await snap("table-detail")})
      await attempt("after19",async()=>{await place();await page.getByTestId("canonical-after19-unlock").click();await snap("after19")})
      await attempt("funding",async()=>{await go("/?review=1");await page.getByTestId("nav-id").click();await page.getByTestId("wallet-funding-change").click();await snap("funding-method")})
      await attempt("settings",async()=>{await go("/?review=1");await page.getByTestId("nav-settings").click();await snap("settings");await page.getByTestId("ondo-b-device-data-settings").click();await snap("privacy")})
      await attempt("saved",async()=>{await go("/?review=1");await page.getByTestId("nav-my").click();await snap("my-korea");await page.getByTestId("nav-tables").click();await snap("tables")})
      await attempt("hackathon",async()=>{await place();await page.getByTestId("hackathon-entitlement-open").click();await snap("hackathon-consent")})
    }
  } finally { await context.close() }
}

try {
  await runProfile({w:390,h:844,locale:"en",theme:"dark"},true)
  await runProfile({w:320,h:568,locale:"ja",theme:"light"},false)
  await runProfile({w:844,h:390,locale:"en",theme:"dark"},false)
} finally {
  await browser.close()
  await writeFile(resolve(output,"inventory.json"),JSON.stringify({baseURL,kind:"visual audit snapshots, not functional acceptance",rows,errors},null,2)+"\n")
  console.log(JSON.stringify({screens:rows.length,errors,output}))
}
