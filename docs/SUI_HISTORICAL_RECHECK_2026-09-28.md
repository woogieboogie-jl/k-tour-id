# Sui 과거 3거래 재검증과 E2E 경로 — 2026-09-28

> **후속 구현·실행 완료:** 아래 진단 뒤 `readTransaction`과 감사 CLI에 제한된 공식
> Testnet GraphQL fallback을 구현했다. 13:22:37.794Z 실제 과거 3거래 재감사 PASS,
> 이후 현재 통합 앱의 **새 실제 Testnet 3거래 E2E도 성공**했다.
> [새 실행 증거·별도 환경·정확한 미검증 범위](./SUI_SELFHOSTED_E2E_2026-09-28.md).

## 정정 결론

**전달된 세 거래는 모두 실제 Testnet 성공 거래이며, 같은 권한 발급 → 위임 → 실행으로 연결된다.**
이전 fullnode `not found`는 해당 조회 경로의 과거 데이터 보관 범위 문제였다.
GraphQL/탐색기 대조 전에 조회 실패만 전달한 것은 불충분한 검수였다.
과거 거래를 찾기 위해 새 서명키나 사용자 입력을 받을 필요는 없었다.

## 이번에 직접 확인한 근거

- 2026-09-28T12:59:52.890Z, 공식 `https://graphql.testnet.sui.io/graphql`에서
  세 digest를 한 read-only query로 조회했다. HTTP 200, 오류 없음, 각 digest 일치,
  `effects.status=SUCCESS`, 이벤트 pagination 잔여 없음.
- chainIdentifier는 현재 Testnet과 같은
  `69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD`다.
- 실제 브라우저로 세 Suiscan 페이지에서도 HTTP 200 / `Success`와 Move 호출·이벤트를 확인했다.
- 별도 작성자의 조회와 root 재조회를 대조했다. 신원 인증·키 로딩·새 서명·거래 전송은 하지 않았다.

