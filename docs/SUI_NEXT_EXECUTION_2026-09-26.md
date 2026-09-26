# Sui 독립 실행 준비 — 2026-09-26

## 이번에 끝낸 것과 남은 것

1. **키 없는 오프라인 리허설 구현 완료.** 기존 adapter의 3단계 명령 구조를 합성 객체로 직렬화하고 실제 digest·evidence 검증 함수를 재사용한다. 서명·전송·RPC simulation은 하지 않는다.
2. **demo test-signer와 Google zkLogin의 다음 조건을 분리했다.** Sui 자체 검증은 명시적인 mock identity/credential로 먼저 가능하다. CX holder 승인이나 OpenDID 발급을 기다려야 하는 것은 전체 연계 검증이지 이 독립 검증이 아니다.
3. **공식 고정 버전 CLI/framework 후보의 격리 build와 Move test 7/7 PASS.** 임시 사본에서 빌드한 module 3,066바이트가 저장된 bytecode와 정확히 일치한다. 원본 lock이 복구됐다는 의미는 아니며 원본 Move 파일은 변경하지 않았다. 첫 CLI의 임시 키 자동 생성 부작용과 폐기는 아래에 별도 기록한다.

프로덕션/CX-only Preview 설정, API/service/adapter, chain 상태는 이 작업에서 변경하지 않았다. 기존 `.env`·사용자 키·인증 파일·비공개 환경변수도 읽지 않았다. 신규 서명·트랜잭션·faucet·ledger 기록은 0회다. 오프라인 앱 스크립트의 `generatedKeys=0`와 아래 CLI 초기화 부작용은 서로 다른 범위다.

## 로컬 실행과 증거 범위

앱 디렉터리 `k-tour-id-app`에서:

```sh
node --import tsx scripts/hackathon-sui-readiness.ts --offline --signer=demo
node --import tsx scripts/hackathon-sui-readiness.ts --offline --signer=zklogin
node --import tsx --test tests/hackathon/sui-readiness.test.ts
```

두 CLI 모드와 focused test **6/6 PASS**. 결과는 `ok=true`, `mode=offline-synthetic-rehearsal`, **`liveExecutionReady=false`**, `walletProofVerified=false`다. `ok`는 로컬 리허설 성공만 뜻한다. `--signer=zklogin`은 요구 조건 목록만 달라지며 Google 로그인이나 proof를 만들지 않는다.

| 확인 | 실제 범위 |
| --- | --- |
| 공개 입력 | 고정된 [배포 metadata](../move/ondo_entitlement/deploy-info.testnet.json)에서 Testnet ID·공개 역할·정책 필드만 선별. 임의 URL/파일/실행 옵션은 거절 |
| unsigned BCS | `issue`, `delegate → attest_consent`, `consume → attest_execution`의 명령 순서와 직렬화. fully-resolved 상태 확인 후 RPC client 없이 build |
| 안전 장치 | 가짜 gas/object 참조와 expiration epoch `0`; 절대 서명·제출할 수 있는 실행 자료로 사용하지 않음. CLI는 bytes를 내보내지 않고 합성 digest·길이만 출력 |
| evidence | 기존 `verifyDelegationEvidence`·`verifyExecutionEvidence`에 합성 성공 fixture 2개, sender/digest/consent/manifest/중복 사용/creation effect 변조 거절 6개 |
| 네트워크 | 테스트와 CLI의 `fetch` tripwire에서 호출 0회. signer 생성, 키 로딩, API/session/store 호출 없음 |

이 스크립트는 **실제 RPC dry-run, Move 컴파일, gas 견적, 발급 결과 검증, 온체인 evidence, sponsor 서명, zkLogin 검증이 아니다.** 합성 digest를 explorer상의 거래로 제시하면 안 된다. fake 객체를 사용하는 오프라인 결과, 아래의 실제 공개 조회, 별도로 실행한 Move build/test는 서로 다른 증거다.

