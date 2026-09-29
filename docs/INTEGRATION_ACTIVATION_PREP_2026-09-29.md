# 통합 Preview 활성화 전 준비 — 2026-09-29 KST

이 문서는 운영자가 이어서 수행할 작업이다. 사용자에게 CLI·배포·키 복사를 맡기거나,
키만 있으면 전체 제공자 연동이 끝난다고 설명하지 않는다. 이번 변경은 **오프라인 대상 검증과
회귀 테스트**이며 원격 branch/env/배포/원장/계약을 변경하지 않았다.

검토 기준은 release `59032b4b`와 로컬에 보관된 원격 추적 ref
`origin/integration/autonomous-finish-20260927`의 `329464ad`다. 후자는 이번 작업에서
원격으로 새로 조회한 최신 상태라는 뜻이 아니다. 실제 갱신 직전 승인된 저장소 ref를 재확인한다.

## 이번에 명확히 분리한 Sui 대상

이전 준비 검사기는 Harvey의 package/Campaign만 알고 있었다. 자체 Testnet 환경이 이미
검증됐는데도 해당 tuple을 잘못된 대상으로 판정하거나 기존 Harvey 키가 필요하다고 읽힐 수 있었다.
이제 [고정 대상 선언](../k-tour-id-app/lib/hackathon/integration-sui-targets.ts)의 두 대상 중
`HK_INTEGRATION_SUI_TARGET`를 **명시적으로** 선택한다. 키·package·branch가 있다는 이유로
대상을 추정하지 않는다. 임의의 세 번째 대상이나 두 환경의 혼합도 허용하지 않는다.

| 구분 | `harvey-original` | `selfhosted-testnet` |
| --- | --- | --- |
| package | `0xc5d26326ffd5267bb5b54625c1e2b9c03f7cca4753232d0b042c62ee74fd975d` | `0x7a28a5e59d87e385f2eb3047ca2bbe76301627343f8d88eeb0f03733d4f2389e` |
| Campaign | `0xe3fce96c9c9e1086ff20dd7453e16ff2c52d3d3324e6e4e34446c7d0dc2ecf16` | `0xa273ccd96315ae187b16eb3192c822795bc2031e6f79405739daec4a52275afd` |
| 최초 shared version | `349181955` | `349181963` |
| issuer / sponsor | `0x8d88f750b8bb8f0e63e6617821e3d2a03fda22b9a7841215689da66c79664c45` | `0x900cd55f3d9de4541e306c6a3b1fe85cd4ddbf04319ee316ae21b6bb3ba95d76` |
| agent | `0xad9340861c08c87c388108f13bde6fd6e27d2604c39d0f6d201e00d6ee161a05` | `0x17ee59f56d182c010732daaf509a2b35b221bf7ec62e4a59c3b2ceca2c3bbce4` |
| 용도 | 기존 배포를 읽기 전용으로 준비 검사 | 승인된 자체 환경의 후속 통합 후보 |

공통 pin은 `testnet`, genesis identifier
`69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD`, RPC
`https://fullnode.testnet.sui.io` 또는 명시적 `:443` 형태다. 원본
[배포 정보](../move/ondo_entitlement/deploy-info.testnet.json)를 덮어쓰지 않으며 자체 환경의
근거는 [실제 독립 E2E](SUI_SELFHOSTED_E2E_2026-09-28.md)와
[hosted 프로필 pin](../k-tour-id-app/lib/hackathon/hosted-sui-profile.ts)이다.

이 resolver의 Harvey 선택은 **서명 권한 부여가 아니다**. 후속 보호 실행 프로필은 자체
`selfhosted-testnet`만 허용해야 한다. 자체 환경에는 이미 승인 운영자가 관리하는 issuer/agent
키가 있으므로 그것을 쓸 계획에서 Harvey의 개인 키를 새로 요청하지 않는다. 각 키의 실제
공개 주소와 권한은 승인된 환경 안에서 재확인하며, 키 값은 출력하지 않는다.

