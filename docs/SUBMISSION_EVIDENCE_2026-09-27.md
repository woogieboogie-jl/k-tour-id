# Submission evidence bundle: offline export

Date: 2026-09-27. This tool assembles a **redacted, structurally checked local snapshot**, not proof that a live end-to-end run has happened. No successful provider run, signing or chain transaction was performed while implementing it.

Files:

- `k-tour-id-app/lib/hackathon/submission-evidence.ts`: pure `buildSubmissionEvidence(input, now?)` validator/projector.
- `k-tour-id-app/scripts/hackathon-submission-evidence.ts`: explicit local input/output CLI.
- `k-tour-id-app/tests/hackathon/submission-evidence.test.ts`: synthetic and adversarial fixtures.

## Meaning of the result

`complete: true` means the supplied records meet all structural checks. It does **not** authenticate their source. Someone able to replace an entire local snapshot can replace its claimed provenance and recompute its digests. `bundleDigest` detects later changes relative to a separately retained digest; it is not a signature or trusted timestamp.

Every result explicitly includes:

```json
{
  "verification": {
    "scope": "offline_snapshot_consistency",
    "remoteVerificationPerformed": false,
    "attestation": "none",
    "liveExecutionCertified": false,
    "sourceAuthenticityVerified": false
  }
}
```

`suppliedExecutionLevel` is a classification of **supplied** provenance:

| Level | Meaning |
| --- | --- |
| `fixture` | Producer declares a fixture, or every step is a fixture/rule step. Provider-looking hashes cannot remove a fixture producer's label. |
| `mixed` | Provider and simulated/rule steps are mixed, or a fully provider-looking snapshot is not declared live. |
| `live` | Producer claims live and all five source declarations are provider, with matching CX/OpenDID/Gemini/provider execution modes. This label is never independently verified by the exporter. |

Current `credentialEligibility` in `operation-evidence.ts` rejects non-mock OpenDID verification (`opendid_provider_unimplemented`). The exporter therefore fails `credential_supported_verifier` for a provider OpenDID summary. **No fully live completed bundle is supported by the current verifier contract.** A real CX/AI/Sui/OmniOne run with the existing mock credential/VP lane remains `mixed`, even if its chain transactions are real. Native/provider OpenDID later requires actual verifier evidence and a reviewed exporter update—not changing the producer label.

The existing service's Sui entitlement/grant records, agent verification flags and OmniOne receipt marker are identified as **supplied service records**, not fresh independent RPC verification. No wallet signature, raw VC, Google JWT, provider response or key is needed by this tool.

## Capture after the authorized end-to-end run

Use the existing authenticated operator workflow. Do not add a public store/export endpoint, share an entire Redis ledger, paste credentials into a command line, or inspect environment/auth files for this task.

1. Finish or inspect the exact intended operation through the existing application. Wait for its service redemption and independently verified OmniOne outbox receipt; a submitted hash, registry-only record or an unknown result is insufficient.
2. Capture the `OperationRecord`'s required summaries and that operation's exact outbox row together from one authorized store snapshot. Obtain `service.evidence(operation)` using the **same backend revision and configuration**. Do not merge observations from two operations or from before/after a retry.
3. Retain the explicit approval's operation ID, approved proposal digest, consent digest, resulting user transaction digest and approval time. The exporter checks these against the operation and its commitments. This is supplied approval metadata; it does not reconstruct or authenticate a missing wallet signature. If approval capture is absent, leave the bundle incomplete—do not invent a time.
4. Independently identify the protected backend's source SHA and deployment ID and record them as `provenance.expectedBackend`. Record the actual capture's backend metadata separately in `capture.backend`. Their equality catches accidental mismatches but does not authenticate either claim.
5. Supply independently selected campaign/venue/policy, consent version, Sui context and approved OmniOne context under `expectedContext`. Do not derive these expected values from an untrusted operation merely to make it pass.
6. Label every step's source honestly, including fixtures and rule fallback. Keep the source capture private. Only share the allowlisted output after reviewing its remaining public transaction/commitment metadata.

