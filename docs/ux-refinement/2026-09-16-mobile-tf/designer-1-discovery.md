# Designer 1 · Discovery, information hierarchy, and return paths

2026-09-16 · Stage 1 census and Stage 2 targeted mobile review complete. **53 fresh screenshot/metric pairs; not 53 passed screens. Cross-review notes below.**

Scope: shared shell/navigation; nation/city map, search, filters and list; optional onboarding; temperature and city guides; official/editorial/research places and facts; directions; public neighborhood-guide reading; map and exact-place After 19. Downstream account, contribution, Tables, transactions, guide-save execution, and stamps belong to the other reviewers; their entry/return boundaries remain here.

No application source changes, build, commit, push, or deployment were made. The source census preceded browser work. Earlier Journey tests and historical signoffs are not fresh whole-app review evidence. Stage 2 used the coordinator-frozen corner-fixed artifact; the preceding pre-fix corner reproduction is separately scoped below.

## Basis and counting rules

Read the current [UX standard](../../toss-grade-ux/00_UX_STANDARD.md), [preservation ledger](../../toss-grade-ux/00_PRD_PRESERVATION_LEDGER.md), [visual standard](../2026-09-15/visual-standard.md), [code sitemap](../2026-09-15/sitemap-code.md), [browser sitemap](../2026-09-15/sitemap-browser.md), and FL-001/002/007/008/009/013/014/016. Their target designs are acceptance references, not proof of present implementation. Current K-Tour ID branding supersedes old ONDO consumer-brand instructions.

The product has one public application URL `/`, with internal tabs and URL/history discovery context. The 53 numbered rows below are review obligations grouped by surface/state, **not 53 URLs, unique screens, completed flows, or passed tests**. Each listed substate must receive its own observed/unobserved result. `/ondo-b` redirect and blocked legacy routes are coordinator boundary checks, not additional consumer pages.

Reachability notation:

- **P**: ordinary public action / local browser state, including `review=0`.
- **S**: publicly selectable sample environment (`review=1` or sample-build default); still not live provider activity.
- **E**: environment/clock/storage/network fault or boundary, without injecting positive authority.
- **Q**: authoring-QA-only state; must not be counted as publicly reached on a QA-disabled standalone artifact.
- **R**: requirement or contract to reconcile, not a presently demonstrated screen.

Selectors below mean `data-testid` unless written as CSS. Missing test IDs are explicitly represented by semantic/data-attribute selectors; none are invented. Every Stage 2 observation needs fresh artifact hash, route/action, locale/theme/viewport, screenshot, computed font/line-height/insets/control heights, and terminal/return result.

## Enumerated surface and state inventory

### Shared shell and global presentation

| ID | Surface / entry selector | States and flow obligations | Reach / return |
|---|---|---|---|
| D1-01 | App bootstrap: `ondo-b-root`, `ondo-canvas`, `ondo-scroll-region` | Unhydrated/inert → ready; fresh nation versus restored city/place; language and appearance applied; no blank joining frame | P/E; same public location, no mandatory onboarding or gate |
| D1-02 | Five-tab shell: `ondo-main-nav`; `nav-ondo`, `nav-my`, `nav-tables`, `nav-id`, `nav-settings` | Mobile icon-only labels, selected state, dock/safe area; desktop rail; per-tab scroll; hidden Explore panel remains mounted and inert; unsuccessful tab switch status | P/E; each tab → Explore retains map/search/selection; inner tab screens delegated |
| D1-03 | Shared SheetB: `ondo-sheet`, `[data-sheet-layer]`, `[data-sheet-header]`, `[data-sheet-scroll-owner]`, `[data-sheet-footer]` | Peek/decision/detail/full-task; header/no header; footer/no footer; close/back/none; opening/open/retained closing; suspended parent/nested task; keyboard/visual viewport | P; topmost-only input, one scroll owner, no background scroll, Escape/Back/close and opener restoration; corner paint checked separately from geometry |
| D1-04 | Transient shell messages: `ondo-toast`; skip link to `#ondo-main-nav` | Toast visible/expiry, navigation error; skip-nav focus; no obstruction of primary controls | P/E; status does not create a route or reset discovery |
| D1-05 | Sample explanation: `review-sample-indicator` → labeled `ondo-sheet` | Compact peek; identity/balance/payment sample disclosure; integration details expanded; exit sample | S → P; `review=0` retains product location and removes sample authority; no live check/charge |
| D1-06 | Sample explanation handoffs: `integration-demo-open`, `reservation-demo-open`, semantic “What your pass unlocks” button | Explanation closes before replacement task; no invisible competing modal; same locale/theme | S; coordinator/D3 own destination and terminal; D1 checks initial transition and return shell |

### Optional discovery setup

| ID | Surface / entry selector | States and flow obligations | Reach / return |
|---|---|---|---|
| D1-07 | Setup entry: nation `ondo-b-personalization-edit` or city `ondo-b-map-options-preferences` → Settings `ondo-b-discovery-settings` → `ondo-b-onboarding-reset` | Actual flow goes through Settings/preferences, not directly to a first-run wizard; no sheet on `ONB-NEW`; existing values loaded | P; D2 owns preferences editor; restart begins explicit `ONB-IN-PROGRESS` |
| D1-08 | Intent: `ondo-onboarding-backdrop`, `onboarding-step-intent`; `persona-short_trip`, `persona-nearby`, `persona-living` | No selection/selected; localized question, three equal choices; disabled/enabled primary; locale buttons in header; close/skip | P; no Account/Person/Age/Payment/K-Tour state inferred from intent |
| D1-09 | Starting area: `onboarding-step-area`; `onboarding-area-seoul/busan/jeju`; `onboarding-continue` | Area unset/chosen; current code shows this step for all intents; short trip permits unset, nearby/living require a choice; actual city preview | P; Back preserves draft; no automatic geolocation permission |
| D1-10 | Preferences: `onboarding-step-preferences`, `onboarding-preference-classic/cafe`, `onboarding-dietary-disclosure` | Selected/unselected food; dietary collapsed/expanded with vegetarian/vegan/halal/allergy_aware; no unsupported legacy mood controls assumed | P; changing preferences must not manufacture heat, dietary support or eligibility |
| D1-11 | Finish/save error: `onboarding-finish`, `onboarding-save-status`, `onboarding-guest-skip` | Successful commit/failed storage/retry/skip; retained exit prevents repeated action; exact focus after exit | P/E; selected area success, prior saved preferences on cancel; measure exact camera/query/list restoration instead of assuming it |
| D1-12 | Back/cancel/restart loop: `[data-sheet-navigation='back']`, `[data-sheet-navigation='close']`, `onboarding-guest-skip` | Preferences → area → intent; close from first step; skip at each step; dirty versus prior saved values; short height | P/E; no identity call, no implicit save on cancel; original Settings/Explore context explicitly measured |

