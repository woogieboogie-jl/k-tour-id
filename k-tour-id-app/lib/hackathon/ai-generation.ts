import { HkError } from "./util"

/** The reservation is persisted before dispatch. A timeout, crash, failed
 * commit or missing response never authorizes another paid generation. */
export async function generateProposalOnce<S, T, R>(ports: {
  reserve: () => Promise<S>
  generate: (snapshot: S) => Promise<T>
  commit: (snapshot: S, output: T) => Promise<R>
  unknown: (snapshot: S) => Promise<void>
}): Promise<R> {
  const snapshot = await ports.reserve()
  try { return await ports.commit(snapshot, await ports.generate(snapshot)) }
  catch (error) {
    // A failed marker update is still safe: the original claimed reservation
    // remains non-retryable. Never replace the original error with store detail.
    try { await ports.unknown(snapshot) } catch { /* durable claimed stays spent */ }
    throw error
  }
}

export function assertAiGenerationUnclaimed(value: unknown): void {
  if (value !== undefined) throw new HkError("ai_generation_already_requested", "The assistant request was already sent. Check the current result; it will not be sent again.", 409)
}
