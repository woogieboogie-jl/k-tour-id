# UI map work — paused at user's restart request

Do not resume until the user explicitly requests it. Nothing here is deployed.

## Worktree and commits

- Worktree: `.codex-worktrees/ui-map-20260929`
- Branch: `fix/ui-map-20260929`, base `7f138507`.
- Map source/test candidate: `ad685db4`.
- Place changes were cherry-picked only for integrated QA: `f10456cd` (original `7afb79bc`) and `49b8408f` (original `3e3588db`). Root should pick the originals, not duplicate these cherry-picks.
- This pause checkpoint adds the map camera left/right dock follow-up, corrected local QA profile assertion, selected-place After19 regression, and this record.
- Wallet `67452f44` is NOT cherry-picked here. Do not assume its new product-guide selector exists until integration.

## Implemented, not browser-approved

1. Desktop map header centered at 600 px; discovery dock centered at 720 px with horizontal story controls. Short/wide layouts retain separate header and story lanes.
2. Camera fit detects actual left/right dock geometry; a centered dock reserves bottom space. Right-side landscape correction incorporates independent wallet-agent review.
3. After19 badge is contained inside its options button, with a 68 px active target rather than an absolute dangling label.
4. Map ambience control removed. Decorative geographic halos now play one finite, staggered 4.2-second sequence, settle by a 4.8-second timer, respect reduced motion/visibility, and do not imply live visits.
5. Nine targeted UI cases cover After19 search, badge bounds/hit targets, desktop centering, short/wide layout, selected-place search, and finite/reduced entrance motion.

## Verification status (precise)

- `git diff --check`: passed before checkpoint.
- Static Playwright contracts: **16/16 passed** (`ondo-nation-ambience.spec.ts`, `ondo-temperature-timeline.spec.ts`), artifacts `/tmp/ktour-map-contracts`.
- Independent source review of `ad685db4`: GO from wallet agent, with right-dock camera improvement incorporated afterward. Not equivalent to visual/browser approval.
- Typecheck: started, then interrupted during earlier host-load serialization; **NOT passed**.
- Initial port3162 tests: invalid target. Port3162 was an older release worktree server (PID59986), not this worktree. Left it untouched.
- First3166 test precondition incorrectly expected503; actual credential-free `hackathon-local.mjs` runner returns200 with `isolatedMock:true`. Corrected test to require local127.0.0.1:3166, exact isolatedMock profile, and block all mutations. Precondition-only failures are not runtime UI evidence.
- Corrected nine-case run `/tmp/ktour-map-polish-3166-valid`: **0 passed; 1 failed; 1 interrupted; 7 not run** at user pause.
  - 320/KO/dark reached After19 active, verified contained badge bounds, then timed out at `locator.evaluate` hit-target check of options after90seconds. Trace/screenshot retained; cause still needs investigation. Host was heavily loaded but that is NOT a proven explanation.
  - 390/JA/light was interrupted while waiting for map readiness; map changed loading→error. Need inspect network/WebGL error on resume.
  - Remaining desktop layout, selected-place search, finite animation cases did not run.
- No new identity approval, provider mutation, chain write, deployment, or main-branch change.

## Processes and resume sequence

- Own runner was `node scripts/hackathon-local.mjs dev 3166`, parentPID54721, NextPID54732; stopped withSIGINT at pause.
- Own valid testPID58289 stopped withSIGINT. No further tests or wallet cherry-pick started.
- Existing unrelated3162 release server was not stopped.
- On resume verify port3166 is free and server cwd matches this worktree. Warm `/` before tests (first compile took about2minutes under load).
- Investigate first corrected test timeout with retained trace, do not simply increase timeout or report pass.
- Finish nine browser cases, mobile-touch variants, screenshots, and typecheck serially. Then freeze source and coordinate wallet-agent reuse of this warm server for its25cases. Root owns final release/main integration and deployment.