### Nation, city, search, filters, and list

| ID | Surface / entry selector | States and flow obligations | Reach / return |
|---|---|---|---|
| D1-13 | Nation: `ondo-b-nation`, `ondo-b-korea-atlas`, `[data-city='seoul/busan/jeju']` inside nation | Loading/ready/fallback; three geographic anchors and distinct official/editorial truth; selected/departing; light/dark; long labels | P/E; tap → same `maplibre-map` instance city; city Back returns chosen beacon focus |
| D1-14 | Nation ambience/personalization: `ondo-b-atlas-motion`, `ondo-b-preference-summary` | Review ambience playing/paused/hidden with reduced motion; active tastes versus empty preferences; no hidden motion-control focus target | P/S; preferences entry → Settings, map remains usable |
| D1-15 | City map: `ondo-b-map-entry`, `maplibre-map`, `ondo-b-city-header`, `ondo-b-city-back` | Seoul/Busan/Jeju; entry active/settled; measuring/ultra-short/compact/spacious layout; map/list foreground; basic versus prepared-sample heat | P/S/E; nation/city back-forward/deep link/reload; retain query/category/camera/selection |
| D1-16 | Search: `ondo-b-search-shell`, `ondo-b-search`; semantic clear button | Empty/typed/cleared; Korean/English/Japanese aliases and district/category query; long 120-character boundary; IME/keyboard viewport; zero results | P; no autofocus on entry; query preserved through list/place/directions/return |
| D1-17 | Categories: mobile `ondo-b-map-options-categories [data-category]`; desktop `ondo-b-category-rail [data-category]` / `[data-editorial-category]` | Official all/korean/casual/japanese/chinese/global/night/specialty as actually rendered; Jeju all/screen-location/food/market/culture-shopping; selected/empty; night locked | P; list/map parity, clear conditions, same context after closing sheet |
| D1-18 | Map options: `ondo-b-map-options-open` → `ondo-b-map-options`, `ondo-b-map-options-done` | Decision sheet; category rows; result total; perspective row conditionally available; privacy disclosure; language cycling; preferences/guide/sample handoffs | P/S; Done/close/Escape returns original Options control; intentional nonmodal guide handoff owns focus |
| D1-19 | Map perspective: `ondo-b-map-perspective` or `ondo-b-map-options-perspective` | 2D/2.5D; unavailable while loading/fallback/entry animation; map camera bounds and selection | P; toggling does not change city/query/results; no transform-based target drift |
| D1-20 | Geolocation/privacy: `ondo-b-map-options-locate` / `ondo-b-locate`, `ondo-b-map-options-location-privacy`, `ondo-b-location-message/details/announcement` | Idle → locating → ready; denied/unsupported/timeout; retry; stale callback after city change; privacy expanded; `ondo-b-user-location-marker` | P/E; explicit action only, search/list remains usable; permission unavailable is not fatal |
| D1-21 | Loading/offline/recovery: `ondo-b-map-loading`, `ondo-b-map-transport-status`, `ondo-b-map-fallback-status`, `ondo-b-map-retry-status` | Quiet <800ms; progress; 5s list recovery; partial tile failure; offline; failed retry/successful retry; fallback list becomes user-owned | E (Q alternative); no empty map replaces accessible results, retry preserves current search/filter/selection |
| D1-22 | Map/list switch and result state: `ondo-b-view-toggle`, `ondo-b-result-bar`, `ondo-b-result-truth`, `ondo-b-effective-view-label`, `ondo-b-list-panel` | Map/list/forced list; result count; list scroll; map accessible marker descriptions; switch while selection/loading | P/E; same IDs/order/filter/selection; scroll and focus restored |
| D1-23 | Official/Jeju lists: `ondo-b-venue-list`, `[data-venue-opener]`; `ondo-b-editorial-place-list`, `[data-editorial-place-opener]`; `ondo-b-empty-results` | Populated; load 30 more; filtered empty; selected row; official names/transliteration; source class; illustration/photo pending/loaded/error/not-provided | P/E; row → correct peek → same row and scroll; clear action has accurate scope |
| D1-24 | Map balance entry/filter: `map-balance-places-filter`; balance entry from `MapBalanceEntryB` | Sample empty/funded balance display; wallet jump; supported-place filter on/off; zero supported result; retain category/query distinction | S; D3 owns money; D1 verifies Wallet return and filter does not claim arbitrary merchant capabilities |

### Temperature, editorial guides, and research picks

