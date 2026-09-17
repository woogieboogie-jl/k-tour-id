# FL-018 · Labs Wallet and Bridge

상태: `THREE-DESIGNER CONSENSUS · IMPLEMENTATION READY`

## 2026-09-16 로컬 후속 계약 · 기념품 분기 우선

아래 본문의 일반 Labs/bridge 규격은 유지한다. 다만 소비자 기념품 분기는 [Journey–Pass 로컬 변경](../KTOUR_JOURNEY_PASS_LOCAL_2026-09-16.md)과 [모바일 인계 변경](../KTOUR_MOBILE_REFINEMENT_LOCAL_2026-09-16.md)이 우선한다. 아직 미커밋/미푸시/미배포이며 과거 운영 증거와 구분한다.

```text
Pass → 방문 컬렉션(서로 다른10곳) → [선택] 여행 기념품
 → 샘플 signer 준비 → 별도 만들기 동의 → 필요한 Person 확인
 → 현재 권한 재확인·1회 실행 → 샘플 결과 → 원 컬렉션·opener 복귀
```

- 일반 Labs·기술 자산 선택·bridge 화면을 기념품의 필수 경유지로 만들지 않는다. 샘플/미공개 결과 안내와 개인정보·별도 동의는 유지하며, 기술 네트워크 상세는 소비자 첫 화면의 선행 과제가 아니다.
- 결제·가이드 저장·단순 열람은 방문 스탬프나 mint를 자동 실행하지 않는다. 기념품도 기본 해커톤 필수 연동 범위를 늘리지 않는다.
- **일반 bridge**의 제출 후 닫기는 같은 pending phase를 보존한다. **집중형 기념품**의 준비 중 취소는 해당 pending action/token을 폐기해 뒤늦은 결과를 막는다. 두 취소 의미를 혼동하지 않는다.
- 아래 `USDC/USDT/OOKRW는 Labs` 원칙은 기본 여행 잔액을 기술 ticker로 대체하지 않는다는 뜻이다. 별도 명시적 스테이블코인 충전에서 자산·네트워크를 선택하는 기존 흐름을 금지하지 않는다. 자산 표현 분리와 출발 확정≠도착 반영은 그대로다.
- 실제 공개 tx 없이 `TESTNET` 실행 완료·explorer·공개 NFT를 만들지 않는다. 다크 완료 화면의 body/header만 공통 Sheet surface로 맞추며 일반 Labs/bridge 처리에는 영향이 없다.

## 1. Flow contract

| 항목 | 값 |
|---|---|
| 연결 요구 | `REQ-004`, `REQ-005`, `REQ-006`, `REQ-014`, `REQ-016` |
| 진입 행동 | Wallet의 folded `Labs`, 또는 10번째 unique visit 뒤 명시적으로 opt-in한 badge의 `Labs에서 보기` |
| 성공 결과 | 동의한 사용자에게만 fixture signer, separate USDC/USDT/OOKRW asset rows, quote와 `source submitted → source confirmed → relaying → destination confirmed` timeline, simulated receipt를 보여준다. |
| 취소 결과 | quote/confirm 단계 취소는 `BRG-CANCELLED + BRP-NONE`; 실제·simulated balance와 normal travel balance를 바꾸지 않고 Wallet/Labs opener로 돌아간다. |
| 실패·재시도 | wallet/bridge/mint 실패는 phase와 recovery를 표시하고 assets invariant를 유지한다. pending 이후 close는 취소 성공을 가장하지 않고 같은 phase를 보존해 Labs에서 다시 연다. |
| 정확한 복귀 | 일반 Labs 진입은 Wallet section, disclosure state, scroll, opener focus를 shell local state로 보존한다. badge branch token은 정확히 `RT-MINT_BADGE-${Date.parse(createdAt)}`이며 canonical envelope에는 venue/table/milestone object를 넣지 않는다. milestone section·scroll·focus는 별도 local snapshot으로 exact return하고 terminal mutation 직전에만 token을 소비한다. |
| 실행 truth | wallet·bridge·mint fixture는 예외 없이 `SIMULATED`; 화면에 정확히 `Target network: Sui Testnet · Simulated`를 표시한다. 검증 가능한 public `txRef`가 있을 때만 해당 실행을 `TESTNET`으로 승격한다. |

