// Read-only integration audit: real outbox orchestration, explicit adapter fixtures.
// Run with --experimental-test-module-mocks. Not part of the normal unit glob.
// Two normative acceptance checks intentionally expose existing recovery/race gaps.
import assert from "node:assert/strict"
import { after, before, beforeEach, mock, test } from "node:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import http from "node:http"
import https from "node:https"
import { readStore, withStore, type OperationRecord, type OutboxRecord } from "../../lib/hackathon/store"
import { nowIso, plusMs, randomId } from "../../lib/hackathon/util"

const fixtureHash = "0x" + "1".repeat(64), fixtureCommitment = "0x" + "2".repeat(64)
const root = mkdtempSync(join(tmpdir(), "cx-chain-outbox-audit-"))
const previous = { isolated: process.env.HK_ISOLATED_MOCK, dir: process.env.HK_DATA_DIR, fetch: globalThis.fetch }
let configured = true, networkAttempts = 0, submitCalls = 0, registryCalls = 0, receiptCalls = 0
let registryResult = { exists: false, payloadCommitment: fixtureCommitment, recordedAt: 0, recorder: "fixture-recorder" }
let receiptResult: { status: "pending" | "confirmed" | "failed"; blockNumber: number | null } = { status: "pending", blockNumber: null }
let submitError = false

mock.module(new URL("../../lib/hackathon/adapters/omnione.ts", import.meta.url).href, { namedExports: {
  omnioneConfigured: () => configured,
  getRedemption: async () => { registryCalls++; return { ...registryResult } },
  receiptStatus: async () => { receiptCalls++; return { ...receiptResult } },
  submitRedemption: async () => {
    submitCalls++
    if (submitError) throw new Error("fixture transport timeout; no real transaction created")
    return { txHash: fixtureHash, alreadyRecorded: false, matches: true }
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
  configured = true; submitCalls = 0; registryCalls = 0; receiptCalls = 0; submitError = false
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
  assert.equal(unknown?.status, "unknown"); assert.equal(unknown?.txHash, null)
  for (const id of [failed.operationId, timeout.operationId]) assert.equal((await readStore((db) => db.operations[id])).fulfillment?.status, "redeemed")
})

test("existing event with a different payload is rejected without another dispatch", async () => {
  const { outboxId } = await seed("unknown")
  registryResult = { ...registryResult, exists: true, payloadCommitment: "0x" + "4".repeat(64) }
  const result = await processOutbox(outboxId)
  assert.equal(result?.status, "failed"); assert.equal(result?.lastError, "duplicate_eventKey_payload_mismatch")
  assert.equal(submitCalls, 0)
})

test("GAP: recovered registry match must not claim receipt confirmation without a receipt", async () => {
  const { outboxId } = await seed("unknown")
  registryResult.exists = true
  const result = await processOutbox(outboxId)
  assert.equal(submitCalls, 0)
  assert.equal(result?.txHash, null); assert.equal(result?.blockNumber, null); assert.equal(receiptCalls, 0)
  assert.notEqual(result?.status, "confirmed", "current recovery path confirms solely from registry state, without recovering tx/receipt evidence")
})

test("GAP: concurrent outbox processors must claim a single dispatch", async () => {
  const { outboxId } = await seed()
  await Promise.all([processOutbox(outboxId), processOutbox(outboxId)])
  assert.equal(submitCalls, 1, "both processors read pending and dispatch independently; registry uniqueness does not prevent duplicate broadcast attempts")
})
