# Shared Sui budget: one-way integration cutover

Status: **local machinery implemented; no remote cutover performed; activation blocked**.
The production `vercel.json` remains the existing hosted-Sui profile. This work
does not claim a new unified OmniOne record or a production guide E2E success.

## Why changing the alias is insufficient

An old immutable deployment still contains the old writer code and its original
credentials. Moving `ktour-id.vercel.app`, rebuilding new code, adding an env flag,
or observing an HTTP 401 cannot establish that the old code cannot write. New
source code cannot retroactively enforce a fence on that immutable executable.
Do not overwrite/delete the old ledger or change its schema to try to poison it.

The shared lifetime limits remain **10 operations, 300,000,000 MIST (0.3 SUI),
expiry 2026-09-30T14:59:59Z (23:59:59 KST)**. The per-transaction and per-operation limits remain
in `integration-sui-limits.ts`. Failed, cancelled, pending, expired and already
pruned allocations still consume their slots. Creating a new key is not a new
budget. This protocol never extends the expiry or refunds an operation.

## Implemented boundaries

| Part | Implemented local behavior | Still required before real activation |
| --- | --- | --- |
| Authority verifier | Pinned account/project/team; bounded exhaustive deployment inventory twice; immutable execution-revocation receipts; stable enforced future-writer exclusion policy | An authenticated platform/security adapter capable of establishing those facts. **No default attestor is installed.** Ordinary Vercel metadata is not such evidence. |
| Source observation | Exact-source SHA-256, all current operations, unresolved-claim checks, two unchanged observations at least 5 seconds apart | Independent authenticated lifetime allocation history, including previously pruned IDs. Current `Object.keys(operations)` is not a complete audit. |
| Operator storage adapter | Explicit approved Upstash connection; fixed-key reads; private fixed-script EVAL; no ambient env/credential discovery or generic command interface | Trusted operator selects the same approved database and authenticated audit adapter. No real Redis calls were executed for this implementation. |
| Two-phase provisioning | Prepare creates only control; commit atomically creates destination and committed control; source bytes and both locks compared in each phase | Fresh, in-process branded proofs. A JSON file, `authenticated:true`, or env flag cannot create a valid plan. |
| Runtime store | Atomic read of target + control + original source; committed-state/digest checks; target/control/source/lease CAS on every write | Committed real cutover plus remaining provider prerequisites. Missing state is an error, never an empty-store initialization. |
| Readiness | No-argument `assertIntegrationSuiActivation()` remains closed; fresh `readIntegrationSuiActivation()` exposes only verified durable state to trusted server code | Service wiring must use that fresh verification at the authorized boundary, never a client boolean or a cached marker. Provider and signer checks remain independent. |

## Fixed scope

- Project `prj_w5rckTz9B1DO55fvVRXjQRy9L5RM`, team `team_6kJAloQ9WlswvMtbbCmGI7Er`, account `jaewook-9643`.
- Source `ktour:sui-hosted:20260928:v1` and its existing `:lock`.
- Destination `ktour:integration-preview:autonomous-20260928:v1` and its `:lock`.
- Control `ktour:integration-cutover:hosted-20260928:v1`.
- At most 8 inventory pages, 64 deployments, 96 authority reads, 30 seconds per verification, 5 seconds per read, 2 MiB source.
- Known invocation bound must be 1–900 seconds. Each revoked invocation must drain for its bound plus 90 seconds of claim allowance. Fresh proof lifetime is 30 seconds.

These are refusal thresholds, not automatic permission to expand scope. If the
inventory exceeds a bound or revocation cannot be proved, stop without writes.

## Operator protocol (not executed)

1. Establish an actual enforced exclusion of **every** immutable old writer and
   of future deployments that could reacquire the legacy signing/store access.
   Obtain authenticated, exhaustive receipts. Read-only alias/config inspection
   cannot manufacture this. Disabling deployments/credentials is an operational
   change requiring explicit authorized coordination; this patch does not do it.
2. Wait for all documented invocation bounds and claims to drain. Reconcile
   unresolved signing/submission/outbox claims without replaying unknown writes.
   Obtain the authenticated lifetime allocation audit. If history is incomplete,
   fail closed rather than assume zero prior usage.
