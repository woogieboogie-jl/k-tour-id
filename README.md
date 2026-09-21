# K-Tour ID

**Current local integration (2026-09-21):** `integration/harvey-final-20260921` contains Harvey's final `f4526af3` plus the preserved mobile UX and explicit-approval/recovery hardening. It is not pushed or deployed. Start with [the integration status, local commands and remaining provider work](./docs/HARVEY_FINAL_INTEGRATION_2026-09-21.md); the production links and original handoff instructions below are historical baselines. The integrated v1 perk journey is distinct from the v2 guide-saving mock. Real OpenDID remains unimplemented; CX and the integrated chain path require separate live-environment verification.

K-Tour ID is a map-first Korea food and travel product. It combines 400 official Seoul and Busan food-service records with a clearly separated Jeju editorial collection, then connects discovery to saved places, Tables and an optional privacy-preserving travel credential flow.

This release is a clickable **mock**. Identity, funding, payment, reservation and chain outcomes are simulated; a sample credential, ticket or receipt is not external confirmation. CX, OpenDID, OmniOne Chain and Sui remain required developer integrations.

**[K-Tour ID app](https://ktour-id.vercel.app)** · **[main](https://github.com/woogieboogie-jl/k-tour-id/tree/main)** · **[Harvey handoff](https://github.com/woogieboogie-jl/k-tour-id/tree/handoff/harvey-20260914)**. **App source `5ba76a2` is deployed: clearer map feedback, refined masthead spacing, and a mobile map that continues behind the navigation dock.** See the [current map release record](./docs/KTOUR_MAP_LAYOUT_FIX_2026-09-16.md) for scoped checks and the [production handoff](./docs/KTOUR_PRODUCTION_HANDOFF_2026-09-15.md) for deployment and synchronized branches. The [free guide reading and optional pass saving](./docs/KTOUR_PUBLIC_GUIDE_RELEASE_2026-09-16.md) from `9980472` remain unchanged. Later documentation-only commits preserve this app source. [Earlier September 16 UX polish](./docs/ux-refinement/2026-09-15/round-20260916.md), the [initial experience release](./docs/KTOUR_EXPERIENCE_RELEASE_2026-09-15.md) and [previous UX release](./docs/ux-refinement/2026-09-15/RELEASE.md) remain historical evidence. Provider integrations remain incomplete.

The [separate Sumsub Sandbox Preview](https://ondo-hinsi4hdz-jaewook-9643s-projects.vercel.app) lives on `feat/sumsub-sandbox-onboarding-20260914` and is **not included in this release**. Its real WebSDK/API tests are not production KYC or verified real face/liveness. See its [separate handoff](https://github.com/woogieboogie-jl/k-tour-id/blob/feat/sumsub-sandbox-onboarding-20260914/docs/SUMSUB_SANDBOX_HANDOFF_2026-09-14.md).

K-Tour ID is the public product name. Historical ONDO names, `ondo` module/API identifiers, environment keys and existing deployment hostnames remain unchanged for compatibility.

## Developer handoff — start here

For the September 21 submission, start with [해커톤 연동 개발 요약](./docs/HARVEY_HACKATHON_HANDOFF_2026-09-14.md), then [Sui 필수 통합 추가 명세](./docs/HACKATHON_SUI_REQUIRED_ADDENDUM_2026-09-14.md) and the [1주 해커톤 통합 개발안](./docs/HACKATHON_ONE_WEEK_SPEC_2026-09-14.md). **CX, OpenDID, OmniOne Chain and Sui are all required by the team.** The optional guide-saving journey adds real Move, zkLogin/PTB and a user-authorized, bounded AI agent. The addendum governs technical/security/submission requirements and the Sui → final service DB → OmniOne order; the [current guide handoff](./docs/EXPERIENCE_MOCK_HANDOFF_2026-09-15.md) governs free reading, optional saving and the v2 action/campaign/recipient. “Redemption” means saving a collection entry, never unlocking reading. Sui staffing and readiness must be confirmed before treating the original one-week schedule as feasible. Financial/reservation integrations, bridge and passport/residence integrations remain mock. Program registration, submission eligibility and matching-prize terms require separate confirmation. The full-product handoff below remains the longer-term reference.

Read [개발자 시작 문서](./docs/DEVELOPER_START_HERE.md) for the mock → API/SDK/backend work map. Harvey starts from `handoff/harvey-20260914`; `main` is the canonical source. The current release record tracks their synchronization, so use the app and docs from the same confirmed handoff. The [original handoff snapshot `9d4aec9`](https://github.com/woogieboogie-jl/k-tour-id/tree/9d4aec9) is historical, not the moving branch head.

The approved [nonfinancial guide flow](./docs/EXPERIENCE_MOCK_HANDOFF_2026-09-15.md) now separates **Roba → freely read the guide** from **optional Add to my pass → Person/pass/presentation → explicit saving approval → local pass collection**. Holder acknowledgement and purpose-specific presentation consent remain explicit. Old opening approvals are not reused for the new save campaign. It adds no real CX/OpenDID/AI/Sui/OmniOne calls, merchant voucher or financial/visit entitlement. The [public-guide release record](./docs/KTOUR_PUBLIC_GUIDE_RELEASE_2026-09-16.md) distinguishes this source change from its verification and deployment status.

### Run the handoff

Requires Node.js 22.13+ and pnpm 10.8.0. No provider credentials are needed to run the mock.

```bash
git clone --branch handoff/harvey-20260914 --single-branch https://github.com/woogieboogie-jl/k-tour-id.git k-tour-id-handoff
cd k-tour-id-handoff/k-tour-id-app
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test:contracts
pnpm build:vercel:ondo-b
pnpm exec next start .ondo-b-standalone -p 3438
```

Open `http://localhost:3438`. Contract tests regenerate the standalone stage, so stop this server before rerunning them.

The acceptance boundary is **complete mock journeys + matching developer requirements**. Actual integrations are the developer's work, including provider SDK/handoff adapters in the frontend.

## Original production baseline

The original [production app](https://ondo-tau.vercel.app), deployment source/runtime `cc3d7c3`, is the pre-rebrand baseline. The September 14 [brand sharing release](./docs/BRAND_SHARE_REFRESH_2026-09-14.md) records that deployment's ID, URL and verification status: Ready, with its HTTP probe and 4 mobile/desktop brand cases passing (one worker, no retries). Its local checks passed: 44 related contracts, typecheck, production build/scan, HTTP probe covering 41 public assets, and 6 mobile/desktop brand browser cases (one worker, no retries). Those results belong to that earlier sharing-card/icon update, not this release. Its [brand asset record](./k-tour-id-app/docs/branding/KTOUR_SOCIAL_REFRESH_2026-09-14.md) is retained as history.

The last functional-flow QA baseline is historical `e2ad7c4`: 833 contracts and the After 19 public-route checks (local 5/5; production 5/5 in 2.0 minutes, one worker, no retries; 5 project-mismatch skips excluded). Its [After 19 fix record](./docs/PLACE_AFTER19_FIX_2026-09-14.md), the [previous map-first entry](./docs/MAP_FIRST_ENTRY_2026-09-14.md) and [map–wallet release](./docs/MAP_WALLET_JOURNEYS_2026-09-12.md) preserve their own evidence; those flows were not rerun by this branding update. This remains a publicly deployed **mock**: no actual identity, payment, reservation or chain provider was added, and actual iPhone Safari/Android devices were not tested. Earlier [production](./docs/PRODUCTION_RELEASE_2026-09-12.md) and [full-journey QA](./docs/FINAL_JOURNEY_QA_2026-09-11.md) remain historical.

## Full-product mock flow

This is the longer-term product journey, not the one-week mandatory integration scope. The hackathon brief and Sui addendum above define that narrower scope.

```text
Identity source
  → K-Tour service credential (VC)
  → merchant proof request
  → holder reviews claims, purpose and retention
  → holder creates a VP
  → merchant verifies issuer, holder binding, status and policy
  → benefit is applied
  → payment and single-use voucher redemption
  → partner settlement and non-PII audit anchor
```

The K-Tour Visitor Credential is a private service credential. It is not a government ID, visa, residence card or official immigration status.

## Identity paths

| User | Identity source | Adapter boundary |
|---|---|---|
| Korean resident | Government Mobile ID | OmniOne CX |
| Registered foreign resident | Mobile residence card, subject to hackathon environment support | OmniOne CX `coresidence` candidate |
| Short-stay visitor | Passport MRZ/NFC, face match and liveness | Separate passport eKYC adapter; not OmniOne CX |

## Current demo entry points

| Entry from `/` | Purpose |
|---|---|
| Map / city / place sheets | Fresh nation → chosen city heatmap without setup; guest search and explicit place selection |
| ID · Wallet → K-Tour ID | Mobile ID, Residence and Passport setup, consent, holder and recovery |
| ID · Wallet → Wallet / place benefit | Funding, explicit USDC/USDT branch, checkout, voucher and refund |
| Tables → meal plan / restaurant reservation | Separate social-plan and reservation operations |
| Demo → partner verification / settlement / events | Partner request/consent/results, reconciliation, ticket history and event evidence |
| My Korea → Labs | Sample signer, interoperability hypothesis and opt-in visit badge |
| Settings → privacy / account services | Local controls and separate sample account export/revoke/deletion |

Use the in-flow sample controls for failure/cancel/unknown/recovery. Legacy `/onboarding`, `/pass`, `/present`, `/wallet`, `/partner/*` and `/evidence` routes are not current standalone entry points. `/ondo-b` redirects to `/`; the current venue-data route is `/api/ondo/venues/[venueId]`. Proposed `/api/v1/*` endpoints in the spec are **to be implemented**, not existing vendor APIs.

## Integration boundaries

The frontend depends on typed contracts for:

- identity verification;
- credential issuance;
- holder presentation;
- merchant verification;
- policy evaluation;
- payment and refund;
- voucher issuance/redemption;
- partner settlement;
- audit anchoring.

OmniOne CX is the Mobile ID transport/verification layer. OpenDID is the VC, VP and Credential Status infrastructure. OmniOne Chain is designed as the non-PII event-hash anchor. Passport eKYC and payment rails are separate integrations.

## Canonical specifications

The current canonical set is:

- [DEPLOYMENT_SPEC — flow/API/state/security contract](./docs/DEPLOYMENT_SPEC.md)
- [Backend handoff — BE-01–16 work packages](./docs/BACKEND_HANDOFF_CHECKLIST_2026-09-09.md)
- [Hackathon integration matrix — technology scope and evidence](./docs/HACKATHON_INTEGRATION_MATRIX_2026-09-08.md)

Older `DEVELOPMENT_SPEC.md`, traceability, scope memory, Sui brief and app architecture notes are historical context. They do not override the current scope, route packaging or the eight unresolved ADR categories in DEPLOYMENT_SPEC §9. Sui remains user-requested project scope, not a requirement automatically attributed to the DID competition.

## Run locally

```bash
cd k-tour-id-app
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test:contracts
pnpm build:vercel:ondo-b
pnpm exec next start .ondo-b-standalone -p 3438
```

Set `NEXT_PUBLIC_SITE_URL` and `NEXT_PUBLIC_ONDO_B_ORIGIN` to the deployed K-Tour ID origin so canonical and social-preview URLs resolve correctly. The existing environment key names stay unchanged.

The current UI uses Next.js 16, React 19, TypeScript and Tailwind CSS v4. K-Tour ID's map-first flow uses MapLibre with a source-attributed OpenFreeMap basemap for prototype validation; this is not a partnership claim. Its visual language is modern white and black with restrained Pulse and editorial accents.

## Repository boundaries

- `k-tour-id-app/` is the active K-Tour ID product mock; internal module names stay stable to preserve API, storage and test contracts.
- `docs/` contains the current canonical trio above and clearly dated historical records. The public-name change does not delete identity, privacy or recovery requirements.
- `legacy-contracts/` contains earlier experimental contracts and is not part of the golden-path production architecture. It must not be deployed or presented as audited product code.
- Brand logos in the mock are target-integration examples, not evidence of partnership.
