# 자동 진행 결과 — 2026-09-28

최신 야간 후속과 사용자에게 남은 행동은 [아침 인계](./MORNING_HANDOFF_2026-09-28.md)를 먼저 본다.
이 문서는 이전 9월 27일 로컬 인계보다 최신인 중간 기록이다. 코드 구현, 실제 제공자 통신,
브라우저 fixture 검수, 사람의 신원 승인을 구분한다. 실제 승인·서명 없이 해커톤
전체 실연동 완료라고 표기하지 않는다.

9/28 01시 후속: 사용자가 제공한 OmniOne RPC로 현재 registry 배포·recorder 권한·배포 receipt
읽기 검사 **4/4**, 앱과 같은 ethers client 조회 **3/3**을 통과했다.
RPC 토큰은 더 이상 미확보 항목이 아니다. 새 기록에는 기존 recorder 서명 수단이 필요하다.
OpenDID는 취소/생략이 아니라 별도 병렬 workflow다. 기존 credential/VP 검사를 우회하지 않는다.
해당 workflow의 연결과 최종 실환경 검수가 남으므로 설정 인계만으로 전체 연동이 끝나지는 않는다.
[최신 확인 결과·Gateway 규격·남은 작업](./OMNIONE_GATEWAY_VERIFIED_2026-09-28.md)을 함께 따른다.

## 완료한 범위

- 공개 지도: <https://ktour-id.vercel.app/>. 서울·부산·제주 각각 3개 스토리,
  KO/EN/JA, 같은 캐러셀→지도 이동→본문→장소→복귀 흐름. 공개 배포
  `a037f9f5309b4fead0766701cbe9824717227504` 유지. 이번 서버 검수 때문에
  이미 검수된 프론트를 이전 버전으로 교체하지 않았다.
- 구현 게시 브랜치: `integration/autonomous-finish-20260927`. 기존 CX 자동 배포
  브랜치에 덮어쓰지 않는다. Sumsub 실서버는 별도
  `integration/sumsub-live-20260927` Preview로 격리한다.
- Sui-only 실행·저장 거래 복구, OmniOne 결과/이벤트/commitment 결합 검증,
  AI 실제 요청 모델 및 규칙 대체 구분, 제출 증거 묶음, OAuth 취소·만료·복귀 구현.
- Linux Chromium/WebKit CI 구축 및 실제 실행. 이전 macOS WebKit의 시작 전
  SIGBUS를 무시하거나 통과로 세지 않고, Linux에서 두 엔진을 실행했다.
- 개발 서버 오류 수정: 검수 영상/trace 파일을 Tailwind/Next가 소스 변경으로
  감지해 반복 재빌드하던 문제. QA 출력 디렉터리만 개발 감시 대상에서 제외.
  프로덕션 watcher나 외부 제공자 차단 규칙은 바꾸지 않았다.
- 실제 Redis 별도 namespace, 다섯 프로세스 동시 변경/취소/늦은 변경/TTL/정리 검수
  **17/17**. CX 데이터는 건드리지 않고 생성한 세 키만 정리했다.
- 이미 제공된 Sumsub Sandbox 키 재사용. level 조회 및 실제 SDK 토큰 발급 확인.
  실제 SDK 검수에서 발견한 신청자 응답 파싱 오류를 수정했다. 일반 GET 응답에
  없는 webhook 전용 `sandboxMode` 필드를 요구하던 문제였다. Sandbox 서명 토큰,
  신청자·level 일치, webhook의 필수 Sandbox/HMAC 검사는 유지한다.
