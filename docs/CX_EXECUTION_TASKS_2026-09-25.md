# CX 실연동 실행 체크리스트

## 이번 완료 기준

기존 최신 UI + Harvey 인증 어댑터를 **접근 제한된 서울 Preview**에서 실제 Redis와 연결한다. 실인증을 흉내 내지 않는다. 자동 검증으로 가능한 작업을 끝내고, 실제 모바일 신분증 보유자의 승인과 그 결과 확인만 사람에게 요청한다.

공개 Production, Harvey 기존 데이터/키는 유지한다. 이번 단계에서 OpenDID 발급·AI·Sui·OmniOne 실행은 열지 않는다. OpenDID native는 기존 합의대로 후속이다. 체인 연동 전체 완료와 CX-only 검증 완료는 다른 마일스톤이다.

| 작업 | 담당 | 완료 증거 | 상태 |
| --- | --- | --- | --- |
| Redis 인프라 연결/서울 실행 | 기존 완료 | 실제 서버 primitive 11/11, 임시 진단 종료 | 완료 |
| 앱 store의 Redis 필수/fail-closed 설정 | 저장소 담당 | 잘못된 설정·별칭 혼합·샘플 seed·기본 namespace 거부 | 구현/fixture 완료 |
| 실제 앱 store 지속성/동시성 | 저장소 담당 + root 실행 | 전용 synthetic 원장, 다중 프로세스 쓰기/새 프로세스 읽기/정리 | 9/26 실제 Redis 6/6, cleanup=true 완료 |
| CX-only 빌드·접근 보호·API allowlist | root + 독립 검토 | 비인증·다른 Origin·다른 경로·체인 호출 거부 | 구현/빌드/독립 리뷰/route 9개 완료 |
| 인증 상태 경합/재시도 안전성 | 인증 담당 | 동시 시작·늦은 완료·취소/만료 후 완료·중복 완료 반례 | 구현/15개 반례 완료 |
| 기존 장소 UI에 CX-only 흐름 연결 | UI 담당 | 명시적 동의, QR/app, 수동 결과 확인, 같은 장소 복귀 | 로컬 구현/독립 검토 완료 |
| 실제 Preview 배포와 provider handoff | root | 정확한 SHA/region, 실제 trans/QR 생성, 민감값 미기록 | 전용 프로필·CX runtime 설정 완료, 실제 배포/handoff 대기 |
| 모바일/오류/새로고침 회귀 | QA + 독립 검토 | 브라우저 증거 및 실패 상태, CI/토큰 비노출 | mocked API 7개 통과, 실제 provider/기기는 대기 |
| 본인 신분증 앱 승인 | 실제 보유자 | verified/transaction correlation/CI 및 성인 결과 확인 | 사람의 승인 필요 |
| 완료/미완료 문서 업데이트 | root | 재현 경로·최종 배포·검사 결과·남은 조건 | 로컬 검수 결과와 배포 차단 사유 반영 |

## 중요한 검수 경계

- 공개 provider 목록 성공 ≠ 실제 본인인증 성공.
- Redis primitive 성공 ≠ 앱 인증 원장의 지속성/동시성 성공.
- QR 또는 app 링크 생성 성공 ≠ 본인확인 성공.
- CX 본인확인 성공 ≠ OpenDID 발급/체인 기록/혜택 사용 성공.
- 모든 실제 승인은 신분증 보유자가 기기에서 직접 한다. sample·임의 CI·클라이언트 성공 값을 live 증거로 받지 않는다.
- 개인정보, QR payload, provider bearer/CI는 보고서·로그·Git·체인에 기록하지 않는다.
- 각 구현은 작성자와 다른 검토자가 반례 검수한 뒤 배포한다. 테스트 실패를 UX 문구나 mock 성공으로 덮지 않는다.

## 사람이 해야 하는 시점

접근 보호된 검증 화면과 실제 handoff가 준비되고 자동 회귀가 통과한 뒤에만 기기 승인을 요청한다. 테스트 참여자의 실제 신분증 앱 실행·동의는 대행할 수 없다.

### 9/25 실행 중 발견한 외부 의존성

