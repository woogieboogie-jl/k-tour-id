# FL-004 · Checkout/Labs → Stamp

상태: `THREE-DESIGNER CONSENSUS · IMPLEMENTATION READY`

> 2026-09-16 로컬 UX 개정: 아래 기존 결제·검증 계약은 유지하되 스탬프의 화면 배치와 복귀 목적지는 [Journey Pass 로컬 검토안](../KTOUR_JOURNEY_PASS_LOCAL_2026-09-16.md)이 우선한다. 장소 상세에서 결제 없이 방문 기록으로 진입하고, 영수증에서는 같은 행동의 선택형 링크만 제공한다. 진행·컬렉션의 홈은 Travel Pass이며, 기념 배지는 기존 Labs 실행 계약을 재사용하는 집중 화면으로 열린다. 아직 배포하거나 개발자 인계 브랜치에 반영하지 않은 로컬 변경이다.

## 1. Flow contract

| 항목 | 값 |
|---|---|
| 연결 요구 | `REQ-006`, `REQ-011`, `REQ-016` |
| 진입 행동 | 사용자가 장소 상세에 표시된 offer/benefit에서 최종 KRW 금액 사용을 선택한다. |
| 성공 결과 | Account·Payment KYC 뒤 한 장소·한 금액의 기기 내 여행 잔액 사용 기록을 만들고, 별도의 unique visit evidence 성공 뒤에만 stamp 9→10과 optional Labs badge eligibility를 연다. |
| 취소 결과 | checkout 또는 Labs를 닫으면 동일 venue/offer/final amount 또는 My Korea milestone로 돌아가며 balance·receipt·stamp·reputation은 불변이다. |
| 실패·재시도 | 정적 provider 미구성, KYC fail/expire, processing fail/timeout, funding unavailable을 구분한다. `NOT_CONFIGURED`에는 의미 없는 Retry를 보이지 않고 다른 방법/나중에를, 연결된 provider의 일시 실패에만 같은 checkout Retry를 제공한다. |
| 정확한 복귀 | checkout은 `START_CHECKOUT`, badge는 `MINT_BADGE`; token/envelope에는 canonical `cta`·gate metadata와 CTA matrix가 허용한 public `venueId`만 둔다(`MINT_BADGE`는 venueId 금지). merchant/offer, benefit, original/final KRW, sheet/scroll, opener focus는 navigation registry에서, funding draft는 token 밖 app memory에서 복원한다. |
| 실행 truth | current B는 외부 merchant order·실제 금액 이동을 만들지 않는 local balance-use record다. normal provider 미연결이면 Payment KYC/payment success 없음; explicit QA/review fixture만 `PKY-VERIFIED`, `PAY-SIMULATED-SUCCESS`, `FX-STM-10` 방문 milestone을 각각 provenance와 외부 확인 없음 범위로 재현한다. |

### 삭제할 수 없는 PRD 불변식

- 소비자 기본 단위는 locale-grouped KRW이며 근거·기준 시각이 있을 때만 USD를 보조로 표시한다.
- `OOKRW`, `USDC`, `USDT`, network, settlement는 결제 상세 또는 Labs에만 둔다.
- non-zero 잔액에는 하나의 출처가 있다: 정본 fixture는 `이번 여행에 준비된 잔액 ₩60,000`, 상세에서 `이 기기에서만 사용하는 잔액·외부 입금 없음`; 출처를 구현하지 못하면 기본 `₩0`이다.
- bank/card·Apple Pay·USD wallet은 funding intent이고, 미연결 선택은 active/Ready로 persist하거나 잔액을 늘리지 않는다.
- Account와 Payment KYC는 독립이고 Person·Age·K-Tour credential을 자동 충족하지 않는다.
- payment result, local receipt, unique visit, stamp, optional badge는 별도 사건이다. payment만으로 stamp/reputation이 변하지 않는다.
- 실패·취소·timeout은 balance, acceptedEvidenceIds, stamp, receipt를 바꾸지 않는다.

## 2. 현재 경험 진단