기존 adapter의 `buildDelegationPtb`는 이름과 달리 sponsor 서명까지 수행하므로 호출하지 않았다. `issueEntitlement`/`agentConsume`도 실제 전송 함수다. 이 스크립트는 [adapter의 순수 digest 함수](../k-tour-id-app/lib/hackathon/adapters/sui.ts)와 [순수 evidence 검증](../k-tour-id-app/lib/hackathon/sui-evidence.ts)만 재사용한다. 명령 구성은 adapter와 별도로 유지하므로 향후 adapter 변경 시 양쪽 순서·인자도 함께 검토해야 한다.

## 이미 확보한 공개 인프라 증거

현재 package·활성 Campaign·역할은 [읽기 전용 보고서](CHAIN_READONLY_2026-09-26.md)의 2026-09-26 00:35–00:40 KST 관측을 따른다. 이번 오프라인 작업에서 과거 거래나 package를 반복 조회하지 않았다.

별도 추가 공개 조회 시각 **2026-09-26 02:18:48 KST / 2026-09-25T17:18:48.140Z**: Testnet `https://fullnode.testnet.sui.io:443`의 `StateService/GetBalance`를 issuer·agent에 각 1회, `0x2::sui::SUI`에 한정해 읽었다.

| 공개 역할 | 주소 | 당시 잔액 |
| --- | --- | --- |
| issuer | `0x8d88f750b8bb8f0e63e6617821e3d2a03fda22b9a7841215689da66c79664c45` | `743838116 MIST` = `0.743838116 SUI` |
| agent | `0xad9340861c08c87c388108f13bde6fd6e27d2604c39d0f6d201e00d6ee161a05` | `0 SUI` |

agent의 0 잔액은 sponsor가 gas를 지불하는 현재 구조에서 단독 blocker가 아니다. issuer 양의 잔액도 키 보유, 현재 spendable gas 선택, sponsor 예산 충분성의 증거는 아니다. 실행 전 실제 선택된 sponsor에 대해 재확인한다. 이 읽기는 signing/broadcast/faucet 없이 완료했다.

## 실제 실행의 최소 다음 gate

기존 CX-only Preview의 isolation을 끄거나 generic smoke를 실행하지 않는다. 기존 `hackathon-smoke.mjs`는 Sui 이외 redeem/OmniOne까지 이어져 이번 독립 범위에 맞지 않는다. 필요한 것은 기존 adapter를 재사용하는 **별도 승인·보호된 Sui-only 테스트 경로**다. 아직 이 문서/오프라인 스크립트가 그러한 실행 경로를 제공하지는 않는다.

| 순서 | 완료 조건 |
| --- | --- |
| 1. 역할·설정 | 아래 공개 metadata와 승인된 기존 서버 signer를 안전하게 주입. issuer/agent 주소가 현재 Campaign 역할과 일치하고 sponsor gas/예산·network가 맞는지 실행 직전 검증. 키를 로그·문서·브라우저에 노출하지 않음 |
| 2. 좁은 demo 시나리오 | identity와 credential은 명시적 mock, user signer는 테스트 Ed25519로 표시. 동의·intent·만료·단일 synthetic 세션 범위를 고정. 신규 발급→위임→agent 실행 최소 3거래, 예산과 stop 조건을 정하고 기존 dispatch journal/reconciliation을 유지 |
| 3. 결과·복구 증거 | 최초 제출 전 journal digest 기록, effects/events/object/commitment 검증. timeout은 무조건 재전송하지 않고 기록된 digest로 reconciliation. replay·실패를 성공으로 표시하지 않음 |
| 4. 진짜 zkLogin | demo 결과와 별도. 승인된 Google 로그인, 정확한 callback 등록, nonce/state/epoch, Testnet 호환 prover, 실제 wallet proof와 사용자 서명 검증. 이를 하지 않은 demo를 zkLogin 완료로 표시하지 않음 |

