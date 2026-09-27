# zkLogin return/resume review — 2026-09-27

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

## Remaining development-server limitation

One cold Next dev run on `3137` passed only 3/5: immediate callback
`history.replaceState` raced App Router initialization, restoring the hash
or triggering `Router action dispatched before initialization`. The only
unexpected POST was Next's local stack-frame diagnostic, not a provider.
The previous dev run on `3112` passed, so dev behavior is intermittent.
The fixed production build did not reproduce it in 15 runs. No private Next
history-state workaround or network-guard weakening was introduced. This
dev-only issue remains open; use the built review server for handoff and
recheck it if the framework/runtime changes. Production passes do not erase
the retained dev failure log `artifacts/qa/zklogin-final-next.log`.