### 삭제할 수 없는 PRD 불변식

- Labs는 normal Wallet·checkout·bottom navigation의 primary path 밖에 있고 명시적 disclosure와 동의 뒤에만 열린다.
- USDC, USDT, OOKRW는 chain/representation별 separate asset row다. 하나의 실제 USD 또는 KRW balance로 합치지 않는다.
- OOKRW는 test token mock settlement hypothesis이며 KRW fiat, deposit, redeemable claim, 1:1 보증으로 표현하지 않는다.
- bridge phase 순서는 `BRP-SOURCE-SUBMITTED → BRP-SOURCE-CONFIRMED → BRP-RELAYING → BRP-DESTINATION-CONFIRMED`다. source confirmed는 destination success가 아니다.
- destination confirmed와 valid terminal fixture 전에는 simulated destination asset view도 증가시키지 않는다. 실제 asset은 모든 fixture 단계에서 불변이다.
- public `txRef`가 없으면 transaction success, explorer link, `TESTNET` truth를 만들지 않는다.
- AMM, pool, liquidity, swap execution은 `Deferred`이며 quote fixture를 시장가격·실행으로 표현하지 않는다.
- payment result, unique visit, stamp, badge opt-in, wallet connect, mint는 각각 별도 사건이다.

## 2. 현재 경험 진단

| 문제 | 사용자 영향 | 심각도 | 근거 화면·상태 |
|---|---|---|---|
| Labs technical assets가 normal travel balance와 같은 hierarchy에 보일 수 있다. | test token과 쓸 수 있는 KRW/USD를 혼동한다. | P0 | Wallet/Labs entry |
| source confirmed에 success check 또는 destination balance가 나타날 수 있다. | bridge가 끝나지 않았는데 자산 도착을 믿는다. | P0 | `BRG-PENDING + BRP-SOURCE-CONFIRMED` |
| fake tx hash/explorer와 `testnet success`가 fixture 결과에 붙을 수 있다. | 실제 공개 transaction이 있다고 오인한다. | P0 | bridge/mint receipt |
| USDC/USDT/OOKRW를 합산 USD/KRW 카드로 보여줄 수 있다. | asset·chain·representation과 환산 basis를 잃는다. | P0 | `AST-*` asset view |
| bridge 설명이 긴 개발자 prose와 여러 nested card로 보일 수 있다. | 현재 phase, 다음 행동, 자산 불변이 첫 viewport에서 사라진다. | P1 | Labs full task mobile |
| pending close를 cancel처럼 처리할 수 있다. | 이미 제출된 fixture phase와 사용자 기대가 충돌한다. | P1 | `BRG-PENDING` close/reopen |

## 3. 목표 경험

### 한 문장 약속

> 기술 데모임을 먼저 동의하고, 자산별 상태와 bridge의 현재 단계를 과장 없이 끝까지 추적한다.

### 사용자가 1초 안에 알아야 하는 것

- 이 화면은 normal travel balance가 아닌 Labs simulation이다.
- 지금 source, relay, destination 중 어느 단계인지 알 수 있다.
- 완료 전에는 어떤 balance도 늘지 않고 public transaction이 없으면 explorer가 없다.

### 사용자가 읽지 않아도 알아야 하는 것

- 네 단계 timeline에서 완료·현재·미도달이 glyph와 line style로 구분된다.
- asset은 separate rows로 남고 합산 total이 없다.
- close 뒤 다시 열어도 pending phase가 이어져 제출과 취소를 혼동하지 않는다.

## 4. 권장 모바일 여정