공개 설정은 저장소로 준비 가능하며 사용자에게 다시 package ID를 물을 필요가 없다. 실제 signer 및 OAuth/prover 권한은 기존 Harvey 설정의 승인된 인계가 필요하다. 사용자에게 키를 채팅에 붙여 넣도록 요청하지 않는다.

| 용도 | 정확한 환경변수 이름 / 조건 |
| --- | --- |
| 공개 Sui 설정 | `HK_SUI_NETWORK=testnet`, `HK_SUI_GRPC_URL`, `HK_SUI_PACKAGE_ID`, `HK_SUI_CAMPAIGN_ID`, `HK_SUI_CAMPAIGN_INITIAL_VERSION` — 위 metadata/RPC 기준 |
| 서버 역할 | `HK_SUI_ISSUER_SECRET_KEY`, `HK_SUI_AGENT_SECRET_KEY`; `HK_SUI_SPONSOR_SECRET_KEY`는 현재 config에서 issuer key fallback이 있으므로 sponsor 선택을 명시적으로 확인 |
| Google zkLogin 추가 | `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `HK_ZKLOGIN_SALT_SEED`, 승인된 `ENOKI_API_KEY` 또는 Testnet 호환성이 확인된 `HK_ZKLOGIN_PROVER_URL` |
| callback | 별도 테스트 배포의 정확한 `https://<approved-origin>/hackathon/zklogin/callback`을 Google에 등록. env 값 존재만으로 로그인/proof 성공을 선언하지 않음 |

이 목록은 Sui adapter를 위한 조건이지 모든 profile/보안 설정을 대신하는 deployment recipe가 아니다. 실제 보호 경로는 branch/project/origin/session/expiry/저장소와 비용 한도를 별도 검토한 뒤 연결한다. current CX-only profile은 계속 체인을 차단한다.

## Move CLI: 고정 후보 build 일치 및 7개 테스트 통과

