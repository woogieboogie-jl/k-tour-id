// Explicit operator preparation only. Initializes EMPTY guide target/control;
// never allocates an operation, changes the legacy ledger, enables providers,
// resets a budget, edits Vercel, signs, broadcasts, or deletes history.
import { randomBytes } from "node:crypto"
import { fileURLToPath } from "node:url"
import { createReadOnlyAuditIO, inspectHostedLedgerReadOnly } from "./hackathon-cutover-audit.mjs"
import { SHARED_BUDGET_SCOPE as S, initialSharedBudgetState, assertSharedBudgetState, SHARED_BUDGET_INITIALIZE_LUA } from "../lib/hackathon/integration-shared-budget"
import { parseStoredJourney } from "../lib/hackathon/store-integrity"

function stop(code: string): never { throw new Error(`shared_budget_prepare_${code}`) }
const UNLOCK = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0"
type Command = (string | number)[]
type OperatorIO = { audit: () => Promise<unknown>; command: (cmd: Command) => Promise<unknown>; now?: () => number; token?: () => string }
/** Injected fixture ports are server-only, never accepted from CLI/body JSON. */
export async function prepareSharedBudget(io: OperatorIO) {
  await io.audit() // Fixed authenticated Vercel scope + journal + same Redis URL.
  const now = () => io.now?.() ?? Date.now()
  if (now() >= Date.parse(S.expiresAt)) stop("expired")
  const token = io.token?.() ?? `shared_${randomBytes(16).toString("hex")}`
  if (!/^shared_[a-f0-9]{32}$/.test(token)) stop("token")
  const targetLock = `${S.targetKey}:lock`, sourceLock = `${S.sourceKey}:lock`
  let ownTarget = false, ownSource = false
  try {
    ownTarget = await io.command(["SET", targetLock, token, "NX", "PX", 5000]) === "OK"
    if (!ownTarget) stop("busy")
    ownSource = await io.command(["SET", sourceLock, token, "NX", "PX", 5000]) === "OK"
    if (!ownSource) stop("busy")
    const read = async () => {
      const rows = await io.command(["MGET", S.targetKey, S.controlKey, S.sourceKey])
      if (!Array.isArray(rows) || rows.length !== 3 || rows.some(v => v !== null && typeof v !== "string") || typeof rows[2] !== "string") return stop("state")
      return rows as [string | null, string | null, string]
    }
    const rows = await read()
    if (now() >= Date.parse(S.expiresAt)) stop("expired")
    if (rows[0] !== null || rows[1] !== null) {
      if (rows[0] === null || rows[1] === null) stop("partial_state")
      const state = assertSharedBudgetState(parseStoredJourney(rows[0]), JSON.parse(rows[1]), rows[2], now())
      return { prepared: true, replayed: true, allocatedNewSlots: 0, sourceOperationCount: Object.keys(state.source.operations).length,
        guideOperationCount: state.budget.operationIds.length, runtimeConfigurationChanged: false, mode: "shared-reservation" }
    }
    const next = initialSharedBudgetState(rows[2], now())
    // Fixed CAS only. Outcome ambiguity is propagated, never retried blindly.
    let result: unknown
    try { result = await io.command(["EVAL", SHARED_BUDGET_INITIALIZE_LUA, 5, targetLock, S.targetKey, S.controlKey, sourceLock, S.sourceKey,
      token, token, rows[2], JSON.stringify(next.db), JSON.stringify(next.control)]) }
    catch { return stop("outcome_unknown") }
    if (result !== 1) stop("conflict")
    try {
      const confirmed = await read()
      if (confirmed[0] === null || confirmed[1] === null || confirmed[2] !== rows[2]) stop("confirmation_unknown")
      assertSharedBudgetState(parseStoredJourney(confirmed[0]), JSON.parse(confirmed[1]), confirmed[2], now())
    } catch { return stop("confirmation_unknown") }
    return { prepared: true, replayed: false, allocatedNewSlots: 0, sourceOperationCount: next.control.sourceOperationIds.length,
      guideOperationCount: 0, runtimeConfigurationChanged: false, mode: "shared-reservation" }
  } finally {
    if (ownSource) await io.command(["EVAL", UNLOCK, 1, sourceLock, token]).catch(() => undefined)
    if (ownTarget) await io.command(["EVAL", UNLOCK, 1, targetLock, token]).catch(() => undefined)
  }
}

function approvedOperatorIO(): OperatorIO {
  const readonly = createReadOnlyAuditIO(), deadline = Date.now() + 45_000
  let connection: { url: string; token: string } | undefined
  return {
    audit: async () => inspectHostedLedgerReadOnly({ ...readonly, mget: async (conn: { url: string; token: string }, cmd: Command) => {
      const result = await readonly.mget(conn, cmd); connection = conn; return result
    } }),
    command: async cmd => {
      if (!connection || Date.now() >= deadline) stop("scope")
      const lock = (key: unknown) => key === `${S.targetKey}:lock` || key === `${S.sourceKey}:lock`
      const token = (value: unknown) => typeof value === "string" && /^shared_[a-f0-9]{32}$/.test(value)
      const read = JSON.stringify(cmd) === JSON.stringify(["MGET", S.targetKey, S.controlKey, S.sourceKey])
      const acquire = cmd.length === 6 && cmd[0] === "SET" && lock(cmd[1]) && token(cmd[2]) && cmd[3] === "NX" && cmd[4] === "PX" && cmd[5] === 5000
      const release = cmd.length === 5 && cmd[0] === "EVAL" && cmd[1] === UNLOCK && cmd[2] === 1 && lock(cmd[3]) && token(cmd[4])
      const initialize = cmd.length === 13 && cmd[0] === "EVAL" && cmd[1] === SHARED_BUDGET_INITIALIZE_LUA && cmd[2] === 5 &&
        JSON.stringify(cmd.slice(3, 8)) === JSON.stringify([`${S.targetKey}:lock`, S.targetKey, S.controlKey, `${S.sourceKey}:lock`, S.sourceKey]) && token(cmd[8]) && cmd[8] === cmd[9]
      if (!read && !acquire && !release && !initialize) stop("command")
      const r = await fetch(connection.url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(Math.max(1, Math.min(5000, deadline - Date.now()))),
        headers: { authorization: `Bearer ${connection.token}`, "content-type": "application/json" }, body: JSON.stringify(cmd) })
      if (!r.ok) stop("transport")
      const raw = await r.text()
      if (raw.length > 8_000_000) stop("response")
      let reply: { result?: unknown; error?: unknown }
      try { reply = JSON.parse(raw) } catch { return stop("response") }
      if (reply.error) stop("transport")
      return reply.result
    },
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== "--initialize-empty-target") stop("arguments")
    console.log(JSON.stringify(await prepareSharedBudget(approvedOperatorIO())))
  } catch (error) {
    console.error(JSON.stringify({ prepared: false, error: /^shared_budget_prepare_[a-z_]+$/.test((error as Error)?.message ?? "") ? (error as Error).message : "shared_budget_prepare_unavailable" }))
    process.exitCode = 1
  }
}
