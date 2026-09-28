# 체인 공개 인프라 읽기 전용 확인 — 2026-09-26

## 결론

- **Sui Testnet: 현재 설정된 package와 Campaign이 실제로 존재하며 Campaign은 활성 상태다.** 공개 RPC만으로 이 범위의 확인을 완료했다. 사용자 추가 입력이나 키가 필요하지 않았다.
- **OmniOne stage: 공개 설정과 저장소에서 registry를 식별했지만, 무인증 RPC는 HTTP 401이었다.** HTTPS 응답은 확인했으나 현재 chain ID·배포 코드·receipt·권한은 미검증이다. 인증 우회나 추가 probe는 하지 않았다.
- 이번 결과는 **인프라 읽기 확인이지 신규 발급·위임·실행·CX 연계 E2E 성공이 아니다.** 신규 트랜잭션, 서명, faucet, gas 사용, 원격 상태 변경은 모두 0회다.

확인 시각: **2026-09-26 00:35–00:40 KST** / **2026-09-25 15:35–15:40 UTC**.

## 범위와 안전 경계

대상은 기존 Harvey 공개 배포 `https://ktourid.vercel.app`와 공개 체인 조회다. 별도 CX-only Preview의 상태를 이 배포의 설정으로 판단하지 않는다. 키·`.env`·인증 파일·비공개 환경변수를 열지 않았고 앱의 세션/발급/체인 실행 API를 호출하지 않았다. 원본 Harvey 배포·저장소·환경변수도 변경하지 않았다.

대상 배포·체인에 보낸 요청은 공개 config GET 1회, Sui 읽기 RPC 3회, OmniOne 무인증 `eth_chainId` 1회뿐이다. RPC의 HTTP POST는 아래 명시한 읽기 메서드에 한정했다. Sui SDK 요청은 실행 중 origin/읽기 경로 allowlist, redirect 거절, 요청별 15초 timeout으로 제한했다. 과거 거래 3건은 재조회하지 않았다.

## 현재 공개 설정

