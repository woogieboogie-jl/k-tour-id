# Main guide → server Pass journey UI — 2026-09-29

## What is implemented, and what this evidence does not establish

The ordinary Roba place detail opens the same free guide reader as the main Travel Pass. Reading starts no identity, signing, provider or saving operation. Only **Add to pass** requests the public v2 readiness summary. A missing connection keeps reading available and never downgrades to the historical v1 perk or the IndexedDB simulator.

When a fully configured v2 deployment is available, the client path is: explicit consent → existing CX operation → native provider QR/refresh/cancel → proposal → Google-backed user approval → Sui execution → final server save → main Pass collection. The current deployment **does not activate that end-to-end path**: the authenticated CX→CAS mapping and native guide-save policy do not yet exist, and the native provider integration deliberately returns unavailable. This is not something a readiness flag or browser fixture can fix.

The current hosted v1 Sui/CX route remains separate historical evidence. Guide saving requires its own new v2 campaign, action and consent. A native lane’s isolated test result does not prove the main application works end to end. See `OPENDID_PROVIDER_INTEGRATION_2026-09-29.md` for remaining mapping, native policy, hosted transport and human consent work. The eventual production v2 profile/access integration and real external E2E must also be completed; the current client uses the protected integration access gate after readiness.

## Main product paths

1. Roba → Place details → neighborhood guide → read free → optional Add to pass.
2. Travel Pass → neighborhood-guide section directly below the Pass card → same free guide.
3. After an authoritative server save, that same Pass section reads `/guide/collection`; refresh/reload obtains the server item, never an IndexedDB upgrade.
4. Saved and OmniOne record-confirmed are distinct. A pending/failed record does not remove an already saved guide or repeat the Sui action.

The public contract is `k-tour-id-app/lib/hackathon/guide-contract.ts`. Exact create body is `{venueId, consentVersion, locale}`. The server supplies canonical place names. The public QR offer stays in component memory, never storage. No fabricated same-device app launch, browser holder acknowledgment or mock VP is used by v2.

## Adversarial boundaries

- V1, `execution: sample`, mock identity/credential/handoff and a restored demo signer cannot authorize the guide path.
- Readiness validates exact guide/action/campaign/consent and all seven configured checks; configuration alone is not labelled real verification.
- Failed or missing resume cannot silently create a replacement operation.
- Unknown agent execution exposes only same-operation reconciliation, not another execution/save.
- Provider responses must match operation ID, guide contract and provider authority before showing any QR.
- Oversized/unrenderable QR shows an explicit handoff failure, not instructions pretending the app opened.
- Request abort/timeout and unmount prevent late provider results updating a closed step. No automatic retry/approval.
- Return restores original place or Pass. Browser Back/Forward does not reopen a stale original place.
- Global wallet, identity and age authority remain unchanged by collection display.

## Reproducible browser fixtures

`tests/e2e/ktour-guide-main-journey.spec.ts` fully intercepts all local integration reads/writes and aborts every external request. Its success is UI-contract evidence only, **not** CX/OpenDID/Google/Sui/OmniOne execution evidence.

Run against the one root-coordinated local server:

```sh
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3172 node node_modules/@playwright/test/cli.js test tests/e2e/ktour-guide-main-journey.spec.ts --workers=1 --retries=0 --output=/tmp/ktour-guide-main-20260929-final
```

Final result: **22/22 passing** (1.7 minutes, one worker, zero retries), Japanese mobile 390px, Japanese desktop 1440px and narrow 320px. Actual screenshots were viewed, not merely generated. Heading wrapping, action reachability and placement below the Pass card were improved after the first review. Peer review added the two QR/provider-mode negative cases. TypeScript `--noEmit` passed after the owned fixture types were corrected.

Final copy cleanup replaced the historical perk sentence/label at the guide approval step with explicit one-guide/one-save scope. The focused approval test then passed **2/2** (mobile + desktop, 8.8 seconds). `git diff --check` was clean. These checks do not authorize production provider activation.

Reviewed screenshots (local QA artifacts):

- `/tmp/ktour-guide-main-20260929-final/tests-e2e-ktour-guide-main-5a532-ness-keep-actions-reachable-mobile-chromium/guide-readiness-ja-320.png`
- `/tmp/ktour-guide-main-20260929-final/tests-e2e-ktour-guide-main-5405c-k-approval-or-sample-signer-mobile-chromium/guide-identity-ja.png`
- `/tmp/ktour-guide-main-20260929-final/tests-e2e-ktour-guide-main-2f930-with-pending-audit-distinct-desktop-chromium/guide-pass-ja.png`

## Deployed read-only acceptance

`tests/e2e/ktour-guide-production-readonly.spec.ts` requires explicit `GUIDE_REMOTE_READ_ONLY=1` and a root-approved `PLAYWRIGHT_BASE_URL`. It uses a fresh browser, blocks every non-read HTTP request before forwarding, checks the real deployed guide/readiness/Pass paths, and does not synthesize successful provider results. It must pass on the built/deployed artifact separately from the intercepted fixtures. Pending deployment at this document’s initial creation.
