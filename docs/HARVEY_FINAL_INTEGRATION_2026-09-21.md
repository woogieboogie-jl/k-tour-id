# K-Tour ID — Harvey 최종본 로컬 통합·검수

> 2026-09-21. 실행 브랜치: `integration/harvey-final-20260921`.
> 검증한 앱 소스: `f83efff0` (최종 통합 코드/UX, 문서 커밋과 구분).
> 이 문서는 **실제 통합 상태**의 기준입니다. 기존 제품 기획의 가이드 저장 v2와 실제 Harvey 혜택 사용 v1을 같은 구현으로 취급하지 않습니다.

## 1. 합친 것과 유지한 것

- Harvey 최종 소스: [`JSHan94/k-tour-id@f4526af3`](https://github.com/JSHan94/k-tour-id/commit/f4526af3ecd35b73459776bd3b8e8c18dd245a0d), `feat/hackathon-integration-harvey`. 병합 커밋 `323d3f2e`.
- 기존 모바일 UX 후속본 `d55a31f0` 및 이전 통합 `60a3c835`를 유지했습니다. 기존 UX 파일을 Harvey 화면으로 덮어쓰지 않았습니다.
- 충돌은 해커톤 레이어·스타일·campaign 진입에서 해결했습니다. 단계 이동은 **읽기 전용 이력 보기**로 받아들였습니다. 범용 다음 버튼·자동 동의·자동 서명·자동 실행은 되살리지 않았습니다.
- 목업 월렛·충전·결제·예약·방문 스탬프는 유지합니다. 실제 결제/예약/방문이나 DID 발급 완료로 승격하지 않습니다.
- 이 단계에서는 **원격 push·배포를 하지 않았습니다.** 기존 공개 URL의 내용과 로컬 통합본을 구분하세요.
- 기존 미커밋 Harvey 실패/복귀 테스트 2개 파일은 내용을 보존·검토하고 `0507f5b6`에 별도로 기록했습니다. 작업 시작 전에 있던 다른 감사 문서/스크립트 4개는 수정·삭제하지 않았습니다.

## 2. 확인할 대표 흐름

```text
지도 → 지정 장소 → 체험 혜택
 → 사용자가 시작에 동의 → 신원 확인 → 패스 받기·보관 → 자격 제시
 → 제안 확인 → 대상·수신자·기한·1회 범위에 명시적으로 동의
 → 사용자 서명 → 제한된 Agent 실행 → 서버 최종 자격·결과 검증
 → 혜택 사용 기록 → OmniOne 기록 상태 확인 → 같은 장소 복귀
```

이력 보기는 API를 실행하지 않습니다. 이전 단계로 갔다가 돌아오면 서명 동의는 다시 선택해야 합니다. 창 닫기/새로고침은 완료나 취소를 의미하지 않으며, 진행 중인 작업은 서버 상태를 다시 읽습니다. 이미 방송했으나 결과가 불명인 **사용자 위임·Agent 거래**는 다시 보내거나 취소 성공으로 표시하지 않습니다. Issuer 발급 응답이 불명일 때는 후속 작업을 중단할 수 있지만, 이미 방송된 발급 거래가 취소되는 것은 아닙니다.

**별도 유지되는 제품 흐름:** 골목 가이드 무료 읽기 → 선택적 패스 컬렉션 저장(v2). 현재 Harvey의 지정 장소 혜택(v1)과 캠페인·동의·결과가 다릅니다. 이력/동의를 변환하거나 두 동작을 같은 성공으로 표시하지 않았습니다. v2까지 실연동하려면 별도의 캠페인·발급/저장 계약을 정해야 합니다.

## 3. 이번 수정

| 영역 | 반영 내용 |
|---|---|
| 장소 상세 | 온도 요약 축소, 공개 가이드 우선, 결제·예약은 넓은 행으로 정돈. 가이드·혜택·스탬프·모임 진입은 유지. 식당 예약과 모임 일정의 이름 구분. |
| 패스·월렛 | 스크롤 때문에 잘리던 패스 샘플 선택창을 고정 레이어로 이동. 0개 스탬프의 빈 장식 축소, 0/10·리셋 안내·탐색은 유지. 월렛의 같은 장소 찾기 중복 CTA를 하나로 통합. |
| 인증·접근성 | 인증 안내 대비/글자 크기 개선. 단계 이동 시 포커스 복구. OAuth 취소·실패를 한/영/일로 설명하고 원래 장소 복귀 제공. callback state를 해당 로그인 요청과 결합하고 URL 토큰 제거. |
| 중복·중단 | 동시 탭 차단. 창을 닫은 뒤 도착한 준비 응답으로 서명하지 않음. issuer 발급 전 DB claim, 방송 전 거래 digest 저장, 발급 결과를 PTB 준비 전에 저장. 불명 결과는 신규 실행 대신 조회. |
| 서버 검증 | CX의 엄격한 완료/성공·거래 일치 확인, 안정된 사용자 식별 요구, 실제 모드의 샘플 fallback 제거. Sui 이벤트·객체·권한·수신자·승인 범위·실행 기록 대조. 혜택 사용 직전 VC/VP/현재 자격 재검증. |
| 저장소 | 실패한 쓰기 rollback, 손상된 원장의 자동 초기화 금지, Redis 잠금 만료 후 오래된 쓰기 차단. 새 세션에서 외부가 정한 쿠키 ID를 채택하지 않음. |

## 4. 검증 결과와 한계

최종 검증 결과는 아래와 같습니다. 검증 대상은 고정 production **로컬 build3**이며, 새 외부 거래는 발생시키지 않았습니다.

- production build 및 TypeScript: 통과.
- 앱/UI contract 회귀 테스트: **917/917 통과**. Move/Solidity 계약 테스트 수가 아닙니다.
- 해커톤 단위/음성 테스트: **69/69 통과**. CX 공급자 응답, Sui 증거·발급 제어, Redis는 통제된 fixture이며 Sui digest는 로컬 SDK로 검증했습니다. 실 공급자·실 SDK 전송 성공 증명이 아닙니다.
- 브라우저 **66/66 통과**: 해커톤 UI fixture **28/28**, 실제 격리 로컬 BFF **4/4**, 현행 충전·스테이블코인·부분/잔액 환불 **12/12**, 모바일 UX **12/12** + 기존 R1/R2 **6/6** + 모서리 픽셀 **4/4**. 마지막 build3에서 모두 재실행했으며 이 선택된 66개에는 실패/skip이 없습니다. 전체 저장소의 모든 브라우저 테스트가 통과했다는 뜻은 아닙니다.
- 실제 build3 PNG 6장을 별도 디자인 리뷰로 확인했습니다. 증거는 `k-tour-id-app/artifacts/qa/`의 `harvey-integration-fixtures`, `harvey-bff-local`, `harvey-final-commerce-build3`, `ux-build3-20260921`, `ux-r1-r2-build3-20260921`, `ux-sheet-corners-build3-20260921`에 있습니다. 생성된 스크린샷/trace는 로컬 검수 산출물이며 Git에 올리지 않았습니다.
- WebKit은 앱 진입 전에 `Bus error 10 / exit 138`, Firefox는 실행 파일 미설치로 검증하지 못했습니다. Chromium 검증을 Safari/실기기 검증으로 확대 해석하지 않습니다.
- Harvey가 공유한 과거 Sui 거래 3건을 읽기 전용으로 조회: 체인 성공·발급/승인/실행 이벤트·Grant/ExecutionRecord 연결을 검증했습니다. 새 거래 0건. 당시 앱의 승인 원문·CX/OpenDID 성공·최종 서비스 사용·OmniOne 확정까지 입증하는 것은 아닙니다.

검수 이력도 구분합니다. 개발 서버의 동시 HMR로 불안정한 실행은 중단하고 고정 빌드로 다시 검수했습니다. 최초 실행의 모호한 selector, 짧은 화면의 테스트 클릭 좌표, HTTP API 테스트의 Secure cookie 전송 조건은 수정 후 재통과했습니다. 사용자 화면을 통과시키기 위해 동의·금액·인증 경계를 제거하지 않았습니다.

**보조 레거시 진단:** `ondo-b-flow8-wallet-direction.spec.ts`에서 추가 선택한 7개 중 첫 `FLOW8-FUNDING-SAMPLE-019` 실패로 6개는 실행되지 않았습니다. 예전 `funding-connected-sample` 한 화면→한 클릭 ₩60,000 계약을 기대하는 테스트인데, 현행은 ₩30,000 견적→별도 동의→확인→적립 단계입니다. 독립 리뷰에서 단순 selector 문제가 아닌 이전 계약의 잔존을 확인했습니다. 구형 테스트는 통과로 세지 않았고 유지보수 대상으로 남겼습니다. 위 12개 현행 commerce 테스트의 통과를 구형 7개의 통과로 대체하지 않습니다.

재실행:

```sh
cd k-tour-id-app
pnpm build:harvey:local
pnpm start:harvey:local
# 다른 터미널
pnpm test:harvey:unit
pnpm test:contracts --workers=4
pnpm test:harvey:e2e
pnpm test:harvey:bff
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3137 pnpm exec playwright test tests/e2e/ktour-ux-integration-refinement.spec.ts --project=mobile-chromium --workers=1 --reporter=list
# 선택: 공개된 과거 Sui 거래의 읽기 전용 검증. 키/서명/방송 없음.
node --import tsx scripts/hackathon-readonly-chain-audit.ts --read-only
```

로컬 앱: <http://127.0.0.1:3137>. 로컬 실행기는 `.env` 혼입을 거부하고 CX/OpenDID/체인 실행을 격리합니다. 실제 로컬 BFF 테스트는 샘플 암호 검증을 거쳐 제안까지 진행하고 실제 Sui 경계에서 멈춥니다. 끝까지 가는 UI fixture는 **서버/체인 실연동 증명과 분리**합니다.

## 5. 실제 시연·배포 전에 남은 것

| 항목 | 현재 확인된 상태 | 다음 작업 |
|---|---|---|
| OmniOne CX | adapter 코드 있음. 9/21 읽어 본 Harvey 공개 config는 `mock`. 이번 테스트는 공급자 응답 fixture. | 실제 계정·국내 접속 경로·모바일 기기/callback에서 완료→서버 검증까지 확인. 현재 캠페인에는 공급자의 안정된 사용자 식별값이 필요하며 없으면 중단. 서울 region 설정만으로 성공을 보장하지 않음. |
| OpenDID | 서명하는 샘플 VC/VP가 있으며 실제 provider 경로는 `opendid_provider_unimplemented`로 차단. | 실제 Issuer/TAS/Verifier + holder SDK/앱의 발급·보관·제시·상태 검증 구현/설정 필요. UI나 환경변수만으로 완료되지 않음. |
| Public blockchain (Sui) | 기존 실제 Testnet 거래 조회 검증. 로컬 통합본의 새 서명/실행은 안 함. | 구성된 OAuth/prover/salt·사용자·Agent·gas로 통합본 명시 승인→실행→timeout 복구를 별도 검증. issuer 응답 불명은 digest를 남기고 안전 중단하며 자동 재발급하지 않음. |
| OmniOne Chain | 제출·조회·outbox 코드 병합. 새 기록/확정 검증 안 함. | 동일 혜택 건의 서버 결과와 실제 registry/receipt를 대조. 재처리는 같은 event만 수행. |
| 배포 | 브랜치 로컬 보관, 미배포. | 통합 전체 앱을 배포 대상으로 선택. 기존 map-only 정적 배포와 혼동하지 말 것. 내구 저장소·키·콜백·접속 경로를 구성하고 공개 URL에서 재검증. |

**별도 후속 작업:** 김해인 님 요청의 ① 콘텐츠→시장/장소 지도 연결 ② Hot/Cool 검색→각 추천 장소 3개. 이번 통합 이후에 진행하며 아직 구현/완료로 표시하지 않습니다. iOS 내부 빌드·OpenDID native holder·실 금융 연결도 이 문서의 완료 범위가 아닙니다.
