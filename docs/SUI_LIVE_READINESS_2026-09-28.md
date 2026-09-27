# Sui 공개 LIVE readiness — 2026-09-28

## 결론과 실제 관측

**2026-09-28 01:25:27 KST / 2026-09-27T16:25:27.077Z**, 고정 Sui Testnet 공개 RPC에서 현재 배포 상태를 읽어 검증했다. 결과는 `ok=true`, `mode=live-public-read-only`, **`liveExecutionReady=false`**다. 현재 객체 확인 성공이지 새 거래·서명·전체 연동 성공이 아니다.

대상은 `https://fullnode.testnet.sui.io:443`이며 [공개 배포 metadata](../move/ondo_entitlement/deploy-info.testnet.json)의 고정 값과 비교했다. 요청은 `GetServiceInfo` 1회, `GetObject` 3회(package·Campaign·Clock), `GetBalance` 2회(issuer·agent)로 **총 6회**, 수신 body **1,366바이트**였다. 이 문서를 쓰기 위한 추가 조회는 하지 않았다.

| 관측 항목 | 실제 결과 |
| --- | --- |
| 네트워크 / chain ID | `testnet` / `69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD` — metadata 일치 |
| ServiceInfo | epoch `1235`, checkpoint `388432774`, checkpoint 시각 `2026-09-27T16:25:27.800Z` |
| Package | `0xc5d26326ffd5267bb5b54625c1e2b9c03f7cca4753232d0b042c62ee74fd975d`, `package`, Immutable, version `1` |
| Campaign | `0xe3fce96c9c9e1086ff20dd7453e16ff2c52d3d3324e6e4e34446c7d0dc2ecf16`, 위 package의 `entitlement::Campaign`, Shared |
| Campaign version | initial shared `349181955`, 현재 `1026899622` |
| 정책·상태 | `active=true`, `policy_version=1`, `campaign_ref=hk-identity-perk-v1` |
| issuer | `0x8d88f750b8bb8f0e63e6617821e3d2a03fda22b9a7841215689da66c79664c45` — metadata 일치 |
| agent | `0xad9340861c08c87c388108f13bde6fd6e27d2604c39d0f6d201e00d6ee161a05` — metadata 일치 |
| 누적 카운터 | issued `26`, delegated `24`, consumed `23`; 이번 작업이 만든 거래 수가 아님 |
| 표준 Clock | `0x6`, `0x2::clock::Clock`, Shared, initial shared `1`, 현재 version `1031996473`, timestamp_ms `1790526328064` |
| issuer SUI | total 및 coin balance `743838116 MIST` = `0.743838116 SUI`; address balance 필드는 응답에 없어 unknown |
| agent SUI | total `0 MIST`; coin/address 구성 필드는 응답에 없어 unknown |

ServiceInfo와 Clock은 로컬 시각 기준 ±120초 신선도 검사를 통과했다. 읽기들은 하나의 atomic snapshot이 아니며, 이후 역할·정책·잔액 변경을 보장하지 않는다. 실제 실행 직전에 다시 확인해야 한다.

## 잔액 해석과 남은 서명 조건

**추론은 관측과 분리한다.** issuer coin balance가 예시 3거래×`10,000,000 MIST` = `30,000,000 MIST` 상한보다 크다는 산술 비교만 통과했다. 실제 비용 견적, 선택 가능한 gas object, signer 보유·권한 또는 sponsor 동작을 검증한 것이 아니다. 출력의 `gasReady`와 `sponsorSelectionVerified`는 계속 `false`다.

기존 [config](../k-tour-id-app/lib/hackathon/config.ts)는 별도 `HK_SUI_SPONSOR_SECRET_KEY`가 없으면 issuer 키로 fallback한다. 별도 sponsor 설정이 있다는 뜻은 아니며, issuer 키 자체가 없으면 fallback도 signer를 만들지 못한다. [보호된 Sui-only 실행 경로](SUI_ONLY_EXECUTION_2026-09-27.md)는 sponsor 주소를 issuer와 동일하게 제한한다. agent는 실행 서명이 필요하지만 gas는 sponsor가 부담하므로 **agent 잔액 0만으로 sponsored 실행 불가라고 판단하지 않는다.**