| 문제 | 사용자 영향 | 심각도 | 근거 화면·상태 |
|---|---|---|---|
| `60 OOKRW Test`처럼 ticker/test 문구와 숫자 grouping이 전면에 나온다. | 얼마를 무엇에 쓰는지 빠르게 이해하지 못한다. | P1 | Wallet/checkout amount |
| non-zero balance와 `no money/funds added`가 동시에 보일 수 있다. | 사용할 수 있는 잔액인지 가짜 숫자인지 판단할 수 없다. | P0 | Wallet provenance |
| place offer와 Wallet 탭이 분리돼 merchant·benefit·amount context가 사라진다. | 결제를 위해 앱 구조를 다시 탐색해야 한다. | P1 | venue→checkout entry |
| local record가 실제 merchant payment/order처럼 보일 수 있다. | 실제 돈이 이동하거나 주문이 접수됐다고 오인한다. | P0 | confirm/result |
| payment success 직후 stamp가 채워질 수 있다. | 방문하지 않았는데 방문 기억·보상이 생긴다. | P0 | `PAY-SIMULATED-SUCCESS`→`STM-N10` |
| account/payment sheet 하단 CTA가 320/short landscape에서 잘릴 수 있다. | 결제 결정을 완료하거나 취소할 수 없다. | P1 | Decision/detail footer |

## 3. 목표 경험

### 한 문장 약속

> 장소의 혜택과 최종 원화 금액을 그대로 이어 받아 여행 잔액 기록을 만들고, 실제 방문 증거가 생겼을 때만 열 번째 기억을 채운다.

### 사용자가 1초 안에 알아야 하는 것

- 어느 장소에서 원가·혜택·최종 얼마를 사용할지.
- 사용할 잔액의 출처와 확인 전에 필요한 한 가지 gate.
- 현재 제품에서는 외부 주문과 실제 금액 이동이 없다는 것.

### 사용자가 읽지 않아도 알아야 하는 것

- amount stack이 원가→혜택→최종 KRW로 줄어들며 primary CTA도 같은 금액을 말한다.
- 장소 media/name이 checkout header에 끝까지 고정된다.
- receipt 뒤 stamp가 즉시 움직이지 않고, 별도 visit object가 확인된 뒤에만 9번째 ring이 10번째로 채워진다.
- technical asset/bridge/badge는 consumer checkout과 다른 Labs layer다.

## 4. 권장 모바일 여정

```text
ENTRY: venue offer/benefit
→ DECISION: merchant + original → benefit → final KRW + balance source
→ GATES: FL-010 Account → FL-017 Payment KYC
→ NORMAL UNAVAILABLE: no payment mutation → exact checkout return
→ REVIEW FIXTURE: PAY-CONFIRMING → PAY-PROCESSING
   → PAY-SIMULATED-SUCCESS local record | PAY-FAILED | PAY-CANCELLED
→ REVIEW-ONLY SEPARATE VISIT: FX-STM-10 unique evidence accepted → STM-N09 → STM-N10
→ OPTIONAL LABS: MINT_BADGE의 Person gate가 미충족이면 기존 JIT 처리 → consent/result
→ RETURN: venue or My Korea milestone
```

| 단계 | 화면의 한 가지 질문 | 주 시각 객체 | 주 행동 | 보존 context |
|---|---|---|---|---|
| Offer | 이 장소 혜택을 쓸까? | venue+benefit+final KRW | `₩19,000 확인` | venue/offer/amount |
| Checkout | 여행 잔액을 사용할까? | amount stack+balance source | `여행 잔액 ₩19,000 사용` | merchant/benefit/source |
| Gate | 지금 Payment 확인을 할까? | checkout anchor+current gate | 확인/나중에 | `START_CHECKOUT` token |
| Pending | 같은 금액이 처리 중인가? | locked final amount+progress | 기다림/취소 | no duplicate, no stamp |
| Record | 무엇이 기록됐나? | balance delta+local receipt | 장소로 돌아가기 | before/after balance, no-order truth |
| Visit | 실제 방문 증거가 있나? | separate visit object | 방문 확인 | evidenceId, accepted set |
| Milestone | 열 번째 방문이 됐나? | 9→10 memory ring | My Korea 보기 | `STM-N10`, no forced mint |
| Labs | 기념 badge를 만들까? | eligible badge object | badge 선택 | `MINT_BADGE`, 필요 시 Person gate, Labs consent |

## 5. 화면별 상세 규격

### Screen A · Venue offer and checkout

**목적**

- 장소에서 Wallet로 이탈하지 않고 merchant·benefit·최종 KRW를 한 결정으로 만든다.

**첫 viewport에 보이는 것**

- venue media/name, 원가, ONDO benefit, 최종 KRW, 사용 후 잔액, primary CTA.
- positive balance fixture라면 `이번 여행에 준비된 잔액 ₩60,000`; 출처가 없으면 `잔액 ₩0`와 연결 가능한/불가능한 funding action.
- confirm 바로 위 `외부 주문 없음 · 실제 금액 이동 없음` 한 줄.

