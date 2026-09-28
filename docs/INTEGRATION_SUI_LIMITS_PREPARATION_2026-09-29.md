# Integration Sui limits — preparation, NOT activated

This change is offline security preparation. It does not complete or activate
the full integration journey. No remote environment, Redis state, private key,
deployment, signature or chain transaction was changed.

The existing hosted Sui/CX lane is unchanged. The separate full integration lane
must still require real CX and real OpenDID; no sample/provider fallback was
added. OpenDID implementation remains its separate workflow.

## Prepared protections

- Explicit `HK_INTEGRATION_SUI_TARGET=selfhosted-testnet`; no target inference.
  The approved package, Campaign/shared version, official Testnet RPC/genesis,
  issuer, agent and issuer-as-sponsor are the owned pins in
  [integration-sui-targets.ts](../k-tour-id-app/lib/hackathon/integration-sui-targets.ts).
  `harvey-original` is a read-only readiness selection, not an execution grant.
- Fixed gas budget: 10,000,000 MIST per transaction. User delegation remains
  sponsored. Derived server role addresses must match the owned pins.
- One shared ceiling, not another allowance: prior hosted operation slots plus
  integration operation slots must total at most **10**. At most three paid
  Sui attempts per slot implies the original maximum **300,000,000 MIST**.
  Cancelled, failed, interrupted and pruned operations remain charged.
- Retained `integrationSuiBudget` includes the immutable prior hosted operation
  IDs, source-ledger SHA-256, hosted-write-disable timestamp and new operation
  IDs. Store writes reject removal, decreasing counts, changed baseline or
  changed historical IDs. Missing/corrupt state is never silently initialized.
- Fixed integration namespace:
  `ktour:integration-preview:autonomous-20260928:v1`; hard expiry no later than
  `2026-09-30T14:59:59Z`. Namespace changes cannot grant fresh allowance.
- Existing durable issuer/delegation claims remain in place; the integration
  agent path additionally refuses every second attempt, including paid failure
  or an interrupted attempt without a transaction digest.

## Deliberate activation fence

`assertIntegrationSuiActivation()` currently refuses protected integration Sui
signing, delegation and agent execution with the fixed
`integration_sui_migration_required` error. It also refuses creation of an
operation explicitly requesting this owned Sui lane. There is **no environment
override**, automatic budget initializer, or operator action in this patch.

Identity/provider preparation, general journey reads and Sui read-only lookups
are not gated by this migration fence. Public integration capabilities do not
claim chain execution or redemption readiness. Hosted production remains under
its existing independent profile checks.

The fence is intentional **activation-incomplete preparation**, not proof that
the full integration works. A budget JSON template alone does not prove another
deployment stopped writing. Removing this fence requires reviewed migration
code and evidence, not merely filling a user secret.

## Remaining work owned by us before activation

1. Fence hosted mutations for every reachable mutable/immutable deployment that
   can access the hosted ledger, then let in-flight claims settle. Disabling
   only the public alias is insufficient. Preserve read-only evidence.
2. With writes quiescent, audit the complete hosted ledger and existing claims.
   Carry **all** consumed operation slots forward, not only successful receipts;
   document any historical gap conservatively. Hash the audited ledger. Do not
   reset or delete the old ledger or locks to make the count fit.
3. Implement and test an atomic one-way cutover/provisioning protocol that
   refuses existing/ambiguous migration state and prevents hosted reactivation
   from spending against a stale baseline. The combined ceiling stays 10.
   Provisioning must be a separately reviewed operator action, never a normal
   request or a `null`-ledger fallback.
4. Replace the preparation fence only after cross-instance concurrency, lost
   response, crash, rollback and old-deployment tests establish the cutover.
   Verify configured public roles, Campaign activity/policy and available gas
   read-only. Stop if the fixed September 30 expiry has passed; do not extend it
   or increase the allowance automatically.
5. Keep the integration runtime disabled until that migration and the real
   provider requirements are satisfied. OAuth/account consent, provider setup
   and genuine signing inputs are distinct prerequisites, not substitutes for
   the budget migration. No provider activation is authorized by these tests.

## Offline verification

Focused tests exercise fixed target/role/gas/expiry rejection, the permanent
preparation fence, no-I/O side-effect entrypoints, retained accounting across
actual store pruning/reload, and refusal to decrease or erase the baseline.
Synthetic Redis transport does not contact any real datastore.

```sh
node --import tsx --test tests/hackathon/integration-sui-*.test.ts
node --experimental-test-module-mocks --import tsx --test tests/hackathon-verification/hosted-sui-agent-budget.test.ts
pnpm typecheck
```

See [integration-sui-limits.ts](../k-tour-id-app/lib/hackathon/integration-sui-limits.ts)
and [budget store tests](../k-tour-id-app/tests/hackathon/integration-sui-budget-store.test.ts).