- Vercel CLI의 현재 계정은 `megan-3020`, 조회 가능한 팀은 `ohayo-global`이다. 기존 대상 `jaewook-9643s-projects / ondo`에는 `scope-not-existent`로 접근이 거부됐다.
- 다른 계정을 임의로 로그아웃하거나 다른 프로젝트를 사용하지 않았다. 비밀값을 로컬 파일·채팅으로 전달받지도 않는다.
- 이번 CX-only 환경변수 등록 결과는 확인되지 않았고, 후속 범위 조회는 scope 확인에서 거부됐다. 원격 변수 등록 성공, 실제 store canary 성공, 새 CX 배포 성공으로 보고하지 않는다. 재연결 후 기존 변수 존재/범위를 먼저 재조회해 중복 생성·seed 교체를 피한다.
- 로컬 구현·독립 리뷰·fixture·브라우저 검수는 계속한다. 계정 복구 뒤 정확한 Preview 브랜치에만 설정하고 실제 Redis → 배포 → CX handoff 순서로 진행한다.

### 9/25 계정 접근 후속 확인

위 접근 거부는 당시 기본 CLI 컨텍스트의 기록이다. 이후 별도 `jaewook` 프로필에서 `jaewook-9643` 사용자와 `ondo` 프로젝트 접근을 확인했고, 기본 `megan-3020` 로그인은 유지했다. 우리 작업 폴더의 로컬 프로젝트 링크와 읽기 전용 계정/대상 가드를 추가했다. [계정 분리 기록](./VERCEL_ACCOUNT_ISOLATION_2026-09-25.md) 참조.

이 접근 확인 중에는 환경변수나 배포를 변경하지 않았다. **실제 앱 Redis canary, 부분 등록 변수의 범위 재조회, 새 Preview 배포, CX handoff는 아직 대기**다. 이후 사용자가 알려준 megan 작업 폴더는 별도 저장소이며, 조회된 ohayo-global 프로젝트에는 K-Tour 저장소 연결이 없었다. 이 결과는 모든 수동 배포 명령의 안전성까지 보장하지 않는다.

## CX 이후 남은 전체 실연동 순서

1. **CX 실기기 결과 확인:** 새 Preview에서 원장/상태 복원과 실제 앱 승인·결과/거래 상관관계를 확인. QR 생성만으로 완료 처리하지 않는다.
2. **Sui 및 OmniOne 실제 증거:** 현재 테스트넷 객체·권한·gas·recorder를 읽기 검증한 후, 승인된 테스트 lane에서 위임 → 실행 → 서버 최종 자격 → OmniOne receipt를 연결한다. 기존 Harvey 구현과 fixture 통과는 보존하지만 새로운 실환경 E2E 성공을 대체하지 않는다.
3. **OpenDID native:** 기존 합의대로 별도 후속. issuer/TAS/verifier 및 holder를 통한 실제 VC 발급·보관·VP 검증이 필요하며 단순 앱 포장은 완료 기준이 아니다.
4. **전체 여정 회귀/제출 증거:** 동일 revision/환경에서 취소·중복·만료·복구까지 검증하고 스펙, 발표 설명, 개인정보 없는 증거 묶음을 맞춘다.

전체 요구사항별 증거와 미완료 항목은 [실연동 감사](./HACKATHON_LIVE_READINESS_2026-09-25.md)를 기준으로 한다.

## 계정 복구 후 실행 체크포인트

### 9/26 재개 시 읽기 확인

- 전용 `jaewook` 프로필의 `vercel:ktour status`가 다시 통과했다. megan 기본 인증은 변경하지 않았다.
- 원격 프로젝트 환경변수 목록에서 `KV_REST_API_URL`과 `KV_REST_API_TOKEN`이 정확한 Preview 브랜치에 등록된 것을 확인했다. 같은 조회에서 `HK_*` CX runtime 변수는 없었다. 값은 출력하지 않았으며 이번 재조회에서는 어떤 변수도 생성·변경하지 않았다.
- 최신 Preview는 여전히 `6e4535b7` / `dpl_8ZtfT8mvGEkcAXHNa6miPfGcNC6z`, READY다. 최신 Production은 `58d284b9`이며, 로컬 CX-only 구현 `fa8c5e98`은 아직 새 Preview로 배포되지 않았다.
- 재개 순서는 **실제 앱 Redis canary → 정확한 Preview 브랜치 CX 설정 → 검수 SHA 배포 → 실제 공급자 handoff → 보유자 직접 승인**이다. 독립 리뷰로 이 순서와 canary의 고유 테스트 namespace·정리 조건을 다시 확인했다.

