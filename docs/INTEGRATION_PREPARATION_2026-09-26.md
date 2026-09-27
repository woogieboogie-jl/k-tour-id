# 설정 인계 대기 중 병렬 진행 결과 — 2026-09-26

후속(2026-09-27): 여권/Sumsub 상태 저장·재개, OmniOne 증거 결합·복구, AI 실제 요청 모델 기록의 로컬 구현과 확인 방법은 [1·2·6·7 로컬 검수 인계](./SUMSUB_OMNIONE_AI_LOCAL_HANDOFF_2026-09-27.md)에 정리했다. 아래 수치와 실연동 상태는 9월 26일 당시 기록으로 보존한다.

## 완료

| 작업 | 반영·확인한 내용 | 실제 연동 여부 |
| --- | --- | --- |
| Sui 준비 | 3단계 unsigned BCS 오프라인 리허설, 기존 digest/evidence validator 재사용, 잘못된 sender/commitment/replay 거절, 명령 인수·Result 연결·shared mutability 고정 검사 | 합성 fixture. 신규 실제 거래·사용자 서명 아님 |
| OmniOne 준비 | 정확한 stage 대상 읽기 전용 점검, token query 지원, chain/code/recorder/deploy receipt·선택 기존 사용 증거의 receipt/event/commitment 대조, timeout/출력 제한 | fixture 검수. 인증 RPC는 아직 미호출 |
| AI 오류 처리 | 공급자 오류 body/URL/API key/transport 원문 반환 제거, 고정 오류 코드, 404 모델 fallback 및 정상 답변 유지, 실패 body 폐기가 멈춰도 사용자 응답을 막지 않음 | 가짜 fetch 테스트. 실제 모델 호출 아님 |
| zkLogin 오류 처리 | JWT 파싱·프로버/Enoki 오류의 민감 원문 차단, 응답 128 KiB/60초 제한, redirect 거절, 기존 salt/address/proof 성공 프로토콜 유지 | 가짜 JWT/증명/응답. 실제 로그인·ZK 증명 검증 아님 |
| 인계 안내 | 앱 승인 경로, 일반 앱/테스트베드 미확정 조건, Vercel 접근 코드 위치, 정확한 env 이름 및 secret/public 구분 | 실제 소지자 승인은 사용자가 직접 수행 |

추가로 Sui 공식 고정 CLI/framework 후보를 임시 사본에서 사용해 Move build 및 **7/7 Move 테스트**를 완료했고, 생성 module이 저장소에 보관된 배포 module bytes와 일치했다. 이는 보관 artifact의 재현 검증이며 새 온체인 실행이나 현재 RPC의 module bytes를 다시 조회한 결과는 아니다. 원본 Move manifest를 바꾸지 않았다. 상세 재현 조건과 CLI 초기화 부작용은 [Sui 문서](./SUI_NEXT_EXECUTION_2026-09-26.md)에 별도로 기록한다.

기존 Harvey 서비스·Move 계약·앱 사용자 흐름을 재설계하지 않았다. 새로운 체인 도구는 서명/전송 기능을 제공하지 않는다. 공개 Production·CX-only Preview·Harvey 별도 배포·megan 계정은 변경하지 않았다. 이번 앱 수정은 로컬 작업 브랜치에만 있다.

## 검수 결과

- `node --import tsx --test tests/hackathon/*.test.ts`: **181/181 PASS**.
- 새 AI/zkLogin/Sui/OmniOne focused suite 최종 재실행: **27/27 PASS**. 위 181개에 포함되므로 중복 합산하지 않는다.
- `pnpm test:harvey:outbox`: **27/27 PASS**. 실제 신규 기록 없이 lease·dispatch journal·timeout·기존 hash 조회·commitment 불일치 회귀를 fixture로 검사했다.
- 앱 계약 테스트: **964/964 PASS**.
- `pnpm build:harvey:local`: **PASS**, Next production build + TypeScript. 외부 provider 환경을 상속하지 않는 격리 wrapper를 사용했다.
- `pnpm exec tsc --noEmit --incremental false --pretty false`: 최종 **PASS**.
- 로컬 실제 BFF 브라우저 검수: **4/4 PASS**, Chromium 390×844. 샘플 신원 확인→샘플 credential 발급·제시→제안→실제 서버의 체인 차단, 취소·장소 복귀, holder acknowledgement 중단/재시도, session cookie 교체/재사용을 확인했다. 브라우저의 외부 요청은 차단했고 서버는 isolated mock이었다. 실 CX·OpenDID·체인 E2E로 세지 않는다.
- 테스트용 로컬 서버는 검수 후 종료했다. 원격 서비스/사용자 서버는 종료하지 않았다.
- `git diff --check`: **PASS**.

작성자와 다른 담당자가 교차 리뷰했다. AI의 body cancel 대기 문제를 수정하고 무한 대기 fixture를 추가했다. Sui의 인자·Result 연결 검사를 강화했다. 인계 문서는 Enoki/별도 prover를 택일로 정리하고 `HK_AI_MODE=rule`이면 키만 추가해도 전환되지 않는 점을 명시했다. 수정 후 독립 리뷰에서 차단 사항 없음(GO)을 받았다.

## 지금 필요한 외부 입력과 후속

1. 본인 모바일 신분증에서 요청 정보 제출 → K-Tour 결과 확인. 앱 종류/운전면허 자격 조건이 맞는지 확인하며, 서버 거래·CI·성인 결과까지 확인해야 완료다.
2. 기존 정상 동작하던 Sui signer·OAuth/prover·OmniOne 인증 RPC/recorder·실제 AI 모델 설정을 안전하게 인계받는다. 비밀값을 채팅/Git에 넣지 않는다.
3. 설정 인계 뒤 읽기 전용 역할/권한/네트워크 확인 → 별도 보호된 통합 검수 환경 → 사용자 승인과 신규 실제 chain E2E로 진행한다. 기존 CX-only의 체인 차단을 설정 몇 개로 몰래 해제하지 않는다.
4. OpenDID native는 기존 합의대로 별도 후속이다. 샘플 credential을 OpenDID 구현 완료로 표시하지 않는다.

정확한 사용자·Harvey 액션: [설정 인계 및 승인 안내](./HARVEY_ENV_HANDOFF_2026-09-26.md).

상세: [Sui 독립 실행 준비와 Move 재현성](./SUI_NEXT_EXECUTION_2026-09-26.md), [OmniOne 읽기 점검](./OMNIONE_NEXT_EXECUTION_2026-09-26.md), [이전에 완료한 CX 실배포 검수](./CX_LIVE_PREVIEW_2026-09-26.md).
