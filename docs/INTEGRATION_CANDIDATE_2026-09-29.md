# 통합 Preview 후보 소스 통합 — 2026-09-29 KST

이 후보는 **소스 통합과 오프라인 검증**이다. 통합 runtime 활성화, 배포, 신규 체인 거래나
전체 제공자 E2E 완료가 아니다. 공개 hosted/CX release와 별도 Claude OpenDID worktree는
수정하지 않았다. 이 후보 branch를 기존 원격 integration branch에 덮어쓰거나 push하지 않았다.

## 정확한 소스 구성

작업 branch는 `prep/integration-candidate-20260929`, worktree는
`.codex-worktrees/integration-candidate-20260929`다.

| 역할 | 원 검토 revision | 후보에 반영된 revision |
| --- | --- | --- |
| 현재 검토된 release + CX identity policy hotfix | `e304b865` | 후보의 base |
| 명시적 own-vs-Harvey 공개 대상 pin | `a11cf836` | `7fd2e08a` |
| 오프라인 readiness/역할 비교/활성화 인계 | `78348a92` | `a4b6f119` |
| 합산 예산·역할·gas 제한 및 migration fence | `2299c3f1` | `4ed01f38` |
| runtime-OFF 자체 Sui 입력 준비 도구/75개 fixture | `19af5ba9` | `b1b2af6b` |

`service.ts`의 예상된 merge 충돌은 두 보호를 모두 유지해 해결했다. 세 Sui 단계 진입에서
CX mode/provider guard와 integration operation membership 검사를 모두 실행하며,
issuer/delegation/agent의 broadcast 직전 정책 검사와 이미 발생한 거래 증거 보존을 유지한다.
agent의 두 번째 시도 금지는 hosted와 integration 양쪽에 적용한다. 독립 read-only merge
검토에서도 이 두 변경의 보존을 확인했다.

후보의 앱 `vercel.json`은 검토된 `vercel.integration.json`과 정확히 일치한다.
build command는 `node scripts/hackathon-integration-build.mjs`, region은 `icn1`,
Git 자동 배포는 `false`다. deprecated `public` 속성이나 build env 비밀값은 없다.
기존 CX와 hosted용 별도 스크립트/프로필은 유지했다. 프로필 회귀 테스트는 이 후보에서
선택한 integration 파일과의 **완전 일치**를 검사하도록 조정했다.

후보 branch 이름 자체는 원격 실행 허용 branch가 아니다. 원격 build guard는 여전히
`integration/autonomous-finish-20260927`, 정확한 repo/project/team, Preview만 허용한다.
향후 원격 source 갱신은 별도 검토된 commit/ref 확인 후 수행하며 이 후보를 push하는 것만으로
배포되거나 runtime이 열리지 않는다.

## runtime-OFF 설정 준비 — root 운영자 확인 완료

root 운영자가 검토된 `19af5ba9` 도구로 승인된 프로젝트의 **기존 통합 Preview branch에만**
정확히 10개 설정 변경(7개 생성, 3개 갱신)을 완료했다고 확인했다.

- 자체 issuer/agent는 새 키가 아니라 기존 승인 보관 키이며, 실제 유도 공개 주소를 고정 역할과
  대조했다. sponsor는 같은 issuer다. 키 값은 문서·로그·git에 넣지 않았다.
- selector/RPC/genesis identifier/explorer를 추가하고 package/Campaign/shared version을
  자체 검증된 tuple로 바꿨다. 기존 `HK_SUI_NETWORK=testnet`은 유지했다.
- 준비 전·각 변경 전·최종 검수에서 `HK_INTEGRATION_PREVIEW_ENABLED=0`과 정확한
  Preview scope를 확인했다. 완료된 private append-only journal을 보존했다.
- 배포 0, runtime 활성화 0, 신규 키 생성 0, ledger/budget/독립 가명 seed 변경 0이다.

따라서 자체 Sui 키나 Harvey 키 인계를 사용자 할 일로 남기지 않는다. 이 기록은 root의
실제 운영 결과 인계이며 후보 검증자가 키/원격 설정을 다시 읽거나 추가 변경했다는 뜻이 아니다.

도구를 후보에도 보존했지만 CLI는 의도적으로 원래 `integration-inputs-20260929` worktree와
branch에 고정되어 있다. 후보에서 `plan`/`apply`를 실행하기 위해 pin을 풀지 않는다.
완료/중단된 journal을 삭제해서 재실행하지 않는다. 후보에서는 주입된 fake API를 사용하는
테스트만 실행한다.

