import { expect, type APIRequestContext, type Page } from "@playwright/test"

const mutations = new WeakMap<Page, string[]>()

export async function assertHostedUiLocalProfile(request: APIRequestContext, baseURL: string | undefined) {
  expect(process.env.KTOUR_QA_LOCAL_HOSTED_UI, "Hosted UI regression requires explicit local opt-in").toBe("1")
  const target = new URL(new URL(baseURL ?? "").origin)
  expect(target.protocol).toBe("http:")
  expect(target.hostname).toBe("127.0.0.1")
  expect(target.port).toBe("3157")
  const response = await request.get(`${target.origin}/api/hackathon/v1/config`)
  expect(response.status()).toBe(503)
  expect(await response.json()).toMatchObject({ error: { code: "hosted_sui_unavailable" } })
}

export async function installHostedUiMutationGuard(page: Page) {
  const blocked: string[] = []
  mutations.set(page, blocked)
  await page.route("**/*", async route => {
    const request = route.request()
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      const url = new URL(request.url())
      blocked.push(`${request.method()} ${url.origin}${url.pathname}`)
      await route.abort("blockedbyclient")
      return
    }
    await route.fallback()
  })
}

export function expectHostedUiMutationsClean(page: Page) {
  expect(mutations.get(page) ?? [], "Hosted UI regression must remain read-only").toEqual([])
}