### 9/26 실제 앱 Redis 검증

- 기존 검토된 `runStoreCanary`를 fixture 옵션 없이 실제 Preview Redis에 실행했다. 두 독립 프로세스의 동시 저장과 세 번째 새 프로세스 재조회가 통과했다.
- 결과: `ok=true`, `checks=6`, `cleanup=true`, `failures=0`. 본 서비스 원장이 아닌 자동 생성 UUID 공간만 사용했고, 소유권 확인 후 해당 임시 데이터만 제거했다. 실제 서비스 데이터는 삭제하지 않았다.
- Redis 자격 증명은 정확한 브랜치의 Vercel 변수에서 프로세스 메모리로만 전달했다. 로컬 env 파일·출력·보고서에 값을 남기지 않았다.
- 재검수: hackathon 단위 테스트 **149/149**, 앱 계약 테스트 **964/964**, CX-only production build 및 TypeScript **PASS**. 공급자/실기기 결과와는 구분한다.

### 9/26 CX 설정 등록

- `ondo`의 정확한 Preview 브랜치에 CX runtime 변수 **12개**를 신규 등록하고 각 변수의 이름·대상·브랜치·저장 유형을 재조회했다. 기존 Redis 쌍 및 Production/다른 Preview 변수의 메타데이터는 유지됐다.
- issuer seed와 access signing secret은 새 난수로 생성해 Sensitive로 저장했다. 접근 코드는 새 고엔트로피 난수로 생성해 encrypted로 저장했다. 값은 메모리와 Vercel에만 전달했으며 채팅·Git·로컬 env 파일로 출력하지 않았다.
- 최초 일괄 등록 시도는 성공하지 않았고, 재조회로 미등록을 확인한 후 개별 등록했다. 이미 존재하는 seed를 덮어쓰거나 재생성하지 않았다.
- 환경 만료는 `2026-09-30T14:59:59Z`이며 본인확인 외 발급/AI/체인 요청은 CX-only 빌드 가드로 계속 차단한다. 설정 등록은 실인증 성공 증거가 아니다.

설정 대상은 `ondo` 프로젝트의 **Preview + 정확한 `feat/hackathon-readiness-preview-20260925` 브랜치**뿐이다. Production/전체 Preview 설정이나 Harvey 저장소의 값을 바꾸지 않는다.

1. CLI 계정/팀/프로젝트를 읽기로 재확인하고 환경변수의 이름·대상·브랜치만 출력한다. 부분 등록된 seed가 있으면 재생성하지 않는다.
2. 기존 `KV_REST_API_URL` + `KV_REST_API_TOKEN` 단일 쌍을 메모리에서만 사용한다. `HK_STORE_CANARY_ALLOW_WRITE=1`로 `scripts/hackathon-store-canary.ts`를 실행한다. 출력 `ok=true`, `checks=6`, `cleanup=true`를 모두 요구하며 본 원장이 아닌 자동 생성 UUID namespace만 쓴다.
3. 아래 CX-only runtime 설정을 등록/검증한다. secret 값은 로그·보고서·로컬 env 파일에 남기지 않는다.
4. 독립 리뷰와 마지막 테스트가 완료된 SHA만 같은 브랜치에 push한다. GitHub 자동 배포가 정확한 SHA/Preview/icn1인지 확인한다. 보호 없는 Production alias에 인증 코드를 보내지 않는다.
5. 승인된 새 Preview에서 접근 코드 → signed HttpOnly cookie → 세션 → 장소별 operation → QR/app 생성 → pending 재조회 → 취소를 확인한다. 새 테스트 세션만 쓰며 실제 신분증 승인·클라이언트 샘플 승인은 하지 않는다.
6. 실제 신분증 보유자에게 코드 입력 경로와 같은 장소 복귀/결과 확인 방법을 안내한다. 신분증·CI·QR payload를 전달받지 않는다. 이후에만 실제 verified 결과를 기록한다.