| ID | Surface / entry selector | States and flow obligations | Reach / return |
|---|---|---|---|
| D1-25 | Temperature replay: `ondo-temperature-timeline`, `ondo-temperature-play`, labeled range input | Running/paused; scrubbing; forward/backward; reduced-motion stepping; city/night switch; prepared illustration truth | S; same current frame feeds map/place display; no live crowd/popularity claims |
| D1-26 | Sample activity overlay/meter: `sample-traveler-map-events`, `sample-traveler-contributions`, `sample-add-moment` | Appearing/paused/focused events; map-only enabled conditions; place meter; sample contribution handoff | S; markers still tappable; D2 owns contribution; no visit proof inferred from animation |
| D1-27 | Legend/method/source credits: `ondo-b-map-key`, `ondo-b-map-key-details`, `ondo-b-pulse-legend`, `ondo-b-pulse-methodology`, `ondo-b-pulse-production-drivers`, `ondo-b-map-credit-details` | Closed/open disclosures; Seoul/Busan curated versus Jeju editorial density; sample replay versus underlying fixed source; external credits | P/S; no numeric Jeju score; controls do not obscure search/dock/attribution |
| D1-28 | City guides: Options `ondo-b-map-options-stories` or `ondo-b-editorial-collection-marker` → `ondo-b-japan-first-discovery`, `ondo-b-editorial-guide-grid` | Seoul/Jeju only; map/list presentation; compact panel; lead/supporting stories; `[data-story-close]`; method disclosure | P; nonmodal details semantics are intentional, map inert while open; close/Escape returns guide opener |
| D1-29 | Story details/links: `[data-content-id]`, `ondo-b-japan-more-stories`, `ondo-b-story-sources-{id}`, `ondo-b-story-map-{id}`, `ondo-b-jeju-editorial-seeds` | Additional stories/source links expanded; mapped-place versus unlinked editorial content; image success/failure; Japanese hook in EN/KO | P/E; mapped Jeju story → exact place; unverified story never invents a pin; external source return intact |
| D1-30 | Research list/detail: `researched-food-list [data-research-id]` → `researched-food-detail` | Food/cafe/bar, district/search/category result; approved photograph versus category art/illustration; image failure; long title/body | P/S/E; SheetB detail; correct place, scroll, close and opener restoration |
| D1-31 | Research detail actions/disclosures: `research-on-map`, `research-directions`, `research-photo-credit`, `research-place-source` | Source/photo expanded; on-map switch; external directions; registered sample offer/reservation versus no service | P/S; on-map camera points at selected research place; D3 owns purchases and same-place receipt return |

### Official/editorial places, facts, and outbound actions

| ID | Surface / entry selector | States and flow obligations | Reach / return |
|---|---|---|---|
| D1-32 | Official peek: `[data-venue-opener]` / public `venueId` → `canonical-place-peek`, `canonical-place-details` | Curated signal/unknown/prepared meter; name provenance `canonical-name-provenance`; source summary; service-supported versus ordinary two-action footer | P/S; custom peek, not SheetB; close/Escape returns exact marker/list row |
| D1-33 | Official detail/data: `canonical-place-overlay`, `canonical-place-identity-stage`, `canonical-detail-name-provenance` | Detail idle/loading/ready/error; address unknown/error/retry; hero/name/source; retained close; long Korean official name + translation | P/E; error does not fabricate address or facts; detail Back → peek → same map/list |
| D1-34 | Official temperature: `canonical-place-pulse`, `canonical-place-temperature-meter`, `pulse-evidence`, `pulse-too-hot`, `pulse-alternative` | Collapsed/expanded; score/count/confidence when applicable, unknown/limited; local evidence; alternatives; prepared-sample replacement | P/S; alternative opens exact other place without implying official popularity; returning restores disclosure/section |
| D1-35 | Four fact rows: `canonical-place-details-to-check [data-fact-key='hours/card/menu/language']` | Each independent yes/no/conditional/unknown/loading/stale/error; unknown not positive; source class; 320px wrapping | P/E/Q; data-supported values are public; arbitrary authored combinations remain Q, not observed normal support |
| D1-36 | Fact drawer: `canonical-evidence-drawer`, `canonical-evidence-sheet`, `canonical-evidence-venue`, `canonical-evidence-retry` | Selected fact loading/result/unknown/stale/error; recoverable/nonrecoverable; source/freshness detail; configured retry only | P/E/Q; custom nested drawer, underlying detail loses dialog ownership; close restores same fact, scroll, focus |
| D1-37 | Source details: `canonical-place-source-summary`, `canonical-source-evidence`; editorial `editorial-place-source-summary` | Collapsed/expanded record scope/date; official directory versus editorial source; external evidence links | P; registration never implies hours/payment/safety/popularity; return same object |
| D1-38 | Place action boundary: `canonical-venue-save`, `canonical-save-error/retry`, `canonical-place-table`, `canonical-venue-tables`, `canonical-local-signal-open`, `canonical-journey-open` | Save unsaved/saved/failure; relevant Table versus browse Tables; contribution absent/posted; optional visit entry; gate cancel/result | P/S/E; D2/D3 own inner flows; D1 checks action hierarchy and exact selected place/section/scroll on return |
| D1-39 | Service capability boundary: `peek-place-service`, `place-service-actions`, `place-offer-open`, `place-reservation-open`, `[data-service-place-id]` | Registered commerce/reservation independently present; sample only; no inferred capability from photo/research/directory; review opt-out | S; capture map return before handoff; D3 owns consent/payment/reservation and receipt |
| D1-40 | Jeju editorial peek/detail: `ondo-b-editorial-place-peek`, `ondo-b-editorial-place-details`, `ondo-b-editorial-place-overlay` | Category-specific media; editorial-unscored temperature; saved/unsaved/save error; sources; food Table/browse action; close/detail→peek | P/S/E; exact `data-editorial-place-id`; score stays none, no official record inference; custom chrome |
| D1-41 | Outbound directions: `canonical-venue-directions`, `canonical-venue-primary-directions`, `ondo-b-editorial-place-directions`, `research-directions` | Correct geographic destination; new context; full accessible purpose; failure to open does not mutate app | P/E; inspect/intercept outbound navigation locally, no need to browse remote map; same place/snap/scroll/focus on return |

### After 19 — map declaration, review provenance, exact-place return

