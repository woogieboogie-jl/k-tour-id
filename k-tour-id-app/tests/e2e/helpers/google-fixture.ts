import { expect, test as base } from "@playwright/test"
import { HarveyFixture } from "./harvey-fixture"
export const MAIN = "https://ktour-id.vercel.app"
// This URL is a browser-origin simulation, not a Production connection. Every
// HTTP/API/socket is intercepted; only credential-free localhost serves assets.
export const test = base.extend<{ harvey: HarveyFixture }>({ harvey: async ({ page }, use, info) => {
  const local = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3174")
  if (!["localhost", "127.0.0.1"].includes(local.hostname)) throw Error("Google fixture requires localhost assets")
  await page.context().routeWebSocket("**", socket => {
    const url = new URL(socket.url()); if (!url.pathname.startsWith("/_next/webpack-hmr")) { socket.close(); return }
    const target = new URL(url.pathname + url.search, local); target.protocol = "ws:"
    const upstream = new WebSocket(target); upstream.binaryType = "arraybuffer"
    let closed = false; const queued: Array<string | Buffer> = []
    socket.onMessage(message => upstream.readyState === WebSocket.OPEN ? upstream.send(message) : queued.push(message))
    socket.onClose(() => { closed = true; if (upstream.readyState === WebSocket.OPEN) upstream.close() })
    upstream.addEventListener("open", () => { if (closed) { upstream.close(); return }; for (const message of queued) upstream.send(message); queued.length = 0 })
    upstream.addEventListener("message", event => { if (!closed) { if (typeof event.data === "string") socket.send(event.data); else if (event.data instanceof ArrayBuffer) socket.send(Buffer.from(event.data)) } })
    upstream.addEventListener("close", () => { if (!closed) socket.close() }); upstream.addEventListener("error", () => { if (!closed) socket.close() })
  })
  const fixture = new HarveyFixture(page, MAIN, local.origin); await fixture.install(); await use(fixture)
  await info.attach("google-fixture-provenance", { contentType: "application/json", body: JSON.stringify({ fixtureOnly: true, realGoogleLogin: false, actualProofs: 0, actualTransactions: 0, requests: fixture.calls.map(({ method, path }) => ({ method, path })) }) })
  expect(fixture.forbiddenRequests).toEqual([]); expect(fixture.unexpectedRequests).toEqual([]); expect(fixture.pageErrors).toEqual([])
} })
export { expect }