## 오프라인 검사 방법과 의미

앱 디렉터리에서 `pnpm exec tsx scripts/hackathon-integration-readiness.ts --offline`은
빈 설정의 준비 목록을 보여 준다. ambient env나 `.env`를 읽지 않는다. 명시적인 snapshot을
점검하려면 같은 명령 뒤에 `--stdin`을 붙이고, 승인된 메모리 전달 경로로 최대 32 KiB JSON을
입력한다. 비밀값을 argv·shell history·문서·새 dotenv에 적지 않는다.

허용하는 최상위 입력은 `env`, `availableInputs`, `suiRoles`, `aiRequested`,
`zkLoginRequested`뿐이다. `suiRoles`는 issuer/agent/sponsor **공개 주소** 세 개다.
`env`는 [검사기의 allowlist](../k-tour-id-app/lib/hackathon/integration-readiness.ts)를 따르며
위 selector와 network/genesis/RPC/package/Campaign/version을 모두 명시한다.
`availableInputs`의 허용된 설정 이름에 `true`를 쓰는 것은 운영자가 실제 보관을 확인했다는
분류용 주장이다. 해당 destination에 이미 설정됐다거나 유효한 서명 수단이라는 증거는 아니다.

- 공개 역할 비교는 고정 주소와의 일치만 확인한다. 가짜 키 문자열이나 공개 주소만으로도
  오프라인 형식 검사는 가능하므로 `suiSignerOwnershipVerified`는 항상 `false`다.
- 미설정된 자체 Sui 키가 승인 보관 위치에 실제 있는 것을 확인했다면 `availableInputs`로
  분류해 `available_input_not_configured`라는 **우리 설정 작업**으로 보고한다.
  대상 이름만 보고 키가 있다고 추정하지 않는다.
- `ok: true`는 이 오프라인 목록에 누락/충돌이 없다는 뜻뿐이다. `providerVerified`,
  `liveExecutionReady`, `opendidProviderReady`는 항상 `false`다.
- 공개 target pin만 출력한다. 입력한 키, RPC token, 임의 역할 주소나 잘못된 selector를
  출력하지 않는다. 네트워크·서명·전송·env 변경은 모두 0이다.

## 오래된 통합 branch에 없는 변경

아래 변경은 `329464ad`에 없고 `59032b4b` 또는 이 후속 준비 branch에 있다.
오래된 branch에 키만 넣어 재배포하는 것으로 대체할 수 없다.

| 반영할 변경 | 근거 revision / 검사 경계 |
| --- | --- |
| Sui 장기 보관 조회 fallback와 독립 Testnet E2E | `6af6aaf5`; fullnode 보관 범위를 지난 digest를 읽기 전용 GraphQL로 확인. 조회 실패를 재전송 이유로 쓰지 않음 |
| CX 완료 응답의 문서화된 envelope 결합 | `17969f7f`; tx/cx/reqTxId 충돌 거부, 새 완료 token 사용. AdultVerify만으로 CI·동일인·성인 판정을 임의 생성하지 않음 |
| 자체 Sui 대상·서명 역할·gas/횟수 제한의 hosted 경로 | `739e169b` 및 후속 hosted 보완; 현재 공개 hosted 경로의 보호이며 full-integration으로 자동 전이되지 않음 |
| zkLogin 준비 검사 fail-closed | `e306037f`; client ID/키 존재를 실제 Google/prover 검증 성공으로 표시하지 않음 |
| OmniOne 신규 서명 직전 고정 tuple·실제 signer·chain/code/recorder 검사 | `fa28ac32` (원 준비 commit `679463c6`); wrong signer는 서명/전송 전 거부 |
| 통합 배포 설정/빌드 수정 | `59032b4b`; Vercel이 거부한 deprecated `public` 속성 제거, 검증된 원격 metadata에서 상속한 `NODE_OPTIONS`는 child env에서 제거. 로컬 injection은 계속 거부 |
| 명시적 own-vs-Harvey readiness 및 역할 비교 | 이 branch의 `a11cf836`와 후속 readiness 변경; 환경 존재로 안전 대상 추정 금지 |