| ID | Surface / entry selector | States and flow obligations | Reach / return |
|---|---|---|---|
| D1-42 | Map night entry: `global-after19-toggle` → `global-after19-prompt-layer`, `global-after19-return-context` | Intro with city/venue anchor; disclosure; auto-open `role=switch`; primary/cancel/close; custom dialog, not SheetB | P; ordinary action is SELF_DECLARED/night_view_only, not protected Age verification |
| D1-43 | Declaration pending and cancellation: `global-after19-confirm`, `global-after19-status`, `global-after19-cancel/close` | Intro → pending → active; cancel before delayed completion; repeated click; retained closing; Escape and focus | P; cancel leaves prior lens unchanged and never grants protected age; exact context retained |
| D1-44 | Active map and manual off: `ondo-b-after19-global`, `global-after19-banner`, semantic off button; `global-after19-off-notice` | Manual/auto; city map/list/peek/detail; off → manual-off; undo/dismiss; category locked notice `ondo-b-map-options-after19`; no night results | P/E; same camera/query/selection; inspect ordinary restaurant preservation; off stays off for current session |
| D1-45 | Exact-place night entry: `canonical-after19-unlock`, `canonical-after19-access`, `global-after19-return-context` | Current UI says “Turn on After 19”, not proof issuance; place context intro/pending/cancel/active; missing/stale venue fallback; return token expired | P/E; same venue/detail section/disclosure/scroll and persistent focus target; no Table/payment guard bypass |
| D1-46 | Review result/provenance: `global-after19-review-scope`, `global-after19-review-toggle`, `global-after19-review-provenance`, `global-after19-review-close`, `global-after19-turn-off` | Review success; result details open/closed; SIMULATED fixture/expiry; turn off; never visually conflated with local declaration | Q for explicit `after19Global` runtime outcome; sample environment alone does not create that outcome |
| D1-47 | Night check failure/unavailable/expired result: `[data-gate-view='failure/unavailable/checkExpired/expired']`, `global-after19-retry/general` | Retryable fixture failure/check expiry; unavailable has general-map/place escape; expired return with/without review; pending cancellation | Q/E; require honest reachability label; no fabricated normal-provider success; preserve exact object |
| D1-48 | Automatic/expiry reevaluation: `ondo-b-after19-global` data mode/activation/age; `global-after19-expiry-notice` | Auto preference on/off; KST 19:00/midnight; valid/expired local declaration or review receipt; manual-off precedence; guest memory vs account session persistence; storage failure | P/E/Q; current implementation uses night-view receipt, not only protected Age. Reconcile FL-014 before grading; no separate success screen |
| D1-49 | Protected age boundary from alcohol Table: `canonical-after19-required` / `canonical-place-table` → downstream action gate | Local map declaration must not satisfy protected Age; ordinary unavailable/review-result/cancel/retry controlled by action coordinator | P/S; D2 Table and D3 action-gate owners; verify return to same Table/place, not GlobalAfter19 alone |

### Public neighborhood-guide reading and cross-flow restoration

| ID | Surface / entry selector | States and flow obligations | Reach / return |
|---|---|---|---|
| D1-50 | Registered Roba guide reader: full detail `experience-open` → `experience-public-guide`, `experience-public-heading`, `experience-guide-content` | Three free reading sections; no Account/Person/holder/IDB required just to read; long localized content; full-task scroll/footer | S in current implementation, although “public/free” means ungated within sample, not present in `review=0`; note this availability explicitly |
| D1-51 | Reader disclosure/close: `experience-public-details`, `experience-public-scenario`, Sheet close | Expanded boundary/scenario details; place-origin versus `experience-saved-guide` pass-origin; stored save resume versus fresh reader | S/E; close place-origin → same Roba; pass-origin → same pass row; only Add-to-pass starts save/gate flow |
| D1-52 | Optional guide save handoff: `experience-add-to-pass` → `experience-flow` | Explicit action enters coordinator-owned flow; gate cancellation/read-again returns free reader; blocked/failed save must not remove readable content | S/E; coordinator owns authorization/fulfillment/audit; D1 owns reader and return typography/context |
| D1-53 | Discovery return matrix: public `city/view/q/category/editorialCategory/venueId/editorialPlaceId/detail` URL + history state | Browser Back/Forward/reload; exact official/editorial/research place after child flow; original list scroll, camera, snap, expanded source, opener focus; invalid IDs safe fallback | P/S/E; count each origin/state separately; same venue alone is not proof of same detail/scroll restoration |

## Source anchors and important exclusions

- [Shell](../../../k-tour-id-app/features/ondo/app/ondo-app-b.tsx), [shared SheetB](../../../k-tour-id-app/features/ondo/shared/ui/sheet-b.tsx), [shared frame CSS](../../../k-tour-id-app/features/ondo/shared/ui/ui.module.css), and [modal isolation](../../../k-tour-id-app/features/ondo/shared/ui/use-modal-isolation.ts).
- [Map and list](../../../k-tour-id-app/features/ondo/map/map-entry-b.tsx), [map options](../../../k-tour-id-app/features/ondo/map/map-options-b.tsx), [discovery history](../../../k-tour-id-app/features/ondo/map/b-discovery-history.ts), [setup](../../../k-tour-id-app/features/ondo/onboarding/official-directory-onboarding.tsx).
- [City guides](../../../k-tour-id-app/features/ondo/map/japan-first-discovery-b.tsx), [research detail](../../../k-tour-id-app/features/ondo/map/researched-food-panel-b.tsx), [food media states](../../../k-tour-id-app/features/ondo/map/food-photo-b.tsx), [temperature replay](../../../k-tour-id-app/features/ondo/map/temperature-timeline-b.tsx).
- [Official place](../../../k-tour-id-app/features/ondo/place/canonical-place-overlay.tsx), [editorial place](../../../k-tour-id-app/features/ondo/place/editorial-place-overlay-b.tsx), [registered service entry](../../../k-tour-id-app/features/ondo/place/place-service-actions-b.tsx), [free reader/save separation](../../../k-tour-id-app/features/ondo/experience-b/experience-b.tsx).
- [Global night UI](../../../k-tour-id-app/features/ondo/after19/after19-global-b.tsx), [night truth model](../../../k-tour-id-app/features/ondo/after19/after19-global-b-model.ts), [place return token](../../../k-tour-id-app/features/ondo/after19/after19-place-return-b-model.ts), [sample versus QA controls](../../../k-tour-id-app/features/ondo/shared/ui/use-qa-controls.ts).
- `after19-jit-b.tsx` contains intro/review/failure/unsupported/expired screens, but no importing caller was found in the mounted source census. Do not count it as a public page without new runtime/source evidence. Historical A onboarding, legacy route screens, and arbitrary enum combinations are likewise excluded.
- Current fact implementation exposes hours/card/menu/language, not the six independent fact keys proposed in FL-016. Reservation/Table/age/service information is elsewhere. Evaluate completeness and naming without inventing extra drawer routes.
- Current setup is optional Settings restart, not initial mandatory setup; FL-007's two-decision target does not describe the current three-step short-trip flow. This is a design delta to review, not automatic proof of failure.

