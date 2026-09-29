# Main guide → server Pass journey UI — 2026-09-29

## What is implemented, and what this evidence does not establish

The ordinary Roba place detail opens the same free guide reader as the main Travel Pass. Reading starts no identity, signing, provider or saving operation. Only **Add to pass** requests the public v2 readiness summary. A missing connection keeps reading available and never downgrades to the historical v1 perk or the IndexedDB simulator.

When a fully configured v2 deployment is available, the client path is: explicit consent → existing CX operation → native provider QR/refresh/cancel → proposal → Google-backed user approval → Sui execution → final server save → main Pass collection. The current deployment **does not activate that end-to-end path**: the authenticated CX→CAS mapping and native guide-save policy do not yet exist, and the native provider integration deliberately returns unavailable. This is not something a readiness flag or browser fixture can fix.

The current hosted v1 Sui/CX route remains separate historical evidence. Guide saving requires its own new v2 campaign, action and consent. A native lane’s isolated test result does not prove the main application works end to end. See `OPENDID_PROVIDER_INTEGRATION_2026-09-29.md` for remaining mapping, native policy, hosted transport and human consent work. Production v2 profile/access code is now prepared and locally fixture-verified, **not activated or externally verified**. Real provider configuration, permitted cutover and actual same-operation E2E still remain.

Readiness must explicitly select `guide-production`, `integration-preview` or `unavailable`. Production uses the private `/guide/access` gate and its server cookie; only an explicit integration profile uses `/integration/access`. Neither missing metadata nor denial may fall back to a historical/sample path. After access, the protected config must match the entire guide tuple and all provider modes. Production also requires the canonical v2 campaign, action and consent; the historical generic campaign in integration Preview does not substitute for guide metadata. A successful access POST without a usable protected config grants no journey view.

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
- Access expiry clears ephemeral QR state and requires an explicit access recheck. The exact known operation ID survives; access renewal does not recreate, approve or execute it.
- A delayed terminal resume GET from a closed journey cannot clear a newer pending pointer. A provider body arriving after its timeout cannot restore its QR or advance the phase.
- Access codes are password inputs in transient component state only; denial and submission clear the input. Reading remains available without access or identity verification.
- Campaign expiry is distinct from setup unavailability and still permits free reading.
- Return restores original place or Pass. Browser Back/Forward does not reopen a stale original place.
- Global wallet, identity and age authority remain unchanged by collection display.

## Reproducible browser fixtures

`tests/e2e/ktour-guide-main-journey.spec.ts` fully intercepts all local integration reads/writes and aborts every external request. Its success is UI-contract evidence only, **not** CX/OpenDID/Google/Sui/OmniOne execution evidence.

Run against the one root-coordinated local server:

```sh
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3172 pnpm exec playwright test tests/e2e/ktour-guide-main-journey.spec.ts --workers=1 --retries=0 --output=/tmp/ktour-guide-access-final-20260929
```

Latest result: **42/42 passing** (3.0 minutes, one worker, zero retries), Japanese mobile 390px, Japanese desktop 1440px and narrow 320px. Actual final screenshots were viewed, not merely generated: narrow access/denial controls, desktop identity modal and mobile server-backed Pass all remain contained and readable. Earlier 22-case main-journey coverage remains included. The added cases cover production/integration profile isolation, wrong/missing config, denied code, missing cookie, expiry/recovery, closed/late responses and campaign closure. Every external request is blocked; no real provider or chain write occurred.

`pnpm exec tsx --test tests/hackathon/guide-ui-access-contract.test.ts`: **3/3 passing**, including all exact guide fields, all production campaign fields, all provider-mode mismatch cases, and the explicitly permitted historical generic campaign only in integration Preview. `pnpm exec tsc --noEmit --incremental false` passed. `git diff --check` was clean. The sole 3172 dev server was stopped after QA.

Independent source review found two bounded stale-response races (late terminal GET clearing another pending pointer; provider response body arriving after abort). Both were fixed, covered by GUIDE-20/21 in both browser projects, and independently re-reviewed **GO**. That review is source/UI evidence, not approval to activate provider execution.

Final copy cleanup replaced the historical perk sentence/label at the guide approval step with explicit one-guide/one-save scope. The focused approval test then passed **2/2** (mobile + desktop, 8.8 seconds). `git diff --check` was clean. These checks do not authorize production provider activation.

Reviewed screenshots (local QA artifacts):

