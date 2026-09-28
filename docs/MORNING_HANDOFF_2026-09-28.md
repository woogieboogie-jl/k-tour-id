# 아침에 볼 인계 — 2026-09-28

> **22:25 KST 후속 완료:** 사용자 승인으로 만든 독립 Sui Testnet 환경에서 현재 통합 앱의
> 모바일 브라우저 → 실제 BFF → 발급·위임·Agent 실행 **3거래가 모두 성공**했다.
> 사용자에게 필요한 Faucet 1회 지급도 완료됐다. 이 독립 Sui E2E에는 Harvey 키 인계가 더 필요하지 않다.
> 아래 기존 키 인계 요청은 **Harvey의 기존 배포/역할을 그대로 운영할 경우**에 한한다.
> [새 거래·검증 범위·재현 안내](./SUI_SELFHOSTED_E2E_2026-09-28.md).
> 실제 Google zkLogin, CX/OpenDID, 서비스 사용 확정·OmniOne은 이번 Sui 단독 성공과 별개다.
> 공개 서비스·기존 CX/Sumsub Preview·통합 Vercel 설정은 변경하지 않았다.

> **같은 날 후속 정정:** 전달된 Sui 과거 3거래는 공식 GraphQL/탐색기에서 모두 성공으로
> 재확인했다. fullnode의 이력 보관 범위가 원인이며 거래 부재가 아니다.
> [재검증 근거·실제 E2E 경로](./SUI_HISTORICAL_RECHECK_2026-09-28.md).

## 먼저 결론

**키·계정 권한·본인 승인 없이 가능한 구현, 환경 준비, 읽기 검증을 진행했다.**
아래 사람의 작업 뒤에 내가 통합 배포와 최종 실거래 E2E를 이어간다.
지금 모든 제공자 연동이 완료됐다는 뜻은 아니다. OpenDID는 취소가 아니라 **별도 진행 workflow**다.
그 결과를 받을 연결 계약을 준비했고 기존 credential/VP 검사를 우회하지 않았다.

## 이번에 실제로 한 것

- **OmniOne 실제 읽기 검증:** chain ID·현재 registry 코드·recorder 권한·배포 receipt 4/4,
  앱과 같은 ethers client 조회 3/3. 인증 RPC가 동작함을 확인했다. 새 기록은 아직 서명하지 않았다.
- **Sui 실제 읽기 검증:** Testnet package·Campaign·역할·Clock·가스 상태 확인. 6회 읽기 요청.
  배포와 역할이 존재함을 확인한 것이며 issuer/agent 키 소유나 새 거래 성공은 아니다.
  최초 fullnode 조회는 `not found`였지만 후속 공식 GraphQL 조회에서 과거 3건의 성공과
  단계 연결을 재확인했다. 이 3건은 Ed25519 서명이며 현재 앱/zkLogin E2E 완료와는 구분한다.
- **통합 서버 설정 준비:** `jaewook-9643 / ondo`, Preview의
  `integration/autonomous-finish-20260927`에 24개 설정을 준비했다
  (연결/공개·서버 비밀 14개 + runtime profile·만료·잠금 10개).
  OmniOne RPC·Redis token·통합 전용 가명화 seed는 sensitive, 기존 Redis 인프라는 재사용하되 저장 key는
  `ktour:integration-preview:autonomous-20260928:v1`로 분리했다.
  기존 CX 및 Sumsub 설정을 덮어쓰지 않았다. 전체 실행 flag나 신규 배포는 켜지 않았다.
- **통합 전용 가명화 seed 준비:** 등록 전에 전용 ledger key와 lock key가 모두 없음을
  한 번의 `EXISTS` 읽기로 확인했다(Redis 쓰기 없음). 32바이트 난수로 새 seed를 한 번 생성해
  통합 Preview branch의 sensitive `HK_ISSUER_SIGNING_SEED`에만 저장했다.
  기존 CX seed의 ID·수정 시각과 원본 ledger는 그대로이며 사용자에게 이전을 요청하지 않는다.
  새 seed는 독립 가명 영역의 최초 설정이다. ledger 수명 동안 유지하고 배포마다 재생성하지 않으며,
  옛 데이터·subjectRef를 가져오거나 두 ledger 사이 동일인/1회 사용 연속성을 주장하지 않는다.
- **상태 경합 보완:** 취소·만료·credential 철회 후 늦은 holder 확인/AI 응답이 흐름을
  되살리거나 새 제안을 덮어쓰지 못하도록 현재 상태를 저장 직전에 다시 검사한다.
- **비밀값 노출 차단:** 제공자 오류 본문·JWT URL·SDK 진단을 API 응답/오류 기록에 내보내지 않는다.
  예전에 저장된 오류도 결과·증거 화면으로 읽을 때 고정 문구로 바꾼다. 기존 데이터 자체는 수정하지 않는다.
  상태가 바뀌는 getter로 allowlist를 우회하는 경우도 독립 리뷰에서 찾아 차단했다.
- **배포 저장소 보완:** 통합 서버에 Redis가 없거나 두 설정이 뒤섞이면 임시 파일로 동작하지 않고 중단한다.
  전용 namespace·설정 변경도 검사한다. 기존 CX/local isolated 규칙은 그대로다.
