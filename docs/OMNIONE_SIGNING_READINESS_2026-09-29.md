# OmniOne 서명 준비 재점검 — 2026-09-29 KST

## 현재 확인 결과

승인된 `jaewook / ondo` Vercel 프로젝트의 환경변수 **114개 전체 메타데이터**를
읽기 전용 조회했다. 이름·target·branch·type만 출력했다. 다른 계정은 조회하지 않았다.

| 검사 | 결과 |
| --- | --- |
| `HK_OMNIONE_PRIVATE_KEY` 또는 recorder signer 별칭 | 현재 프로젝트 전체 범위에 없음 |
| 현재 셸의 OmniOne 키/RPC | 없음 |
| release/source worktree의 로컬 `.env` 비밀 설정 | 없음 |
| 원본 repo 앱의 `.env.local` | `VERCEL_OIDC_TOKEN` 이름만 존재; OmniOne 키/RPC 없음 |
| 기존 통합 Preview의 OmniOne 설정 | RPC URL, chain ID, registry 주소 3개 존재 |
| sensitive RPC 값을 API로 회수 가능 | HTTP 200이지만 `decrypted=false`; 사용 가능한 평문 없음 |
| 이번 신규 체인 읽기 / 서명 / 전송 / 배포 / 원격 설정 변경 | 모두 0 |

RPC가 보관돼 있으므로 사용자에게 새 토큰을 요청할 일이 아니다. 다만 sensitive 값을
로컬 API 조회로 복구할 수 없으므로, 이번 점검을 **9/29 체인 재검증 성공**이라고 주장하지
않는다. 마지막 실제 체인 읽기 근거는 [9/28 Gateway 검증](OMNIONE_GATEWAY_VERIFIED_2026-09-28.md)이다.
기존 제공 URL의 안전한 메모리 주입 또는 승인 서버의 읽기 전용 실행으로 재검증할 수 있다.

## 정확한 계약·권한

| 항목 | 기존 승인 대상 / 마지막 읽기 결과 |
| --- | --- |
| chain ID | `201210` |
| 현재 앱 registry | `0x696bc4e29c8f8079b6d3cd49d310a09577550e4c` (`DemoEntitlementRegistry`) |
| owner / 승인 recorder | `0x003403Cb95c2FFd66BC5748738d96C4A5B48b4ba` |
| 기존 recorder 권한 | 9/28 `recorders(address)=true` |
| 기존 누적 기록 | registry 22개; 별도 `KTourAnchor` 1개 |
| 승인 signer를 지금 사용할 수 있는가 | 조사한 승인 로컬/서버 환경에서는 찾지 못함 |

사람에게 필요한 것은 해당 recorder의 **승인된 서명 수단**뿐이다. 현재 adapter는
`HK_OMNIONE_PRIVATE_KEY` 서버 비밀 설정을 사용한다. 채팅/문서에 키를 붙이지 않는다.
기존 키 인계가 불가능하면 owner가 승인하는 recorder 위임 또는 원격 signer 연동을
별도 결정해야 한다. API 토큰·Sui 키·새 임의 EVM 키는 이 권한을 대신하지 않는다.
이번 작업은 owner/recorder를 바꾸거나 새 계약을 배포하지 않는다.

## 과거 기록은 어떻게 생겼는가

Harvey 원본 `bff485b9`부터 앱의
`lib/hackathon/adapters/omnione.ts`는 `HK_OMNIONE_PRIVATE_KEY`로 ethers Wallet을 만들고
`DemoEntitlementRegistry.recordRedemption(eventKey, payloadCommitment)`를 호출한다.
거래 설정은 기존 stage의 `type=0`, `gasPrice=0`이다. 계약은 `onlyRecorder`로 쓰기를
제한하고 최초 배포자를 owner/recorder로 등록한다. 이전 `KTourAnchor`는 별도 ABI와
`onlyOwner` 권한이며 현재 앱 흐름의 계약이 아니다.

따라서 과거 기록 존재와 지금의 signer 부재는 모순이 아니다. 당시 승인된 signer가
다른 실행 환경에서 서명할 수 있었더라도 그 키가 현재 프로젝트에 인계된 것은 아니다.
누적 수와 배포 receipt만으로 22건 각각을 앱의 어떤 operation/실행 코드가 만들었는지는
단정하지 않는다. 그 귀속은 해당 거래 receipt·eventKey·commitment와 원장 대응 증거가 필요하다.

## 이번 로컬 보완

기존 adapter는 비밀 설정의 존재만 확인한 뒤 서명을 진행할 수 있었다. 서명 경로에
다음을 추가했다. OpenDID 코드·credential/VP 검사·배포 프로필은 변경하지 않았다.

1. RPC origin/query, stage chain ID, registry, 명시적 recorder 설정을 기존 승인 tuple과 대조한다.
   Anchor 주소나 다른 host/chain/recorder는 네트워크/서명 전에 거부한다.
2. 실제 Wallet의 공개 주소가 승인 recorder인지 확인한다. 키는 새 helper에 전달하지 않는다.
3. 매 신규 서명 전 최대 3개 bounded 읽기로 실제 chain ID·배포 코드 존재·현재 recorder 권한을
   확인한다. SDK의 `staticNetwork` 설정이나 과거 permission 조회를 현재 증거로 대체하지 않는다.
4. 실패는 기존 `omnione_submission_not_started`로 처리한다. 서명/전송 0이며,
   오류 원문·RPC 토큰은 반환하지 않는다. 준비된 hash 선저장과 unknown 거래 재전송 금지는 유지한다.

코드 존재 확인은 Solidity 재컴파일 bytecode 일치 증명이 아니며,
서명 직전 읽기 성공도 이후 거래 성공/권한 불변을 보장하지 않는다. 최종 확정은 기존
receipt·registry entry·같은 receipt의 event 검증을 계속 요구한다.

로컬 검증(실제 provider 호출·키·서명 없음):

- OmniOne 단위 테스트 34/34 통과: 잘못된 tuple/주소/chain/code/권한, malformed 응답, 오류 redaction 포함.
- 실제 service/adapter를 사용하는 mocked outbox 테스트 32/32 통과: 새 거부 경계 4개 및 기존
  hash 선저장·동시 claim·timeout·중복 전송 금지 회귀 포함.
- TypeScript 검사 및 `git diff --check` 통과.

이 문서는 로컬 수정 결과이며 배포 완료 기록이 아니다.

## 키 인계 후에도 우리가 할 일

현재 공개 hosted-Sui 프로필은 `HK_OMNIONE_*`와 redeem을 의도적으로 차단한다.
키만 추가하면 활성화되는 구조가 아니다. 승인된 실행 범위에 맞는 보호 프로필/설정 연결,
영속 outbox 경로, 제한된 실제 기록과 receipt/event/commitment 대조가 우리 통합 작업으로 남는다.
OpenDID는 별도 Claude workflow이며 여기서 우회하거나 실증명으로 바꾸지 않는다.
샘플 VC를 쓰는 부분 검증은 실제 OpenDID/실매장 혜택 성공과 명확히 구분해야 한다.

또한 9/28 Gateway 문서의 옛 CX seed 인계 요청은 이후
[별도 통합 seed 준비 완료](HARVEY_ENV_HANDOFF_2026-09-26.md#통합-가명화-seed--이미-처리했으므로-인계-불필요)로
해소됐다. 원본 CX seed 이전은 이번 사용자 입력 목록에 넣지 않는다.
