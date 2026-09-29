# Shared Sui budget: one-way integration cutover

> **Superseded as the recommended main-guide activation path.** The 2026-09-29
> follow-up audit found a compatible single-pool reservation protocol; see
> [shared-budget preparation](INTEGRATION_SHARED_BUDGET_2026-09-29.md).
> The one-way fenced protocol below remains implemented and fail-closed, but its
> old-writer retirement requirement is **not an owner prerequisite for the new
> shared-reservation path**. Do not delete deployments or request a shutdown on
> the strength of this historical plan.

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
| Readiness / creation | No-argument `assertIntegrationSuiActivation()` remains closed; fresh `readIntegrationSuiActivation()` validates the full approved profile and durable committed state | A real committed cutover is still required. Returning a valid snapshot does not create signing authority. Provider and signer checks remain independent. |
| Actual Sui boundaries | `withIntegrationSuiAuthorization({sessionId, operationId}, fn)` scopes a private async-context capability around issue, sponsored build, user submission and agent execution; fresh reads before signing/broadcast | No caller-supplied JSON, env success flag or fixture can replace the operator cutover. Existing live providers/consent remain mandatory. |

## Runtime authorization (implemented, not activated)

The legacy integration-preview profile and the new `deploy/guide-main-20260929`
profile share the **same** destination, fixed chain tuple, lifetime budget and
absolute expiry. Guide uses `HK_GUIDE_EXPIRES_AT`; it does not create a second
allowance. Either protected profile's flags or exact branch keep the limits on.
The existing hosted-Sui branch keeps its existing guards; this patch does not
silently activate the guide profile on it.

The trusted server sequence is:

1. Creation/readiness calls `readIntegrationSuiActivation()` for a fresh atomic
   source/target/control read and full profile validation. Missing Redis or
   cutover state fails before file fallback or initialization.
2. One adapter call runs inside `withIntegrationSuiAuthorization`. It verifies an
   already allocated operation, exact session/row ID, pending execution phase,
   unexpired operation, committed marker and immutable limits. Private
   `AsyncLocalStorage` carries authority, never a public response or HTTP token.
3. `refreshIntegrationSuiAuthorization()` rereads committed state after async
   transaction building and after the existing durable `beforeBroadcast` claim.
   `assertIntegrationSuiAuthorized()` rejects authority older than 5 seconds,
   backwards time, expiry, owner mismatch, configuration/credential drift,
   absent context or a completed context. It is not a long-lived cached permit.
4. Failed refresh invalidates prior authority. Concurrent refresh generations
   cannot replace a newer result with an older observation. Nested owner swaps
   and detached tasks inherited after the callback closes are denied. Ordinary
   store commits also recheck expiry and configuration before the existing
   source/target/control/lease CAS. The configuration fingerprint stays private
   in memory; neither its secret input nor its digest is logged or returned.

This capability supplements, rather than replaces, the service's one-attempt
dispatch claims and provider/consent rechecks. It cannot make an unfenced legacy
deployment safe; it controls only the new executable.

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

### Concrete platform inspection and control gap (2026-09-29)

A GET-only Vercel inspection authenticated the pinned account/project/team. The
first page exceeded the runtime protocol's 64-deployment refusal threshold, so
a separate bounded **read-only inventory** (500 deployments / 10 pages / 90
seconds) was completed at **2026-09-29T04:16:04Z**. It returned **157 deployments
in two pages, 4.2 seconds** and reached the API pagination end: 11 hosted-Sui
branch candidates (9 READY, 2 ERROR), 11 CX-preview, 135 other/unclassified.
The runtime verifier's bound remains unchanged. Branch classification is not
proof of which deployments possess the old signing/store capability.

Seven bounded deployment-detail reads expose `config.functionTimeout=300`
seconds. Current production has `functions: null` and no numeric per-function
duration override in its lambda build-group metadata: default 300 seconds is
readable, but an effective invocation bound for **every** relevant function is
not established. Project metadata contained no configured protection and no
pause field. Absent fields are **unknown**, not evidence of revocation.

Exact candidate IDs, dates, per-deployment observations and all 157 sanitized
metadata rows are in workspace artifacts:
`artifacts/main-flow-integration-20260929/CUTOVER_READONLY_INVENTORY_20260929.md`
and its adjacent JSON files. No environment values, deployment mutations, Redis
writes or chain operations were requested. Current pagination completeness is
not an authenticated historical inventory or platform-fence attestation.

Current official documentation establishes these limits:

| Available control / observation | What it does **not** establish |
| --- | --- |
| Updating environment variables affects new deployments, not existing ones. [Environment variables](https://vercel.com/docs/environment-variables) | Old immutable code has lost its old credentials. |
| Protected deployments can be reached using an automation bypass. [Protection bypass](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation) | A 401/403 proves invocation or signing access was revoked. |
| Project pause blocks the production deployment. [Managing projects](https://vercel.com/docs/projects/managing-projects) | Every old Preview/immutable deployment and in-flight invocation is stopped. |
| Deployment listing is paginated; deletion returns a deletion result. [List deployments](https://vercel.com/docs/rest-api/deployments/list-deployments), [Delete deployment](https://vercel.com/docs/rest-api/deployments/delete-a-deployment) | A list response is an exhaustive historical snapshot, or one delete receipt proves all writers/drain/future exclusion. Deletion is destructive and was not performed. |
| Deployment Policies restrict repositories and creation mechanisms such as Git, CLI and REST. [Deployment Policies](https://vercel.com/docs/deployments/deployment-policy) | An allowed repository can no longer redeploy an old SHA or restore a legacy writer. |
| Credential rotation also requires invalidating the old credential at its provider. [Rotating secrets](https://vercel.com/docs/environment-variables/rotating-secrets) | Editing Vercel env alone revokes the old value; retiring a store token alone proves every old executable cannot send a previously prepared transaction. |
| Function durations vary; documented extended duration can reach 1,800 seconds. [Function duration](https://vercel.com/docs/functions/configuring-functions/duration) | This protocol's 900-second bound is a Vercel guarantee. Actual per-function evidence is required; longer/unknown durations are refused, not rounded down. |

The necessary operational decision is permission for a **coordinated retirement
of legacy writers**, including immutable endpoints and future redeploy/rollback
paths. The first owner decision is whether a controlled interruption for this
transition is acceptable, **not blanket permission to delete deployments**.
Engineering prepares the exact plan next; any destructive retirement or upstream
credential invalidation requires its own precise targets and approval. Larger
read-only inventory was independent engineering and did not require owner action.
The engineering team then implements the matching
authenticated verifier, observes invocation/claim drain, and applies the
cutover. This is not a request for the user to write an `authenticated: true`
file, hand-edit ledger counters, or claim a UI screenshot is a revocation receipt.

Before that decision is applied, engineering still must map the 157-deployment
inventory to actual legacy capability holders, review the runtime inventory
bound/control design, establish actual function durations and reconstruct
authenticated lifetime allocations. The source store
prunes operation rows after three days, so present rows alone are not a universal
history proof. Missing audit history cannot be converted to zero usage. If the
chosen controls cannot supply the protocol's required evidence, change/review
the control design explicitly; do not install an adapter that merely renames
ordinary metadata to the required authority types.

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
Additional real-wrapper fixtures cover owned allocation, terminal/expired rows,
profile removal/restoration, credential drift, source drift, failed refresh,
parallel owners/refreshes, closed async contexts and guide/legacy shared storage.

```sh
node --import tsx --test tests/hackathon/integration-cutover*.test.ts tests/hackathon/integration-sui-authorization.test.ts tests/hackathon/integration-sui-limits.test.ts
```