```text
WALLET OR BADGE ENTRY
→ LABS DISCLOSURE + CONSENT
→ WAL-CONNECTING
→ WAL-READY | WAL-FAILED | CANCEL
→ SELECT SEPARATE ASSET + QUOTE
→ BRG-CONFIRMING
→ SOURCE SUBMITTED
→ SOURCE CONFIRMED
→ RELAYING
→ DESTINATION CONFIRMED | FAILURE
→ SIMULATED RECEIPT OR RETRY
→ EXACT WALLET/LABS OR BADGE RETURN
```

| 단계 | 화면의 한 가지 질문 | 주 시각 객체 | 주 행동 | 보존 context |
|---|---|---|---|---|
| Entry | Labs simulation을 열까요? | target truth + concise disclosure | 동의하고 계속 | Wallet section 또는 badge milestone opener |
| Connect | fixture signer를 준비할까요? | wallet glyph + target truth | 연결 | consent, normal balance unchanged |
| Asset decision | 어떤 separate asset을 볼까요? | USDC/USDT/OOKRW rows | asset 선택 | chain representation, available/reserved/pending |
| Quote | 이 simulated route를 확인할까요? | amount, fee, route, expiry | quote 확인 | source/destination assets snapshot |
| Confirm | 시작 후 단계별 상태를 추적할까요? | consequence + four-phase timeline | bridge 시작 | quote, no real movement truth |
| Pending | 지금 어느 phase인가요? | current phase glyph/line | 닫기 또는 상태 보기 | phase persisted; assets unchanged |
| Terminal | destination까지 완료됐나요? | destination check 또는 failure warning | receipt 보기/다시 시도 | simulated-only asset view |
| Return | 원 Wallet/Labs 또는 badge인가요? | opener focus | 계속 | exact section/scroll/focus or one-shot badge RT |

## 5. 화면별 상세 규격

### Screen A · Labs disclosure and connect

**목적**

- normal consumer Wallet과 technical simulation의 경계를 동의 전에 명확히 한다.

**첫 viewport에 보이는 것**

- 제목 `Labs`, 정확한 line `Target network: Sui Testnet · Simulated`.
- `실제 자산은 움직이지 않아요` 한 줄, consent, primary `Labs 열기`.
- Wallet 또는 badge로 돌아가는 close/back.

**시각·인터랙션**

- Full task route 또는 100dvh sheet이며 normal bottom dock를 숨기고 header에 back/close 하나만 둔다.
- target truth는 full task header 아래 compact persistent line 한 번으로 고정한다. asset/quote/timeline의 nested card마다 반복해 첫 viewport를 밀어내지 않는다.
- K-Tour ID logo는 signer/identity 의미가 실제 필요한 connect header에만 원본 비율로 사용할 수 있고 장식 watermark로 반복하지 않는다.
- consent 전 address, asset, quote, success fixture를 pre-populate하지 않는다.
- connect pending은 wallet glyph 내부 progress로 보이고 success card skeleton을 쓰지 않는다.

**행동**

- Primary: `Labs 열기`; consent 후 `지갑 연결`
- Secondary: `돌아가기`
- Close/Back: exact Wallet section 또는 badge milestone로 복귀

**정보 배치**

| 처리 | 정보 |
|---|---|
| 항상 표시 | Labs scope, target truth exact label, no-real-assets consequence, consent, primary |
| 시각화 | wallet disconnected/connecting/ready/failed glyph, consent state |
| 한 번 접기 | fixture signer 범위, address privacy, disconnect effect |
| Labs/개발 문서로 이동 | fixtureId, sourceId, adapter, raw diagnostics; 이 full task가 기술 정보의 소비자 경계다. |
| 삭제 | normal Wallet의 technical ticker, fake provider logo wall, `testnet live`, 자동 connect, explorer shortcut |

### Screen B · Separate asset view and quote

**목적**

- asset representation을 합치지 않고 simulated bridge input을 고른다.

**첫 viewport에 보이는 것**

