# ONDO PRD preservation ledger

상태: `LOCKED INPUT FOR UX REDESIGN · 2026-09-04`

이 문서는 더 단순하고 아름다운 화면을 만들다가 기존 PRD 기능을 삭제하거나
의미가 다른 상태를 합치는 일을 막는다. 화면에서 문장이 사라질 수는 있지만,
사용자 결정·동의·실패·복귀·제품 truth는 사라질 수 없다.

## 1. 절대 합치지 않는 제품 축

| 축 | 뜻 | 다른 축의 성공으로 자동 충족되는가 | 기본 노출 방식 |
|---|---|---:|---|
| Guest | 계정 없는 탐색 | 해당 없음 | 설명 없이 바로 지도 사용 |
| Account | 저장·Table 등 앱 세션 | 아니오 | 해당 행동의 JIT sheet |
| Person | 한 사람임을 확인한 결과 | 아니오 | Person이 필요한 행동에서만 |
| 19+ | 보호된 주류·Table 행동의 성인 조건 결과 | 아니오 | 해당 보호 행동에서만 |
| Payment KYC | 결제 정책 확인 결과 | 아니오 | 결제를 계속할 때만 |
| K-Tour ID | 최소 자격을 보관·제시하는 private service credential | 아니오 | 재사용 가치가 생기는 시점 |
| Reputation | Visit·Contribution·Meetup·Identity reference의 분리 기록 | 아니오 | 해당 행동이 끝난 뒤 변화한 축만 |

`verified`, `ready`, `trusted` 하나로 위 상태를 통합하는 디자인은 금지한다.
화면에서는 지금 필요한 축 하나만 전면에 두고, 나머지는 ID · Wallet의 상태
목록 또는 상세 disclosure에서 독립적으로 확인한다.

지도 utility의 공개 night-view 자기선언은 별도 신원 축이 아니다. 현재 탭의
dark/neon presentation과 night subset 강조만 열며 `Account`, `Person`, `19+`,
`Payment KYC`, `K-Tour ID` 중 어떤 것도 충족하거나 보호 행동을 잠금 해제하지 않는다.

## 2. Requirement 보존 매트릭스

