/** Offline inspection only. Deliberately no credentials, env, network, stdin or
 * file payload parsing: CLI JSON must never become an activation attestation. */
import { CUTOVER_SCOPE } from "../lib/hackathon/integration-cutover"
import { INTEGRATION_SUI_LIMITS } from "../lib/hackathon/integration-sui-limits"

const args = process.argv.slice(2)
if (args.length && !(args.length === 1 && ["--help", "--requirements"].includes(args[0]))) {
  process.stderr.write("Cutover is operator-only. This offline helper cannot activate, apply, reset, or accept JSON proof.\n")
  process.exitCode = 2
} else {
  process.stdout.write(JSON.stringify({
    status: "blocked-awaiting-authenticated-authority", mode: "offline-read-only", runtimeActivated: false,
    sharedLimits: { operations: INTEGRATION_SUI_LIMITS.maxOperations, totalGasMIST: INTEGRATION_SUI_LIMITS.maxTotalGasMIST, expiresAt: INTEGRATION_SUI_LIMITS.maxExpiresAt },
    sourceKey: CUTOVER_SCOPE.sourceKey, targetKey: CUTOVER_SCOPE.targetKey, controlKey: CUTOVER_SCOPE.controlKey,
    requirements: [
      "Authenticated complete immutable-deployment inventory, execution revocation receipts, and enforced future legacy-writer exclusion.",
      "All previous invocations and claims drained within proven bounds; authenticated lifetime allocation history including pruned, failed, cancelled and pending operations.",
      "Two stable source observations; fresh in-process proof; exact-source CAS for prepare then atomic target/control commit.",
      "Missing signer/provider prerequisites remain separate activation blockers. No alias, env flag, anonymous HTTP status or user JSON is disablement evidence.",
      "Lost responses require read-only inspection and fresh proof; never delete keys, reset counters, extend expiry or replay blindly.",
    ],
    guide: "../docs/INTEGRATION_CUTOVER_2026-09-29.md",
  }, null, 2) + "\n")
}
