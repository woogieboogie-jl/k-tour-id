# Optional hosted test-confirmation audit

## Meaning and scope

This connects the existing app-owned, non-financial test entitlement to the existing atomic redemption/outbox mechanism. It is **not** a real merchant benefit, payment, reservation, native OpenDID issuance, or proof that a complete real-user journey has run.

The explicit final action rechecks the current CX-derived identity, mock credential/holder presentation, campaign/subject/use limit and independently verified Sui execution. It then commits one app-owned test use and its OmniOne audit outbox in the same durable store update. The UI names that test scope before confirmation and on the receipt.

## Activation and invariants

- Existing hosted profile only: paired `NEXT_PUBLIC_HK_HOSTED_PROVIDERS` and `HK_HOSTED_PROVIDERS` equal `connected-20260930-v1`, plus `HK_HOSTED_OMNIONE_ENABLED=1` and the exact approved public `stage-20260930` target. Full existing profile preflight still applies. Missing/partial activation rejects before opening storage.
- Same hosted ledger, lifetime ceiling of 10 operations, maximum 0.3 SUI, existing roles and hard expiry `2026-09-30T14:59:59Z`. No new budget or historical replay is created.
- OpenDID remains mock in this optional hosted lane. Native readiness is not waived or claimed. AI and Google flags are independent and not authority to redeem.
- New operations retain their immutable target snapshot. An absent target is legacy, never implicitly the new registry. Historical operations cannot acquire the new confirmation CTA or a new audit merely because environment settings changed.
- Before a first audit dispatch and its prepared-hash commit, the worker rechecks the committed same-ledger redemption, consumed presentation, verified Sui execution, immutable target and payload commitments.
- A transaction hash is persisted before broadcast. Unknown/submitted outcomes are check-only, not permission to resend. A late audit cannot repeat the app-owned test use.
- `OperationResult.hostedTestRedemption` is a server-derived **lane/recovery marker, not authorization**. Provider disablement does not erase pending recovery. The actionable UI additionally requires current config capability and server `allowedActions`.
- Existing legacy Sui-only completion behavior and terminal secret cleanup stay unchanged.

## Separate Google cancellation boundary

Connected Google signing additionally checks the same current, proved, operation/address/config-bound attempt at prepare entry, after asynchronous signature verification, issuer claim/pre-broadcast/final preparation CAS, before PTB construction, submit claim and submit pre-broadcast. A cancelled/expired or changed attempt cannot use cached signature material to advance. Persisting evidence of an already broadcast transaction is not blocked or undone by subsequent login expiry.

## Local verification, not provider E2E

- 6 pure Omni policy fixtures: explicit activation, exact targets, immutable ceilings/deadline, no legacy/probe promotion, committed outbox/payload binding.
- 7 real service + disposable ledger fixtures: atomic one-use/outbox, concurrent callers, legacy rejection, recovery marker, activation/expiry drift, current-proof revocation, lost-response receipt-only recovery.
- 2 recovery helper fixtures: pending close/reload state vs terminal/legacy cleanup.
- 6 real service/preparation + disposable ledger fixtures for Google cancellation timing and unchanged demo signing; policy/provider transports are synthetic in these wiring tests. The actual policy has its separate owned-attempt tests.
- 4 direct signing-policy fixtures cover current proved authority, cancellation/unknown/expiry, recipient/session/consent/configuration drift, invalid imported identity and historical non-hosted compatibility.
- Existing 22 outbox audit regressions, 8 legacy hosted route regressions and 6 lifetime agent-budget regressions passed after the optional path was added.
- TypeScript passed. The dedicated hosted UI fixture suite `tests/e2e/ktour-hosted-omnione-confirm.spec.ts` passed 5/5 against the credential-free hosted-flag local server on port 3174: Korean 320px, Japanese 390px, English 1440px, provider-disabled recovery and legacy Sui-only completion. It uses one mobile Chromium project with explicit viewport sizes; this is not a real-device or live-provider E2E test. Six screenshots are under `k-tour-id-app/artifacts/qa/hosted-omnione-connected/`; direct visual inspection found no clipped/overlapping controls or text in the representative narrow, Japanese dark and wide views. All integration API calls were intercepted, and the fixture guard observed no provider calls or unmocked mutations.

The new registry's earlier non-personal adapter self-test is independent evidence of that registry/adapter only; it is not counted as a user redemption here. Actual activation, deployment verification, and any real user-authorized journey remain separately recorded operator actions. These source/fixture checks issue no provider or chain requests.