- USDC, USDT, OOKRW separate rows와 각 chain/representation, available/reserved/pending.
- 선택 asset amount field, `Quote`, target truth.

**시각·인터랙션**

- combined `USD total`이나 `KRW total`을 만들지 않는다. 환산 값이 있으면 read-only estimate이며 basis/time을 같은 row에 둔다.
- 320/360 portrait의 asset row는 `asset+representation`과 `amount+state`의 두 줄 구조로 wrap한다. amount를 좁은 trailing column에 압축하거나 ellipsis하지 않고, 390/430에서만 같은 row 정렬을 허용한다.
- OOKRW row에는 `test token` scope를 항상 붙이고 KRW symbol을 primary balance처럼 쓰지 않는다.
- asset pictogram은 서로 다른 silhouette를 쓰되 dollar/wan glyph만으로 fiat를 암시하지 않는다. available/reserved/pending은 glyph+text로 읽히며 색만으로 구분하지 않는다.
- `AST-STALE/ERROR`는 clock/warning glyph와 text로 구분하고 quote primary를 차단한다.
- numeric input은 locale formatting과 tabular numeral을 쓰며 asset precision을 accessibility label로 읽는다.

**행동**

- Primary: `견적 보기`
- Secondary: asset row 선택, `자산 상세`
- Close/Back: Labs overview; normal Wallet balance 불변

**정보 배치**

| 처리 | 정보 |
|---|---|
| 항상 표시 | separate asset name, chain/representation, asset state, input, target truth |
| 시각화 | row-specific icon, available/reserved/pending segments, stale/error glyph |
| 한 번 접기 | estimate basis/time, representation details, quote fee/expiry |
| Labs/개발 문서로 이동 | token address, decimals, fixture ledger, raw quote diagnostics |
| 삭제 | combined USD/KRW balance, fiat/redemption/1:1 claim, AMM/pool/liquidity/swap CTA |

### Screen C · Quote confirmation and ordered bridge

**목적**

- 시작 전 consequence를 확인하고 source와 destination finality를 순서대로 보여준다.

**첫 viewport에 보이는 것**

- selected source asset+amount, destination representation, fee, quote expiry.
- `실제 자산은 움직이지 않아요`, primary `시뮬레이션 시작`, four-phase timeline 첫 row.

**시각·인터랙션**

- timeline은 `source submitted`, `source confirmed`, `relaying`, `destination confirmed` 순서를 고정한다.
- completed는 check, current는 progress, future는 outline. source confirmed에서 overall success check를 금지한다.
- `BRG-PENDING` 중 close는 phase를 보존하고 `계속 진행 중` entry row를 Labs overview에 남긴다. 취소로 표현하지 않는다.
- destination confirmed terminal fixture 전에는 simulated destination available도 변경하지 않는다.

**행동**

- Primary: quote가 유효할 때 `시뮬레이션 시작`; pending은 자동 phase update/상태 새로 읽기
- Secondary: submit 전 `취소`; pending 후 `닫기`
- Close/Back: submit 전 cancel, submit 후 phase 보존 + Labs opener 복귀

**정보 배치**

| 처리 | 정보 |
|---|---|
| 항상 표시 | source/destination/amount/fee/expiry, target truth, no-real-assets consequence, current phase |
| 시각화 | ordered four-step timeline, completed/current/future line styles, immutable asset mini-summary |
| 한 번 접기 | quote route, fixture provenance, phase timestamps |
| Labs/개발 문서로 이동 | relayer diagnostics, source/destination fixture IDs, raw simulated receipt |
| 삭제 | source-confirmed success, destination balance early increase, fake tx hash/explorer, market execution claim |

### Screen D · Terminal receipt, failure, badge branch

**목적**

- terminal simulation과 failure를 구분하고 optional badge를 독립 사건으로 유지한다.

**첫 viewport에 보이는 것**

- success는 destination-confirmed timeline + simulated receipt summary; failure는 stopped phase + retry.
- 모든 결과에 exact target truth와 `실제 자산 변화 없음`.
- badge는 `STM-N10 + NFT-OPTED-IN + WAL-READY`일 때만 별도 action.