## Stage 2 review plan and concrete acceptance measurements

Start on the coordinator-frozen artifact, one browser worker only. Baseline: 390×844. Revisit high-risk surfaces at 320×568 and 320×540, 430×932, and short landscape. Use KO/EN/JA and light/dark as explicit evidence dimensions, not as an implied exhaustive Cartesian-product pass. Where the corner compositor depends on tablet/desktop, include 820px DPR2 and 1440px as targeted shared-component checks.

For each actual screen/state record:

1. Screenshot initial settled viewport and scrolled terminal content; open the image, not merely save it. Capture header, both corners, body, footer, backdrop and dock together.
2. Computed font-family/size/weight/line-height/letter-spacing for page/sheet heading, section title, body, metadata and primary/secondary actions. Reference: page 28–32px, section 20–22px, body 15–17px, metadata 12–14px. A smaller value is a review candidate, not an automatic defect if hierarchy and legibility justify it.
3. Measure canvas→sheet→content insets, heading-to-body and section gaps, nested footer padding, button heights, target separation, radius and internal scroll count. Reference: 16px at 320/360; 20px at 390/430; 44px targets, 52–56px primary; one shared header/body/footer owner. Inspect actual wrapping and density, not values alone.
4. Header/close and primary/footer must be inside viewport and hit-testable **without an auto-scroll click masking a defect**. Then perform the actual click. At 200% text size, all decision/error text remains available without ellipsis or fixed-height clipping.
5. Entry → choice → cancel, failure → retry, success → exact return: compare public context and actual focus/scroll. Capture focus after asynchronous result replaces the initiating control; Escape must still close only the top layer.
6. Record source/scope labels, empty/unknown states and recovery action. Normal `review=0` and sample results remain separate. No external mutation/provider request or positive-state injection establishes public reachability.

Initial source-only risks to adjudicate in the browser, not pre-labeled must-fix:

- Local per-flow typography and short-height rules vary materially (e.g. onboarding short-height primary can become 12px, map-options action text 14px), while the standard expects readable common hierarchy.
- Shared footer has padding and some callers add another padded wrapper; measure actual doubled inset/large gap rather than infer from CSS alone.
- Multiple custom chrome owners (official peek/detail, fact drawer, editorial peek/detail, GlobalAfter19) do not automatically receive SheetB paint fixes.
- Public night mode currently derives an `approved-night-subset` and locks categories; compare actual ordinary-night restaurant continuity against FL-013/014 before proposing changes.
- Auto-open currently accepts `isGlobalAfter19NightViewCurrent`, including bounded local declaration; FL-014's older protected-Age prerequisite differs. Protected-age evaluator separately rejects declaration. This is a contract/documentation reconciliation, not evidence of unauthorized protected access.
- Guide reader is account-free but sample-only, and its disclosure exposes save scenario controls. Evaluate consumer clarity without relabeling the current sample as a live service.

## Corner defect: independent evidence and robust regression strategy

Pre-fix artifact `page-073dddfa315a0782.js`, one browser with sequential 390×844 and 1440×1000 contexts, light and dark. Relevant evidence under app `artifacts/qa/journey-pass-preview/`: `corners-390-light.png`, `corners-390-dark.png`, `corners-1440-light.png`, `corners-1440-dark.png`, and corresponding `corner-top-left-*` crops. Desktop light crop visibly shows rectangular pale paint outside the intended 28px curve.

Computed pre-fix sheet: 28px top radii, overflow hidden, isolation isolate, solid surface; header: 0px radius, 96%-surface fill, `backdrop-filter: blur(18px)`. Mobile sheet rectangle was x0/y382.203125/w390/h461.796875; desktop x400/y478.609375/w640/h471.390625. Header inset was 1px. At visually defective points x+2/y+2 and right−3/y+2, `elementFromPoint` still returned the backdrop. Thus correct bounds, computed radius, overflow, and hit testing did **not** establish correct pixel clipping.

Regression should combine these independent layers:

- Approved focused corner image baselines (both top corners, and rounded bottom corners where present), 80–100 CSS px crops, light/dark and DPR1/DPR2, representative open/settled/retained-close frames. Include at least a real nested entry such as Your visit, an ordinary decision sheet, a detail sheet, and custom chrome representatives.
- A controlled backdrop-pair pixel test: on a deterministic, paused scene capture the open sheet, then hide only its painted panel while keeping the same backdrop and layout. Compare sample regions geometrically outside the rounded path but inside the panel rectangle. Exclude the antialias boundary and any explicitly expected shadow band; use the same scroll/camera/animation state. Unexpected positive/white paint in the cutout must fail. The coordinator's corner regression can provide the exact robust threshold after observing pre/post-fix images.
- Keep geometry/focus/overflow/hit assertions as interaction checks, but do not substitute them for the image assertion. Do not mask the corners out of a full screenshot diff or accept a newly generated baseline without visually opening it.

Why earlier QA missed it: the Journey suite asserted frame bounds, footer/header reachability, focus and contrast, and saved broad screenshots; it had no corner-specific paint oracle. Small compositor leakage can pass every DOM assertion and be overlooked in a full-page screenshot. Saved screenshots alone are not visual regression coverage. Prior pass counts remain valid only for their stated interaction assertions, not flawless shared-sheet rendering.

## Review results

### Fresh artifact and evidence boundaries

