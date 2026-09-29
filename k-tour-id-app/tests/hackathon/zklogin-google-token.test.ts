import test from "node:test"
import assert from "node:assert/strict"
import { generateKeyPairSync, sign } from "node:crypto"
import { createGoogleTokenVerifier } from "../../lib/hackathon/zklogin-google-token"
import { HkError } from "../../lib/hackathon/util"
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
const now = Date.parse("2026-09-30T00:00:00Z"), seconds = now / 1000, expected = { audience: "fixture-client", nonce: "fixture-nonce" }
const claims = { iss: "https://accounts.google.com", aud: expected.audience, sub: "1234567", iat: seconds, exp: seconds + 3600, nonce: expected.nonce }
const header = { alg: "RS256", kid: "fixture-key", typ: "JWT" }
const jwk = { ...publicKey.export({ format: "jwk" }), alg: "RS256", kid: header.kid, use: "sig" }
const part = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url")
function token(body = claims, h = header) { const data = `${part(h)}.${part(body)}`; return `${data}.${sign("RSA-SHA256", Buffer.from(data), privateKey).toString("base64url")}` }
test("fixed Google JWKS verifies synthetic RS256 signature + audience/nonce and caches only public keys", async () => {
  let calls = 0
  const verify = createGoogleTokenVerifier(async (url, options) => { calls++; assert.equal(url, "https://www.googleapis.com/oauth2/v3/certs"); assert.equal(options?.method, "GET"); assert.equal(options?.redirect, "error"); assert.equal(options?.credentials, "omit"); assert.equal(options?.body, undefined); return Response.json({ keys: [jwk] }) }, () => now)
  assert.deepEqual(await verify(token(), expected), { sub: claims.sub, aud: claims.aud, iss: claims.iss, exp: claims.exp }); await verify(token(), expected); assert.equal(calls, 1)
})
test("wrong nonce/audience/issuer/expiry/iat/header never fetches Google keys", async () => {
  let calls = 0; const verify = createGoogleTokenVerifier(async () => { calls++; throw Error("must-not-fetch") }, () => now)
  for (const body of [{ ...claims, nonce: "other" }, { ...claims, aud: [expected.audience] }, { ...claims, iss: "https://evil.invalid" }, { ...claims, exp: seconds }, { ...claims, exp: undefined }, { ...claims, iat: seconds + 120 }, { ...claims, azp: "other-client" }]) await assert.rejects(verify(token(body as typeof claims), expected), (e: unknown) => e instanceof HkError && e.code === "zklogin_jwt")
  await assert.rejects(verify(token(claims, { ...header, alg: "none" }), expected)); assert.equal(calls, 0)
})
test("signature tampering, unknown key and duplicate JWKS ids cannot verify", async () => {
  const verify = createGoogleTokenVerifier(async () => Response.json({ keys: [jwk] }), () => now)
  const original = token().split("."); original[1] = part({ ...claims, sub: "another" }); await assert.rejects(verify(original.join("."), expected))
  await assert.rejects(verify(token(claims, { ...header, kid: "absent-key" }), expected))
  await assert.rejects(createGoogleTokenVerifier(async () => Response.json({ keys: [jwk, jwk] }), () => now)(token(), expected))
})
test("JWKS transport, redirect and oversized stream errors never expose upstream data or JWT", async () => {
  const jwt = token(), secret = "private-url-sentinel"
  for (const fetcher of [async () => { throw Error(secret) }, async () => new Response(secret, { status: 500 }), async () => new Response("x".repeat(32769)), async () => Response.json({ keys: [{ ...jwk, kty: "oct" }] })]) {
    await assert.rejects(createGoogleTokenVerifier(fetcher, () => now)(jwt, expected), e => e instanceof HkError && e.code === "zklogin_prover" && !String(e).includes(secret) && !String(e).includes(jwt))
  }
})
