/** Narrow main/native boundary. A bearer capability is NOT app attestation.
 * No caller chooses endpoints; no raw native evidence is returned to the web.
 */
import { assertExternalServicesEnabled, hkConfig } from "./config"
import { withStore } from "./store"
import { HkError } from "./util"
import { createNativeBindingProvider, nativeBindingConfiguration } from "./native-binding-provider"
import { hostedSuiOrigin } from "./hosted-sui-access"
import { localNativeRequested, assertLocalNativeTarget, LOCAL_NATIVE_ORIGIN } from "./local-native-policy"
import { createNativeBindingService, NATIVE_BINDING_ID, NATIVE_BINDING_TOKEN, NATIVE_BINDING_VERSION } from "./native-binding-service"
const MAIN = "https://ktour-id.vercel.app"
const OP = /^op_[A-Za-z0-9_-]{8,100}$/
const bad = () => new HkError("native_binding_request", "The holder connection request is invalid", 400)
const denied = () => new HkError("native_binding_access_denied", "The holder connection request is not authorized", 403)
type Service = ReturnType<typeof createNativeBindingService>
export function nativeBindingRouteAllowed(method: string, path: string[]): boolean {
  return path.length === 4 && path[0] === "operations" && OP.test(path[1]) && path[2] === "native-binding" &&
    (method === "GET" ? path[3] === "status" : method === "POST" && ["start", "cancel", "begin", "prove", "confirm"].includes(path[3]))
}
function configured(): Service {
  assertExternalServicesEnabled("OpenDID")
  if (hkConfig().opendid.mode !== "opendid") throw new HkError("native_binding_unavailable", "The native holder connection is not available", 503)
  const c = nativeBindingConfiguration()
  return createNativeBindingService({ atomic: withStore, provider: createNativeBindingProvider(c.provider), secret: c.secret, configBinding: c.configBinding })
}
async function body(req: Request, keys: string[]): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers.get("content-type") ?? "") || req.headers.get("content-encoding") || Number(req.headers.get("content-length") ?? 0) > 65_536) throw bad()
  const reader = req.body?.getReader(); if (!reader) throw bad()
  let timer: ReturnType<typeof setTimeout> | undefined, size = 0
  const chunks: Uint8Array[] = []
  try {
    const read = async () => { for (;;) { const r = await reader.read(); if (r.done) break; size += r.value.byteLength; if (size > 65_536) throw bad(); chunks.push(r.value) } }
    await Promise.race([read(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(bad()), 3000) })])
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)))
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value, k))) throw bad()
    return value as Record<string, unknown>
  } catch { throw bad() } finally { clearTimeout(timer); void reader.cancel().catch(() => {}) }
}
export async function nativeBindingRoute(req: Request, path: string[], sessionLookup: () => Promise<{ sessionId: string }>, factory: () => Service = configured, originOf: (req: Request) => string = hostedSuiOrigin): Promise<Response | null> {
  if (!nativeBindingRouteAllowed(req.method, path)) return null
  const url = new URL(req.url)
  // The native app is pinned to this same exact URL. No forwarded-host-derived
  // arbitrary origin, Preview alias or cross-origin bridge request is admitted.
  const local = localNativeRequested()
  if (local) assertLocalNativeTarget(req)
  const expectedOrigin = local ? LOCAL_NATIVE_ORIGIN : MAIN
  if ((!local && originOf(req) !== expectedOrigin) || url.search || url.hash) throw denied()
  const action = path[3], native = ["begin", "prove", "confirm"].includes(action)
  let sessionId: string | undefined, bearer = ""
  if (native) {
    if (req.headers.has("origin") || req.headers.has("sec-fetch-site") || req.headers.has("sec-fetch-mode") || req.headers.has("cookie")) throw denied()
    const auth = req.headers.get("authorization") ?? ""
    if (!auth.startsWith("Bearer ") || !NATIVE_BINDING_TOKEN.test(auth.slice(7))) throw denied()
    bearer = auth.slice(7)
  } else {
    if (req.headers.has("authorization") || (req.method === "POST" && req.headers.get("origin") !== expectedOrigin) || req.headers.has("origin") && req.headers.get("origin") !== expectedOrigin || req.headers.has("sec-fetch-site") && req.headers.get("sec-fetch-site") !== "same-origin") throw denied()
    sessionId = (await sessionLookup()).sessionId
  }
  const input = req.method === "GET" ? {} : await body(req, native ? action === "prove" ? ["version", "bindingId", "didDocument", "didAuth"] : ["version", "bindingId"] : [])
  if (native && (input.version !== NATIVE_BINDING_VERSION || typeof input.bindingId !== "string" || !NATIVE_BINDING_ID.test(input.bindingId))) throw bad()
  const service = factory(), id = path[1]
  const result = action === "status" ? await service.status(sessionId!, id) : action === "start" ? await service.start(sessionId!, id) : action === "cancel" ? await service.cancel(sessionId!, id)
    : action === "begin" ? await service.begin(id, input.bindingId as string, bearer) : action === "prove" ? await service.prove(id, input.bindingId as string, bearer, input.didDocument, input.didAuth) : await service.confirm(id, input.bindingId as string, bearer)
  return Response.json(result, { headers: { "cache-control": "no-store, private", "pragma": "no-cache", "referrer-policy": "no-referrer" } })
}