## 계속 잠겨 있어야 하는 경계

빌드 child는 `HK_INTEGRATION_PREVIEW_ENABLED=0`을 고정하고 provider/store/signing/access
비밀값을 받지 않는다. 실 runtime도 off다. private 접근 코드/cookie는 신원 증거나 Sui 실행
권한을 대신하지 않는다. `HK_MODE_CX=cx`, `HK_MODE_OPENDID=opendid` 요구는 그대로이며
별도 OpenDID 구현을 sample credential/VP로 우회하지 않는다.

`assertIntegrationSuiActivation()`은 현재 **항상** `integration_sui_migration_required`로
거부하며 env로 해제할 수 없다. 기존 hosted의 사용 슬롯과 integration 슬롯을 합쳐 최대10개,
거래당10,000,000 MIST, 기존 총300,000,000 MIST 한도다. 별도 빈 namespace나 새 배포가
추가 예산을 만들지 않는다. 공개 capabilities도 전체 실행 준비 완료를 표시하지 않는다.

남은 budget cutover 구현/검증은 **우리 작업**이다. 현재 사용자 승인을 또 받아야 하는 일반
작업으로 미루지 않는다. 다만 아직 제공자가 준비되지 않은 통합 환경을 위해 현재 작동 중인
hosted를 먼저 중단하지 않는다. 제공자 준비가 되면 모든 기존 immutable writer까지 안전하게
정지·정산하고, 누적 슬롯/미확정 거래/ledger hash를 인수하는 atomic one-way migration을
구현·검증한 뒤 fence를 대체한다. 상세 실패/복구 기준은
[migration 준비 계약](INTEGRATION_SUI_LIMITS_PREPARATION_2026-09-29.md)을 따른다.

## 실제 외부 의존과 남은 검증

| 항목 | 현재 상태 / 담당 |
| --- | --- |
| 자체 Sui source·대상·서버 키 준비 | 준비됨. 새 사용자 키 요청 불필요; 활성화 직전 chain/role/gas 재확인은 우리 작업 |
| OmniOne recorder | 현재 승인 환경에서 사용할 수 있는 signer를 찾지 못했음. 승인 recorder의 서명 수단 인계는 실제 소유자 의존. 기존 RPC token을 다시 요구하지 않음 |
| Google/zkLogin | 승인 OAuth client/등록 및 prover 경로의 실제 인수 필요. 설정·검증은 우리 작업, 본인 로그인/동의는 사용자 수행 |
| Gemini | 사용할 승인 API credential 필요. rule fallback은 실제 Gemini 검증이 아님 |
| CX | 문서화된 완료 binding 수정은 있음. 본인의 실제 승인·결과 재검증 필요; CI 없는 AdultVerify를 임의 동일인 증명으로 승격하지 않음 |
| OpenDID | 별도 Claude workflow. 이 후보는 구현·검사를 제거하거나 제공자 완료를 주장하지 않음 |
| 통합 배포/접근/예산 migration/E2E | 우리 후속 작업. source consolidation은 완료했지만 이 실행 단계들은 아직 수행하지 않음 |

최대 expiry는 `2026-09-30T14:59:59Z`다. 지나면 자동 연장하거나 한도를 늘리지 않는다.
현재 공개 release의 실제 거래나 이전 OmniOne 기록을 새 통합 operation의 성공으로 재사용하지 않는다.

## 후보 검증

- 전체 TypeScript 단위 테스트: 449/449 통과.
- 실제 service/adapter를 사용하는 mocked verification: 70/70 통과.
- integration/hosted build plan 및 프로필 테스트: 19/19 통과.
- 접근 순서/프로필 static contract: 4/4 통과. 두 프로필이 공유하는 body reader를 각 분기 안에서
  검사하도록 오래된 selector를 수정했으며 두 access 검사 모두 business body/session보다 앞선다.
- runtime-OFF 입력 도구 fake API 테스트: 75/75 통과.
- TypeScript 검사 및 `git diff --check` 통과.
- 실제 local integration build 통과: inherited env 없이 빌드했고 Next TypeScript 및30개 static
  page 생성까지 성공했다. 배포는 수행하지 않았다.

모든 테스트는 synthetic 입력/로컬 격리 환경이며 fixture용 로컬 암호 서명은 포함한다.
후보 검증 과정에서는 실제 제공자 요청, 운영 비밀키 접근, 실제 체인 거래 서명/방송,
원격 env 변경 및 배포를 수행하지 않았다.