현재 base에 포함된 공개 hosted-Sui 제한만으로 full-integration 실행이 안전하다고 주장하지
않는다. 병렬 작업의 integration limits는 **기존 hosted와 합산한** 10-operation / 300,000,000
MIST 상한을 대상으로 하며 별도 10회를 새로 부여하지 않는다. 기존 hosted writer를 멈추고
이력/미확정 거래를 대조하는 명시적 migration 승인이 없는 동안 실행을
`integration_sui_migration_required`로 거부하는 설계다. 해당 변경은 이 문서의 base에는
아직 없으며, 반영 revision과 테스트를 별도로 확인해야 한다. 단순 env flag로 이 fence를
해제하거나 기존 예산/원장을 초기화해서는 안 된다.

## 키 인계 후 운영자가 수행할 정확한 순서

1. 기존 공개 hosted/CX 배포와 OpenDID Claude worktree를 그대로 둔다. 승인 저장소에서
   통합 branch의 실제 최신 SHA를 읽고, 별도의 깨끗한 worktree를 만든다. 이 문서의
   `329464ad`를 현재 remote로 단정하거나 force-push하지 않는다. local/remote 변경이
   있으면 먼저 충돌 범위와 소유자를 확인한다.
2. `59032b4b` 이후 검토된 target/readiness 및 integration-limits revision까지 포함한
   **하나의 후보 SHA**를 만든다. ancestor임이 확인되면 fast-forward하고, 그렇지 않으면
   관련 변경만 검토해 반영한다. native OpenDID 구현 branch를 임의 merge하지 않는다.
   `git diff --check`, 단위/verification/계약 검사, typecheck와 통합 build를 후보에서 실행한다.
3. 전용 통합 branch의 앱 `vercel.json`만 검토된
   [vercel.integration.json](../k-tour-id-app/vercel.integration.json)과 동일한 프로필로 변경해
   commit한다. `buildCommand=pnpm build:vercel:integration`, region `icn1`, 자동 배포 off를
   확인한다. 기존 `329464ad`의 기본 파일은 여전히 `build:vercel:cx-preview`이므로 source
   revision만 갱신하고 기본 파일을 방치하면 잘못된 artifact가 된다. release/Production의
   기본 파일은 변경하지 않는다. `public:false`를 다시 추가하지 않는다.
4. 실제 원격 metadata를 재확인한다: repo `woogieboogie-jl/k-tour-id`, branch
   `integration/autonomous-finish-20260927`, app root `k-tour-id-app`, Preview only,
   project `prj_w5rckTz9B1DO55fvVRXjQRy9L5RM`, team `team_6kJAloQ9WlswvMtbbCmGI7Er`.
   branch 한정 기존 seed/Redis/RPC를 유지한다. `HK_INTEGRATION_PREVIEW_ENABLED=0`을
   유지하고 발급된 secret을 build env로 넘기지 않는다. hosted-Sui operator는 별도 branch와
   profile에 고정되어 있으므로 그 deploy 명령을 통합 branch에 재사용하거나 pin을 풀지 않는다.
5. `HK_INTEGRATION_SUI_TARGET=selfhosted-testnet`와 위 public tuple을 이 Preview 범위에
   설정한다. 승인된 기존 자체 issuer/agent를 안전하게 연결하고 공개 역할을 대조한다.
   sponsor가 생략되면 issuer fallback을 확인한다. 개인 키를 새로 만들거나 Harvey signer로
   바꾸지 않는다. 실제 chain identifier·Campaign 타입/issuer/정책·gas·epoch를 읽어 확인한다.