- 수정된 실제 Preview에서 SDK 시작→서버 조회→닫기→동일 신청자 재개→세션 해지
  **21개 체크포인트 통과**. [실제 여권 연결 Preview](https://ondo-conn98e6p-jaewook-9643s-projects.vercel.app/),
  source `21f365314e932c16db867c3ad03da110f1760b0f`.

## 실제 통신과 사람 승인의 경계

Sumsub 연결은 샌드박스 서버와 실제 통신하는 별도 Preview다. 화면 fixture가 아니다.
여권·얼굴 업로드나 심사 승인까지 대행하지 않았다. SDK 시작만으로 패스·성인 자격·결제
권한을 만들지 않는다. webhook 서명 transport 검수도 실제 제공자 이벤트 배달과 구별한다.

Sumsub 관리 API는 webhook 목록 조회 200이지만 생성 요청은 **403**이었다.
기존 SDK 키가 틀린 것이 아니라 `manageClientSettings` 권한이 없다.
관리 권한 없는 상태에서 서명 키를 바꾸거나 다른 계정으로 우회하지 않았다.

## 이제 사람에게 필요한 것만

| 담당 | 필요한 행동 | 왜 자동 완료할 수 없나 |
| --- | --- | --- |
| 모바일 신분증 보유 팀원 | 9/29 화요일, 본인 휴대폰에서 CX 요청 승인 | 본인 정보 제출 동의는 대행 불가. [순서와 통과 기준](./TUESDAY_MOBILE_ID_CHECK_2026-09-29.md) 준비 완료 |
| Harvey/설정 보유자 | 기존 Testnet issuer·agent, Google OAuth/prover/salt, OmniOne recorder 서명 수단, AI 모델 키의 안전한 인계 | OmniOne RPC는 9/28 제공·읽기 검증 완료. 나머지 실행 설정은 별도 인계 필요. [정확한 설정 표](./HARVEY_ENV_HANDOFF_2026-09-26.md) 참고 |
| Sumsub 계정 관리자 | 실제 provider webhook 배달 검증을 위한 Sandbox webhook 관리 권한 또는 안내대로 등록 | 실제 관리 API 403 확인. SDK·상태 재조회·CX→체인의 필수 선행 조건은 아님. 기존 SDK 키 재전달 불필요 |
| 인증/서명 당사자 | 설정 완료 후 자기 기기에서 Google 로그인 및 명시적 서명 | 본인 동의/서명은 대행하지 않음. Sumsub Sandbox에는 실제 여권·얼굴 자료를 요구하지 않으며 승인된 테스트 자료만 사용 |

권한/설정 인계 뒤에는 내가 읽기 전용 환경 대조→별도 통합 배포→같은 operation의
Sui 발급·위임·실행→서버 최종 판정→OmniOne 확정→장소 복귀→제출 증거 갱신을 진행한다.
새 signer나 새 계약으로 기존 Harvey 권한을 임의 교체하지 않는다.
OpenDID의 실제 issuer/holder/verifier는 별도 진행 중인 workflow이며 완료 아님.
[연결 계약·네이티브 작업 인계](./OPENDID_WORKFLOW_BOUNDARY_2026-09-28.md)를 준비했다.

## 확인 문서

- [Sumsub 실제 Preview 및 webhook 인계](./SUMSUB_LIVE_PREVIEW_2026-09-28.md)
- [실제 Redis 증거](./SUMSUB_REDIS_LIVE_2026-09-27.md)
- [모바일 CI](./WEBKIT_CI_2026-09-27.md)
- [로그인 복귀·개발 서버 수정](./ZKLOGIN_RETURN_REVIEW_2026-09-27.md)
- [화요일 모바일 신분증 안내](./TUESDAY_MOBILE_ID_CHECK_2026-09-29.md)

## 이전 완료 시점의 검수 증거

구현 revision: `ce5b07c6c01daf0dec54a827bd6b398958458621`.

| 검사 | 결과 | 해석 |
| --- | --- | --- |
| 계약 회귀 | 970/970 | 공개/통합 프로필·UI 계약 |
| KYC 단위·경계 | 58/58 | 실제 응답 형태, 서명·취소·경합·origin·redirect 포함 |
| Harvey 서버 단위 / OmniOne outbox | 242/242 / 28/28 | provider fixture, 실제 체인 거래 아님 |
| Harvey 기존 브라우저 | 34/34 | 통합 흐름·동의/서명 경계·장소 복귀 fixture |
| OAuth callback production | 21/21 | 7개 시나리오×3, 고정 Harvey 빌드 |
| OAuth callback dev | Node24 21/21, Node25 21/21 | QA trace/영상 저장 상태에서도 오류 재발 없음 |
| 실제 Redis | 17/17 | 5개 프로세스, 자체 생성 키 정리 확인 |
| 실제 Sumsub 시작·복귀 | 21개 체크포인트 통과 | 실제 Sandbox SDK/API/Redis. 신원 최종 승인은 아님 |
| 새 Preview webhook 수신 경계 | 401 / 200 `applied:false` | 잘못된 HMAC 거절 / 올바른 명시적 수동 이벤트 수신. 실제 제공자 배달 아님 |
| 복구된 로컬 여권 화면 | 13/13 | 최신 Sumsub 빌드, 언어·테마·복구 UI fixture |
| 최종 Linux 모바일 CI | Chromium 33/33 + WebKit 33/33 = 66/66 | 재시도·skip·집계 오류 0. 실제 iPhone의 카메라/앱 승인은 별도 |
| 빌드·TypeScript | PASS | Harvey/Sumsub 각각 보호된 로컬 빌드 |

최종 Linux 브라우저 CI [실행 36328594158](https://github.com/woogieboogie-jl/k-tour-id/actions/runs/36328594158)은
**success / 66 passed(5.0분)**로 완료됐다. [CI 보고서](./WEBKIT_CI_2026-09-27.md)에
정확한 revision과 범위를 확정했다.

당시 로컬 <http://127.0.0.1:3139/?review=0&city=seoul>은 최신 Sumsub 로컬 빌드로
복구했고 검수 창을 열었다. 항상 실행 중인 주소는 아니므로 현재 접속 가능 여부는 별도다. 로컬 화면 fixture와
위 실제 Sumsub Preview는 구분한다. 공개 주소·기존 CX immutable 주소·로컬은
최종 HTTP 200 확인. 원격 main `a037f9f` / CX branch `e8628cf`는 그대로 유지했다.
