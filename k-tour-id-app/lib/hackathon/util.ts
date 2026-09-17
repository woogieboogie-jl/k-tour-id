import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"

export function nowIso() { return new Date().toISOString() }
export function plusMs(ms: number, from = Date.now()) { return new Date(from + ms).toISOString() }
export function isPast(iso: string | undefined | null, now = Date.now()) { return !iso || Date.parse(iso) <= now }

export function randomId(prefix: string, bytes = 12) { return `${prefix}_${randomBytes(bytes).toString("base64url")}` }
export function randomHex32() { return "0x" + randomBytes(32).toString("hex") }
export function sha256Hex(input: string | Uint8Array) { return "0x" + createHash("sha256").update(input).digest("hex") }
export function hmacHex(key: string, input: string) { return "0x" + createHmac("sha256", key).update(input).digest("hex") }

/** Stable JSON: sorted keys, no whitespace — used for every digest/commitment. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).sort().reduce<Record<string, unknown>>((acc, key) => {
      const v = (value as Record<string, unknown>)[key]
      if (v !== undefined) acc[key] = sortKeys(v)
      return acc
    }, {})
  }
  return value
}
export function digestOf(value: unknown) { return sha256Hex(canonicalJson(value)) }

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) throw new Error("bad hex")
  return Uint8Array.from(Buffer.from(clean, "hex"))
}
export function bytesToHex(bytes: Uint8Array) { return "0x" + Buffer.from(bytes).toString("hex") }
export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a), bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

export class HkError extends Error {
  constructor(public code: string, message: string, public status = 400, public retryable = false) { super(message) }
}
export function assert(cond: unknown, code: string, message: string, status = 400): asserts cond {
  if (!cond) throw new HkError(code, message, status)
}