**시각·인터랙션**

- public `txRef`가 없으면 explorer row 자체를 렌더하지 않는다. 임의 hash를 흐리게 만들지 않는다.
- failure는 phase를 지우지 않고 stopped node에 warning을 둔다. retry는 canonical allowed phase부터 이어간다.
- simulated receipt는 actual bank/card/merchant receipt와 다른 Labs visual label을 유지한다.
- badge mint success도 `SIMULATED`; payment receipt나 bridge success가 unique visit/stamp를 만들지 않는다.

**행동**

- Primary: success `Labs로 돌아가기`, failure `다시 시도`
- Secondary: `상세 보기`; eligible opt-in branch만 `기념 배지 보기`
- Close/Back: exact Labs section 또는 `MINT_BADGE` milestone opener

**정보 배치**

| 처리 | 정보 |
|---|---|
| 항상 표시 | terminal/failure, completed/stopped phase, target truth, asset invariance, recovery |
| 시각화 | destination terminal check 또는 stopped warning, receipt summary, badge eligibility glyph |
| 한 번 접기 | receipt ID, phase timestamps, fixture provenance, mint scope |
| Labs/개발 문서로 이동 | raw receipt, fixture IDs, diagnostics; public txRef가 생긴 실행만 explorer |
| 삭제 | fake explorer/hash, real transaction wording, automatic NFT mint, payment→stamp/badge causal shortcut |

## 6. 상태·오류·복귀

| 상태 | 보이는 변화 | 가능한 행동 | 데이터·맥락 불변식 |
|---|---|---|---|
| Loading | consent/connect/quote/phase 각각 현재 객체 안 progress | 닫기 | normal balance·actual assets·stamp 불변 |
| Empty | wallet disconnected 또는 asset rows 없음; target truth와 connect/retry | 연결, 돌아가기 | 가짜 address/asset 생성 0 |
| Failure | `WAL-FAILED`, `AST-ERROR`, `BRG-FAILED`, `NFT-FAILED` 별 warning | 해당 객체 재시도, 닫기 | stopped phase 보존; actual/simulated balance 불변(terminal 전) |
| Retry | wallet은 connect 재시작, bridge는 allowed stopped phase에서 재개 | 취소 가능 단계만 취소 | quote/phase provenance 보존, duplicate submit 차단 |
| Cancel | quote/confirm 전 `BRG-CANCELLED + BRP-NONE` | 새 quote, 돌아가기 | balance/assets/stamp unchanged |
| Success | `BRG-SIMULATED-SUCCESS + BRP-DESTINATION-CONFIRMED`에서만 simulated receipt/asset view 갱신 | receipt, Labs 돌아가기 | actual assets 불변; `SIMULATED` truth |
| Return | exact Wallet Labs disclosure/scroll/focus 또는 badge milestone | 기존 action 계속 | pending phase 보존; badge RT terminal 직전 one-shot consume |

## 7. Motion choreography

| 전이 | duration/easing | 공간 규칙 | reduced motion |
|---|---|---|---|
| Wallet→Labs full task | 280~320ms | opener row와 Labs header shared anchor; normal dock는 함께 fade | duration 0 + focus title |
| consent→connect | 160~200ms body swap | target truth header 고정 | 즉시 swap |
| asset→quote | 180~220ms | selected asset row가 quote summary로 확장, row center 고정 | 즉시 state change |
| phase advance | 220~300ms line fill | 순서대로 한 node만 current; future node 이동 0 | 즉시 glyph/text + live announcement |
| destination terminal | 220~360ms | destination node만 check; 전체 card scale/confetti 없음 | static terminal state |
| failure→retry | 160~200ms | stopped phase·amount·asset anchor 고정 | 즉시 state change |
| close/return | 240~280ms | exact opener section/scroll 유지 | 즉시 close + focus restore |

## 8. Copy·localization

