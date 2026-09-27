# 별도 통합 Preview — 운영자 실행 순서

이 문서는 **내가 이어서 수행할 작업**이다. 사용자에게 CLI 배포/테스트를 맡기는 안내가 아니다.
공개 UI, 기존 CX-only, Sumsub Sandbox를 통합 실험 환경으로 덮어쓰지 않는다.

## 현재 준비와 잠금

- 프로젝트: `jaewook-9643 / ondo`, repo `woogieboogie-jl/k-tour-id`.
- 소스 branch: `integration/autonomous-finish-20260927`.
- 배포 목표는 Preview/`icn1`. Production·다른 project/team/repo/branch는 거절한다.
- branch 전용으로 OmniOne RPC/chain ID/registry, Sui network/package/Campaign/initial version,
  기존 KV pair, 전용 `HK_STORE_KEY`, CX base/provider/zkpType, 통합 전용
  `HK_ISSUER_SIGNING_SEED`의 **14개 설정**을 저장했다. 아래 runtime profile·만료·잠금
  10개도 추가 등록·재조회해 **총 24개**다. build child 환경은 runtime 설정을 대신하지 않는다.
- 전용 ledger key와 lock key가 모두 없음을 한 번의 `EXISTS` 읽기로 확인한 뒤(Redis 쓰기 없음),
  32바이트 난수로 새 가명화 seed를 한 번 생성해 **통합 Preview branch에만 sensitive로 등록**했다.
  설정의 scope/type을 재확인했으며 기존 CX seed의 ID·수정 시각은 변하지 않았다.
  기존 CX seed를 복제하거나 이전받을 필요가 없으며 그 값과 ledger를 그대로 보존한다.
- 전체 실행 flag는 켜지 않았고 새 통합 배포도 하지 않았다. 기존 build 설정은 CX-only이며,
  새 통합 빌드는 별도 설정 파일/스크립트를 명시해 사용한다. 기본 `vercel.json`을 교체하지 않는다.
- 준비된 파일: [전용 배포 설정](../k-tour-id-app/vercel.integration.json),
  [격리 빌드](../k-tour-id-app/scripts/hackathon-integration-build.mjs),
  [접근 검사](../k-tour-id-app/lib/hackathon/integration-preview-access.ts).
  로컬 빌드 명령은 `pnpm build:vercel:integration`이다. 이것은 원격 배포 명령이 아니다.
  `public:false`는 source visibility 설정이며 HTTP 접근 보호를 대신하지 않는다.
  API 접근은 별도 signed cookie/host/branch/runtime/expiry 검사로 차단한다.
- OpenDID 실제 adapter는 병렬 구현 중. sample credential/VP로 이 빈칸을 메우지 않는다.

### 이미 고정한 runtime 설정

모두 위 통합 branch의 Preview에만 등록했다. 아래 값만으로는 접근·제공자 실행이 열리지 않는다.

| 변수 | 고정값 |
| --- | --- |
| `NEXT_PUBLIC_HK_INTEGRATION_PREVIEW` | `1` |
| `NEXT_PUBLIC_HK_CX_PREVIEW` | `0` |
| `NEXT_PUBLIC_HK_PREVIEW_READ_ONLY` | `0` |
| `NEXT_PUBLIC_HK_ENABLED` | `1` |
| `HK_API_ENABLED` | `1` |
| `HK_ISOLATED_MOCK` | `0` |
| `HK_MODE_CX` | `cx` |
| `HK_MODE_OPENDID` | `opendid` |
| `HK_INTEGRATION_PREVIEW_EXPIRES_AT` | `2026-09-30T14:59:59Z` — 9월 30일 23:59:59 KST |
| `HK_INTEGRATION_PREVIEW_ENABLED` | **`0` — 활성화 전 유지** |

Vercel의 project/team/Git/region/immutable host 메타데이터도 실제 원격 배포 시 검사한다.
메타데이터가 없다고 검사를 지우거나 값만 위조해 통과시키지 않는다.

## 활성화 전 순서