- **별도 통합 배포 profile 구현:** 기존 CX-only 빌드로 전체 흐름을 켜려던 빈틈을 정리했다.
  통합 전용 빌드·설정 파일, branch/origin/만료/짧은 접근 cookie 검사, 한국어·영어·일본어
  접근 화면을 추가했다. 인증 전에는 session/provider를 호출하지 않으며 접근 승인은 신원/거래 동의가 아니다.
  runtime은 꺼진 상태이고 OpenDID 제공자 모드를 요구한다. 일반 `/api/ask`, `/api/chat`은
  이 통합 환경에서 차단해 모델 키를 비보호 경로로 사용할 수 없게 했다.
  마지막 교차 리뷰에서 build 옵션만으로는 runtime 설정이 되지 않는 누락을 찾아,
  branch별 runtime 값도 등록·재조회했다. `HK_INTEGRATION_PREVIEW_ENABLED=0`은 유지한다.
- **설정 사전 검사:** 키 보유자의 일 / 이미 받은 설정을 연결하는 내 일 / 본인 승인 /
  OpenDID 별도 작업을 분리하는 offline 도구와 회귀 테스트를 추가했다.
  입력이 모두 있어도 실제 연결·거래를 검증했다고 표시하지 않는다.
- **OpenDID 인계:** native issuer/holder/verifier가 현재 BFF와 연결할 DTO·ack 서명·VP 판정·
  복귀·실패 기준을 문서화했다. 이것은 provider 구현 완료나 공식 vendor API 명세가 아니다.

### 배포 경계

| 대상 | 상태 |
| --- | --- |
| 공개 지도 `https://ktour-id.vercel.app/` | 기존 `a037f9f` 유지 |
| 기존 CX Preview | 기존 `e8628cf` 유지. 화요일 확인용 링크 변경 없음 |
| Sumsub Sandbox Preview | 기존 별도 branch/배포 유지 |
| 통합 branch | 코드·사전 설정 준비. 자동 배포 비활성화, 전체 실연동 미개방 |

## 네가 연결해 줄 사람과 행동

아래만 부탁하면 된다. **코드 수정, 환경 조합, 재배포, 회귀 검사, 체인 증거 정리는 내 일**이다.

| 누가 | 딱 필요한 행동 | 자료 / 주의 |
| --- | --- | --- |
| 화요일 모바일 신분증 보유 팀원 | 자기 기기에서 QR 또는 앱 연결 후 정보 제출 승인 | [한 단계씩 따라가는 안내](./TUESDAY_MOBILE_ID_CHECK_2026-09-29.md). 서비스의 일반 앱/테스트베드 허용 여부도 Harvey에게 확인. 본인 승인은 내가 대신할 수 없음 |
| Harvey 또는 기존 키 보유자 | OmniOne recorder 서명키를 안전하게 등록. **기존 Sui 배포를 계속 쓸 경우에만** 기존 issuer·agent도 인계 | 독립 Sui Testnet E2E는 새 전용 환경에서 이미 완료. [기존 주소·등록 위치](./HARVEY_ENV_HANDOFF_2026-09-26.md). 기존 서비스의 계약/역할을 임의 교체하지 않음 |
| Google/Enoki 설정 관리자 | 기존 client ID·salt seed와 Enoki **또는** 승인된 prover 경로 제공, callback 등록 권한/담당자 연결 | 양쪽 prover를 동시에 요구하지 않는다. 환경 확정 후 정확한 callback 주소는 내가 전달 |
| AI 키 보유자 | 실제 Gemini key·사용 모델 제공 | rule 제안은 실제 모델 호출 성공이 아님 |
| Sumsub 관리자 — 별도 항목 | provider webhook 배달까지 검증하려면 Sandbox webhook 등록 또는 관리 권한 제공 | [등록 표](./SUMSUB_LIVE_PREVIEW_2026-09-28.md). SDK·상태 재조회·CX→체인의 필수 선행 조건은 아님 |

설정이 갖춰진 뒤에는 인증·서명 당사자의 실제 Google 로그인과 명시적 거래 승인이 한 번 더 필요하다.
키·JWT·QR·신분증 화면은 채팅/MD/Git으로 보내지 않는다. 등록한 **이름과 완료 여부**만 알려주면 된다.
Sumsub Sandbox에는 실제 여권/얼굴을 요구하지 않는다. 제공자가 승인한 테스트 자료만 사용한다.

### 이미 있으므로 새로 준비하지 않을 것

Vercel 로그인/프로젝트, Redis 인프라, OmniOne RPC/API 토큰, 공개 계약·Campaign·역할 주소,
기존 CX 연결값, 통합 전용 `HK_ISSUER_SIGNING_SEED`, Sumsub SDK 키.
기존 CX seed 전달이나 재발급은 필요 없다. 이 새 가명화 seed는 기존 Sui·OmniOne·실제 OpenDID
서명키 또는 Google/zkLogin salt를 교체한 것이 아니다.
CX API key는 현재 서비스/adapter에서 선택 사항이라 새 필수 키로 요구하지 않는다.