| 역할 | KO | EN | JA | 규칙 |
|---|---|---|---|---|
| Title | Labs | Labs | Labs | normal Wallet 밖 technical area |
| Target truth | Target network: Sui Testnet · Simulated | Target network: Sui Testnet · Simulated | Target network: Sui Testnet · Simulated | exact immutable technical label |
| Consequence | 실제 자산은 움직이지 않아요 | No real assets move | 実際の資産は移動しません | consent·confirm·result에 짧게 |
| Open CTA | Labs 열기 | Open Labs | Labsを開く | consent 뒤 |
| Connect CTA | 지갑 연결 | Connect wallet | ウォレットを接続 | fixture signer scope |
| Quote CTA | 견적 보기 | View quote | 見積もりを見る | execution 아님 |
| Confirm CTA | 시뮬레이션 시작 | Start simulation | シミュレーションを開始 | Labs에서는 truth 직접 표시 |
| Phase 1 | source 요청 제출 | Source submitted | 送信元リクエスト提出済み | success 아님 |
| Phase 2 | source 확인 | Source confirmed | 送信元確認済み | destination pending |
| Phase 3 | destination으로 전달 중 | Relaying | 転送中 | balance unchanged |
| Phase 4 | destination 확인 | Destination confirmed | 送信先確認済み | terminal fixture only |
| Failure | {phase}에서 멈췄어요 | Stopped at {phase} | {phase}で停止しました | stopped phase 유지 |
| Retry | 다시 시도 | Try again | もう一度試す | allowed phase부터 |

- exact target truth를 축약해 `Sui Testnet`, `testnet live`, `onchain`만 표시하지 않는다.
- USDC/USDT/OOKRW는 Labs에서만 technical asset name으로 보이며 normal Wallet accessible name에도 누출하지 않는다.
- `deposit`, `withdrawn`, `received`, `minted onchain`은 검증 가능한 public transaction 없이 쓰지 않는다.

## 9. Accessibility·responsive

- 320×568/800·360px edge 16px, 390×844·430px edge 20px; full task 하나의 scroll container와 safe-area footer를 쓴다.
- 844×390에서는 asset/quote summary와 timeline을 2-column로 배치할 수 있으나 header/footer를 동시에 fixed해 body를 120px 이하로 만들지 않는다.
- consent, asset row, primary, close는 48px default, 최소 44×44px, gap 8px 이상이다.
- timeline은 ordered list semantics와 `완료/현재/예정` KO/EN/JA accessible state를 가진다. line color만으로 phase를 전달하지 않는다.
- phase advance, failure, terminal을 polite live region으로 한 번만 알린다. 전체 timeline 반복 낭독을 금지한다.
- connect/bridge sheet는 focus trap, Escape 동작을 단계별로 구분한다. submit 전 Escape=cancel 확인, pending 후 Escape=close+phase preserve다.
- 200% zoom에서 asset name, chain, amount, fee, target truth, recovery가 잘리지 않고 footer가 마지막 phase를 덮지 않는다.
- forced colors에서 separate asset rows, current/completed/future phase, stale/error가 border·glyph·text로 구분된다.
- reduced motion에서도 phase order와 terminal 조건을 static ordered list로 완전히 이해할 수 있다.

## 10. 계측·완료 기준

### UX signal

- consent, connect, asset select, quote, confirm, phase, close/resume, retry, terminal을 fixtureId와 함께 기록하되 address·raw asset identifiers는 analytics에서 제외한다.
- source-confirmed 조기 success, destination-terminal 전 balance delta, fake txRef/explorer, actual asset mutation을 invariant violation으로 즉시 실패시킨다.
- pending close/reopen phase continuity와 `MINT_BADGE` exact return·one-shot consume를 자동 검증한다.

### Acceptance criteria