1. [안전한 설정 인계](./HARVEY_ENV_HANDOFF_2026-09-26.md)의 기존 signer/Google·zkLogin salt/prover/AI 설정을 받는다.
   통합 가명화 seed는 이미 준비됐으므로 기존 CX seed 이전을 사용자 작업으로 추가하지 않는다.
   선택한 branch의 env metadata만 대조하며 값을 로그/파일/명령 인자로 출력하지 않는다.
2. 키를 메모리 안에서 공개 주소로 유도해 기존 issuer/agent/recorder 역할과 비교한다.
   현재 Sui gas object·정책·epoch와 OmniOne 권한을 다시 읽는다. 맞지 않으면 활성화하지 않는다.
3. [OpenDID 연결 계약](./OPENDID_WORKFLOW_BOUNDARY_2026-09-28.md)에 따라 실제 adapter와 native 복귀를 인수한다.
   provider 모드가 unimplemented인 동안 발급/제시 성공을 만들지 않는다.
4. 별도 integration build로 provider/store/signing 비밀값이 없는 빌드 프로세스를 실행한다.
   Vercel 계정·프로젝트·Preview target과 Git source를 실행 직전 다시 고정한다.
   로컬 빌드 통과는 원격 배포 권한 확인이 아니다.
5. 새 immutable Preview 주소가 정해지면 Google callback
   `https://<확정된-호스트>/hackathon/zklogin/callback`을 관리자에게 전달해 허용받는다.
   branch alias·public URL·이전 배포의 callback을 섞지 않는다.
6. 해당 환경 전용 접근 코드와 cookie 서명 secret은 운영자가 새로 생성·보관한다.
   이것은 이미 설정한 통합 가명화 seed/chain signer와 다르다. 사용자가 별도 서비스 키를 준비할 항목이 아니다.
   `HK_INTEGRATION_PREVIEW_ENABLED`는 기본 꺼짐이며 검수 전까지 켜지 않는다.
7. 접근 전·잘못된 origin·만료·runtime off·잘못된 branch·불완전 Redis에서
   세션 생성/제공자 요청이 일어나지 않는지 실제 배포를 검수한다. 실패하면 즉시 off 유지.
8. 본인 승인을 받아 한 operation 완주와 실패 복구를 검사한 뒤에만 실제 실연동 증거를 갱신한다.

## 세션·기록 원칙

access cookie는 짧은 수명, host/branch 결합, HttpOnly/Secure이며 신원 인증 결과가 아니다.
여전히 session/holder/operation/credential/VP/명시적 거래 동의가 각각 필요하다.
통합 저장소 namespace는 `ktour:integration-preview:autonomous-20260928:v1`이며
기존 CX/Sumsub ledger를 복사하거나 비우지 않는다. 서로 다른 환경의 operation을 합치지 않는다.

새 seed는 빈 통합 ledger를 위한 **독립 가명 영역의 최초 설정**이지 기존 CX seed의 교체가 아니다.
모든 instance와 재배포에서 같은 값을 사용하고 해당 ledger의 수명 동안 보존한다.
기존 session·subjectRef·credential·redemption·outbox를 가져오지 않으며, 서로 다른 ledger 사이의
동일인 결합이나 1회 사용 연속성을 보장한다고 표시하지 않는다. 이미 데이터가 쌓인 뒤 seed 변경이
필요하면 명시적인 마이그레이션 검토가 먼저다. 기존 Sui/OmniOne signer, 실제 OpenDID issuer 키,
Google/zkLogin salt는 이 준비로 생성·교체하지 않았다.

실거래 상태가 unknown이면 저장된 digest/txHash로 확인한다. 다시 누른다는 이유로 재전송하지 않는다.
OmniOne 성공은 receipt/event/registry payload 결합까지 확인해야 하며 RPC 응답 성공만으로 판정하지 않는다.

## 아직 하지 않은 것

새 통합 원격 배포/접근 코드 발급, 실제 OpenDID 제공자 연결, 새 Sui/OmniOne 거래,
본인 Google/CX/holder 승인. 이를 fixture/읽기 결과로 대체하지 않는다.
준비된 코드의 최종 검사·게시 revision은 [아침 인계](./MORNING_HANDOFF_2026-09-28.md)를 따른다.
