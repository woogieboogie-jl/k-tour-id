# zkLogin return/resume review — 2026-09-27

Follow-up updated 2026-09-28: the dev watcher/callback fixes and the new local
production seven-case rerun are complete. Public deployment remains `a037f9f`.

## Boundary

The callback is a browser binding step, not a verifier. Google returns an
`id_token` in the fragment; the callback checks the pending operation's
one-time OAuth `state`, moves the token to per-tab `sessionStorage`, scrubs the
URL, and returns to the same venue. Server `/zklogin/prove`, the configured
proof provider, and Sui signature validation retain their respective authority
for issuer/audience/expiry, nonce-bound proof inputs, salt and the Sui address.
This callback does not independently validate a Google signature or ZK proof.

The ephemeral signer, randomness, nonce, and OAuth state are per-operation
`sessionStorage` records. No JWT, proof, approval, account, or transaction is
stored in `localStorage`, URL query, or `postMessage`. A cancellation or
malformed return clears only the one-time OAuth correlation state; the
ephemeral signer remains available for an explicitly started retry.

## Return matrix

| Situation | Browser result | Authority effect |
| --- | --- | --- |
| Matching state and compact JWT shape | Store token in the current tab and return to the pending venue | No proof or approval is created; the user must explicitly continue |
| Provider cancellation | Localized stopped state and same-place return link | No API mutation |
| Wrong/missing state, malformed token, no signer, other tab | Localized stopped state; same-place link only if a fresh local pending operation exists, otherwise map return | No token storage or API mutation |
| Expired pending marker | Pending marker is removed and map return is offered | Server operation is not cancelled or changed |
| Readiness/CX preview | Return is rejected | External identity remains disabled |
| Terminal JWT/audience/issuer/expiry error from proof API | Discard this operation's rejected callback token; the next explicit click starts new OAuth | No automatic navigation, signature or approval |
| Provider/network failure | Retain the token for an explicit retry | No fabricated successful proof |
| Callback replay after reload | Scrub the URL and reject consumed state | No additional token acceptance or approval |

`returnContext` is restored by the map only when its venue, city, level, and
fresh pending operation match the requested venue. URL/session state is never
treated as entitlement authority.

## Known live prerequisite

The current deployment has no confirmed Google client, prover/salt, or live
zkLogin verifier configuration. Browser fixtures therefore test state binding,
URL scrubbing, safe resume, and the no-approval boundary only; they do not
claim a real Google login, JWT verification, proof, account derivation, or
transaction.

Focused local results: **4/4 unit fixtures** and **5/5 browser fixtures**.
Coordinator rerun on the actual isolated production build at `3137`:
**5 cases × 3 repeats = 15/15**; existing Harvey integration/preservation
fixtures also **34/34**. No actual OAuth/provider call occurred.
The terminal-token retry loop was found in coordinator adversarial review and
fixed before handoff. Other operations' stored state remains unchanged.

## Prior development-server failure (resolved below)

One cold Next dev run on `3137` passed only 3/5: immediate callback
`history.replaceState` raced App Router initialization, restoring the hash
or triggering `Router action dispatched before initialization`. The only
unexpected POST was Next's local stack-frame diagnostic, not a provider.
The previous dev run on `3112` passed, so dev behavior is intermittent.
The fixed production build did not reproduce it in 15 runs. No private Next
history-state workaround or network-guard weakening was introduced. The
follow-up below fixes the callback sequencing and separately isolates the
development harness rebuild loop. Later passes do not erase the retained
dev failure log `artifacts/qa/zklogin-final-next.log`.

## Follow-up adversarial callback review

The callback now schedules its router-aware URL scrub after parent effects and
performs an accepted return's token storage, one-time state consumption, and
place navigation only after that scrub succeeds. The accepted branch must not
rely on navigation completing to remove a fragment: a deliberately paused
same-origin destination now verifies the callback URL is already clean.
An asynchronous scrub/storage/navigation exception exposes the stopped UI; a
failed scrub does not first persist the accepted token or consume its state.
No private Next history fields are read or assigned, no verifier/state
acceptance checks were removed, and provider/network guards are unchanged.

The browser fixture now seeds pending state only once per tab so a full-page
return cannot silently recreate a consumed OAuth state. The existing accepted
case explicitly checks state consumption and waits for the map to consume its
resume query marker. Two new cases cover paused navigation and a one-shot
history-write error; the latter does not deliberately disable every subsequent
framework-owned history write.

