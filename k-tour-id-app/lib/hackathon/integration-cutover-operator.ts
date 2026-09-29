/** Privileged operator adapter, never imported by a route or client component.
 * Construction is pure; there is no ambient env lookup or default invocation.
 * No generic Redis command/EVAL capability is exposed to the caller. */
import { HkError } from "./util"
import { storeRedisCommand, type RedisConnection } from "./redis-config"
import { CUTOVER_SCOPE as S, CUTOVER_PREPARE_LUA, CUTOVER_COMMIT_LUA, assertCommittedCutover,
  assertCutoverSourceUnchanged, parseIntegrationCutoverControl, provisionCutover,
  type HostedLedgerReadPort, type CutoverPlan, type CutoverAtomicPort, type CutoverDb } from "./integration-cutover"

const refused = (): never => { throw new HkError("integration_cutover_operator_configuration", "The approved cutover operator is unavailable.", 503) }
/** The connection must be selected by trusted server/operator code for the SAME
 * approved Redis database used by source and destination. This validator is not
 * an authentication attestor and does not prove ownership of an Upstash host. */
export function createCutoverRedisOperator(options: {
  connection: RedisConnection;
  allocationAudit: HostedLedgerReadPort["readLifetimeAllocation"];
  fetchImpl?: typeof fetch;
}) {
  const { url, token } = options.connection
  try {
    const u = new URL(url)
    if (url !== url.trim() || /[\x00-\x1f\x7f]/.test(url) || u.protocol !== "https:" || !u.hostname.endsWith(".upstash.io") ||
      u.username || u.password || u.search || u.hash || u.pathname !== "/" || (u.port && u.port !== "443") ||
      !token || token !== token.trim() || /[\x00-\x20\x7f]/.test(token) || typeof options.allocationAudit !== "function") refused()
  } catch { refused() }
  const connection = Object.freeze({ url: url.replace(/\/+$/, ""), token })
  const command = async (args: (string | number)[], signal: AbortSignal) => {
    if (signal.aborted) return refused()
    // Honor both the protocol's cancellation and the transport's independent
    // timeout. Abort or lost EVAL response is never treated as proof of no write.
    const fetchImpl: typeof fetch = (input, init) => (options.fetchImpl ?? globalThis.fetch)(input, {
      ...init, signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]),
    })
    return storeRedisCommand<unknown>(connection, args, { fetchImpl, timeoutMs: 4500 })
  }
  const ledger: HostedLedgerReadPort = Object.freeze({
    async readSource(signal: AbortSignal) {
      const pair = await command(["MGET", S.sourceKey, `${S.sourceKey}:lock`], signal)
      if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string" || Buffer.byteLength(pair[0]) > S.sourceMaxBytes ||
        (pair[1] !== null && typeof pair[1] !== "string")) return refused()
      return { key: S.sourceKey, raw: pair[0], locked: pair[1] !== null }
    },
    // This independent authenticated lifetime history is deliberately mandatory;
    // current ledger keys alone miss allocations already pruned by old writers.
    readLifetimeAllocation: options.allocationAudit,
  })
  const atomic: CutoverAtomicPort = {
    async eval(script, keys, args, signal) {
      const expectedKeys = [S.sourceKey, `${S.sourceKey}:lock`, S.targetKey, `${S.targetKey}:lock`, S.controlKey]
      if ((script !== CUTOVER_PREPARE_LUA && script !== CUTOVER_COMMIT_LUA) || JSON.stringify(keys) !== JSON.stringify(expectedKeys) ||
        args.length !== (script === CUTOVER_PREPARE_LUA ? 2 : 4) || args.some(value => typeof value !== "string" || Buffer.byteLength(value) > S.sourceMaxBytes)) return refused()
      return command(["EVAL", script, 5, ...keys, ...args], signal)
    },
  }
  return Object.freeze({
    ledger,
    // A serialized or forged plan is rejected inside provisionCutover BEFORE
    // this adapter can send a request; only fresh branded authority proofs work.
    provision(plan: CutoverPlan, phase: "prepare" | "commit", now = Date.now()) { return provisionCutover(plan, phase, atomic, now) },
    /** Read-only recovery check. Never returns source raw, provider secrets,
     * operation rows, credentials, or Redis response bodies. No auto-repair. */
    async inspect(signal: AbortSignal, now = Date.now()) {
      const values = await command(["MGET", S.sourceKey, S.targetKey, S.controlKey], signal)
      if (!Array.isArray(values) || values.length !== 3 || values.some(v => v !== null && typeof v !== "string")) return refused()
      const [source, target, rawControl] = values as Array<string | null>
      if (target === null && rawControl === null) return { phase: "unprepared" as const }
      if (rawControl === null) return refused()
      let control
      try { control = parseIntegrationCutoverControl(JSON.parse(rawControl)) } catch { return refused() }
      assertCutoverSourceUnchanged(source, control.marker)
      if (control.phase === "prepared") {
        if (target !== null) return refused()
        return { phase: "prepared" as const, migrationId: control.marker.migrationId }
      }
      let db: CutoverDb
      try { if (target === null) return refused(); db = JSON.parse(target) as CutoverDb } catch { return refused() }
      assertCommittedCutover(db, control, now)
      return { phase: "committed" as const, migrationId: control.marker.migrationId, sequence: control.sequence }
    },
  })
}