| 변수 | 제한/목적 |
| --- | --- |
| `HK_API_ENABLED`, `HK_CX_PREVIEW_ENABLED` | `1` |
| `HK_ISOLATED_MOCK` | `0`; file fallback은 별도 guard로 금지 |
| `HK_MODE_CX` | `cx` |
| `HK_CX_BASE_URL` | `https://cx.raonsecure.co.kr:18543` 고정 |
| `HK_CX_PROVIDER`, `HK_CX_ZKP_TYPE` | `comdl`, `AdultVerify` |
| `HK_STORE_KEY` | `ktour:cx-preview:20260925:journey:v1` 전용 원장 |
| `HK_ISSUER_SIGNING_SEED` | 신규 전용 안정적 random 32-byte hex, Sensitive |
| `HK_CX_PREVIEW_ACCESS_SECRET` | 신규 random 32-byte hex, Sensitive |
| `HK_CX_PREVIEW_ACCESS_CODE` | 신규 고엔트로피 코드, 서버 전용; URL/브라우저 저장소에 넣지 않음 |
| `HK_CX_PREVIEW_EXPIRES_AT` | 최대 `2026-09-30T14:59:59Z` |

공개 `NEXT_PUBLIC_*` 실행 플래그는 allowlisted 빌드 스크립트가 고정한다. build/prerender에는 위 secret·Redis token·체인 키를 전달하지 않는다. 이 브랜치의 `vercel.json`은 CX-only용이며 Production 빌드는 거부한다. 그대로 main에 병합해 공개 배포 설정을 바꾸지 않는다.

## 최종 로컬 검수 — 2026-09-25 19:32 KST

- `pnpm exec tsx --test tests/hackathon/*.test.ts`: **142/142 PASS**. 접근/Origin/경로/본문 차단, 실제 route dispatch 이전 세션·네트워크 0회, CX 상태 경합, Redis fixture 및 기존 Harvey 회귀를 포함한다.
- `pnpm test:contracts --reporter=dot`: **964/964 PASS**. 기존 앱 계약 회귀이며 전체 화면 시각 QA나 실제 체인 실행을 뜻하지 않는다.
- `pnpm build:vercel:cx-preview`: **PASS**, Next production build와 전체 TypeScript 검사 완료. 비밀값 없이 빌드한다.
- 해당 production build를 로컬에서 실행한 미설정 상태의 API 차단 검사: **5/5 PASS**, config/access/operations/ask/chat 모두 503, session cookie 생성 없음.
- `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3147 pnpm exec playwright test tests/e2e/ktour-cx-preview.spec.ts --project=mobile-chromium --workers=1 --output=artifacts/qa/cx-preview-final3 --reporter=list`: **7/7 PASS**, 375×812, 16.4초. 접근/401, QR·app 명시 선택, 재진입 복원, 취소 실패 유지, 만료, 신원 확인 후 중단/장소 복귀, 이미 인증된 issuance 재호출을 검수했다. 발급·체인 요청은 0회다.
- 위 브라우저 검수는 **API fixture**를 사용한다. QR 이미지도 테스트 PNG이며 실제 공급자 QR·본인인증 성공 증거가 아니다. iOS Safari/실기기 native 왕복 검증은 아직 하지 않았다.
- 캡처 직접 검수 후 접근 입력란/버튼 사이 12px 간격과 badge 콘텐츠 폭을 보정했다. 공용 CSS는 바꾸지 않았고 별도 리뷰 후 위 final3 전체를 다시 통과했다.
- 새로고침은 인증 모달을 자동으로 다시 열지 않는다. **같은 장소 CTA를 다시 열면 서버 세션의 진행 상태를 복원**한다. localStorage/sessionStorage에 CX provider 토큰/CI/QR payload/operation marker를 새로 저장하지 않는다. Preview 접근 및 세션은 별도의 HttpOnly cookie로 유지한다.
- Redis canary와 API 접근 경계는 작성자 외 리뷰 완료. UI는 별도 검토에서 발견한 중복 완료/재시도 로딩/취소 표현/만료/복귀 문제를 수정하고 root가 최종 캡처를 확인했다.

### 아직 주장하지 않는 것

9/26 후속 실행으로 실제 앱 Redis canary 및 CX-only 환경변수 등록 확인은 완료했다. **새 Preview 배포, 실제 CX transaction/QR 생성, 신분증 앱 승인 및 최종 검증**은 아직 미완료다. 공개 Production과 Harvey 별도 환경은 변경하지 않는다.
