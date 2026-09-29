import { HkError } from "./util"
const operationId = /^op_[A-Za-z0-9_-]{8,64}$/
const attemptId = /^zkl_[A-Za-z0-9_-]{24}$/
/** Private profile owners still enforce session, origin and access first. */
export function zkLoginRouteAllowed(method: string, p: readonly string[]): boolean {
  return p[0] === "zklogin" && ((method === "GET" && ((p.length === 2 && p[1] === "params") ||
    (p.length === 4 && p[1] === "status" && operationId.test(p[2]) && attemptId.test(p[3])))) ||
    (method === "POST" && p.length === 2 && ["start", "prove", "cancel"].includes(p[1])))
}
export function assertZkLoginRequestBody(p: readonly string[], value: unknown): void {
  const bad = () => { throw new HkError("bad_request", "Invalid Google approval request.", 400) }
  if (!zkLoginRouteAllowed("POST", p) || !value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) bad()
  const body = value as Record<string, unknown>, start = p[1] === "start", prove = p[1] === "prove"
  const keys = start ? ["operationId", "attemptId", "extendedEphemeralPublicKey", "maxEpoch", "jwtRandomness"] : prove ? ["operationId", "attemptId", "jwt"] : ["operationId", "attemptId"]
  const descriptors = Object.getOwnPropertyDescriptors(body)
  if (Reflect.ownKeys(body).some(key => typeof key !== "string" || !keys.includes(key) || !("value" in descriptors[key]) || !descriptors[key].enumerable) || keys.some(key => !Object.hasOwn(body, key))) bad()
  if (typeof body.operationId !== "string" || !operationId.test(body.operationId) || typeof body.attemptId !== "string" || !attemptId.test(body.attemptId)) bad()
  if (start) {
    if (typeof body.extendedEphemeralPublicKey !== "string" || !body.extendedEphemeralPublicKey.length || body.extendedEphemeralPublicKey.length > 256 || /[\x00-\x20\x7f]/.test(body.extendedEphemeralPublicKey) ||
      !Number.isSafeInteger(body.maxEpoch) || (body.maxEpoch as number) < 0 || typeof body.jwtRandomness !== "string" || !/^\d{1,78}$/.test(body.jwtRandomness)) bad()
  } else if (prove && (typeof body.jwt !== "string" || body.jwt.length > 16384 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(body.jwt))) bad()
}