| REQ | 사용자 가치 | 반드시 남길 기능·상태 | 주 Flow | UX 단순화 허용 범위 |
|---|---|---|---|---|
| `REQ-001` | 한국인 Mobile ID 경로 | OmniOne CX 선택, pending/success/cancel/fail/expire, Person만 변경, 원 행동 복귀 | `FL-005`, `FL-008` | provider명은 상세로 접을 수 있으나 경로·결과·실패는 삭제 금지 |
| `REQ-002` | 장기체류자 경로 | Residence Card 지원/미지원/대체 Passport, 원 행동 복귀 | `FL-006`, `FL-009` | 기술 설명은 접되 unavailable과 대체 행동은 항상 보임 |
| `REQ-003` | 단기 여행자 신원과 첫 기여 | Passport eKYC Person 경로와 Local Signal을 분리, Visit/Contribution만 허용 | `FL-006`, `FL-007`, `FL-012` | onboarding에서 선제 eKYC 금지; 필요한 행동에 흡수 가능 |
| `REQ-004` | 증거 표준화 | OpenDID/EAS 독립 adapter, canonical envelope, contract-only truth | `FL-016`, `FL-018` | 일반 화면에서 숨기되 Labs·상세에서 확인 가능해야 함 |
| `REQ-005` | 로그인·검증 분리 | Account/Person/Age/Payment 분리, optional zkLogin Labs, one-shot `returnTo` | `FL-005`, `FL-006`, `FL-010`, `FL-017`, `FL-018` | 여러 설명 카드를 한 readiness sheet로 조율 가능; 상태 축은 합치지 않음 |
| `REQ-006` | 디지털 달러·bridge 가설 | USDC/USDT/OOKRW 분리, ordered bridge, 자산 불변, AMM Deferred | `FL-018` | ticker/network는 결제 상세·Labs로 접음; 실제 이동처럼 표현 금지 |
| `REQ-007` | 식음료 발견과 ONDO | 실제 지도, 공식 장소, source-bounded ONDO, freshness/confidence | `FL-001`, `FL-012` | 숫자는 선택 전 숨길 수 있으나 데이터·범례·접근 가능한 의미는 유지 |
| `REQ-008` | 장소 기반 함께 먹기 | Table availability/membership/chat 분리, 선택 공개 profile, safety actions | `FL-003`, `FL-015` | 카드 수는 줄여도 6개 계획 사실과 Report/Block/Leave는 유지 |
| `REQ-009` | 현장 사진 기여 | 선택/preview/replace/remove/fail/retry, local-only 경계 | `FL-012` | 구현 설명은 접되 업로드 여부와 실패는 오해 없게 표시 |
| `REQ-010` | Table 이미지 대화 | confirmed-member guard, pending/sent/fail/retry, 삭제 경계 | `FL-003` | 메시지 상태를 아이콘화 가능; 실패·재시도 행동 삭제 금지 |
| `REQ-011` | 여행 잔액 기반 결제 데모 | KRW 주 표시, USD 보조, hidden ticker detail, Payment KYC, receipt/failure/cancel | `FL-004`, `FL-017` | OOKRW/USDC/USDT는 접되 금액·효과·실제 이동 없음 truth는 유지 |
| `REQ-012` | 밤 식음료 탐색과 보호된 19+ 행동 | 탭 한정 self-declared night-view, 보호 행동 manual proof·provider fail-closed, 네 guard auto mode, immediate off, expiry, 일반 야간 식당 유지 | `FL-002`, `FL-013`, `FL-014` | 공개 presentation과 보호 Age를 분리하고 긴 설명은 1회 consent로 축약; Age를 Account/Person/Payment/K-Tour ID와 합치지 않음 |
| `REQ-013` | 가기 전 필요한 사실 | 카드·번호·예약·언어·연령의 yes/conditional/no/unknown | `FL-001`, `FL-016` | 별도 제품/장문을 만들지 않고 장소 fact grid로 시각화 |
| `REQ-014` | 제한적 merchant trait | policy/venue/offer 범위, stale/error/unknown, contract-only truth | `FL-016` | 일반 장소에는 결정에 필요한 fact만; 상세는 disclosure/Labs |
| `REQ-015` | 행동 기반 신뢰 | Identity/Visit/Contribution/Meetup 네 축, 종합 점수 없음 | `FL-003`, `FL-012`, `FL-015` | 긴 설명 대신 타임라인·네 축 visual; 의미는 합치지 않음 |
| `REQ-016` | 10회 여행 기억 | unique visit만 stamp, 9→10, opt-in badge, 결제와 분리 | `FL-004`, `FL-018` | 2026-09-16 로컬 UX 개정: 진행·컬렉션의 홈은 Travel Pass, 적립 진입은 장소 상세. 배지는 선택형 집중 화면에서 기존 Labs 실행 계약 재사용. 결제·신원 자격과 분리 유지 |
| `REQ-017` | 서울·부산 중심 전국 shell | 서울 200, 부산 200, 제주 editorial, 다른 지역 허위 숫자 금지 | `FL-001` | 전국 intro 카피·숫자 축약 가능; 실제 지역과 source 차이는 유지 |
| `REQ-018` | responsive web | 320/360/390/430 중심, tablet/desktop/landscape, KO/EN/JA | 전 Flow | desktop을 기준으로 줄이는 방식 금지; mobile first composition |
| `REQ-019` | 온도를 강하게 시각화 | field/aura/core/selection grammar, 숫자·신뢰·freshness 접근성 | `FL-001` | 기본 지도에서는 aura-first 가능; 선택/목록/상세에 정확한 의미 제공 |

## 3. 결정 원장 amendment 보존

### D-13 · 소비자 통화

- 기본 소비자 단위는 `KRW`, 필요한 경우 보조 예상값은 `USD`다.
- `OOKRW`, `USDC`, `USDT`, network와 settlement는 사용자가 여는 결제 상세나
  Labs에만 둔다.
- 외부 provider가 없을 때 실제 충전·환전·결제·환불 성공을 주장하지 않는다.
- 일반 화면의 `simulation/test/preview` 제작자 언어는 줄이되, 사용자가 돈이
  움직였다고 오해할 지점에는 `실제 금액 이동 없음`을 한 번 명시한다.

### D-14 · 세 도시의 한 시각 문법

- 서울·부산·제주는 `field → aura → core → selected halo → place capsule`의 같은
  renderer와 interaction을 쓴다.
- 서울·부산은 `curated-scored`, 제주는 `editorial-unscored`다.
- 제주는 장소·story 수를 ONDO 점수, 인기, 혼잡으로 변환하지 않는다.
- 제주도 실제 검증 좌표만 coverage field에 쓰고 좌표 없는 후보는 지도에 찍지 않는다.

### D-15 · 현재 B 지도

- 현재 B renderer는 `MapLibre`다. 역사적 Leaflet 명세로 되돌리지 않는다.
- atlas→city는 동일 지도 위 camera transition이며 별도 흰 전환 화면을 만들지 않는다.
- 800ms 이후 non-blocking progress, 5초 뒤 같은 query/filter/selection의 List를
  foreground로 올린다.
- reduced motion은 camera animation을 duration 0/jump로 바꾸지만 맥락은 같다.

## 4. Flow checkpoint 보존

모든 `FL-001`~`FL-018`은 다음 일곱 checkpoint를 가진다.

