// Isolated integration regression: real outbox orchestration, adapter fixtures.
// Run with --experimental-test-module-mocks. Not part of the normal unit glob.
import assert from "node:assert/strict"
import { after, before, beforeEach, mock, test } from "node:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import http from "node:http"
import https from "node:https"
import { readStore, withStore, type OperationRecord, type OutboxRecord } from "../../lib/hackathon/store"
import { HkError, nowIso, plusMs, randomId } from "../../lib/hackathon/util"

const fixtureHash = "0x" + "1".repeat(64), fixtureCommitment = "0x" + "2".repeat(64)
const root = mkdtempSync(join(tmpdir(), "cx-chain-outbox-audit-"))
const previous = { isolated: process.env.HK_ISOLATED_MOCK, dir: process.env.HK_DATA_DIR, fetch: globalThis.fetch }
let configured = true, networkAttempts = 0, submitCalls = 0, registryCalls = 0, receiptCalls = 0
let registryResult = { exists: false, payloadCommitment: fixtureCommitment, recordedAt: 0, recorder: "fixture-recorder" }
let receiptResult: { status: "pending" | "confirmed" | "failed"; blockNumber: number | null } = { status: "pending", blockNumber: null }
let submitError = false
let preparationError = false
let registryError = false
let submitResult = { txHash: fixtureHash as string | null, alreadyRecorded: false, matches: true }
let submitWait: Promise<void> | null = null
let onSubmit: (() => void) | null = null

mock.module(new URL("../../lib/hackathon/adapters/omnione.ts", import.meta.url).href, { namedExports: {
  omnioneConfigured: () => configured,
  getRedemption: async () => { registryCalls++; if (registryError) throw new Error("fixture registry read unavailable"); return { ...registryResult } },
  receiptStatus: async () => { receiptCalls++; return { ...receiptResult } },
  submitRedemption: async (opts: { onPrepared?: (hash: string) => Promise<void> }) => {
    submitCalls++
    if (preparationError) throw new HkError("omnione_submission_not_started", "fixture preparation failed before broadcast", 503)
    if (!submitResult.alreadyRecorded && submitResult.txHash) await opts.onPrepared?.(submitResult.txHash)
    onSubmit?.()
    if (submitWait) await submitWait
    if (submitError) throw new Error("fixture transport timeout at https://rpc.invalid/?token=FIXTURE_PRIVATE; no real transaction created")
    return { ...submitResult }
  },
} })
const { processOutbox } = await import("../../lib/hackathon/service")

before(() => {
  process.env.HK_ISOLATED_MOCK = "1"; process.env.HK_DATA_DIR = root
  const forbidden = () => { networkAttempts++; throw new Error("all external network forbidden in outbox audit") }
  globalThis.fetch = async () => forbidden()
  mock.method(http, "request", forbidden); mock.method(https, "request", forbidden)
})
beforeEach(() => {
  configured = true; submitCalls = 0; registryCalls = 0; receiptCalls = 0; submitError = false; preparationError = false; registryError = false
  submitWait = null; onSubmit = null
  submitResult = { txHash: fixtureHash, alreadyRecorded: false, matches: true }
  registryResult = { exists: false, payloadCommitment: fixtureCommitment, recordedAt: 0, recorder: "fixture-recorder" }
  receiptResult = { status: "pending", blockNumber: null }
})
after(() => {
  assert.equal(networkAttempts, 0, "fixture audit must never call an external service")
  globalThis.fetch = previous.fetch
  if (previous.isolated === undefined) delete process.env.HK_ISOLATED_MOCK; else process.env.HK_ISOLATED_MOCK = previous.isolated
  if (previous.dir === undefined) delete process.env.HK_DATA_DIR; else process.env.HK_DATA_DIR = previous.dir
  mock.restoreAll()
  rmSync(root, { recursive: true, force: true })
})

async function seed(status: OutboxRecord["status"] = "pending") {
  const operationId = randomId("op"), outboxId = randomId("obx"), now = nowIso()
  const row: OutboxRecord = { outboxId, operationId, eventKey: "0x" + "3".repeat(64), payloadCommitment: fixtureCommitment, payload: { kind: "fixture-only" }, status, txHash: status === "submitted" ? fixtureHash : null, blockNumber: null, attempts: 0, lastError: null, createdAt: now, updatedAt: now, confirmedAt: null }
  const op: OperationRecord = {
    operationId, sessionId: "fixture-session", kind: "demo_entitlement", venueId: "fixture-venue", campaignId: "fixture-campaign", policyVersion: 1,
    status: "succeeded", phase: "done", revision: 1, createdAt: now, updatedAt: now, expiresAt: plusMs(60_000), execution: "sample", safeNextAction: "return", allowedActions: ["return"], returnContext: null,
    consent: null, identity: null, credential: null, presentation: null, proposal: null, delegation: null, agent: null,
    fulfillment: { status: "redeemed", redemptionRef: "fixture-redemption", redeemedAt: now, reason: null, recheck: null },
    chain: { ...row }, error: null, secrets: {}, audit: [],
  }
  await withStore((db) => { db.operations[operationId] = op; db.outbox[outboxId] = row })
  return { operationId, outboxId }
}

