# 실연동 다음 작업과 사용자 액션

2026-09-28 후속 갱신: Linux 모바일 CI와 개발 콜백 수정 검증을 반영했다. 공개 배포 source `a037f9f5309b4fead0766701cbe9824717227504`는 유지하며, 아래 통합 브랜치 검증과 구분한다.

## 먼저 상태를 정확히 구분한다

사용자 화면의 문구는 실제 제품과 동일한 톤으로 만들고, 서버 연결은 Sandbox/Testnet을 사용한다. 반복되는 '테스트' 버튼·배너는 필요하지 않다. 그러나 화면 fixture를 실제 제공자와 통신한 것으로 기록하지 않는다.

| 구분 | 현재 확인 범위 | 남은 확인 |
| --- | --- | --- |
| CX | 이전 보호 Preview에서 실제 요청·QR/앱 링크 생성, 미승인·복원·취소 | 실제 신분증 소지자 승인 → 서버의 같은 요청/동일인/성인 결과 확인 |
| Sumsub | 9/28 전용 Preview에서 실제 SDK 시작·서버 상태·취소·동일 신청자 재개·실제 Redis·해지 통과 | webhook 관리 권한(등록 API 403), 본인 자료 제출·제공자 결과/webhook 왕복 |
| Sui | Harvey 코드/과거 실거래 보존, 공개 인프라 조회 기록, Move 재현·오프라인 검증 | 현재 통합본에서 발급→사용자 위임→agent 실행을 신규 Testnet 거래로 재현 |
| zkLogin | 콜백 상태 결합·URL 정리·동일 장소 복귀, 수정본 개발 Node 24/25 각각 21/21 및 새 로컬 production 21/21 | 실제 Google 로그인·증명·사용자 서명 |
| OmniOne | receipt/event/registry/recorder/commitment 검증 및 기존 hash 복구 코드 | 인계된 RPC·현재 서비스 건의 실제 기록 확정 |
| AI | 실제 요청 모델/fallback 구분·proposal digest 검수 | 현재 설정으로 실제 모델 응답을 받은 제안→승인→실행 |

코드 존재·과거 Harvey 실증·현재 통합본 실연동은 서로 다르다. 1·2·6·7의 로컬 구현 완료를 전체 실연동 완료로 말하면 안 된다.

## 1·2·6·7 이후의 독립 작업 — 이번 진행 결과

사용자 승인 후 아래 네 갈래를 실제로 진행했다. 구현 완료와 실환경 완료를 분리한다.

| 작업 | 완료한 것 | 실제 실행 전 남은 것 |
| --- | --- | --- |
| 1. Sui 독립 실행 | 고정 Testnet/Campaign·역할·승인 만료, 직렬화된 거래의 가스 상한, 최대 3거래, 별도 영속 journal·중복 방지·저장 digest만 복구. 기존 adapter를 재사용하며 앱 Redis journal과 분리 | 기존 issuer/agent 및 승인된 테스트 holder signer 인계 후 신규 거래. 이 CLI는 demo Ed25519 서명이며 zkLogin 성공으로 세지 않음 |
| 2. zkLogin 복귀 | 취소·잘못된 콜백·만료·다른 탭·URL 정리·같은 장소 복귀·재로드/재사용 회귀. 만료 JWT 재시도·초기화 순서·QA 출력 재빌드 루프 수정. 이동 정지/URL 정리 오류 포함 개발 Node 24/25 각각 21/21, 새 Harvey 활성 로컬 production 7개×3회 = 21/21(재시도 없음) | OAuth callback 등록, 기존 salt/prover 설정, 실제 Google 로그인·사용자 서명 |
| 3. 제출 증거 | 지정한 로컬 snapshot의 revision/operation/모델/승인/체인 증거 결합·변조 검사·민감 필드 제외. fixture/mixed와 실제 출처 주장 분리 | 실제 실행 후 같은 backend revision/operation의 기록 채우기. exporter 자체는 네트워크 진위 확인 도구가 아님 |
| 4. 모바일 오류/복귀 | Linux CI Chromium 33/33 + WebKit 33/33 = 66/66. 권한 거절·화면 높이 축소·오프라인 복귀 포함. 기존 사각 페인트 및 light/dark/짧은 화면 검수는 별도 확인 | 실제 iPhone Safari/카메라/외부 앱 왕복은 미검수. macOS WebKit SIGBUS는 보존하되 자동 WebKit 검수는 Linux CI에서 완료 |