One Chromium browser/serial runner against `http://127.0.0.1:3112`; browser closed after **53 captures, zero recorded runtime/provider/mutation failures**. This is a capture count, not a functional test pass count. [Evidence index](../../../k-tour-id-app/artifacts/qa/mobile-tf/designer-1/observations.json); harness `tests/ux-audit/mobile-tf-designer-1.mjs`. Each PNG has a same-named JSON recording actual resource URLs, route/action, viewport, typography, controls, and dialogs. All 53 final images were personally opened during review.

JS: `page-073dddfa315a0782.js`. Loaded CSS identities: `3cc2d39ef965c086`, `dd4b1eafadcc4a57`, `72d168ad88e2d16e`, `7dbd4a2c6edd0562`, `9d5ea6ef31b0fbff`, `ce15fefc76f34fa3`, `b68a9705906c20a1`, `711f2fcb752b8f5a`, `ce346fc9cfd5749e`, `a03a339479bfc4b5`, `de9139a836ba2e9b`, `9a0b24010ebd928f`. These identify the CSS-only corner fix despite the unchanged page-JS identity.

Actual configurations: EN390×844 light; JA320×568 light; KO430×932 dark; JA320×540 dark; JA390×844 dark. Public normal `review=0` and public sample `review=1` were inspected separately. Language/theme/preferences were changed through public controls. No positive identity, payment, fact, or visit state was injected. Read-only GET failures were deliberately induced for `/api/ondo/venues/**` and OpenFreeMap tiles, then removed before UI retry. Location denied was the local browser permission result. External provider/mutation attempts were guarded; external map destinations were not visited.

Capture39 uses a **custom doubled computed-font/line-height text stress**, not native browser zoom or an actual assistive setting. It supports a narrow reader-layout observation only. Reduced motion was enabled throughout. Desktop/DPR2 corner regression belongs to the coordinator, not this mobile pass.

Harness navigation mistakes are not product defects: a second Escape sent during retained closing, an incorrect initial GET interception pattern, a strict summary selector, and expecting a Jeju story's “View on map” action to open a peek. Capture25's filename `editorial-peek` is misleading: the actual screenshot shows story→map focus, not a peek. Captures26a/26b are the real editorial peek/detail. Capture40 records initial map loading, not a settled-map pass. Hidden/clipped text can appear in computed-metric collections; conclusions below are based on personally viewed pixels as well as metrics.

### Prioritized findings

| ID / priority | Specific evidence | Required or recommended direction; preserved behavior |
|---|---|---|
| **D1-F01 · Must fix** — canonical Directions has an icon-sized box containing a full label | [EN390 facts](../../../k-tour-id-app/artifacts/qa/mobile-tf/designer-1/13-canonical-facts.png), [JA320 facts](../../../k-tour-id-app/artifacts/qa/mobile-tf/designer-1/34-normal-facts-ja320.png). `canonical-venue-primary-directions`: EN width50×height54, 13px label visibly overflows; JA width50×height56, label wraps into three lines (text height52), SVG shrinks to9.72px wide. CSS `canonical-place.module.css:1189` gives the second grid column and button50px. Root independently viewed both and confirmed. | Either give a labeled Directions action content-appropriate width, or use a genuinely icon-only44–52px action with a localized accessible name. Do not conceal the label with clipping/ellipsis. Recheck EN/KO/JA320/390, icon shrink, full label, hit area and exact destination/return. No route or service is removed. |
| **D1-F02 · Must fix** — dark map failure explanation has insufficient contrast | [JA390 dark tile-failure fallback](../../../k-tour-id-app/artifacts/qa/mobile-tf/designer-1/48-map-fallback-ja390-dark.png), JSON owner `ondo-b-map-fallback-status`: explanation12px/18.6px, `rgb(98,94,88)` on screenshot background `rgb(17,18,20)`, calculated **2.91:1**. The recovery button remains44px high and works; the explanation itself is hard to see. | Use a theme-aware status surface/text pair and readable recovery prose. Test forced tile failure in both appearance modes with the real panel pixels, then retry preserving the existing query. Secondary copy should distinguish the complete200-place city dataset from the currently filtered one-row result. Preserve accessible-list fallback. |
| **D1-F03 · Must fix** — dark map legend mixes a light panel with dark-theme light text | [JA390 dark normal map legend](../../../k-tour-id-app/artifacts/qa/mobile-tf/designer-1/50-normal-map-legend-ja390-dark.png). `ondo-b-map-key-details` body:12px/18px `#b7b6bc` over approximately `#fbfbfb`, **~1.95:1**. `ondo-b-pulse-methodology > summary`:12px/16px `#f4f4f5` over `#fbfbfb`, **~1.06:1**. The disclosure is effectively invisible despite a44px target. | Give legend, nested methodology, source disclosure and text one coherent theme treatment. Test open/closed nested disclosures on actual dark-map background and After19 independently; do not remove source/truth explanations to shorten the panel. Theme-token ownership is the issue, not simply a small font. |
| **D1-F04 · Recommend** — free guide uses metadata-sized text for its main reading task | [EN390 reader](../../../k-tour-id-app/artifacts/qa/mobile-tf/designer-1/17-public-guide.png), [JA320 reader](../../../k-tour-id-app/artifacts/qa/mobile-tf/designer-1/38-guide-ja320.png). Main instructional paragraphs13px/21.45px; item titles15px/21; section19px/26.6. Reader body is comparatively small inside large nested cards, especially at320px. | Promote continuous guide prose to15–16px with comfortable21–24px leading; compact source labels can remain12–14px. Preserve ungated reading, internal scroll, optional Add-to-pass, and same-place return. Capture39's text stress did not reveal a reader clipping blocker. |
| **D1-F05 · Recommend** — canonical full detail gives several unrelated tasks primary visual weight before practical facts | [Roba full detail top](../../../k-tour-id-app/artifacts/qa/mobile-tf/designer-1/12-canonical-detail-top.png), [facts below](../../../k-tour-id-app/artifacts/qa/mobile-tf/designer-1/13-canonical-facts.png). Sample payment/booking, guide, Journey and Table blocks precede directions/fact checks; multiple dark actions compete. This is a sample service-supported place, not all normal directory places. | Establish one context-specific primary action and a compact secondary task group; make address/directions/facts readily scannable. Keep every existing capability and truth boundary. Do not undo the approved two-action peek merely because full detail needs better ordering. |
| **D1-F06 · Recommend** — optional setup changes scale abruptly between adjacent steps | [Intent EN390](../../../k-tour-id-app/artifacts/qa/mobile-tf/designer-1/27-onboarding-intent.png): heading22px/23.1, body edge15px, primary44px. [Area EN390](../../../k-tour-id-app/artifacts/qa/mobile-tf/designer-1/28-onboarding-area.png): heading31.2px/31.824 (two lines), edge21px, primary52px. Both are the same three-step optional flow. JA320×540 remained usable with internal scroll. | Normalize the flow's heading, grid and action tiers, with an explicit short-height adaptation instead of a step-specific visual jump. Keep all intent/area/preference choices and cancellation semantics. Current44px controls are not alleged to fail target size. |
| **D1-F07 · Recommend** — shared-footer wrappers create inconsistent horizontal rhythm | [Options EN390](../../../k-tour-id-app/artifacts/qa/mobile-tf/designer-1/04-map-options.png): content edge21px, primary x37/width316. [Reader](../../../k-tour-id-app/artifacts/qa/mobile-tf/designer-1/17-public-guide.png): content outer edge23px, footer action x35/width320. Research-detail actions use a different inset. Controls are reachable; this is not clipping. | Set one padding owner per shared footer and align the intended content/action grid at16px narrow /20px baseline, preserving safe-area padding and52px primary height. Deliberate inset cards can remain nested; avoid a blanket removal of all card padding. |