Remove `operation.secrets`, `operation.audit`, `operation.sessionId`, identity handoff/token/transaction reference/subject reference, raw VC/VP, raw provider responses and free-form errors before making a capture file when possible. None is required for the checks. Retain the proposal's structured output locally to recompute `outputDigest`; its title/summary/rationale are **not exported**. Input is limited to 1 MiB and is not echoed.

## Input envelope

The following is a shape guide, not a successful example. Values must come from the intended capture; placeholders are not valid evidence.

```ts
{
  schema: "ktour-submission-input/v1",
  operation: operationSummaries, // JSON form of the checked OperationRecord fields
  serviceEvidence: evidenceProjection, // JSON form of existing service.evidence(op)
  outbox: exactOperationOutbox,
  approval: {
    operationId, proposalDigest, consentDigest, userTxDigest, approvedAt
  },
  expectedContext: {
    campaignId, venueId, policyVersion, consentVersion,
    sui: { network, packageId, campaignId: suiCampaignObjectId, agentAddress },
    omnione: { chainId, registry, recorder }
  },
  provenance: {
    producer: "fixture" | "mixed" | "live",
    executionSources: {
      identity: "fixture" | "provider",
      credential: "fixture" | "provider",
      ai: "fixture" | "provider" | "rule",
      sui: "fixture" | "provider",
      omnione: "fixture" | "provider"
    },
    expectedBackend: {
      role: "protected-backend", environment: "preview" | "local",
      sourceSha, deploymentId // null only for local captures
    },
    capture: {
      operationId, operationRevision, capturedAt,
      backend: { role: "protected-backend", environment, sourceSha, deploymentId }
    },
    frontend: { // optional; never substituted for the backend
      role: "public-frontend", sourceSha, deploymentId
    }
  }
}
```

Timestamps use canonical UTC with milliseconds (`YYYY-MM-DDTHH:mm:ss.sssZ`). The operation must already be `succeeded/done`; the tool can export an incomplete diagnostic bundle for earlier stages. It checks the captured execution window, not whether a historical credential is still valid today.

The approved OmniOne context is stage chain `201210`, registry `0x696bc4e29c8f8079b6d3cd49d310a09577550e4c`, recorder `0x003403cb95c2ffd66bc5748738d96c4a5b48b4ba`, reused from `omnione-evidence.ts`. No RPC URL or authentication value belongs in this envelope. Sui supports explicitly supplied testnet/devnet/localnet context; this tool does not approve mainnet operations.

The public frontend deployment `7127f19fbe608b914870b08bbbadfe1f5a06974b` / `dpl_4fqExVqqrx27YP8j2LmnCUp4henK` is **not** a backend revision. It is allowed only as frontend metadata; substituting that known frontend SHA or deployment as the protected backend fails. A backend source/deployment is never defaulted from frontend metadata.

These are historical frontend references, not a claim that they remain the latest deployment. Any supplied frontend SHA and deployment ID must also differ from the protected backend's, including later frontend releases. This separation check does not verify deployment metadata remotely.

Optional `omnioneReceipt` may contain `{ chainId, authorizedRecorder, receipt, entry }`, where `entry` has `exists`, `payloadCommitment`, decimal-string `recordedAt`, and `recorder`. The exporter reuses `verifyOmnioneReceiptEvidence` for same-transaction receipt/status/target/recorder/block/event/registry binding. These supplied bytes are still not authenticated as an actual network response, and no raw receipt/logs are copied to the output.

## Checks and redaction