**시각·인터랙션**

- 금액은 tabular numeral과 locale grouping; original은 secondary, benefit은 signed delta, final은 가장 큰 한 값이다.
- benefit 색은 ONDO accent 한 곳에만, 일반 CTA는 near-black이다.
- Checkout Decision≤72dvh, 한 internal scroll, footer padding≥CTA+safe area.

**행동**

- Primary: `여행 잔액 ₩19,000 사용`.
- Secondary: `결제 상세`/funding source.
- Close/Back: exact offer/venue, mutation 없음.

**정보 배치**

| 처리 | 정보 |
|---|---|
| 항상 표시 | venue, original/benefit/final KRW, balance/source, no-order/no-money consequence |
| 시각화 | amount stack, balance before→after, benefit delta |
| 한 번 접기 | receipt policy, USD estimate+basis/time, balance provenance detail |
| Labs/개발 문서로 이동 | OOKRW/USDC/USDT, network, settlement, bridge, fixture IDs |
| 삭제 | `test offer`, `simulation`, 일반 CTA의 ticker, `60 OOKRW`, provider architecture |

### Sheet B · Funding and Payment gate

**목적**

- current checkout을 고정한 채 Account와 Payment KYC를 한 축씩 처리하고 미연결 수단을 false Ready로 만들지 않는다.

**첫 viewport에 보이는 것**

- merchant/final KRW anchor, current gate 한 가지, primary/escape.
- funding을 연 경우 은행·카드, Apple Pay, USD wallet의 human label과 각 availability.
- unavailable이면 상태와 가장 가까운 recovery; future gates/credential stepper는 없음.

**시각·인터랙션**

- 방법 선택은 sheet-local draft; provider unavailable/cancel/close 시 이전 usable source로 복원한다.
- normal `NOT_CONFIGURED`는 `PKY-NOT-STARTED` 또는 기존 state와 balance를 유지한다.
- explicit review fixture만 `FX-PKY-PENDING`, `FX-PKY-SUCCESS`, `FX-PKY-FAIL`과 해당 payment fixture를 실행하며 provenance를 result에 남긴다.

**행동**

- Primary: 현재 gate 확인 또는 사용 가능한 source 선택.
- Secondary: `나중에`/다른 방법; Retry는 연결된 provider의 일시 실패에만 보인다.
- Close/Back: same checkout, no source commit.

**정보 배치**

| 처리 | 정보 |
|---|---|
| 항상 표시 | merchant/final amount, current gate, method availability, failure/recovery |
| 시각화 | one-axis status, selected draft, unavailable icon+label |
| 한 번 접기 | provider name, USD route detail, KYC provenance/expiry |
| Labs/개발 문서로 이동 | ticker/network/adapter, wallet signer, bridge architecture |
| 삭제 | 모든 verification badge, provider logo wall, `wallet ready` false state, K-Tour presentation |

### Screen C · Balance-use record

**목적**

- review fixture 성공 결과를 실제 merchant payment가 아닌 local balance-use record로 정확히 보여준다.

**첫 viewport에 보이는 것**

- venue, `₩60,000 → ₩41,000`, 사용 금액 `₩19,000`, time, `외부 주문 없음 · 실제 금액 이동 없음`.
- `장소로 돌아가기` primary와 receipt detail secondary.
- stamp animation이나 NFT CTA는 이 화면에 없다.

**시각·인터랙션**

- Receipt primitive, Detail≈88dvh; success check보다 금액 관계와 결과 명칭이 우선이다.
- review fixture label/provenance는 오해 방지 범위로 결과에 보이고 raw diagnostics는 접는다.
- failure/cancel에는 receipt ID와 balance delta를 생성하지 않는다.

**행동**

- Primary: `장소로 돌아가기`.
- Secondary: `기록 상세`/`잔액 복원`이 구현된 fixture일 때 별도 confirmation.
- Close/Back: exact venue/offer.

**정보 배치**

| 처리 | 정보 |
|---|---|
| 항상 표시 | venue, final amount, before/after balance, local-only/no-order truth, result |
| 시각화 | amount delta and receipt timestamp |
| 한 번 접기 | local receipt ID, provenance, technical settlement hypothesis |
| Labs/개발 문서로 이동 | OOKRW ledger, network, raw fixture log |
| 삭제 | `결제 완료`, merchant 승인 번호, fake explorer, stamp success |