The first three are concrete rendering/legibility defects. D3 independently viewed13/34/48/50 and agreed with all three required findings. F04–F07 are measured refinements, not reasons to declare whole flows unusable. No new implementation is performed by this report.

### Product-contract question, not an inferred security bug

After19 local declaration correctly changes the map lens without satisfying the protected19+ Table requirement; same-Roba cancel/active return was observed. However, the KO Busan dataset changes from208 places to30 in the approved night subset. Source uses `approved-night-subset`, while FL-013/014's older preservation language says ordinary night restaurants should remain. Resolve the current intended subset/auto-open contract before implementing changes or calling this a regression. Screenshots42/43 and source are evidence of the discrepancy, not authorization to broaden protected access or restore arbitrary places.

### What should be kept

- Map-first guest use and optional setup: finish selected Busan successfully; cancel a later Jeju draft returned to prior Busan. This does not prove exact camera/hash restoration across every history branch.
- Normal-mode official facts/stamps remain unavailable/unknown honestly. A network failure is not represented as a positive card/hours fact; retry returned to unknown for the same Roba object.
- Tile failure falls back to a searchable list, and successful retry preserves `q=Roba`. The dark status paint is wrong, but the recovery behavior is useful.
- Self-declared night-map access remains separate from protected Age; local activation/cancel/off keeps the chosen place context.
- Public guide reading opens without an Account/Person gate. Its optional save boundary stays separate; free reading is currently sample-only and was not falsely represented as live normal-mode fulfillment.
- Viewed shared SheetB corners look clean on this frozen corner-fixed artifact across options, guide, research and sample-info states. This is visual spot-check evidence; the coordinator owns the dedicated pixel-regression result.

### Coverage against every census row

**V** = named fresh image/state personally viewed; **I** = visible entry/boundary inspected, not destination completion; **U** = source-only/unexercised remainder; **D** = other reviewer owns the inner task. Numeric evidence references are the numbered capture filenames in the index. No row means all listed variants passed.

