# Journey stamps × Travel Pass — local review

Status: local implementation only. No commit, push, or deployment. Production and Harvey's published handoff are unchanged.

## Product change

- Travel Pass owns one compact stamp card immediately below the pass. The public profile no longer duplicates it.
- Canonical place details offer an optional visit action independently of checkout.
- A completed payment has only an optional entry to that same visit action. Payment, funding, saved places, and reading/saving guides do not award stamps.
- The collection shows place, date, and existing category imagery marked as an illustration; it does not pretend to contain travelers' photos. A row returns to the same canonical place.
- At ten distinct places, an optional focused keepsake screen reuses the existing signer, consent, Person gate, and one-shot execution. No general Labs/bridge detour and no automatic mint or new discount promise.
- The unrelated 64px Tables header decoration was removed because it resembled progress.

## Representative journeys

1. Guest → Pass → empty stamp card → explore map, without identity onboarding.
2. Place detail → visit sheet → explicit sample visit → same place, or collection → place.
3. Payment receipt → optional visit sheet → cancel or record → same receipt. Paying alone does not change stamps.
4. Pass → collection → ten-place keepsake → separate consent/required checks → sample result → original collection. Declining or cancelling leaves the visit count unchanged.

## Boundaries retained

Stamps still belong to the existing activity provider. This is not a new credential, payment entitlement, merchant benefit, verified physical visit, or separate rewards backend.

Sample visits remain session-memory only and reset on reload, stated in the UI. Regular mode (`?review=0`) shows unavailable information, not an active collecting quest. Stored counts/receipts cannot assert verified activity. The live review opt-in is rechecked at mutation time, including delayed callbacks.

One canonical place ID produces one stamp. New presentation does not add KYC to viewing or recording samples. The optional keepsake retains its original checks and explicit consent. Provider integration and durable verified history remain separate backend work, not additions to the hackathon's mandatory scope.

## Interaction details

- Collection, visit, and keepsake use shared modal isolation, keyboard escape/back controls, retained exits, and opener-focus restoration.
- The visit sheet is portaled to the app canvas, outside the underlying place/receipt scroll container. Saving cannot scroll or clip its header; the completed action transfers keyboard focus to the return button.
- Settled receipt/visit/collection/keepsake priorities are 139/140/141/142; protected action gates retain 160. Paint and logical ownership agree.
- Cancelling a visit before its delayed commit prevents accrual. Cancelling keepsake preparation abandons only that pending action and prevents a delayed result.
- EN/KO/JA, light/dark, narrow mobile and desktop are in the local acceptance suite.

## Local verification

Run the app at `http://127.0.0.1:3112/?review=1`; no production URL is changed. Open the bottom Pass/wallet tab, or open a map place's details and select Journey stamps. Local branch: `local/journey-pass-20260916` in `.codex-worktrees/ux-refinement-20260915`.

To restart the local review server, run `pnpm build:vercel:ondo-b` from that worktree's `k-tour-id-app`, then run `../node_modules/.bin/next start -H 127.0.0.1 -p 3112` from `.ondo-b-standalone`. Despite the build command's name, it only builds and scans locally; it does not deploy.

### Prior Journey-only acceptance — local artifact `page-073dddfa315a0782.js`

The following evidence belongs to the earlier Journey-only build, not the later mobile refinements. See the [mobile follow-up](./KTOUR_MOBILE_REFINEMENT_LOCAL_2026-09-16.md) for its separately recorded artifact, results, and remaining limits. M12 makes normal mode unavailable-first; M13 exposes the unchanged reload-reset lifetime as a readable separate line; R8 matches the focused keepsake body/header to the shared sheet surface. None makes sample visits durable or verified.

- Local production build and standalone artifact scanner: pass.
- TypeScript typecheck and `git diff --check`: pass.
- Six targeted contract suites (activity milestones, modal isolation, shared sheets, retained exits, public Labs samples, and action gates): **38 passed**.
- `tests/e2e/ktour-journey-pass.spec.ts`: **24 passed** across mobile and desktop projects (18 mobile-project cases plus 6 desktop cases; viewport-specific skips are not counted as passes). EN/KO/JA × light/dark × 320/390/1440 widths, plus six adverse-workflow tests. No failures or flaky retries.
- `tests/e2e/ktour-journey-keepsake-completion.spec.ts`: **2 passed**, EN/KO. Public controls reach ten stamps → explicit consent → existing Person sample gate → simulated keepsake → original collection, with exact opener focus restored.
- The tests cover cancellation before visit commit, duplicate visits, live review opt-out, forged stored activity in normal mode, tab preservation/reload reset, payment not awarding stamps, receipt return, and keepsake refusal/cancellation.
- A separate visual pass checked mobile Pass, collection, saved visit and keepsake success; dark 320px and desktop layouts were also inspected. Saved visit header/footer bounds and clickability are asserted without auto-scrolling across the layout matrix, including a dedicated 320×540 interaction case. Eight Tab cycles stayed within the portaled visit dialog.
- No identity/payment/wallet/chain provider calls or external mutations were observed in the guarded browser journeys. Ordinary map/font fetching remains possible. These are Chromium viewport tests, not physical-device or backend-integration certification.

Reproducible browser evidence is under `k-tour-id-app/artifacts/qa/journey-pass-portal-final-mobile`, `journey-pass-portal-final-desktop`, and `journey-keepsake-final`; the corresponding `*-results.json` files record the layout-suite counts. Human-review screenshots are in `artifacts/qa/journey-pass-preview`. Artifacts are local QA output, not new public assets.