## 입력 뒤 내가 이어서 할 순서

1. 서명키를 출력하지 않고 기존 on-chain 역할과 대조. callback/origin과 별도 통합 배포 경계를 확정.
2. 별도 OpenDID workflow의 실제 issuer/holder/verifier 결과를 연결. 샘플 credential로 실제 검증을 주장하지 않기.
3. 본인 승인 후 **같은 operation**의 CX → credential/VP → Sui 발급·위임·실행 → 서버 최종 자격 판정 →
   OmniOne receipt/event/payload commitment → 장소 복귀를 검수.
4. 취소·만료·중복·늦은 응답·체인 재조회/복구까지 실제 증거와 대조해 제출 문서 갱신.

설정 인계만으로 이 4단계가 이미 끝났다고 해석하면 안 된다. OpenDID 별도 작업 완료와 실제 본인 동의가 합류해야 한다.

## 근거와 실행 도구

- [OmniOne 내부 문서 보존·실제 조회 결과](./OMNIONE_GATEWAY_VERIFIED_2026-09-28.md)
- [Sui 실제 조회·역할·가스 해석](./SUI_LIVE_READINESS_2026-09-28.md)
- [OpenDID 별도 workflow 연결 계약](./OPENDID_WORKFLOW_BOUNDARY_2026-09-28.md)
- [설정 준비도 검사](../k-tour-id-app/scripts/hackathon-integration-readiness.ts)
- [별도 통합 Preview 운영 순서](./INTEGRATION_PREVIEW_RUNBOOK_2026-09-28.md)
- [서비스 경합 회귀](../k-tour-id-app/tests/hackathon-verification/service-race-hardening.test.ts)
- [오류 공개 경계](../k-tour-id-app/tests/hackathon/public-error.test.ts)
- [서버 저장소 검사](../k-tour-id-app/tests/hackathon/hosted-store-config.test.ts)

설정 준비도 도구는 `node --import tsx scripts/hackathon-integration-readiness.ts --offline`로
빈 환경의 부족 항목을 볼 수 있다. 실제 값은 승인된 operator가 메모리에서 제한된 stdin으로 전달한다.
명령행 인자·`.env` export·로그에 비밀값을 넣지 않는다. 이 보고서 자체는 신원/거래 성공 증거가 아니다.

## 최종 검수 기록

보호된 통합 profile의 접근 helper·실제 route 회귀를 포함해 로컬 단위 **326/326**,
상태 경합·복구 **53/53**, 기존 앱 계약 **970/970**이 통과했다.
기존 브라우저 fixture **34/34**, 실제 로컬 BFF **4/4**, TypeScript/production build도 통과했다.
로컬 BFF는 샘플 cryptography와 실제 서버 경로를
검사하고 체인 실행 차단에서 멈춘다. 실제 제공자 E2E가 아니다.

첫 BFF 실행에서는 오류 비노출 수정이 격리 환경 안내를 너무 일반적인 문구로 바꾼 것을 잡았다.
정확한 고정 안내로 보완한 뒤 4개 전체를 다시 실행해 통과했다. 테스트 assertion을 지워 맞추지 않았다.
작성자와 다른 reviewer의 TOCTOU/legacy error 검수 결과도 반영했다.

최종 소스 기준 통합 production build도 재실행해 통과했다. 실제 production build를 띄운
loopback 서버에서 runtime off인 `config`/`sessions`는 503, `ask`/`chat`은 403이며
모두 `no-store`임을 확인했다. 원격 통합 배포나 제공자 요청을 수행한 검사는 아니다.
**코드 revision: `dfed33bcb4d4872772745bcead75b1065b1ae39b`.**
[`integration/autonomous-finish-20260927`](https://github.com/woogieboogie-jl/k-tour-id/tree/integration/autonomous-finish-20260927)에 게시했다.
[동일 revision Linux CI #36336119734](https://github.com/woogieboogie-jl/k-tour-id/actions/runs/36336119734)는
2026-09-28 02:18 KST에 성공했다. 단위 **326/326**, 상태·복구 **53/53**,
모바일 Chromium **33/33**, WebKit **33/33**이며 실패·skip·flaky는 0이다.
이후 인계 문서만 갱신했으며 테스트한 코드 revision은 바꾸지 않았다.

같은 코드의 isolated build에서도 기존 흐름 **34/34**와 로컬 BFF **4/4**를 다시 통과했다.
공개 배포는 `dpl_13auzoqMNbg51Fb9jfrL3Lnqi5Up` / `a037f9f` / `READY`,
공개 URL HTTP 200을 재확인했다. 기존 CX·Sumsub branch도 변경하지 않았다.

통합 전용 production build의 새 접근 화면 **5/5**
(320px KO, 390px EN, 390px JA dark, 844px landscape dark, unavailable)와 스크린샷을 확인했다.
접근 후에도 본 동의 checkbox는 꺼져 있고 operation을 생성하지 않는다. 이 5개는
API를 차단·대체한 화면 fixture이며 실제 제공자 승인 검사가 아니다.
