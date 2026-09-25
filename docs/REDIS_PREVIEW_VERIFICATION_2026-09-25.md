# 검증 브랜치 Redis 연결 — 2026-09-25

## 범위

사용자가 입력한 Redis 변수를 검증 브랜치로 한정하고, 전용 테스트 키로 실제 연결을 검증한다. 공개 앱 UI, Harvey의 기존 저장소/이력, 인증·발급·체인 실행은 변경하지 않는다. 이 작업을 CX 본인인증 완료로 보고하지 않는다.

- 프로젝트: `jaewook-9643s-projects / ondo`
- 브랜치: `feat/hackathon-readiness-preview-20260925`
- 신규 Redis: `ktour-cx-preview-20260925` (`store_vDZTRyB7NH00O95k`, free/hnd1)
- 앱 서버 목표: `icn1`. Redis 저장 지역과 앱 실행 지역은 별개다.

## 설정 수정 및 로컬 실제 검사

사용자 재배포는 `main`/Production `dpl_HHDmk5SoQPmdJbonqjE2w7pLwJNj`였으며 두 KV 변수는 Production과 전체 Preview에 적용되어 있었다. 사용자 승인 후 동일 변수 ID/값을 유지하면서 target을 Preview 하나, gitBranch를 위 브랜치로 수정했다. custom environment 연결은 없다.

- `KV_REST_API_URL`, `KV_REST_API_TOKEN`: 정확한 검증 브랜치 전용, `encrypted`.
- 토큰을 Sensitive로 바꾸는 API 시도는 확인에 실패했다. 현재 상태를 Sensitive라고 표시하지 않는다. 값 삭제/재생성·회전은 하지 않았다.
- 값은 필요한 두 변수만 인증된 Vercel API로 프로세스 메모리에 받아 사용했다. 로그·터미널 출력·환경 파일·Git에 기록하지 않았다.
- 실제 Redis primitive probe: **11 checks, ok=true, cleanup=true, failures=0**. PING, SET NX/PX, GET, 잘못된 lock 소유자 거절, 올바른 소유자의 EVAL, 조건부 삭제까지 확인했다.
- 전용 `ktour:probe:<UUID>:lock/value`만 사용한다. 쓰기는 120초 TTL을 포함하며 실제 앱 ledger key를 읽거나 변경하지 않는다.

환경변수 변경은 이후 생성되는 배포에 적용된다. 기존 immutable Production 배포에서 과거 설정이 소급 제거됐다고 주장하지 않는다. 기존 UI-only 앱의 API는 404이며 그 Redis 값을 사용하는 코드 경로는 없다.

## 서울 Preview 런타임 검사

**2026-09-25 18:25:49 KST, 실제 서울 Preview → Redis 검증 성공.**

| 항목 | 관측값 |
| --- | --- |
| 앱 SHA | `6d3dbebd1e065f58fdc460ae624ea078aa01a764` |
| Vercel / GitHub 배포 | `dpl_6i4eNAxfwA5gLDrsj3x399aUogan` / `6657671787` |
| 실행 지역 / config | `icn1`, `previewReadOnly=true`, `isolatedMock=true`, chain disabled |
| 실제 Redis 응답 | HTTP 200, **11 checks, ok=true, cleanup=true, failures=0** |
| 진단 접근 경계 | 인증 없음/틀림 401, GET/추가경로 503, query/body/cookie 400 — 7개 통과 |
| 원격 앱 회귀 | API 22/22, 모바일 Chromium 3/3 PASS |

배포 전 타입 검사·full-stack production build, Harvey 단위 99/99, 배포 보호 계약 3/3, 로컬 HTTP 22/22 및 모바일 Chromium 3/3도 통과했다. 작성자와 별도의 검토자가 실행 게이트·만료·쓰기 불확실성·빈 POST stream 경계를 검수했고 blocker 없음으로 승인했다.

원격 브라우저 캡처: `k-tour-id-app/artifacts/qa/redis-preview-remote/`. 모바일 Chromium 테스트이며 실기기 iOS 인증 시험은 아니다.

임시 예외는 정확한 `POST /api/hackathon/v1/readiness/redis`뿐이다. 별도 임시 서버 토큰, frozen read-only, 정확한 Vercel Preview/저장소/브랜치/SHA/서울 지역, 고정 만료를 모두 요구한다. 요청 body/query/cookie는 거부한다. 앱 세션·서비스·store.ts·CX·서명·체인은 호출하지 않는다. 작업 25초 + 정리 8초의 한도와 테스트 키 TTL을 둔다.

진단 토큰은 임시 branch-only `HK_REDIS_READINESS_TOKEN`이며 Redis 자격증명을 재사용하지 않는다. 검증 후 라우터 예외를 제거하고 helper를 만료 처리했다. 임시 변수도 ID를 확인해 삭제하고 목록에서 부재를 재확인했다. 최종 소스에서 단위 99/99·계약 3/3·타입 검사 재통과. 최종 닫힌 Preview 배포 및 위 임시 배포 제거 결과는 후속 정리 기록으로 남긴다.

## 완료 범위와 다음 단계

Redis primitive 성공은 네트워크/자격증명/필요 명령 지원 증거다. 앱의 실제 session ledger 다중 프로세스/재시작 검증 및 CX 본인인증 완료와는 구분한다. 앱 readiness/isolation은 유지한다.

CX를 열기 전 남은 구현/검증:

1. 접근 보호된 CX-only 실행 프로필: 인증/세션만 허용, VC·AI·Sui·OmniOne 실행 차단. `HK_ISOLATED_MOCK=0` 하나만 바꾸지 않는다.
2. 앱 저장소 Redis 필수/fail-closed, URL/token 같은 쌍 검사, 전용 ledger namespace, 신규 고정 서버 seed. 기존 이력/seed를 덮어쓰지 않는다.
3. 앱 store 자체의 실제 Redis 지속성·동시성·중복완료 검사.
4. 실제 CX transaction/QR 또는 app handoff 생성 → 본인 기기의 모바일 신분증 승인 → 서버 결과 검증. 지원되는 모바일 운전면허증 등 holder 자격증명이 필요하다.
5. `verified`, 완료 상태, txId/cxId 일치, 안정적인 CI 및 성인 여부 확인. 취소/만료/재시도/새로고침/장소 복귀 검사. 원본 CI/신분증/JWT는 로그·보고서·체인에 남기지 않는다.

기존 서울 서버→CX 공개 목록 HTTP 200은 이미 확인했다. 과거 문서의 timeout 기록을 최신 결론처럼 반복하지 않는다. 반대로 이 공개 조회를 실인증 성공으로 확대하지 않는다.

설정 API 근거: [값을 생략한 환경변수 범위 변경](https://vercel.com/docs/rest-api/projects/edit-an-environment-variable), [단일 변수 조회](https://vercel.com/docs/rest-api/projects/retrieve-the-decrypted-value-of-an-environment-variable-of-a-project-by-id).
