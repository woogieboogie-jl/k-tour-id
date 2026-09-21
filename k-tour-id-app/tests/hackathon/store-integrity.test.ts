import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { parseStoredJourney } from "../../lib/hackathon/store-integrity"
import { readStore, withStore } from "../../lib/hackathon/store"

const empty = () => ({ version: 1, sessions: {}, operations: {}, redemptions: {}, outbox: {}, idempotency: {}, nonces: {} })
const savedEnv = { HK_ISOLATED_MOCK: process.env.HK_ISOLATED_MOCK, UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN }
const savedFetch = globalThis.fetch
let stored: string | null = null
let lock: string | null = null
let expiredOwner: string | null = null
let commits = 0

before(() => {
  Object.assign(process.env, { HK_ISOLATED_MOCK: "0", UPSTASH_REDIS_REST_URL: "https://fixture-redis.invalid", UPSTASH_REDIS_REST_TOKEN: "fixture-only" })
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://fixture-redis.invalid", "no external requests allowed")
    const cmd = JSON.parse(String(init?.body)) as Array<string | number>
    let result: unknown
    if (cmd[0] === "SET" && cmd[3] === "NX") { lock = String(cmd[2]); result = "OK" }
    else if (cmd[0] === "GET") result = stored
    else if (cmd[0] === "EVAL" && cmd[2] === 2) {
      assert.match(String(cmd[1]), /GET.*KEYS\[1\].*ARGV\[1\].*SET.*KEYS\[2\]/)
      result = lock === cmd[5] ? 1 : 0
      if (result === 1) { stored = String(cmd[6]); commits++ }
    } else if (cmd[0] === "EVAL" && cmd[2] === 1) {
      result = lock === cmd[4] ? 1 : 0
      if (result === 1) lock = null
    } else assert.fail(`Unexpected storage command ${cmd[0]}`)
    return Response.json({ result })
  }
})
after(() => {
  globalThis.fetch = savedFetch
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

test("corrupt or incompatible file/Redis content never becomes an empty ledger", () => {
  for (const raw of ["", "broken", "null", "[]", "{}", JSON.stringify({ ...empty(), version: 2 }), JSON.stringify({ ...empty(), redemptions: [] }), JSON.stringify({ ...empty(), operations: { broken: null } })]) {
    assert.throws(() => parseStoredJourney(raw), { code: "store_corrupt" })
  }
  assert.deepEqual(parseStoredJourney(JSON.stringify(empty())), empty())
})

test("missing Redis ledger initializes once and valid writes stay detached", async () => {
  stored = null
  const saved = await withStore((db) => { db.sessions.first = { sessionId: "first", createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), subjectRef: null }; return db.sessions.first })
  saved.subjectRef = "outside-write"
  assert.equal((await readStore((db) => db.sessions.first)).subjectRef, null)
  assert.equal(commits, 1)
})

test("malformed Redis ledger cannot be overwritten by a fresh transaction", async () => {
  stored = "broken-ledger"
  const before = commits
  await assert.rejects(withStore(() => "must not commit"), { code: "store_corrupt" })
  assert.equal(stored, "broken-ledger")
  assert.equal(commits, before)
})

test("expired Redis writer is fenced and cannot unlock the newer owner", async () => {
  stored = JSON.stringify(empty())
  const before = commits
  await assert.rejects(withStore((db) => {
    expiredOwner = lock
    lock = "newer-owner"
    stored = JSON.stringify({ ...empty(), sessions: { newer: { sessionId: "newer", createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), subjectRef: null } } })
    db.sessions.stale = { sessionId: "stale", createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), subjectRef: null }
  }), { code: "store_lease_lost" })
  assert.notEqual(expiredOwner, lock)
  assert.equal(lock, "newer-owner")
  assert.equal(commits, before)
  assert.deepEqual(Object.keys(await readStore((db) => db.sessions)), ["newer"])
})