### Screen D · Unique visit and 9→10 milestone

**목적**

- payment와 분리된 explicit review fixture 방문 evidence가 성공할 때만 열 번째 여행 기억을 만든다. normal public 경로는 실제 방문 확인을 가장하지 않는다.

**첫 viewport에 보이는 것**

- separate visit event와 venue/date, accepted evidence state.
- `검토용 방문 기록 · 외부 방문 확인 없음` 범위.
- 성공 후 10개 ring/stamp 중 새 한 칸이 채워지고 `My Korea에서 보기`.
- badge는 `원하면 기념 badge` secondary로만 나타난다.

**시각·인터랙션**

- payment receipt→visit object 사이를 구분하는 timeline divider/time을 둔다.
- `FX-STM-10`은 명시적 QA/review mode에서만 실행하고 normal public UI에는 방문 성공·stamp 증가 action을 노출하지 않는다.
- duplicate evidenceId는 animation/mutation 없이 기존 milestone을 보여준다.
- stamp는 최대 500ms one-shot; confetti/반복 pulse 없음.

**행동**

- Primary: `My Korea에서 보기`.
- Secondary: eligible일 때 `기념 badge 보기` → Labs.
- Close/Back: venue/My Korea origin.

**정보 배치**

| 처리 | 정보 |
|---|---|
| 항상 표시 | review fixture scope, visit evidence result, venue/date, stamp count, duplicate/failure recovery |
| 시각화 | separate timeline, 9→10 ring, accepted state |
| 한 번 접기 | evidence reference/provenance |
| Labs/개발 문서로 이동 | NFT/mint/chain/network, badge fixture controls |
| 삭제 | payment=visit 연결 문구, forced mint, `NFT issued` without evidence |

### Screen E · Optional Labs badge

**목적**

- 10회 milestone 뒤 사용자가 원할 때만 별도 Labs consent로 badge fixture를 실행한다.

**첫 viewport에 보이는 것**

- eligibility, badge image, consent, target/result truth, primary opt-in, back to milestone.

**시각·인터랙션**

- consumer Wallet/navigation에서 Labs를 primary로 승격하지 않는다.
- `MINT_BADGE`는 별도 token/consent/result이고 checkout token과 재사용하지 않는다.
- `MINT_BADGE`의 canonical required gate는 Person이다. 미충족이면 같은 anchored JIT shell에서 Person만 처리하고 badge consent로 정확히 복귀한다.
- txRef가 없으면 mint completed/explorer link를 만들지 않는다.

**행동**

- Primary: review fixture가 명시된 경우 `기념 badge 만들기`.
- Secondary: `My Korea로 돌아가기`.
- Close/Back: milestone state, assets/stamp 불변.

**정보 배치**

| 처리 | 정보 |
|---|---|
| 항상 표시 | opt-in, eligibility, simulated target/result truth, failure/recovery |
| 시각화 | badge eligibility/mint states, no fake chain success |
| 한 번 접기 | receipt/evidence details |
| Labs/개발 문서로 이동 | `Target network: Sui Testnet · Simulated`, asset/network/tx diagnostics |
| 삭제 | normal consumer surface의 mint CTA, fake txRef/explorer, forced success |

## 6. 상태·오류·복귀

| 상태 | 보이는 변화 | 가능한 행동 | 데이터·맥락 불변식 |
|---|---|---|---|
| Initial | `PAY-IDLE`, venue/benefit/final KRW | checkout 열기 | stamp/reputation 불변 |
| Gate unavailable | Payment method/KYC unavailable | 다른 방법/나중에 | 정적 `NOT_CONFIGURED`는 재시도로 해결되지 않으며 no `PKY-VERIFIED`; balance/source/receipt/stamp 불변 |
| Confirming | `PAY-CONFIRMING`, amount locked | 사용/취소 | amount/merchant 변경 시 중단 |
| Processing | `PAY-PROCESSING`, duplicate input lock | 기다림/취소 가능 시 취소 | stamp/visit 불변 |
| Failure/timeout | `PAY-FAILED` | Retry/장소 복귀 | balance/receipt/acceptedEvidence/stamp 불변 |
| Cancel | `PAY-CANCELLED` | 장소 복귀 | source draft discard, token terminal |
| Review success | `PAY-SIMULATED-SUCCESS`, local record | 장소/기록 상세 | local receipt only; stamp/reputation 0 mutation |
| Visit failure/duplicate | visit object failure/existing | Retry/기존 보기 | `STM-N09` 또는 기존 count 유지 |
| Unique visit success | explicit review mode의 accepted new evidence | milestone 보기 | `FX-STM-10`, `STM-N09→STM-N10`, acceptedEvidenceIds 1회 추가; normal public 전이 금지 |
| Badge cancel/fail | `NFT-ELIGIBLE/FAILED` | Retry/My Korea | stamp/assets 불변 |
| Return | exact venue/offer or My Korea milestone | continue | valid token one-shot, invalid token safe map |

