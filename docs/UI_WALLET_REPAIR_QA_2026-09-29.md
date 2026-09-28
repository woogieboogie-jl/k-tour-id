# Wallet and guide repair QA — 2026-09-29

Scope: user screenshot items **4 and 6**. This report does not claim a deployment
or external integration success.

## Repairs

- Desktop Travel Pass title and card form one independent stack; wallet content
  no longer determines the vertical position of the pass.
- Desktop heading size is bounded. Wallet cards follow their DOM order and fit
  the available column rather than inheriting page-wide grid positioning.
- The guide sheet has consistent full-width, wrapping buttons with minimum
  48px heights. Narrow screens and enlarged Japanese text remain scrollable.
- Repetitive Demo header badges and generic sample-app prose become a neutral
  guide entry. Connection details still disclose that practice payments create
  no orders/funds and identity/chain results belong to their respective flows.
- Illustrative wallet balances explicitly remain non-monetary. No provider,
  credential, account authority, signing, or payment state was changed.

Source: `67452f44`; legacy copy assertions: `ff57fcb4`; settled-layout test:
`9f1101ec`.

## Executed verification

Single combined, warmed local server: `http://127.0.0.1:3166`, map QA worktree at
`a07da3d4`, which contains the wallet source and current map/place repairs.
Browser routing blocked all mutations and external provider traffic.

| Check | Result |
| --- | --- |
| Identity / guide boundary source contracts | 7 / 7 passed |
| 320, 390, 1440, 1920px × KO, EN, JA × light, dark | 24 / 24 passed |
| 320 × 568px Japanese, 22px enlarged guide text, final action scroll/focus | 1 / 1 passed |
| Final browser matrix, one worker, no retries | **25 / 25 passed**, 1.6 minutes |

The initial matrix was 24/25: one EN desktop measurement caught the pass's
temporary 10px entry transform. The test now waits for fonts and finite pass
animations to complete before measuring settled geometry; animations remain
enabled and the original 36px maximum spacing assertion is unchanged. The
entire matrix was then rerun, not just the failed case.

Final captures: `/tmp/ktour-wallet-layout-final-20260929`.
Initial diagnostic captures: `/tmp/ktour-wallet-layout-20260929`.

## Adversarial review

- Prior independent source review by the place agent: GO for items 4 and 6.
- Fresh independent image review by `resume_place_release`: GO for Japanese
  desktop wallet, 320px guide, and enlarged-text scrolled disclosure. No overlap
  or clipping; buttons fit and the pass title/card form one stack.
- Own visual inspection also covered KO light phone, EN dark phone guide, and
  KO/JA dark desktop. These are rendered browser captures, not inferred layout.
- Local screenshots contain the Next development indicator. It is not product
  UI and must not appear in final film captures.

Final integrated typecheck/build, main merge, Production deployment, and film
review remain coordinated release tasks outside this scoped QA report.