- [ ] `ENTRY / DECISION / CANCEL / ERROR / RETRY / TERMINAL / RETURN` 계약이 유지된다.
- [ ] Labs는 normal Wallet/checkout/nav 밖에서 explicit disclosure+consent 후만 열린다.
- [ ] 모든 wallet/bridge/mint fixture에 exact `Target network: Sui Testnet · Simulated`와 `SIMULATED` provenance가 있다.
- [ ] USDC/USDT/OOKRW는 separate asset row이며 combined USD/KRW actual balance가 없다.
- [ ] target truth는 full task의 compact persistent line 한 번이고 nested card마다 반복하지 않으며, 320/360 asset row가 두 줄로 wrap되어 amount/state가 잘리지 않는다.
- [ ] phase가 source submitted→source confirmed→relaying→destination confirmed 순서이고 source confirmed는 success가 아니다.
- [ ] terminal 전 simulated destination balance delta가 0이고 모든 fixture에서 actual asset delta가 0이다.
- [ ] public txRef가 없으면 explorer link, transaction success, `TESTNET` truth가 없다.
- [ ] failure/timeout/cancel은 assets·normal travel balance·stamp·reputation을 변경하지 않는다.
- [ ] AMM/pool/liquidity/swap은 `Deferred`; quote가 execution/market price로 표현되지 않는다.
- [ ] badge는 unique visit 10회+opt-in+wallet ready 뒤 별도 사건이며 payment/bridge가 stamp를 만들지 않는다.
- [ ] 320/360/390/430, 320×568, 844×390, 200% zoom에서 clipping·overflow·footer overlap이 없다.
- [ ] KO/EN/JA, keyboard, screen reader, forced colors, reduced motion을 통과한다.

## 11. PRD preservation ledger

| 보존 대상 | 현재 연결 | 개선 후 연결 | 검증 |
|---|---|---|---|
| REQ | `REQ-004` evidence interface, `REQ-005` optional identity/wallet boundary, `REQ-006` bridge hypothesis, `REQ-014` contract truth, `REQ-016` opt-in badge | consented Labs full task + separate assets + ordered bridge + independent badge | requirement trace + Labs E2E |
| State | `WAL-*`, `AST-*`, `BRG-*`, `BRP-*`, `NFT-*`, `STM-*` | source/destination finality와 milestone causal boundary 유지 | reducer illegal-transition/asset-delta tests |
| Fixture | `FX-WAL-LABS-*`, `FX-BRG-QUOTE/CONFIRM/SOURCE-SUBMITTED/SOURCE-CONFIRMED/RELAYING/DESTINATION-CONFIRMED/SIM-FAIL/CANCEL`, `FX-NFT-*` | all `SIMULATED`, fixture provenance, no public txRef | fixture registry/truth/explorer negative tests |
| returnTo | 일반 Labs gate 없음; badge만 `MINT_BADGE`, `RT-MINT_BADGE-${Date.parse(createdAt)}` | envelope에는 canonical CTA/gate fields만; Wallet/milestone section·scroll·focus는 별도 local snapshot, badge terminal mutation 직전 one-shot | close/resume/cancel/fail/duplicate/tampered/unknown-field E2E |
| Persistence | wallet/bridge/NFT demo session, pending phase 보존 | normal balance 분리, consent·fixture phase만 allowlist, actual asset mutation 0 | storage/reset/asset invariance audit |

## 12. 세 디자이너 합의 기록

| 관점 | 제안 | 최종 반영 |
|---|---|---|
| D1 제품 단순성 | Labs를 normal Wallet에서 접고 현재 phase와 다음 행동만 전면에 둠 | explicit entry 후 asset→quote→ordered timeline의 single journey로 고정 |
| D2 시각·인터랙션 | separate asset rows와 four-node timeline, stable anchors, compact receipt | source/destination phase를 움직이지 않는 glyph/line grammar로 고정 |
| D3 신뢰·접근성 | exact target truth, no fake txRef, asset invariance, pending close semantics | `SIMULATED`·ordered finality·screen-reader timeline·negative invariants를 release blocker로 고정 |

잔여 이견: `없음`.