## 7. Motion choreography

| 전이 | duration/easing | 공간 규칙 | reduced motion |
|---|---|---|---|
| offer→checkout | 220–280ms sheet | venue/amount shared object, backdrop/surface same frame | 즉시 sheet+focus |
| gate body swap | 160–200ms | header merchant/amount 고정 | 즉시 state |
| confirm→processing | 160–200ms | CTA 자리 progress, amount 위치 고정 | static pending+live region |
| record result | 220–360ms | before→after balance number morph, no confetti | 즉시 두 숫자 표시 |
| visit→stamp | 최대 500ms spring-lite once | 해당 10번째 ring만 채움 | 즉시 count+delta text |
| cancel/failure return | 160–220ms | exact sheet/venue focus restore | 즉시 복원 |

## 8. Copy·localization

| 역할 | KO | EN | JA | 규칙 |
|---|---|---|---|---|
| Checkout title | 여행 잔액 사용 | Use travel balance | 旅行残高を使う | `Travel wallet/test` 금지 |
| Primary CTA | 여행 잔액 ₩19,000 사용 | Use ₩19,000 travel balance | 旅行残高から₩19,000使う | 실제 final amount 동적 |
| Balance | 이번 여행에 준비된 잔액 ₩60,000 | ₩60,000 prepared for this trip | この旅行用の残高 ₩60,000 | 출처 있는 fixture만 |
| Consequence | 외부 주문 없음 · 실제 금액 이동 없음 | No external order · no real money movement | 外部注文なし・実際の資金移動なし | confirm/result 모두 한 번 |
| Result | 잔액 사용 기록 | Balance-use record | 残高利用の記録 | `Payment complete` 금지 |
| Unavailable | 지금은 이 방법을 연결할 수 없어요 | This method is unavailable right now | 現在この方法は利用できません | no false Ready |
| Retry | 같은 금액으로 다시 시도 | Try the same amount again | 同じ金額でもう一度試す | context 고정 |
| Visit result | 열 번째 방문이 기록됐어요 | Your tenth visit is recorded | 10回目の訪問を記録しました | unique visit 뒤만 |
| Visit fixture truth | 검토용 방문 기록 · 외부 방문 확인 없음 | Review visit record · no external visit confirmation | 検証用の訪問記録・外部での訪問確認なし | stamp 변화 전에 visible |
| Badge CTA | 기념 badge 보기 | View commemorative badge | 記念バッジを見る | optional Labs |

- KRW/JPY/USD는 locale formatter와 tabular numerals를 쓰며 `60000`, `60 OOKRW Test`는 금지한다.
- normal title/CTA의 `preview/simulated/test/on-device/provider`는 0회. review fixture/Labs truth는 필요한 결과점에 명시한다.

## 9. Accessibility·responsive

- 320×568/800과 360×800 edge 16px, 390×844/430×932 edge 20px, horizontal overflow 0.
- 844×390은 merchant+amount sticky header, 한 internal scroll, primary+escape sticky footer로 구성하며 desktop rail이 나타나지 않는다.
- amount, source, payment CTA, close, restore/badge action은 최소 44px; primary 52–56px, critical gap 8px.
- 200% zoom에서 original/benefit/final, no-money consequence, failure recovery, restore scope가 footer 뒤에 숨지 않는다.
- screen reader는 merchant→amount relation→balance source→consequence→primary 순서로 읽고, amount update는 polite live region이다.
- forced colors에서 benefit/selected/unavailable/failure/stamp가 glyph+border+text로 구분된다.
- reduced motion에서도 payment, visit, stamp의 사건 경계와 count delta가 동일하게 전달된다.
- 모든 consent/금액/복원/opt-in 행동은 icon-only 금지이며 KO/EN/JA decision text에 ellipsis를 쓰지 않는다.

## 10. 계측·완료 기준

### UX signal