상세: [Sui 실행 안내](./SUI_ONLY_EXECUTION_2026-09-27.md), [로그인 복귀](./ZKLOGIN_RETURN_REVIEW_2026-09-27.md), [제출 증거](./SUBMISSION_EVIDENCE_2026-09-27.md), [모바일 검수](./MOBILE_COMPATIBILITY_2026-09-27.md).

모바일 CI 최종 근거: [실행 36328594158](https://github.com/woogieboogie-jl/k-tour-id/actions/runs/36328594158), source `ce5b07c6c01daf0dec54a827bd6b398958458621`, Chromium/WebKit 각각 33/33, 재시도·skip·report error 0. 공급자 비밀값 없는 고정 로컬 빌드의 UI fixture 검수이며 실제 인증·카메라·사용자 승인을 대체하지 않는다. [CI 실행 경계와 결과](./WEBKIT_CI_2026-09-27.md)를 참고한다.

9월 28일 최종 로컬 production 재검수: zkLogin **21/21**(14.1초)과 Harvey 통합/보존 **34/34**(1.4분), 전체 계약 **970/970** 통과. 공급자 API는 fixture이며 실제 OAuth·사용자 승인·서명 완료를 의미하지 않는다.

다음 순서: 설정 인계 → 읽기 전용 환경/역할 대조 → 보호된 Sui 실행 → 실제 OAuth 사용자 승인 → 전체 운영 흐름과 OmniOne 확정 → 제출 증거 기록. 공개 UI와 CX-only 보호 환경은 섞지 않는다. OpenDID 실제 issuer/holder/verifier는 기존 합의대로 native 단계의 별도 작업이며, 단순 앱 포장만 남았다고 보지 않는다.

## 사용자가 지금 해주면 실제로 진전되는 것

1. **팀원 확보는 완료. 화요일 9월 29일 실제 승인 검수.** [별도 친절한 진행 안내](./TUESDAY_MOBILE_ID_CHECK_2026-09-29.md)를 따른다. 일반 앱/테스트베드 중 계정에 맞는 환경을 확인하고, 소지자가 자기 기기에서 동의한다. 승인 결과·시각·비민감 오류 코드만 공유하고 QR/개인정보는 공유하지 않는다.
2. **Harvey가 동작시킨 기존 실행 설정의 안전한 인계.** 추가 개발 요청이 아니라 Sui issuer/agent, 선택한 sponsor, Google OAuth/prover, OmniOne 인증 RPC/recorder, AI 모델 설정을 현재 승인된 통합 환경에 이전하는 요청이다. 기존 저장소의 공개 package/Campaign 주소는 다시 받을 필요 없다. 별도 sponsor가 없다면 현재 config의 issuer fallback을 확인하면 되며 sponsor 키를 무조건 새로 만들 필요도 없다.
3. **실행 단계에서 Google 로그인·사용자 서명 참여.** 정확한 callback 등록과 환경 검사를 마친 뒤 요청한다. 지금 임의로 wallet 연결·서명할 필요는 없다.

이미 제공한 Sumsub Sandbox 키, 완료한 Vercel 연결과 Redis 준비를 다시 요청하는 것이 아니다. 실제로 부족한 설정만 기존 인계/환경과 대조해야 한다. 비밀값은 채팅·Git이 아닌 환경 secret 경로로 전달한다.

9/28 추가 확인: Sumsub SDK 키는 실제로 동작한다. webhook 목록 조회는 200, 등록은
`manageClientSettings` 권한 부족으로 403이다. 관리자가 Sandbox 관리 권한을 인계하거나
[정확한 target/서명 설정](./SUMSUB_LIVE_PREVIEW_2026-09-28.md)으로 등록해야 한다.
실제 신분증·여권·Google 본인 동의/서명은 당사자만 수행한다.

정확한 설정 이름과 모바일 앱 승인 경로는 [Harvey 설정 인계 안내](./HARVEY_ENV_HANDOFF_2026-09-26.md), 로컬 확인 방법은 [여권/OmniOne/AI 인계](./SUMSUB_OMNIONE_AI_LOCAL_HANDOFF_2026-09-27.md)를 따른다. 과거 Preview 링크의 만료 여부는 재시도 전에 확인한다.
