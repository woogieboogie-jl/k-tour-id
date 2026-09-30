# Public CX and Gemini 3.8 — reviewed implementation

This revision follows production `64f2a4fc` without replacing its evidence. Source implementation and tests below are not a deployment or human-authentication claim. The dated release artifacts retain the exact later deployment IDs and checks.

## Product changes

- The paired public-identity profile removes the operator access code from purpose-bound CX entry and the explicitly allowed product journey. Pass setup, After19, a Local moment, general/age-limited Tables and the designated Roba experience use the same server-owned identity authority. Reading content, finding places and directions remain free of identity checks.
- After19 requires a verified provider birth claim and the documented full-age-19 product policy, not a browser declaration, generic adult boolean or inferred CI. The exact request context must be separately approved. No raw birth date is persisted. See `CX_AGE19_INTEGRATION_2026-09-30.md`.
- New identity-only operations have bounded, separately accounted capacity and atomic abuse limits. They cannot acquire VC, proposal, delegation or chain fields, and existing charged rows cannot be relabelled. The execution ledger, signer roles, ten-operation lifetime ceiling, 0.3-SUI ceiling and September 30 23:59:59 KST deadline are unchanged.
- The exact connected model is `gemini-3.8-flash`. Google’s official model page and the owner's authenticated model list confirmed availability; a one-request, nonpersonal actual adapter probe returned valid Japanese structured output with the expected model and target. No model fallback or repeat request was used. Historical 2.5 evidence and stored proposals are preserved.
- Model migration is an explicit, journalled one-row `GEMINI_MODEL` update. It derives the before/after fingerprints from one immutable secret snapshot and requires the same-SHA READY, attested preview before production. It does not rotate any key, salt, wallet, budget or store. Public admission flags are separately journalled. Uncertain partial changes cannot be silently retried or re-prepared.

## OpenDID scope chosen by the owner

OpenDID is **local execution plus public source submission**, not public native hosting. Hosted credentials remain mock and are labelled accordingly. No hosting-budget or cloud-account decision is required.

The isolated local profile uses a DEBUG-only native origin contract, web BFF `127.0.0.1:3183`, bridge `3193`, separate `194xx` providers and a separate store/cookie/build directory. It refuses production/Vercel and paid AI, Sui, OmniOne execution. Existing `3181/3182/193xx` services and wallets are not overwritten. Native return values never constitute successful VC/VP verification: the server rechecks DID authentication, TA/CAS binding, expected issuer/holder, presentation and status.

See `NATIVE_CX_HOLDER_BINDING_2026-09-30.md` and the public app README for the exact local setup and first-registration/recovery scope. A compile or fixture pass is not the holder's actual Mobile ID consent, native registration or VC/VP.

## Verification before release

- Operator/build: 58/58 offline checks, including old-journal compatibility, model-only update, before/after single-snapshot integrity, same-preview evidence and uncertain public-flag rejection.
- All JavaScript operator/helper tests: 192/192 passed.
- Verification suite: 99 top-level checks passed; its isolated local-route child also reports 2/2. Do not sum parent and child counts as independent checks.
- Complete TypeScript unit suite passed; final frozen-source counts and build result are recorded with the release artifacts.
- Received-secret comparison passed across 76 changed/new files at the recorded checkpoint; final publication scan is repeated at source freeze.
- Gemini one-shot report: `artifacts/integration-handoff-20260930/ai-gemini38-once.json` in the owner workspace, SHA-256 `1ecca3d9f82bd98891751c06f5870e5bf1a26c9169e62d756ff63a06122c43fe`.

## Remaining human boundary

A supported Mobile ID holder must personally approve the QR handoff. After19 additionally requires that the approved CX contract returns a verifiable birth date; missing data denies access. Google login and separately scoped transaction approval require the account holder. Local native wallet PIN/registration/presentation require the holder. These are not substituted with fixtures, and one-user end-to-end success is reported only after actual server/chain evidence is reconciled.