| Census | Actually reviewed | Explicit remaining limit |
|---|---|---|
| D1-01 | V01–03 initial→settled nation/city; restored/deep-linked place later | Hydration failure, arbitrary stale storage and every resume branch U. |
| D1-02 | V dock throughout; UI Settings round trips for preferences/language/theme | Desktop rail, every per-tab scroll/error U; inner tabs D2/D3. |
| D1-03 | V decision/detail/full-task/peek shared sheets, normal closes, sample disclosure scroll | Not every retained-close frame/keyboard/visual viewport; custom chrome checked separately. |
| D1-04 | U skip-link/toast-specific exercise | No new toast/skip focus pass. |
| D1-05 | V51/52 sample explanation and expanded integrations | Exit-sample button visible, not executed from this sheet; review=0 exercised independently. |
| D1-06 | I51/52 sample handoff links | Destination completion/return D3/coordinator; no D1 pass. |
| D1-07 | V27 settings→preferences→explicit restart;47 return | First-run remained map-first; preferences editor details D2. |
| D1-08 | V27/44 intent selected/unselected, short-height JA | All locale buttons/skip permutations U. |
| D1-09 | V28/45 area choice; successful Busan and cancelled Jeju drafts | All intents' unset/required combinations U. |
| D1-10 | V29/46 preferences and expanded dietary | Every dietary combination U; no support claim manufactured. |
| D1-11 | V30 successful finish | Storage failure/retry U. |
| D1-12 | V44–47 area/preference/back/cancel returns saved Busan | Every dirty-stage skip and exact opener/camera measurement U. |
| D1-13 | V01/02 nation;03/23/30 three city destinations | Nation fallback and every beacon-back focus U. |
| D1-14 | I02/27 preferences entry, reduced-motion state | Playback/hide permutations U. |
| D1-15 | V03/23/30 Seoul/Jeju/Busan;32/40/43 size/theme/night | Real device keyboard, landscape and every history branch U. |
| D1-16 | V07 empty search→08 clear; Roba filtered query48→49 recovery | IME,120-character boundary and virtual keyboard U. |
| D1-17 | V04 categories→06 Korean filtered list;08 clear | Every official/editorial category combination U. |
| D1-18 | V04/05/41 options/category/privacy/localized dark | Perspective toggle operation U; Done/close used. |
| D1-19 | I options perspective available state | Camera-preserving 2D/2.5D toggle not exercised. |
| D1-20 | V31 explicit denied location and privacy/recovery instructions | Successful geolocation, timeout, stale callback U. |
| D1-21 | V48 intentional tile failure→accessible list;49 retry map | Partial tiles/offline/repeated retry and delayed thresholds U. |
| D1-22 | V06–08 map/list/search;48 fallback and49 recovery | Exact row-scroll equivalence in every toggle U. |
| D1-23 | V06/08 official list, empty→clear07/08; editorial peek26a | Load-more/media-failure and full Jeju-list variants U. |
| D1-24 | I sample balance visible in map/search | Wallet/funding D3; supported-only filter/return not D1 exercised. |
| D1-25 | I03 sample timeline, reduced motion | Playback/scrub synchronization U. |
| D1-26 | I sample events/meter visible in maps/places | Contribution D2; no animation→visit proof inferred. |
| D1-27 | V50 normal dark legend/method disclosure; F03 | Expanded technical driver/credits and all Jeju legend variants U. |
| D1-28 | V22 Seoul and24 Jeju guide panels, closes | All additional-story overflow states U. |
| D1-29 | V24→25 actual story→map focus | External sources not opened;25 is not a peek despite filename. |
| D1-30 | V09 research detail Zest | All research categories/media-failure variants U. |
| D1-31 | V10 research source expanded; I directions/on-map/service | External navigation not traversed; payment/reservation D3. |
| D1-32 | V11 canonical Roba peek,33 normal deep link | Every ordinary/long-name/source state U. |
| D1-33 | V12/13 ready sample;33/34 normal;35 API error | Real loaded positive fact/address variant not injected. |
| D1-34 | V12/13 current meter and source boundaries | Expanded evidence/alternatives transitions U. |
| D1-35 | V13/34 unknown fact rows,35/36 errors | Positive/no/conditional/stale authored combinations U/Q. |
| D1-36 | V14 card unknown;36 error→37 retry unknown | Other fact drawers/stale/nonrecoverable variants U. |
| D1-37 | V14 evidence source,10 research disclosure; I canonical/editorial summaries | Every expanded canonical/editorial external evidence link U. |
| D1-38 | I12 action hierarchy; V15/16 and19 night return | Saves/contribution/Journey/Tables execution D2/D3. |
| D1-39 | I11/12 sample registered-service entries;33 normal unavailable separation | Checkout/reservation outcomes D3. |
| D1-40 | V26a/26b long-title food editorial peek/detail | Other categories, save/error/media-failure U. |
| D1-41 | V13/34 Directions label/layout defect; I other direction controls | No remote map opened; all geographic destinations/return assertions remain U. |
| D1-42 | V15 exact-place intro;42 map KO dark intro | Auto-open variants U. |
| D1-43 | V16 ordinary cancel;19 completed declaration | Pending-delay race not freshly exercised here. |
| D1-44 | V20 active map;21 manual off/notice;43 dark active | Undo/dismiss variants and every category/list state U. |
| D1-45 | V15→16 same-Roba cancel;19 same-Roba active return | Stale/missing return token U. |
| D1-46 | U/Q authored review provenance screen | Public sample alone not treated as positive review receipt. |
| D1-47 | U/Q authored night failure/expired variants | Not fabricated as normal public outcomes. |
| D1-48 | I manual current declaration/off; source contract reconciliation | Clock-bound auto/expiry/storage variants U. |
| D1-49 | I19 protected Table still requires19+ after local declaration | Full protected-gate terminal/return D2/D3. |
| D1-50 | V17/38 account-free guide EN390/JA320;39 diagnostic text stress | Normal review=0 reader absent; not live normal-service coverage. |
| D1-51 | V18 details/close to same Roba | Pass-origin saved-reader resume D2/coordinator. |
| D1-52 | I Add-to-pass visible and separate from reading | Coordinator owns execution/cancel/fulfillment. |
| D1-53 | V same-place night cancel/active; guide close; setup cancel; tile retry query | Browser Back/Forward, exact camera/list-scroll/focus across all origins U. |

### Adversarial cross-review supplied to coordinator

Personally viewed D3's real-coordinate direct-Person screenshot and geometry evidence: opening from a scrolled Pass can leave the new dialog/focused controls above the viewport while the background is inert. This is a blocking reachability defect, not an ordinary typography preference. D3 also confirmed the Age sibling through the same non-autoscrolling method.

For D3-F02–F04, promote the actual approval, minimal-proof/retention consequence, and checkbox consent to body scale. Do **not** fail every bold12px requester/receipt label: separated compact labels can remain legible. A13px content edge versus20px target is a grid refinement, not by itself an inaccessible decision. D3-F05's39px receipt title is overweight but fits; normal scrolling reaches Return and the amount/result are shown. Treat the title as a recommendation, with refund-consequence readability evaluated separately. D3-F06's two black funding actions compete visually; retain both capabilities and establish hierarchy, but do not misreport wrong credit or broken navigation. These reservations were sent to both D3 and the coordinator before consolidation.

Personally viewed D2's `014-table-detail-top-en390`, `017-table-plan-saved-en390`, `027-my-plan-en390` and `023-table-report-decision-en390` under `artifacts/qa/mobile-tf-designer-2/`. The same **A small dinner in Gijang** changes from18:30 KST in Table/save-success to20:30 in My Korea: required correctness fix, independently supported by `saved-entry-b.tsx:473` using the global `productTimeline.tableSchedule` whose formatter hardcodes20:30. Use the selected Table's own timeline; verify all saved Table schedules match detail in EN/KO/JA. The report reason **Uncomfortable behavior** visibly breaks inside its word at390px (`Uncomfortab` / `le behavior`) in an equal-three-column group: required localized control-layout repair. Give each complete reason enough width or stack choices; retain all three reasons, explicit report confirmation and local-only truth. Both agreements were sent to D2/coordinator.