기존 설정 인계에서 확인된 현재 대상의 issuer·agent 실행 키 미확보 상태는 남아 있다. 이번 도구는 그 존재 여부조차 읽지 않았으며, 다른 계정·기기·배포에 키가 없는지 탐색하지 않았다. 기존 키 보유자(Harvey/운영자)의 승인된 서명 수단 인계가 필요하다. 새 키·계약으로 역할을 바꾸거나 키를 채팅에 요청하지 않는다.

## 재실행과 안전 경계

앱 디렉터리 `k-tour-id-app`에서 아래 명령만 사용한다. LIVE 명령은 `--read-only` 단독 인자를 요구하며 URL·파일·키·실행 옵션을 받지 않는다.

```sh
node --import tsx scripts/hackathon-sui-live-readiness.ts --read-only
node --import tsx --test tests/hackathon/sui-live-readiness.test.ts

# 네트워크 없는 별도 합성 리허설
node --import tsx scripts/hackathon-sui-readiness.ts --offline --signer=demo
node --import tsx scripts/hackathon-sui-readiness.ts --offline --signer=zklogin
```

[LIVE CLI](../k-tour-id-app/scripts/hackathon-sui-live-readiness.ts)는 요청 전에 host·읽기 메서드·protobuf body의 object/owner/type/field mask를 검증한다. 중복 요청·retry·pagination·redirect·인증 header를 허용하지 않는다. 최대 6회, 전체 20초/요청별 10초, 요청 body 4 KiB/응답 body 128 KiB 상한이며 metadata·체인·역할·정책·Clock 불일치에 fail-closed한다. 오류·출력은 공개 allowlist만 사용한다.

이번 실제 실행의 **secret read·키 생성·서명·broadcast·faucet·계정 변경은 각각 0회**다. 환경변수·`.env`·wallet/keychain을 읽지 않았고 SDK transaction builder, dry-run, 앱 API/session/store, CX, OpenDID, OAuth/prover, OmniOne을 호출하지 않았다. 과거 receipt 재조회나 package bytecode 대조도 하지 않았다. 공개 배포/CX-only isolation 설정은 바꾸지 않았다.

[새 fixture 테스트](../k-tour-id-app/tests/hackathon/sui-live-readiness.test.ts) **17/17**, 기존 offline·Sui-only runner와 합쳐 **40/40**, app TypeScript 검사 PASS. 테스트는 실제 SDK binary gRPC 직렬화를 가짜 transport로 검증하며 네트워크 tripwire 호출은 0회다. [기존 offline script](../k-tour-id-app/scripts/hackathon-sui-readiness.ts)는 변경하지 않았다. offline 성공은 LIVE 조회 또는 실제 zkLogin 성공을 의미하지 않는다.

## 누가 무엇을 이어서 하나

| 담당 | 다음 조건·작업 |
| --- | --- |
| 우리 쪽, 추가 사용자 입력 불필요 | 고정 공개 설정·fixture·회귀·오류 비노출 검수를 유지. 승인된 실행 직전에 같은 bounded read로 상태를 재확인. package/주소를 사용자에게 다시 묻지 않음 |
| 기존 키 보유자/운영자 | 기존 issuer·agent와 승인된 테스트 사용자 signer, issuer sponsor 선택 및 좁은 실행 범위·예산을 안전한 secret manager/wrapper로 인계. 키 원문을 채팅/CLI argument/문서에 넣지 않음 |
| 우리 쪽, 승인된 서명 수단 확보 후 | 보호된 별도 Sui-only 경로에서 signer 주소·gas·만료·단일 operation을 검증하고 journal-before-broadcast 및 effects/events/object 증거를 확인. 불확정 결과는 저장 digest로 reconciliation하며 임의 재전송하지 않음 |
| 인증·서명 당사자 및 병렬 구현팀 | 실제 Google 로그인/zkLogin 승인, CX 본인 승인, OpenDID issuer/holder/verifier 증거는 별도 게이트. [OpenDID 병렬 워크플로](OPENDID_WORKFLOW_BOUNDARY_2026-09-28.md)는 진행 중이며 취소·우회하지 않음 |

독립 fixture Sui 실행과 실제 CX→OpenDID→Sui→OmniOne 통합 완료는 서로 다른 결과다. 이번 공개 조회를 근거로 credential/VP gate를 풀거나 기존 Preview에 키를 주입하지 않는다. OmniOne의 새 기록도 별도 recorder 서명·receipt 검증이 필요하다.