```text
ENTRY → DECISION → CANCEL | ERROR → RETRY → TERMINAL → RETURN
```

- 특정 Flow에 실제 retry UI가 필요 없다는 PRD 근거가 있는 경우만 `N/A`다.
- 성공 화면만 아름답고 실패·취소·재진입이 이전 디자인으로 남는 것은 완료가 아니다.
- gate Flow는 current location, city, map camera, query, filter, category, venue,
  Table, sheet, scroll, opener focus 중 해당 행동에 필요한 context를 보존한다.
- 성공은 원 행동 mutation 직전에 token을 한 번만 소비한다.
- cancel은 mutation 없이 정확한 직전 맥락으로 돌아간다.

## 5. 화면에서 줄일 수 있는 정보의 등급

| 등급 | 뜻 | 처리 |
|---|---|---|
| A · 결정 | 지금 선택·동의·결과에 필요 | 항상 보임; 아이콘은 보조 |
| B · 오해 방지 truth | 돈·신원·공식성·공개 범위를 오해할 수 있음 | 결정점 가까이에 한 줄 또는 상태 객체로 보임 |
| C · provenance | source, provider, freshness, method, receipt ID | 한 번 접기 |
| D · 기술 구조 | DID/VC/network/adapter/fixture 세부 | Labs 또는 개발 문서 |
| E · 제작자 자기설명 | `우리가 이렇게 만들었다`, 중복 status, preview 소개 | 삭제 후보 |

정보를 접는 것은 제거가 아니다. 접힌 정보도 keyboard, screen reader, Back/Forward,
reload에서 도달할 수 있어야 한다.

## 6. 데이터·브랜드 truth

- 소비자 제품은 `ONDO`; `K-Tour ID`는 여행 자격·잔액을 잇는 인프라와 Pass
  명칭으로 사용한다.
- 서울·부산 LOCALDATA 기록은 공식 라이선스 기록이지 인기·영업 중·맛·외국인
  친화 보증이 아니다.
- 제주 콘텐츠는 확인된 place edge를 가진 editorial만 장소 행동으로 연결한다.
- ONDO는 기온, 실시간 혼잡, 안전, 평점이 아니다.
- Table·chat·photo·Local Signal은 현재 브라우저·fixture 범위를 넘는 실제 사람,
  예약, 전송, moderation을 주장하지 않는다.
- K-Tour ID는 정부 신분증·비자·체류허가가 아니다.
- OOKRW는 상환 가능한 원화로 주장하지 않는다.
- badge는 실제 mint evidence가 없으면 NFT 발급 완료로 표현하지 않는다.

## 7. 화면 밖으로 이동해도 되는 것

다음은 기능 삭제가 아니라 위치 조정 대상이다.

| 현재 앞에 나오는 것 | 새 기본 위치 |
|---|---|
| provider/OmniOne/OpenDID 명칭 | 동의·결과의 `자세히` |
| OOKRW/USDC/USDT/network | 결제 상세 또는 Labs |
| LOCALDATA record ID/snapshot/date | 장소 source drawer |
| ONDO 산식·confidence 근거 | compact key → detail disclosure |
| on-device/storage mechanics | Settings의 데이터 상세 또는 결과 한 줄 |
| simulation/test/preview 설명 | 사용자 오해가 생기는 결정점 한 번; 나머지는 Labs |

## 8. 절대 숨기지 않는 것

- 지금 무엇을 승인·공개·지불·삭제하는지
- 결제 금액, 적용 혜택, 결과, 실패와 복구 행동
- 요청 주체, 필요한 proof, 사용 목적, consent 거절 경로
- 공식/편집 경계가 사용자의 장소 판단을 바꾸는 순간
- unavailable, unsupported, expired, stale, unknown
- destructive scope와 되돌릴 수 있는지 여부
- Table의 시간·메뉴·언어·비용·좌석·만남 방식
- 현재 사용자가 돌아갈 장소·Table·행동

## 9. 변경 승인 체크

화면을 구현하기 전에 각 PR에 다음을 증명한다.

- [ ] 어떤 문장을 없앴는지와 그 의미를 대신하는 시각·상태·interaction을 적었다.
- [ ] `REQ-001`~`REQ-019`의 reachability가 변하지 않았다.
- [ ] 정규 state 이름과 독립 축을 합치지 않았다.
- [ ] `returnTo` context와 one-shot consumption이 유지된다.
- [ ] provider 미연결·simulated·contract-only·deferred가 live처럼 보이지 않는다.
- [ ] Settings, 일본/제주 editorial, loading/error처럼 정규 Flow 사이 화면도 검토했다.
- [ ] 현재 B의 MapLibre·D-13·D-14·D-15를 역사적 문서로 회귀시키지 않았다.
- [ ] 변경 뒤 기존 자동 계약과 새 visual/meaning acceptance가 함께 통과한다.