Follow-up validation, before the coordinator's new production build:

- Focused OAuth/state/provider unit tests: **12/12 PASS**; TypeScript PASS.
- Two new security browser cases × three repeats: **6/6 PASS**, no retries.
- Before the watcher fix, seven-case suite × three repeats on webpack dev:
  **16/21 PASS, 5 FAIL**, no retries; not an all-green result. Failures include
  hydration `Invalid or unexpected token`, a Next diagnostic request rejected
  by the unchanged network guard, and one resume navigation timeout.
- Failure evidence remains at `artifacts/qa/zklogin-seven-final-dev/`; earlier
  investigation artifacts were retained rather than overwritten.

## Development QA watcher fix and controlled A/B

The remaining dev failure was reproducibly caused by QA files triggering
webpack rebuilds, not by a missing OAuth prerequisite or a required exception
to the provider/network guard:

1. `app/globals.css` imports Tailwind. Installed Tailwind 4.1.12's scanner
   respects `.gitignore` for content files but still emits an `artifacts`
   directory dependency. Next 16.2.6's PostCSS loader converts that dependency
   into `addContextDependency(message.dir)` without its glob filter.
2. Next's default watcher ignores `.git`, `.next`, and `node_modules`, not the
   generated `artifacts/qa` subtree. Recording video/trace under that subtree
   caused repeated layout/chunk invalidation while a callback was hydrating.
   Traces showed 45–65 rebuilds in roughly eight seconds; one run also logged
   `Unexpected end of JSON input` while reading a generated Next manifest.
3. Controlled A/B retained the same Node 25 runtime, callback source, seven
   cases, unchanged HarveyFixture, video recording, and no retries. In-repo
   output failed 5/21; changing only the output directory to
   `/tmp/ktour-zklogin-dev-results.w6LZR3` passed **21/21**. A separate unchanged
   fixture run without artifact writers passed **20/20**.

`next.config.mjs` now adds an exclusion for this app's exact `artifacts/qa`
subtree **only when webpack is running in development**. The helper preserves
existing exclusions, flags, string/array schema, and other watcher options.
Production webpack settings are returned unchanged; source directories and
similarly named sibling directories are not ignored. Literal checkout glob
characters and Windows separators have focused tests against the installed
Watchpack parser. No fixture/request guard was relaxed.

- Watcher contracts: **6/6 PASS**; existing CI launcher contracts: **5/5 PASS**.
- Original seven cases × three repeats, output back inside the repo, default
  trace/video recording, Node 25: **21/21 PASS**, no retries (**52.0s**).
  Output: `artifacts/qa/zklogin-watch-fixed-dev/`.
- Final helper revision on isolated Node **24.21.0**, both server and runner,
  seven cases × three repeats with `--trace=on` and in-repo output:
  **21/21 PASS**, no retries (**47.2s**); all **21 trace archives** retained in
  `artifacts/qa/zklogin-watch-fixed-node24-dev/`. Watcher contracts also pass
  **6/6** on Node 24. No system/global Node installation was changed.

The owned `3151` dev server was stopped after verification. The `3139` review
server and its production build were not modified by this callback audit.

## Final fixed production rerun — 2026-09-28

The coordinator rebuilt the actual isolated Harvey-enabled local production
profile (`HK=1`) and ran the updated seven cases three times at `3139`:
**21/21 PASS**, no retries, **14.1s**. This extends the earlier five-case result;
it is not a claim that the public `a037f9f` deployment changed.

The first rerun mistakenly used the Sumsub-only/HK-disabled profile (**9/21**);
that profile intentionally disables pending Harvey state, and verification was
completed on the correct newly built profile instead of changing its guard.

Evidence: `/tmp/ktour-autonomous-final-zklogin-hk.log` and
`artifacts/qa/zklogin-autonomous-final-hk/`. The coordinator also reran the
updated release contracts: **970/970 PASS**. The callback contract checks both
preview guards schedule scrubbing before pending-state access.

The new Harvey-enabled production build also passed the existing integration
and preservation browser suite **34/34** in **1.4 minutes**, with fixture API
responses. This is a new rerun, separate from the historical 34/34 above.

These browser cases remain local fixtures, not real Google login, JWT/proof
verification, account derivation, user signature, approval, or transaction.