3. Trusted server code implements `AuthenticatedCutoverReadPort` and calls
   `verifyWriterFence`. It then uses `createCutoverRedisOperator(...).ledger`
   with an independently authenticated `allocationAudit` to call
   `observeHostedLedger` twice, separated by at least 5 seconds. The snapshots
   stay in process; never save/log raw source, identity data, tokens or responses.
4. `prepareCutover` accepts only the branded proof/snapshots. Its deterministic
   plan records all lifetime IDs and the source hash. `operator.provision(plan,
   "prepare")` uses exact-source/lock CAS and refuses an existing destination,
   conflicting control, source drift or expired proof. Prepared is **not active**.
5. `operator.provision(plan, "commit")` again compares exact source/locks/control
   and atomically writes the fresh destination and committed control. It copies
   only the immutable budget baseline/marker, **not source sessions, identity
   secrets, operations or old claims**. The source remains readable and unchanged.
6. New runtime requests atomically read all three durable keys. Every normal
   mutation preserves prior budget IDs and guide collection ownership, checks
   the original source hash, and atomically advances target + control sequence.
   A late legacy-source write is a hard stop on subsequent reads/commits.

The concrete operator adapter intentionally does not expose raw EVAL or accept
arbitrary command JSON. Its constructor is pure. Only `provision` with a fresh
branded plan can reach the fixed EVAL operations. There is no activation route
or auto-run CLI. The read-only helper is safe to run offline:

```sh
cd k-tour-id-app
node --import tsx scripts/hackathon-integration-cutover.ts --requirements
```

## Lost responses, partial state and rollback

- A failed/timeout EVAL response is **outcome unknown**, not a failed write.
  Inspect the fixed keys read-only with `operator.inspect`, then obtain fresh
  authority proof and stable observations. Exact idempotent preparation/commit
  may be retried; never clear control, delete target, unlock another owner, or
  reset counters. If runtime state already advanced, an old exact commit is
  refused; read the current verified state instead of replaying.
- Prepared-only, missing control, missing target, corrupted hashes, changed
  source bytes, lease loss, partial write, ledger-only rollback and decreasing
  allocation IDs all fail closed. Callback changes to the marker are forbidden.
- The control is durable independent high-water state in the **same Redis**.
  It is not an externally tamper-proof journal: a privileged administrator
  restoring **both target and control together** to a coherent old backup cannot
  be detected by these local keys alone. Do not restore that pair to an older
  state. Stronger administrator/snapshot rollback resistance needs an external
  monotonic authority/journal before any claim of such protection is made.
- The source hash check detects a late write; it cannot undo an external
  transaction already sent by unfenced old code. This is why authentic old-writer
  exclusion and quiescence remain mandatory, not optional after-the-fact checks.

## Work ownership and actual blockers

Engineering can complete the authenticated adapter against the approved real
platform/security control and lifetime audit source once those capabilities are
identified, then perform the bounded protocol under authorized coordination.
It is **not** appropriate to ask a user to hand-edit JSON or counters. If the
available platform/credentials do not support proving exclusion, runtime remains
blocked; a platform owner must authorize an enforceable disable/revoke strategy.

This cutover alone does not supply the OmniOne recorder signer or provider
credentials/approved authority. Those remain separate requirements. Existing
historical chain receipts are not evidence of a newly committed main-flow record.

## Verification evidence

Local Node tests cover counterfeit proofs, incomplete/drifting inventory,
future-writer policy drift, missing historical allocations, corrupt baselines,
unresolved claims, late source writes, lock conflicts, concurrent preparation,
lost responses, restart with fresh proof, exact retry, expired proofs, the fixed
10-operation ceiling, no private-source copying, and store rollback/monotonicity.
The real store is exercised against a **synthetic Redis transport**, and the
operator uses injected synthetic HTTP responses. These are not live Redis or
platform-authority verification and must not be described as a production E2E.

```sh
node --import tsx --test tests/hackathon/integration-cutover*.test.ts
```