test("unconfigured chain leaves the audit pending without dispatch", async () => {
  configured = false
  const { outboxId } = await seed()
  const result = await processOutbox(outboxId)
  assert.equal(result?.status, "pending"); assert.equal(result?.txHash, null)
  assert.equal(submitCalls, 0); assert.equal(registryCalls, 0)
})

test("submitted audit retries only receipt lookup and confirms matching registry data", async () => {
  const { outboxId, operationId } = await seed()
  assert.equal((await processOutbox(outboxId))?.status, "submitted")
  assert.equal((await processOutbox(outboxId))?.status, "submitted")
  assert.equal(submitCalls, 1)
  receiptResult = { status: "confirmed", blockNumber: 123 }
  registryResult.exists = true
  const done = await processOutbox(outboxId)
  assert.equal(done?.status, "confirmed"); assert.equal(done?.txHash, fixtureHash); assert.equal(done?.blockNumber, 123)
  assert.equal((await readStore((db) => db.operations[operationId])).fulfillment?.status, "redeemed")
  const before = { submitCalls, registryCalls, receiptCalls }
  await processOutbox(outboxId)
  assert.deepEqual({ submitCalls, registryCalls, receiptCalls }, before)
})

test("receipt success plus mismatched registry commitment is not confirmed", async () => {
  const { outboxId, operationId } = await seed("submitted")
  receiptResult = { status: "confirmed", blockNumber: 123 }
  registryResult = { ...registryResult, exists: true, payloadCommitment: "0x" + "4".repeat(64) }
  const result = await processOutbox(outboxId)
  assert.equal(result?.status, "failed"); assert.equal(result?.lastError, "receipt_ok_but_registry_mismatch")
  assert.equal(result?.confirmedAt, null)
  assert.equal((await readStore((db) => db.operations[operationId])).fulfillment?.status, "redeemed")
})

test("failed receipt and transport timeout preserve the already-committed service result", async () => {
  const failed = await seed("submitted")
  receiptResult = { status: "failed", blockNumber: 124 }
  assert.equal((await processOutbox(failed.outboxId))?.status, "failed")
  const timeout = await seed()
  submitError = true
  const unknown = await processOutbox(timeout.outboxId)
  assert.equal(unknown?.status, "submitted"); assert.equal(unknown?.txHash, fixtureHash)
  assert.equal(unknown?.lastError, "omnione_request_failed")
  assert.doesNotMatch(JSON.stringify(unknown), /FIXTURE_PRIVATE|rpc\.invalid/)
  for (const id of [failed.operationId, timeout.operationId]) assert.equal((await readStore((db) => db.operations[id])).fulfillment?.status, "redeemed")
})

test("existing event with a different payload is rejected without another dispatch", async () => {
  const { outboxId } = await seed("unknown")
  registryResult = { ...registryResult, exists: true, payloadCommitment: "0x" + "4".repeat(64) }
  const result = await processOutbox(outboxId)
  assert.equal(result?.status, "failed"); assert.equal(result?.lastError, "duplicate_eventKey_payload_mismatch")
  assert.equal(submitCalls, 0)
})

test("recovered registry match must not claim receipt confirmation without a receipt", async () => {
  const { outboxId } = await seed("unknown")
  registryResult.exists = true
  const result = await processOutbox(outboxId)
  assert.equal(submitCalls, 0)
  assert.equal(result?.txHash, null); assert.equal(result?.blockNumber, null); assert.equal(receiptCalls, 0)
  assert.equal(result?.status, "unknown")
  assert.equal(result?.lastError, "registry_recorded_receipt_unavailable")
  assert.equal(result?.confirmedAt, null)
})

test("concurrent outbox processors claim a single dispatch", async () => {
  const { outboxId } = await seed()
  await Promise.all([processOutbox(outboxId), processOutbox(outboxId)])
  assert.equal(submitCalls, 1, "both processors read pending and dispatch independently; registry uniqueness does not prevent duplicate broadcast attempts")
  assert.equal((await readStore((db) => db.outbox[outboxId])).processingClaim, undefined)
})

test("submission timeout never re-broadcasts while the registry is still empty", async () => {
  const { outboxId } = await seed()
  submitError = true
  await processOutbox(outboxId)
  submitError = false
  await Promise.all([processOutbox(outboxId), processOutbox(outboxId)])
  const row = await readStore((db) => db.outbox[outboxId])
  assert.equal(submitCalls, 1); assert.equal(row.attempts, 1)
  assert.equal(row.status, "submitted"); assert.equal(row.txHash, fixtureHash)
  assert.equal(row.confirmedAt, null)
})

test("a registry read failure before any dispatch remains safely retryable", async () => {
  const { outboxId } = await seed()
  registryError = true
  const pending = await processOutbox(outboxId)
  assert.equal(pending?.status, "pending"); assert.equal(pending?.attempts, 0); assert.equal(submitCalls, 0)
  registryError = false
  assert.equal((await processOutbox(outboxId))?.status, "submitted")
  assert.equal(submitCalls, 1)
})