6. 누적 budget migration은 **우리 구현/검증 작업**이다. hosted writer 종료와 미확정 거래
   reconciliation, 이전 operation ID·원장 hash·중지 시각, 기존+신규 합산 예산을 검토하기
   전에는 full-integration을 켜지 않는다. 새 namespace가 빈 원장이라는 사실만으로 잔여
   예산이 초기화되지는 않는다. seed/subject domain은 독립 상태로 유지하고 과거 PII/session/
   credential을 가져오거나 cross-ledger 동일인/1회 사용을 보장한다고 표시하지 않는다.
7. 승인된 OmniOne recorder 서명 수단을 연결한 후
   [현재 signer 준비 검사](OMNIONE_SIGNING_READINESS_2026-09-29.md)를 실행한다.
   기존 sensitive RPC가 보관된 것은 이미 확인됐으므로 새 token을 재요청하지 않는다.
   승인 recorder 부재를 임의 EVM 키·owner 변경·새 계약으로 해결하지 않는다.
8. Google client/salt/prover와 Gemini는 실제 준비 상태에 따라 별도로 인수한다. 새 immutable
   Preview 주소에 맞는 Google callback 등록과 본인 로그인/동의를 확인한다. 키 존재나 rule
   AI fallback을 제공자 성공으로 표시하지 않는다. 접근 code/cookie secret은 운영자가
   활성화 직전에 생성하는 환경별 값이며 사용자에게 서비스 credential로 요구하지 않는다.
9. runtime off 상태로 고정 SHA의 Preview를 배포하고, 정확한 immutable host/forwarded
   headers/branch/region/expiry와 접근 전 401/503, 잘못된 origin/만료/불완전 Redis의 차단을
   검증한다. 접근 code/secret이 있어도 OpenDID 제공자 구현을 대신하지 못한다.
10. [별도 OpenDID 계약](OPENDID_WORKFLOW_BOUNDARY_2026-09-28.md)에 맞는 실제 구현을
    인수하기 전에는 `HK_MODE_OPENDID=opendid`의 fail-closed 상태를 유지한다. 모드를 mock으로
    바꾸거나 credential/VP/holder/consent 검사를 건너뛰지 않는다. 이 단계는 별도 Claude
    workflow이며 이번 변경이 구현/완료한 것이 아니다.
11. 모든 실행 경계와 예산/권한이 확인된 뒤 승인된 소수 작업만 수행한다. 같은 operation의
    Sui receipt/event/역할과 OmniOne receipt/event/registry commitment를 결합해 검증하고,
    실제 동의·보유자 승인 근거와 함께 새 증거를 남긴다. unknown digest/hash는 먼저 조회하며
    자동 재방송하지 않는다. 공개 Production 활성화는 이 Preview 절차에 포함되지 않는다.

현재 expiry의 최대치는 `2026-09-30T14:59:59Z`다. 일정이 지나면 문서 시각만 바꿔 검사를
우회하지 않고 코드·정책·승인 범위를 다시 검토한다. 기존
[통합 runbook](INTEGRATION_PREVIEW_RUNBOOK_2026-09-28.md)의 `public:false` 설명과
Harvey signer를 전제로 한 준비 순서는 이 후속 문서의 대상 분리/수정으로 대체한다.

## 이번 로컬 검증

세 readiness/target 테스트 파일에서 34/34 통과했다. 두 승인 tuple, 혼합 tuple/역할,
임의 selector/chain/RPC, 누락된 공개 값, 준비된 자체 키의 소유자 분류, getter/추가 key/symbol,
검증된 역할 snapshot 재사용, CLI 비밀값 비출력을 검사한다. 기존 통합 build/zkLogin readiness
19/19와 TypeScript 검사도 통과했다. 실제 provider 요청·서명·방송·원격 env 변경·배포는 모두 0이다.
이 문서는 full-integration 활성화 완료나 새 제공자 E2E 성공 증거가 아니다.