- venue offer→checkout exact context, funding unavailable→no mutation, review result→venue return, visit→stamp conversion을 사건별로 분리 계측한다.
- amount/merchant/source/receipt/acceptedEvidence/stamp mutation whitelist와 one-shot/duplicate evidence를 기록한다.
- normal `NOT_CONFIGURED`와 `FIXTURE_REVIEW` 결과를 provenance dimension으로 분리한다.

### Acceptance criteria

- [ ] `ENTRY / DECISION / CANCEL / ERROR / RETRY / TERMINAL / RETURN` 계약이 유지된다.
- [ ] venue, benefit, final KRW가 checkout header와 exact return에 끝까지 고정된다.
- [ ] positive balance는 정의된 provenance를 가지며 `no funds added`와 동시에 보이지 않는다.
- [ ] KRW primary/USD substantiated secondary이고 OOKRW/USDC/USDT/network는 detail/Labs에만 있다.
- [ ] normal unavailable은 Payment/funding/balance/receipt/stamp mutation 0이며 review fixture와 분리된다.
- [ ] 정적 `NOT_CONFIGURED`에는 무의미한 Retry가 없고, 연결된 provider의 일시 실패에서만 같은 checkout Retry를 제공한다.
- [ ] confirm 직전과 result에 no external order/no real money movement consequence가 보인다.
- [ ] payment/local receipt/unique visit/stamp/badge가 별도 state·time·visual event다.
- [ ] payment alone은 stamp/reputation을 바꾸지 않고 unique new evidence만 9→10을 만든다.
- [ ] `FX-STM-10`은 explicit QA/review mode에서만 provenance와 외부 방문 확인 없음 범위를 표시하고, normal public 경로의 stamp delta는 0이다.
- [ ] failure/cancel/timeout/duplicate에서 assets·acceptedEvidence·stamp 불변이다.
- [ ] KO/EN/JA와 320/360/390/430/844×390, 200% zoom, keyboard, SR, forced colors, reduced motion을 통과한다.

## 11. PRD preservation ledger

| 보존 대상 | 현재 연결 | 개선 후 연결 | 검증 |
|---|---|---|---|
| REQ | `REQ-006`, `REQ-011`, `REQ-016` | currency/settlement hypothesis, checkout result, unique visit 9→10, opt-in Labs 유지 | requirement reachability |
| State | `PKY-*`, `PAY-IDLE/CONFIRMING/PROCESSING/SIMULATED-SUCCESS/FAILED/CANCELLED`, `STM-N09/N10`, `NFT-*` | separate Decision/Receipt/Visit/Milestone/Labs objects | state+mutation diff |
| Fixture | `FX-PKY-PENDING`, `FX-PKY-SUCCESS`, `FX-PKY-FAIL`, `FX-PAY-OOKRW-QUOTE`, `FX-PAY-PROCESSING`, `FX-PAY-SUCCESS`, `FX-PAY-FAIL`, `FX-PAY-CANCEL`, `FX-STM-10`, `FX-NFT-OPT-IN`, `FX-NFT-MINT-PENDING`, `FX-NFT-MINT-SUCCESS`, `FX-NFT-MINT-FAIL` | explicit review/Labs provenance로 보존 | normal-vs-fixture E2E |
| returnTo | `START_CHECKOUT`, `MINT_BADGE` | canonical cta/gate metadata와 matrix가 허용한 public venueId만(`MINT_BADGE` venueId 금지); offer/amount/scroll/focus는 navigation registry, funding draft는 token 밖 app memory에 두고 checkout과 milestone context를 분리 | one-shot/expiry/duplicate/forgery/privacy tests |
| Persistence | local balance/receipt/demo milestone은 allowlisted session state | payment instrument/private key/raw provider response 없음 | storage allowlist+reload audit |

## 12. 세 디자이너 합의 기록

| 관점 | 제안 | 최종 반영 |
|---|---|---|
| D1 제품 단순성 | 장소 offer→한 금액→기록→별도 방문→milestone의 단일 인과 | Wallet 탭 우회와 ticker prose를 제거하고 amount object를 고정 |
| D2 시각·인터랙션 | amount relation, receipt/visit/stamp를 서로 다른 object/time으로 표현 | shared Receipt/timeline/ring, one-shot≤500ms, sticky obstruction 0 |
| D3 신뢰·접근성 | balance provenance, no-order/no-money truth, unavailable no mutation | normal unavailable/review fixture 분리, consequence 전면, mutation whitelist |

잔여 이견: `없음`. 잔액을 예산으로 재정의하거나 숨기는 안은 기각하고, 정의된 기기 내 여행 잔액과 외부 입금 없음의 일관된 provenance를 채택했다.