test("expired pre-dispatch worker can be replaced without changing the event identity", async () => {
  const { outboxId } = await seed()
  await withStore((db) => { db.outbox[outboxId].processingClaim = { id: "expired", expiresAt: plusMs(-1000) } })
  const before = await readStore((db) => db.outbox[outboxId])
  const done = await processOutbox(outboxId)
  assert.equal(done?.status, "submitted"); assert.equal(submitCalls, 1)
  assert.equal(done?.eventKey, before.eventKey); assert.equal(done?.payloadCommitment, before.payloadCommitment)
})

test("a live durable claim blocks a second worker even before its first dispatch", async () => {
  const { outboxId } = await seed()
  await withStore((db) => { db.outbox[outboxId].processingClaim = { id: "other-worker", expiresAt: plusMs(60_000) } })
  await processOutbox(outboxId)
  assert.equal(submitCalls, 0); assert.equal(registryCalls, 0)
  assert.equal((await readStore((db) => db.outbox[outboxId])).processingClaim?.id, "other-worker")
})

test("stale RPC completion cannot overwrite a newer owner or trigger another broadcast", async () => {
  const { outboxId, operationId } = await seed()
  let release!: () => void, started!: () => void
  submitWait = new Promise<void>((resolve) => { release = resolve })
  const submitting = new Promise<void>((resolve) => { started = resolve })
  onSubmit = started
  const first = processOutbox(outboxId)
  await submitting
  try {
    await withStore((db) => { db.outbox[outboxId].processingClaim!.expiresAt = plusMs(-1000) })
    await processOutbox(outboxId)
    const recovered = await readStore((db) => db.outbox[outboxId])
    assert.equal(recovered.status, "submitted"); assert.equal(recovered.txHash, fixtureHash); assert.equal(submitCalls, 1)
  } finally {
    release(); await first
  }
  const done = await readStore((db) => db.outbox[outboxId])
  assert.equal(done.txHash, fixtureHash); assert.equal(done.status, "submitted"); assert.equal(done.processingClaim, undefined)
  assert.equal((await readStore((db) => db.operations[operationId])).fulfillment?.status, "redeemed")
})

test("a registry race reported by submit is checked for payload mismatch", async () => {
  const { outboxId } = await seed()
  submitResult = { txHash: null, alreadyRecorded: true, matches: false }
  const done = await processOutbox(outboxId)
  assert.equal(done?.status, "failed"); assert.equal(done?.lastError, "duplicate_eventKey_payload_mismatch")
  assert.equal(done?.confirmedAt, null)
})

test("an already-recorded submit result does not invent a transaction receipt", async () => {
  const { outboxId } = await seed()
  submitResult = { txHash: null, alreadyRecorded: true, matches: true }
  const done = await processOutbox(outboxId)
  assert.equal(done?.status, "unknown"); assert.equal(done?.lastError, "registry_recorded_receipt_unavailable")
  assert.equal(done?.txHash, null); assert.equal(done?.confirmedAt, null)
})

test("legacy unknown with a known hash recovers only through its existing receipt", async () => {
  const { outboxId } = await seed("unknown")
  await withStore((db) => { db.outbox[outboxId].txHash = fixtureHash })
  receiptResult = { status: "confirmed", blockNumber: 123 }; registryResult.exists = true
  const done = await processOutbox(outboxId)
  assert.equal(done?.status, "confirmed"); assert.equal(submitCalls, 0); assert.equal(receiptCalls, 1)
})

test("receipt confirmation without block evidence is not final", async () => {
  const { outboxId } = await seed("submitted")
  receiptResult = { status: "confirmed", blockNumber: null }; registryResult.exists = true
  const done = await processOutbox(outboxId)
  assert.equal(done?.status, "submitted"); assert.equal(done?.confirmedAt, null)
})

test("a positively identified preparation failure can retry without a prior broadcast", async () => {
  const { outboxId } = await seed()
  preparationError = true
  const pending = await processOutbox(outboxId)
  assert.equal(pending?.status, "pending"); assert.equal(pending?.txHash, null); assert.equal(pending?.attempts, 0)
  preparationError = false
  const submitted = await processOutbox(outboxId)
  assert.equal(submitted?.status, "submitted"); assert.equal(submitted?.attempts, 1)
})

test("legacy unknown without a transaction hash is never blindly resubmitted", async () => {
  const { outboxId } = await seed("unknown")
  const done = await processOutbox(outboxId)
  assert.equal(done?.status, "unknown"); assert.equal(submitCalls, 0)
})

test("legacy registry-only confirmation is corrected without undoing the benefit", async () => {
  const { outboxId, operationId } = await seed("confirmed")
  registryResult.exists = true
  const done = await processOutbox(outboxId)
  assert.equal(done?.status, "unknown"); assert.equal(done?.confirmedAt, null)
  assert.equal(submitCalls, 0)
  const operation = await readStore((db) => db.operations[operationId])
  assert.equal(operation.fulfillment?.status, "redeemed"); assert.equal(operation.chain?.status, "unknown")
})