[Harvey 공개 config](https://ktourid.vercel.app/api/hackathon/v1/config)는 `2026-09-25T15:35:07.797Z`에 HTTP 200이었다. 응답은 메모리에서 처리하고 공개 mode와 ID만 선별했다. 전체 config를 기록하지 않았다.

| 항목 | 관측값 |
| --- | --- |
| modes | `cx=mock`, `opendid=mock`, `ai=rule`, `sui=testnet`, `omnione=stage`, `zklogin=google` |
| Sui package | `0xc5d26326ffd5267bb5b54625c1e2b9c03f7cca4753232d0b042c62ee74fd975d` |
| Sui Campaign | `0xe3fce96c9c9e1086ff20dd7453e16ff2c52d3d3324e6e4e34446c7d0dc2ecf16` |
| OmniOne configured chain ID | `201210` — config 값이며 이번 RPC로 확인된 값은 아님 |
| OmniOne registry | `0x696bc4e29c8f8079b6d3cd49d310a09577550e4c` |

Mode 이름은 해당 연동이 정상 작동한다는 증거가 아니다. OmniOne RPC URL은 공개 config에서 제공되지 않아 아래 저장소의 공개 배포 기록을 사용했다.

## Sui — 현재 객체 확인 완료

RPC: `https://fullnode.testnet.sui.io:443`. 설치된 `@mysten/sui/grpc`의 `SuiGrpcClient`로 `GetServiceInfo` 1회와 `BatchGetObjects` 2회를 호출했다. 첫 batch는 package·Campaign·표준 Clock 객체, 두 번째는 Campaign의 공개 정책 필드만 확인했다. SDK의 `getObject`도 실제 전송은 `BatchGetObjects`였다. 공식 인터페이스 근거: [Mysten gRPC client](https://sdk.mystenlabs.com/sui/clients/grpc), [객체 조회](https://sdk.mystenlabs.com/sui/clients/querying).

| 관측 대상 | 실제 응답 |
| --- | --- |
| ServiceInfo, `15:36:43.746Z` | `chain=testnet`, epoch `1233`, checkpoint `387668363` |
| ServiceInfo chain ID | `69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD` — 배포 기록과 일치하는 genesis checkpoint digest |
| Package | `type=package`, version `1`, owner `Immutable` |
| Campaign | 위 package의 `entitlement::Campaign`, owner `Shared`, initial shared version `349181955`, 현재 version `1026899622` |
| Campaign 정책, `15:40:25.402Z` | `active=true`, `policy_version=1`, `campaign_ref=hk-identity-perk-v1` — RPC의 base64 bytes를 해석한 문자열 |
| Campaign 역할 | 공개 `issuer`·`agent` 주소가 저장소 배포 기록과 각각 일치 |
| Campaign 누적 카운터 | `issued=26`, `delegated=24`, `consumed=23` |
| Clock `0x6` | `0x2::clock::Clock`, owner `Shared`, initial shared version `1` |

비교 기준: [Sui 배포 metadata](../move/ondo_entitlement/deploy-info.testnet.json), [Campaign 정의](../move/ondo_entitlement/sources/entitlement.move).

카운터는 공개 객체의 현재 누적 상태일 뿐, 어떤 이용자·실행·증빙의 결과인지 이번 조회에서 검증하지 않았다. signer 보유 여부, gas 잔고, 서명/스폰서 동작, 신규 transaction receipt, zkLogin, CX→Sui 연계도 확인하지 않았다.

[9월 21일 검증 기록](SUI_INTEGRATION_VERIFICATION_2026-09-21.md)의 과거 성공 및 9월 23일 동일 digest `not found`는 해당 시점의 별도 관측이다. 이번에는 과거 3개 digest를 다시 요청하지 않았다. **과거 거래 조회 실패로 현재 package 부재나 Testnet reset을 단정할 수 없으며, 현재 package·Campaign 존재는 이번에 직접 확인했다.** 과거 조회 실패 원인은 이번 범위에서 확정하지 않았다. 기존 [historical audit script](../k-tour-id-app/scripts/hackathon-readonly-chain-audit.ts)는 과거 거래 중심이라 이번 확인에 실행하지 않았다.

## OmniOne — 인증 없는 조회 경계 확인

[stage 배포 metadata](../chain/omnione/deploy-info.stage.json)는 `https://stage-chainapi.omnione.net/` 및 토큰 placeholder를 기록한다. 실제 토큰을 조회하거나 사용하지 않았다.

`2026-09-25T15:36:06.264Z`에 해당 URL로 자격증명 없는 JSON-RPC `eth_chainId`, `params=[]`를 1회 요청했고 **HTTP 401**을 받았다. redirect는 거절했고 15초 timeout을 적용했다. 인증 오류 이후 `eth_getCode`, `eth_call`, receipt 등 추가 요청은 하지 않았다.

따라서 현재 확인한 사실은 HTTPS endpoint의 응답과 무인증 거절뿐이다. chain ID `201210`, registry 배포 코드, recorder 권한, 과거 receipt의 유효성은 모두 추가 조회가 필요하다. 401은 지역/IP 제한이나 국내 배포 필수의 증거가 아니다.

현재 앱용 대상은 `DemoEntitlementRegistry`다. 같은 metadata의 `KTourAnchor`는 과거 별도 계약이며 앱용 registry와 혼동하면 안 된다. 확인할 read ABI는 [DemoEntitlementRegistry.sol](../chain/omnione/DemoEntitlementRegistry.sol)의 `owner()`, `recorders(address)`, `total()`, `getRedemption(bytes32)`다.

## 정확한 다음 gate

| 다음 단계 | 필요한 조건 / 허용 확인 | 이번 상태 |
| --- | --- | --- |
| Sui 추가 인프라 조회 | 현재 공개 endpoint와 위 객체 ID로 필요한 필드만 읽기. 키·사용자 추가 입력 불필요 | 현재 package/활성 Campaign 확인 완료. 같은 과거 거래 3건 반복 불필요 |
| Sui 신규 실제 거래 | 별도 승인된 좁은 테스트 경로에서 issuer/agent 및 필요한 sponsor signer의 안전한 서버 설정, 현재 역할 일치, gas, intent/만료/동의/중복 전송 방지 확인 후 명시한 1회 시나리오 실행 | **미수행**. 현재 CX-only 차단을 이 보고서 근거로 해제하지 않음. 독립 Sui 검증은 명시적 테스트 identity로 구분 가능하나 실제 CX 연계 검증과 혼동 금지 |
| OmniOne 인프라 조회 | 승인된 read-only RPC 접근 권한 또는 문서화된 공개 endpoint. signer/private key는 읽기에 불필요. `eth_chainId=201210` → registry `eth_getCode != 0x` → 공개 배포 receipt/정확한 read ABI의 역할·기존 기록 순으로 제한 조회 | **접근 조건 미충족**. 키 탐색·401 반복·인증 우회 금지. 적법한 접근이 이미 제공된 경우에만 다음 조회 가능 |
| OmniOne 신규 기록 | 위 읽기 확인 이후 별도 권한·recorder signer·중복 방지·receipt/event 검증을 갖춘 명시적 승인 단계 | **미수행**. Sui 성공과 OmniOne 성공은 각각 별도 증거 필요 |

결론적으로 사용자의 추가 입력 없이 가능한 **Sui 현재 인프라 확인은 완료**했다. OmniOne은 인증된 읽기 접근이라는 구체적 의존성이 남았다. 공개 mode, 과거 문서, 단위 테스트만으로 두 체인의 신규 실제 E2E 성공을 선언하지 않는다.