| 거래 | 실제 Move 동작 / 이벤트 | checkpoint | 실행 시각(UTC) |
| --- | --- | ---: | --- |
| [발급](https://suiscan.xyz/testnet/tx/4pNNdcruJvmdWyYnSamrh7vxBRCCxWUAwG58uHBP1Wy3) | `issue` → `EntitlementIssued` | 384352746 | 2026-09-16 12:24:54.047 |
| [사용자 위임](https://suiscan.xyz/testnet/tx/EATbwBKz3PqhQRdqkar1VGxVS31eBL9ex3UYjEdudM5W) | `delegate` + `attest_consent` → `GrantCreated`, `ConsentAttested` | 384352752 | 2026-09-16 12:24:55.305 |
| [Agent 실행](https://suiscan.xyz/testnet/tx/CisRR8SYFCxukw8WntxzkxGbrx9Xc19D2Vh96SZgfB4D) | `consume` + `attest_execution` → `GrantConsumed`, `ExecutionAttested` | 384352758 | 2026-09-16 12:24:56.633 |

현재 package `0xc5d26326ffd5267bb5b54625c1e2b9c03f7cca4753232d0b042c62ee74fd975d`와
Campaign `0xe3fce96c9c9e1086ff20dd7453e16ff2c52d3d3324e6e4e34446c7d0dc2ecf16`가 일치한다.
발급 holder = 위임 owner, 세 단계 intent, 위임·동의·소비 grant가 모두 연결된다.
소비·실행 attestation의 record는
`0xce1095866585fd01f230517890b0d8bf1d4ddc15bb9f49e12b329b9bb7a2a186`로 일치한다.

공개 서명은 SDK `parseSerializedSignature`로 종류만 확인했다. 발급은 ED25519 1개,
위임과 실행은 ED25519 2개씩이다. 원문 서명은 출력·저장하지 않았다.
**이 세 거래는 zkLogin 서명 거래가 아니다.** Ed25519 사용자 서명도 유효한 사용자 서명이며,
이 사실이 다른 거래에서의 zkLogin 구현 유무를 판정하지는 않는다.
Agent 실행 이벤트만으로 실제 LLM 호출이나 CX/OpenDID 인증 성공도 입증하지 않는다.

## 왜 fullnode는 찾지 못했는가

2026-09-28T12:58:29.937Z에 동일 공식 fullnode의 `GetServiceInfo`를 읽었다.

- endpoint: `https://fullnode.testnet.sui.io:443`
- head checkpoint: `388739452`
- `lowestAvailableCheckpoint`: **`386731138`**
- 세 거래 checkpoint: **`384352746` / `384352752` / `384352758`**

세 거래 모두 해당 노드가 제공하는 이력 범위보다 오래됐다. Sui 공식 문서도 fullnode gRPC가
과거 데이터를 정리하며 아카이브로 자동 전환하지 않는다고 설명한다.
[공식 과거 데이터 조회 안내](https://docs.sui.io/develop/accessing-data/archival-store/using-archival-store).
이번에는 공식 GraphQL 조회가 성공했다. GraphQL 내부에서 어느 저장소를 사용했는지는 추정하지 않는다.

## 기존 앱에서 이 거래를 만드는 정확한 순서

1. 제안 범위 승인·지갑 소유 증명 → `/operations/:id/delegation/prepare`
   → `service.delegationPrepare` → `prepareDelegationOnce` → `issueEntitlement` → **발급 거래**.
2. 브라우저가 준비된 PTB에 사용자 서명 → `/operations/:id/delegation/submit`
   → `executeDelegation` → **위임 + 동의 attestation 거래**.
3. Agent 실행 → `/operations/:id/agent/run` → `agentConsume`
   → **권한 소비 + 실행 attestation 거래**.
4. 그 뒤의 `redeem`은 현재 자격·중복·체인 증거를 다시 검증하고 서비스 사용/OmniOne 기록을 처리한다.

UI의 `Get pass`/`credential/issue`는 OpenDID credential 단계이며 1번 Sui 거래와 다르다.
기존 Harvey Move 흐름은 보존돼 있다. 현재 통합본에서도 같은 adapter를 호출한다.
Harvey 공개 config를 읽어 같은 package/Campaign을 확인했으며, 선언된 모드는
CX/OpenDID `mock`, AI `rule`, Sui `testnet`, OmniOne `stage`, zkLogin `google`이다.
설정 선언만으로 실제 제공자 성공이나 특정 서명 종류를 판단하지 않는다.

## 진단 시점의 다음 E2E 범위 (후속 결과는 상단 링크)

- **Sui 단독 새 실행:** 기존 adapter를 사용하는 별도 runner로 새 operation 하나의
  issue → delegate/consent → consume/attest를 실제 실행하고 sender·holder·grant·record·commitment를 대조한다.
  CX/OpenDID/Google/AI를 기다리지 않아도 된다. 기존 issuer·agent 서명 권한과 승인된 테스트 holder가 필요하다.
- **실제 앱/zkLogin E2E:** UI 승인 → OAuth/zkLogin → 위임 서명 → Agent → 서비스 결과 →
  OmniOne 확정까지 같은 operation으로 확인한다. 실제 로그인/동의와 provider 설정이 필요하다.
- **이번에 완료한 것:** 과거 세 거래의 읽기 재검증과 소스 경로 추적이다.
  새 거래를 실행했거나 현재 통합 버전의 전체 E2E가 완료됐다고 표시하지 않는다.

진단에서 찾은 fullnode-only 조회 문제는 이제 수정했다. **Testnet의 typed NOT_FOUND**일 때만
공식 GraphQL에 1회 읽기 요청을 보낸다. 15초·512 KiB·50 이벤트 상한, 네트워크/digest/
effects BCS·상태·이벤트 완전성 검사를 적용하고 기존 grant·record·commitment 검증도 유지한다.
실제 재감사는 fullnode 5회 + GraphQL 3회 읽기로 통과했다. 서명·거래 전송은 0회다.
일반 장애나 다른 네트워크로 fallback하지 않으며 과거 객체 전체의 복구를 보장하지 않는다.
현재 Grant/ExecutionRecord 읽기는 기존 fullnode 경로다. 조회 실패 때문에 재발급/재전송하지 않는다.
