import assert from "node:assert/strict"
import { after, beforeEach, test } from "node:test"
import { cxComplete } from "../../lib/hackathon/adapters/cx"
import { HkError } from "../../lib/hackathon/util"

// Transport fixtures only. Never reach the provider or use real identity data.
const keys = ["HK_ISOLATED_MOCK", "HK_MODE_CX", "HK_CX_BASE_URL", "HK_CX_SAMPLE_FALLBACK", "HK_ISSUER_SIGNING_SEED"]
const oldEnv = Object.fromEntries(keys.map(k => [k, process.env[k]]))
const oldFetch = globalThis.fetch
const calls: string[] = []
let responses: Response[] = []
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } })
const result = (verified: unknown = true) => json({ code: 200, oacxStatus: "AFTER_RESULT", data: { verified } })
const claims = (patch: Record<string, unknown> = {}) => json({ code: 200, data: { ci: "fixture-ci-not-personal-data", txId: "tx-fixture", cxId: "cx-fixture", adult: "Y", ...patch } })
const input = { operationId: "op-fixture", token: "fixture-token", txId: "tx-fixture", cxId: "cx-fixture", mobile: false }
const code = (expected: string) => (e: unknown) => e instanceof HkError && e.code === expected

beforeEach(() => {
  Object.assign(process.env, { HK_ISOLATED_MOCK: "0", HK_MODE_CX: "cx", HK_CX_BASE_URL: "https://cx.invalid", HK_CX_SAMPLE_FALLBACK: "1", HK_ISSUER_SIGNING_SEED: "cx-test-fixture-only" })
  calls.length = 0
  responses = []
  globalThis.fetch = async (url) => {
    assert.ok(String(url).startsWith("https://cx.invalid/"))
    calls.push(String(url))
    const response = responses.shift()
    assert.ok(response, "Every request must have a response fixture")
    return response
  }
})
after(() => {
  globalThis.fetch = oldFetch
  for (const [key, value] of Object.entries(oldEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
})

test("real CX mode rejects sample results even with legacy fallback enabled", async () => {
  await assert.rejects(cxComplete({ ...input, sample: { outcome: "verified", subjectSeed: "attacker" } }), code("cx_sample_not_allowed"))
  assert.equal(calls.length, 0)
})

for (const value of ["false", "true", 1, {}, false, null]) {
  test(`CX verification requires boolean true, not ${JSON.stringify(value)}`, async () => {
    responses = [result(value)]
    assert.deepEqual(await cxComplete(input), { failed: "failed" })
    assert.equal(calls.length, 1)
  })
}

test("missing completion status does not verify or fetch claims", async () => {
  responses = [json({ code: 200, data: { verified: true } })]
  assert.deepEqual(await cxComplete(input), { pending: true })
  assert.equal(calls.length, 1)
})

test("missing stable subject cannot become a new person through transaction ID", async () => {
  responses = [result(), claims({ ci: undefined })]
  await assert.rejects(cxComplete(input), code("cx_subject_unavailable"))
})

test("missing provider transaction reference cannot inherit the requested one", async () => {
  responses = [result(), claims({ txId: undefined })]
  await assert.rejects(cxComplete(input), code("cx_transaction_missing"))
})

for (const badCode of [undefined, "garbage", 0]) {
  test(`malformed claims result code ${badCode} cannot be accepted`, async () => {
    responses = [result(), json({ code: badCode, data: { ci: "fixture-ci", txId: input.txId } })]
    await assert.rejects(cxComplete(input), (e: unknown) => e instanceof HkError && ["cx_response", "cx_error"].includes(e.code))
  })
}

test("provider result details are not echoed into application errors", async () => {
  responses = [json({ code: 500, oacxCode: "SECRET_ID_BODY" })]
  await assert.rejects(cxComplete(input), (e: unknown) => e instanceof HkError && !e.message.includes("SECRET_ID_BODY"))
})

for (const mismatch of [{ txId: "other-tx" }, { cxId: "other-cx" }]) {
  test(`provider correlation mismatch is rejected ${Object.keys(mismatch)[0]}`, async () => {
    responses = [result(), claims(mismatch)]
    await assert.rejects(cxComplete(input), code("cx_transaction_mismatch"))
  })
}

test("same provider subject has stable pseudonym across requests and never exposes CI", async () => {
  responses = [result(), claims(), result(), claims({ txId: "tx-second", cxId: "cx-second" })]
  const first = await cxComplete(input)
  const second = await cxComplete({ ...input, operationId: "op-second", txId: "tx-second", cxId: "cx-second" })
  assert.ok("evidence" in first && "evidence" in second)
  assert.equal(first.evidence.subjectRef, second.evidence.subjectRef)
  assert.equal(first.evidence.mode, "cx")
  assert.equal(JSON.stringify(first).includes("fixture-ci-not-personal-data"), false)
})

test("provider error body cannot leak identity data into application errors", async () => {
  responses = [new Response("SECRET_ID_BODY", { status: 500 })]
  await assert.rejects(cxComplete(input), (e: unknown) => e instanceof HkError && e.code === "cx_http" && !e.message.includes("SECRET_ID_BODY"))
})

test("malformed provider response fails closed", async () => {
  responses = [new Response("null", { status: 200 })]
  await assert.rejects(cxComplete(input), code("cx_response"))
})

for (const [providerCode, expected] of [[402, { pending: true }], [408, { pending: true }], [406, { failed: "cancelled" }], [312, { failed: "expired" }], [30020, { failed: "failed" }]] as const) {
  test(`CX provider result ${providerCode} remains recoverable, never verified`, async () => {
    responses = [json({ code: providerCode })]
    assert.deepEqual(await cxComplete(input), expected)
    assert.equal(calls.length, 1)
  })
}