- Operation ID/revision/capture time, expected context, backend and optional separate frontend metadata.
- Consumption cannot follow redemption; redemption cannot follow the operation's `updatedAt`. Asynchronous OmniOne confirmation is instead bounded by its own outbox `updatedAt` and capture time: `service.mirror` intentionally does not advance operation `updatedAt`.
- Consent digest; identity verification time and credential acknowledgement; allowed/consumed presentation and service projection consistency.
- Actual recorded successful Gemini model, not the configured preferred model; proposal output and proposal digests; bounded rule fallback labels. A rule result has `actualModel: null`. Bare `rule-v1` cannot distinguish an explicitly configured rule from a missing-provider-key rule, so it is labelled `configured_or_unavailable`.
- Explicit approval metadata; exact proposal target; single-use recipient/action/consent commitments and execution expiry.
- Sui issue, delegation and agent transaction references must exist and be distinct; grant/user transaction must match; canonical manifest, decision commitments and service `effectsOk/eventOk/grantUses=1` flags must agree. Issuance/delegation are still stored-record evidence, not independently reverified transactions.
- Service redemption and eligibility recheck are separate from Sui consumption.
- Exact outbox/operation/chain-summary relation, `receiptEvidenceVersion: 1`, confirmed transaction/block/time, payload digest, campaign/policy, Sui transaction commitment and manifest commitment. Legacy confirmations without the marker, no-hash unknowns and merely submitted records fail.

Output is built field by field. It contains no raw subject/CI/passport, provider transaction reference, VC document, JWT, nonce, credential issuer payload, wallet proof/signature, input/output prose, raw manifest, outbox salt, RPC URL, provider error, arbitrary extra metadata or local paths. Identifying application IDs and prompt/consent versions are represented as one-way references. The approved chain's public transaction/object IDs and commitments remain intentionally linkable; the bundle is not anonymous and is not permission to publish a user's history without authorization.

## Run locally

From `k-tour-id-app`, use a private, existing directory with regular, nonsymlink JSON paths. The output file must not already exist. Parents must resolve without symlink aliases; use their canonical paths (on macOS `/private/tmp/...`, not `/tmp/...`, if applicable).

```sh
node --import tsx scripts/hackathon-submission-evidence.ts --help
node --import tsx scripts/hackathon-submission-evidence.ts --input /absolute/private/capture.json --output /absolute/private/new-evidence.json
```

No environment loading, provider/RPC connection, signer, broadcast, Redis read/write, account switch or deployment occurs. The CLI opens only the specified local capture and creates only the explicitly named output at mode `0600`. It does not make directories, overwrite files, follow input/output symlinks, or emit the input/file path in errors. The capture must not be modified concurrently. Use a private directory not writable by another user; this is not an operating-system sandbox against an attacker who controls that directory.

Exit `0`: structurally complete export. Exit `1`: incomplete export or invalid input/output. `exported: true` with `complete: false` is a saved diagnostic report, **not** success. Fixed failed-check names are printed; no raw error is returned. A failed partial write is cleaned up only if the current regular file still matches this invocation's created device/inode; a replacement file is left alone. `partialOutputRemoved: false` means cleanup was not confirmed. The trusted-parent requirement also applies during this stat/unlink step.

Keep the original input private or dispose of it according to the operator's existing data policy; this tool does not automatically delete captures.

## Local verification

Focused fixtures cover deterministic/nonmutating export, the actual `service.evidence` JSON projection with explicit synthetic configuration, PII/error redaction, actual-model/rule provenance, wrong source SHA/deployment/context, missing approval, altered commitments, malformed/mismatched Sui transactions, OmniOne unknown/legacy/wrong receipt/commitments, source taint, hostile/oversized JSON, no-overwrite/symlink handling and file permissions. They are synthetic checks and do not count as provider approval or live chain execution.

Verification: exporter **15/15** tests; combined with existing AI model provenance and OmniOne evidence suites **29/29**; `tsc --noEmit --incremental false`, CLI `--help` and scoped whitespace checks passed. Independent review's future-consumption, stale-operation timestamp and replacement-file cleanup reproductions are covered; asynchronous OmniOne confirmation later than operation `updatedAt` remains accepted when its separate outbox timeline is valid.
