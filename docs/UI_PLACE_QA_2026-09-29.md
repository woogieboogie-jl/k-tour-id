# Place UI repair: verified handoff

## Scope

- Item 1: expanding temperature does not overlap later rows.
- Item 2: canonical, editorial, and researched story places share their downstream action component while retaining capabilities and exact return context.
- Item 9: compact place previews do not block map search; expanded details remain modal.

Original implementation commits: `7afb79bc`, `3e3588db`.

## Additional defects found by adversarial integration

1. **Capability hydration could repurpose a details button as payment.** The recorded trace resolved `canonical-place-details` before hydration, but that same unkeyed button became `peek-place-service` at click time. `43ffe7ab` gives service/details/directions stable keyed identities. A deterministic regression holds the original details DOM node across a review-mode change and confirms it remains the details button and opens details, not checkout.
2. **Moving researched payment from footer to body lost exact return-focus identity.** The existing commerce exit coordinator requires `data-service-place-id` on the opener button. The shared body button lacked that attribute, so the retained-exit fallback could not locate its replacement. Final `592bb1c1` restores the attribute on offer/reservation buttons and reuses the existing coordinator. An intermediate observer approach in `89abf0dc` is fully removed by `592bb1c1`; do not deploy the intermediate alone.
3. **A legacy scroll baseline assumed a fixed footer.** The test now brings the relocated body action into view before recording the real click position. The strict exact scroll/disclosure/focus assertions remain intact. The added regression starts a newer keyboard task and checks old return work cannot reclaim its focus.

Final correction sequence from `3e3588db`: `43ffe7ab`, `89abf0dc`, `2444be49`, `592bb1c1`. Net research-panel runtime code after those last three commits has no new observer or timer.

## Browser evidence

Single shared, combined Next origin: `http://127.0.0.1:3166`. No competing cold compiler/browser; one worker and zero retries. UI-only checks; no identity approval, provider mutation, or chain transaction.

- Saved original unique place cases: 18 passed before restart.
- Remaining mobile Japanese editorial/search and shared-source cases: 2 passed after correction.
- Remaining desktop English/Japanese editorial/search and shared-source cases: 4 passed.
- New capability hydration regression: mobile + desktop, 2 passed.
- Therefore the original 24-case place matrix plus 2 hydration cases are covered across saved/resumed runs; this is not a claim of one fresh 26-case run on the final SHA.
- Final integrated legacy subset: **14/14 passed** on shared QA HEAD `4248af8d` in 1.2 minutes. Includes four 320px research return cases, two newer-keyboard-task cases, two inclusive place-modal cases, and six desktop/mobile resize/navigation cases.

Artifact directories:

- `/tmp/ktour-place-pending-mobile-final-20260929`
- `/tmp/ktour-place-pending-desktop-final-20260929`
- `/tmp/ktour-place-final14-20260929`

Failed intermediate runs were inspected and corrected, not waived:

- `/tmp/ktour-place-pending-mobile-20260929`: 1/2 pass, proved details-to-payment hydration defect.
- `/tmp/ktour-place-legacy-final-20260929`: 8/12 pass, exposed exact research return-focus contract loss.
- `/tmp/ktour-place-legacy-repaired-20260929`: original 12 pass; two newly added tests failed because their 420ms transient-inert assumption was nondeterministic. Final tests assert the actual newer-task focus contract instead.

## Independent review

- Map agent independently reviewed stable action keys and final two-attribute focus correction: GO.
- Earlier place implementation independently reviewed by map/wallet agents: GO.
- Japanese researched-place screenshot inspected: source context, shared service row, and map/directions footer are coherent with no overlap.
- Place agent independently inspected wallet Japanese desktop, 320px guide, and enlarged-text images: GO for items 4/6 layout.

Remaining release work is root-owned final integrated build, main/release push, scoped deployment, and read-only Production checks. This file does not claim those happened.