공식 [MystenLabs `testnet-v1.79.0` release](https://github.com/MystenLabs/sui/releases/tag/testnet-v1.79.0)의 macOS arm64 asset만 임시 폴더에 내려받았다. [GitHub release metadata](https://api.github.com/repos/MystenLabs/sui/releases/tags/testnet-v1.79.0)에 명시된 SHA-256과 다운로드 파일이 일치한 뒤 `sui` 바이너리만 압축 해제·실행했다. 설치 script 실행, global 설치, `PATH`/`HOME` 변경은 하지 않았다.

- Asset: `sui-testnet-v1.79.0-macos-arm64.tgz`, `381889716` bytes.
- SHA-256: `79900034cb533832a3bf9f10d783c309bfa8259697d6417e6dccdb0758f0f613`.
- 실제 `--version`: `sui 1.79.0-46f18562f1f5`.
- 실제 `move build --help`: `--dump-bytecode-as-base64 --no-tree-shaking`은 dependency tree-shaking의 RPC 호출을 피하는 경로라고 명시한다. 이것이 git dependency 다운로드까지 없애준다는 뜻은 아니다.
- 로컬 검증 파일: `/tmp/ktour-sui-toolchain.aPL3Mr/` — 임시 산출물이며 저장소에 포함하지 않는다.

[원본 Move.toml](../move/ondo_entitlement/Move.toml)은 `rev="framework/testnet"`라는 이동 가능한 참조이며 **`Move.lock`이 없다**. 처음에는 정확한 dependency snapshot이 없어 build를 보류했다. 이후 범위를 제한한 추가 실험으로 공식 release tag가 가리킨 commit **`46f18562f1f5af2438d35828e8b62d5e0b972db7`**의 framework를 후보로 사용했다. 원본을 바꾸지 않고 임시 패키지 사본의 Sui dependency만 다운로드한 release source의 local 경로로 연결했다. Sui framework의 MoveStdlib dependency도 같은 source 내 local 경로다. Rust compiler를 새로 빌드하거나 전역 설치하지 않았다.

실제 build/test 모두 `MOVE_HOME`·`SUI_CONFIG_DIR`를 위 임시 디렉터리로 지정하고 macOS `sandbox-exec`의 `(deny network*)`로 실행해 네트워크를 차단했다. build에는 `--dump-bytecode-as-base64 --no-tree-shaking`을 적용했다. 앱/체인 RPC 및 gas 비용은 발생하지 않았다. 공식 GitHub release/source 다운로드만 이 도구 준비의 외부 요청이다.

| 관측 | 결과 |
| --- | --- |
| 임시 사본 build | exit 0 |
| 저장된 module과 비교 | [bytecode-testnet-v1.79.0.json](../move/ondo_entitlement/bytecode-testnet-v1.79.0.json)의 유일한 module과 `entitlement.mv` **3,066바이트 전체 일치** |
| module SHA-256 | `f266e663f8045ecef8806fe0fc1ddf77ae74acf97c32d90dec2dbb38d6b94ffc` |
| Move test | `sui move test --path <temporary-copy> --threads 1`: **7 passed, 0 failed** |
| 통과 케이스 | happy path, public mint 거절, non-holder delegation 거절, expired/revoked grant 거절, second consume 거절, wrong agent 거절 |
| 원본 보존 | `git diff -- move/ondo_entitlement` 결과 없음 |

이는 **고정 release 후보로 저장된 module 출력을 재현했고 그 후보에서 Move 테스트가 통과했다는 증거**다. 원래 배포자가 사용한 dependency commit을 복구한 것은 아니며, 현재 온체인 bytecode를 다시 읽어 대조한 것도 아니다. repository에 lock을 새로 추가하거나 기존 framework 참조를 수정하지 않았다. 향후 영구적인 재현 recipe를 도입할 때 이 검증된 후보/CLI checksum을 함께 고정해야 한다.

### CLI 초기화 부작용 및 폐기

첫 build는 빈 임시 `SUI_CONFIG_DIR`에서 Sui CLI가 noninteractive client 설정을 자동 생성하면서 **미사용 임시 keypair 1개와 recovery 문구를 stdout에 생성했다**. 기존 사용자 프로필·키에는 접근하지 않았고, 이 실행도 network sandbox 안이어서 서명·전송·faucet·gas 사용은 없었다. 생성된 키/문구를 실행용 credential로 사용하지 않으며 문서·코드에 재기록하지 않았다.

정확히 이번에 생성된 `/tmp/ktour-sui-toolchain.aPL3Mr/sui-config/`의 client/key/alias 5개 파일만 즉시 삭제했다. 이어 명시적인 `empty.keystore=[]`, `active_address=null`, 공개 Testnet env만 가진 client config를 만든 뒤 Move test를 실행했다. **초기화/키 생성 재발 없이 7/7 PASS**, 실행 후 빈 keystore 유지와 원래 자동 생성 key 파일 부재를 확인했다. 삭제된 임시 key 파일은 복구용으로 보관하지 않았다. 이미 출력된 문구의 기록을 지웠다고 주장하지 않으며, 해당 키는 절대 재사용하지 않는다.

향후 이 CLI를 재현할 때는 **첫 실행 전에 빈 keystore/client config를 명시적으로 준비**하고 네트워크 sandbox를 유지해야 한다. 오프라인 앱 readiness 스크립트는 이 CLI 초기화 경로를 호출하지 않으며 그 스크립트의 key 생성·secret read는 0회다.

## 변경 파일

- [오프라인 readiness 스크립트](../k-tour-id-app/scripts/hackathon-sui-readiness.ts)
- [focused 테스트](../k-tour-id-app/tests/hackathon/sui-readiness.test.ts)
- 이 문서. 기존 production config/service/Move manifest는 수정하지 않음.