- `/tmp/ktour-guide-access-final-20260929/tests-e2e-ktour-guide-main-86b44-arate-from-identity-consent-mobile-chromium/guide-access-ja-320.png`
- `/tmp/ktour-guide-access-final-20260929/tests-e2e-ktour-guide-main-5405c-k-approval-or-sample-signer-desktop-chromium/guide-identity-ja.png`
- `/tmp/ktour-guide-access-final-20260929/tests-e2e-ktour-guide-main-2f930-with-pending-audit-distinct-mobile-chromium/guide-pass-ja.png`

## Dedicated guide artifact: legacy-entry exclusion

The dedicated `NEXT_PUBLIC_HK_GUIDE_PRODUCTION=1` artifact now excludes the historical venue CTA, menu shortcut, direct convenience helper, forged legacy open events and persisted v1 resume. The same canonical venue with an explicit `source: "guide"` still opens the real readiness boundary; an old pending pointer is neither deleted nor upgraded to a guide result. A second render guard prevents a legacy journey from mounting in the guide profile. With the guide flag off, the existing hosted CX/Sui entry behavior is unchanged. These guards do not weaken the global review/sample permission boundary.

`tests/hackathon/guide-ui-campaign-profile.test.ts` exercises the real module in two fresh, credential-free processes: **2/2 passing**, both guide-only exclusion and preserved hosted behavior.

The actual production artifact was compiled with `node scripts/hackathon-guide-build.mjs` (**build and TypeScript passed**) and served by `next start` on local port 3172 using only that builder's positive-allowlisted environment, with `HK_GUIDE_PRODUCTION_ENABLED=0`. `tests/e2e/ktour-guide-built-profile.spec.ts` then passed **6/6** on Japanese mobile 390px and desktop 1440px (32.2 seconds, one worker, zero retries). This suite uses the actual readiness response, not an API success fixture; every browser mutation and non-passive external request is blocked before forwarding. It asserts no attempted integration mutation, no generic operation/config reads from legacy shortcuts, and no page errors. It also confirms the free reader and unavailable-save return remain usable.

The first run passed five cases; one test helper waited on a paused map timeline indefinitely. The helper was corrected to await only the current modal's bounded entry animation, without disabling product motion, and all six cases were rerun. Both final screenshots were actually viewed: Japanese text, close button, continued-reading button and retry button are contained and readable. The sole local server was stopped after verification. This proves the built runtime-OFF boundaries, not live provider integration or activation. The build exercised exclusion even with the old demo-shortcut flag still set; the subsequent builder/preparer hardening additionally sets that flag to zero.

- Mobile: `/tmp/ktour-guide-built-profile-final-20260929/tests-e2e-ktour-guide-buil-93852-ue-and-menu-CTAs-are-absent-mobile-chromium/guide-built-runtime-off-ja.png`
- Desktop: `/tmp/ktour-guide-built-profile-final-20260929/tests-e2e-ktour-guide-buil-93852-ue-and-menu-CTAs-are-absent-desktop-chromium/guide-built-runtime-off-ja.png`
- Run JSON SHA256: `7a6af099e93a54152f5e689882b89701f7cac61b991fc63de181d45670ff0507` (Playwright's `artifacts/qa/playwright/results.json` at completion; the default report path may be replaced by later suites).

Independent source review: **GO**, no P0/P1 issues. Explicit guide access remains canonical-venue/readiness-bound; historical pending state is not promoted. This is not permission to enable providers.

## Deployed read-only acceptance (hosted profile)

`tests/e2e/ktour-guide-production-readonly.spec.ts` requires explicit `GUIDE_REMOTE_READ_ONLY=1` and a root-approved `PLAYWRIGHT_BASE_URL`. It uses a fresh browser, blocks every non-read HTTP request before forwarding, checks the real deployed guide/readiness/Pass paths, and does not synthesize successful provider results. It must pass on the built/deployed artifact separately from the intercepted fixtures.

The earlier main revision `62fc18843c935192905e004b65306d634fc5e125` passed **2/2** read-only checks on both its approved Preview and `https://ktour-id.vercel.app`. Production report: `/tmp/ktour-guide-production-62fc1884/report.json`, SHA256 `2fde20e4120936d93e1b102ac49c347cfe3898df075088f46325c7288bcf2717`. These deployed checks establish the free reader/unavailable-save/main Pass surfaces, **not the later access-profile changes**, which require a separate new-revision deployment check. The owner checklist's main Roba URL and local `scripts/capture-integration-owner-inputs.mjs` path were rechecked in source; neither was changed by this UI work.
