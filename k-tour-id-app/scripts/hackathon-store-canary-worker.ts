import { readStore, storeBackendKind, withStore } from "../lib/hackathon/store"
import { STORE_CANARY_UUID, previewRedisConfig } from "../lib/hackathon/redis-config"

const operation = process.argv[2] ?? ""
const workerId = process.argv[3] ?? ""
const uuid = process.env.HK_STORE_CANARY_UUID ?? ""

async function main() {
  if (!STORE_CANARY_UUID.test(uuid) || process.env.NEXT_PUBLIC_HK_CX_PREVIEW !== "1" ||
    process.env.NEXT_PUBLIC_HK_PREVIEW_READ_ONLY !== "0" || process.env.HK_ISOLATED_MOCK !== "0" ||
    process.env.HK_MODE_CX !== "mock" || process.env.HK_MODE_OPENDID !== "mock" || process.env.HK_AI_MODE !== "rule" ||
    !((operation === "write" && ["a", "b"].includes(workerId)) || (operation === "read" && workerId === "reader"))) {
    throw new Error("canary_disabled")
  }
  const config = previewRedisConfig(process.env)
  if (!config.canary || config.key !== `ktour:cx-preview:canary:${uuid}:journey`) throw new Error("canary_key")

  // Unit tests use parent IPC, never a local or external HTTP server. The CLI
  // does not set this flag; provider APIs are never imported by this worker.
  if (process.env.HK_STORE_CANARY_FIXTURE === "1") {
    if (!process.send) throw new Error("canary_fixture")
    let sequence = 0
    const pending = new Map<number, { resolve: (response: Response) => void; reject: (error: Error) => void }>()
    process.on("message", (message: { id?: number; result?: unknown; failed?: boolean }) => {
      const item = pending.get(message.id ?? -1)
      if (!item) return
      pending.delete(message.id!)
      if (message.failed) item.reject(new Error("fixture_failure"))
      else item.resolve(Response.json({ result: message.result }))
    })
    globalThis.fetch = async (input, init) => {
      if (String(input) !== config.url || init?.method !== "POST") throw new Error("fixture_scope")
      const id = ++sequence
      return await new Promise<Response>((resolve, reject) => {
        pending.set(id, { resolve, reject })
        process.send!({ id, command: JSON.parse(String(init.body)) })
      })
    }
  }

  // This is an actual backend check, not an assertion about an expected env flag.
  if (storeBackendKind() !== "redis") throw new Error("canary_backend")
  const ids = [`canary-${uuid}-a`, `canary-${uuid}-b`]
  if (operation === "write") {
    const ownId = `canary-${uuid}-${workerId}`
    await withStore(async db => {
      if (Object.keys(db.sessions).some(id => !ids.includes(id)) ||
        [db.operations, db.redemptions, db.outbox, db.idempotency, db.nonces].some(rows => Object.keys(rows).length)) throw new Error("canary_contents")
      // Ensure simultaneous children contend for the real store's lease.
      await new Promise(resolve => setTimeout(resolve, 40))
      const at = new Date().toISOString()
      db.sessions[ownId] = { sessionId: ownId, createdAt: at, lastSeenAt: at, subjectRef: null }
    })
  } else {
    const valid = await readStore(db => Object.keys(db.sessions).length === 2 &&
      ids.every(id => db.sessions[id]?.sessionId === id && db.sessions[id]?.subjectRef === null) &&
      [db.operations, db.redemptions, db.outbox, db.idempotency, db.nonces].every(rows => !Object.keys(rows).length))
    if (!valid) throw new Error("canary_read")
  }
  process.stdout.write(`${JSON.stringify({ ok: true, backend: "redis", pid: process.pid })}\n`)
}

main().catch(() => { process.stdout.write(`${JSON.stringify({ ok: false })}\n`); process.exitCode = 1 })
  .finally(() => { if (process.connected) process.disconnect() })
