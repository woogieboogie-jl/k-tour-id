# OmniOne Stage target migration — 2026-09-30

## Scope and evidence

This change does not migrate or replay historical records. The old registry and its
deployment metadata remain untouched. The operator reported a successful new Stage
deployment and independently read back receipt, runtime bytecode, owner and recorder
permission. Public evidence is in `chain/omnione/deploy-info.stage-20260930.json`;
the compiled public runtime is in `chain/omnione/runtime.stage-20260930.json`.

| Target | Registry | Recorder |
| --- | --- | --- |
| `stage-legacy-20260914` | `0x696bc4e29c8f8079b6d3cd49d310a09577550e4c` | `0x003403cb95c2ffd66bc5748738d96c4a5b48b4ba` |
| `stage-20260930` | `0x07b35e14b1bf59be938fd72a6f9d9f9e04f0a687` | `0x315694f531f7b25c4cec3660f9cd66eab9f2c39a` |

Both use chain ID `201210` and the approved Stage RPC origin. The new deployment
receipt has effective gas price zero. That receipt is deployment evidence, **not**
evidence of a new user audit record, CX approval, OpenDID issuance, or an integrated
production journey. This source change does not activate any runtime profile.

## Immutable history contract

- The reviewed `omnione-targets.ts` catalog is the sole target authority. Environment
  variables can select a registered target; they cannot register an address.
- New service operations privately snapshot `{version:1,targetId,chainId,registry,recorder}`.
  Redemption copies exactly that target into its outbox and public chain receipt.
  Guide collection keeps the target after operation/outbox retention expires.
- Missing snapshots are old-format rows and always mean the legacy target, even
  after new signing credentials/configuration are selected. `null`, malformed,
  unregistered or cross-target snapshots fail closed.
- Ordinary file and Redis mutations cannot retarget a retained operation or outbox.
  Guide records also cannot be retargeted. Existing TTL pruning is unchanged.
- Evidence views, receipt lookups and recovery use the stored target, not the
  current signing configuration. Reading old receipts needs the approved RPC,
  not the old private key.
- New signing requires the operation target to match the configured target and
  derived signer. Every attempt checks the live chain ID, bytecode and recorder
  permission. The new target requires its exact reviewed runtime code hash.
- A legacy pending item cannot be sent by the new recorder into the new registry.
  Unknown/no-hash items stay check-only. Hash-known items only inspect their same
  receipt. A configuration change never resets attempts or creates a new event key.

## Operator sequence (root-owned; no automated credential disclosure)

1. Validate candidate key/keystore privately and compare its derived public address
   to the new catalog recorder. Do not weaken the old-recorder input validator or
   overwrite the old key entry merely to accept a different address.
2. Use the existing approved RPC via secure local input, with logs limited to
   public target IDs/hashes/status. Never put RPC tokens, raw signed bytes, private
   keys, keystore contents or passphrases into repository artifacts or command args.
3. Read target chain/code/hash/owner/`recorders(recorder)` before any write. Confirm
   nonce and actual zero-price transaction policy; a historic zero-price receipt
   alone does not authorize nonzero fees. No owner grant or old-registry modification
   is needed for this separately deployed registry.
4. For an explicitly controlled nonpersonal audit probe, call the real adapter with
   `target: omnioneTargetSnapshot('stage-20260930')`. Persist its prepared hash in a
   private durable journal through `onPrepared` **before** broadcast. One event key,
   one payload commitment, one nonce. A lost response means read the known hash,
   not sign again. A probe is labelled a probe, never a customer redemption.
5. Confirm with `receiptStatus(hash,{eventKey,payloadCommitment,target})`: require
   status 1, exact transaction target/sender, receipt event, block and matching
   `getRedemption` entry. A hash or registry presence alone is not confirmation.
6. Production configuration, when the other required providers/policy are ready,
   selects `HK_OMNIONE_TARGET_ID=stage-20260930` and the exact catalog chain,
   registry and recorder. Load the matching signer only through secure server
   settings. Leave old ledgers and all existing operation snapshots unchanged.
7. A new main-flow operation must independently satisfy CX consent/current proof,
   OpenDID real holder mapping/presentation, user Sui authorization and server
   fulfillment before creating an audit outbox. Provider deployment or a standalone
   audit probe must not bypass these requirements or be reported as that full E2E.

## Rollback and recovery

Rolling configuration back does not move new-target receipts to the old registry.
The source must retain both catalog entries and snapshot validation. Never roll back
to pre-snapshot code against a ledger containing new-target rows: such code would
misinterpret history. Restore a compatible release or keep the affected write lane
disabled. Read-only recovery validates each row target and preserves attempt counts,
fulfillment results and chain history; it does not replay or reconstruct missing
transaction hashes.

## Verification (offline unless explicitly stated)

New adversarial cases cover unknown targets, malformed tuples, config mismatch,
atomic retarget attempts, operation-before-outbox immutability, guide history after
pruning, new runtime hash, old receipt recovery without signer, rollback reading,
unknown/no-hash no rebroadcast, and late receipt/target drift. Real service + adapter
fixtures use inert signers and forbid all external network. Passing these cases is
source/runtime orchestration evidence, not an assertion of live user integration.
