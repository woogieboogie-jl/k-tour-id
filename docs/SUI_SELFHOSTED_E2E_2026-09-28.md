# 독립 Sui Testnet 환경 · 실제 BFF/브라우저 E2E — 2026-09-28

## 결과와 검증 범위

**새로 만든 독립 Testnet package/Campaign에서 실제 앱 브라우저 → BFF → Sui 발급 → 사용자 위임 → Agent 실행이 성공했다.**
기존 Harvey 거래를 다시 보여 준 것이 아니라, 아래의 새 거래 3개를 생성하고 같은 앱 operation으로 확인한 결과다.

- 실행: 2026-09-28 **22:25:40–22:25:50 KST** (`13:25:40.978Z–13:25:50.715Z`).
- 브라우저: Chromium, 모바일 터치 환경, `390 × 844`, 영어/밝은 테마.
- 앱: `http://127.0.0.1:3160`, 실제 Next.js BFF와 독립 파일 ledger. 응답 fixture로 거래 성공을 대체하지 않았다.
- operation: `op_oURTVLlWjAziObXj`; 최종 `phase=fulfillment`, `agent.status=executed`, 서비스 사용은 `pending`.
- 공개 실행 보고서: `status=passed`; Campaign `issued=1`, `delegated=1`, `consumed=1`.
- 검증 후 실제 서명키를 사용하는 `3160` 서버는 정상 종료했다. 해당 URL은 현재 공개 검수 링크가 아니다.

**실제 외부 제공자 전체 통합 E2E는 아니다.** CX 신원과 OpenDID credential은 명시적 sample/mock,
AI는 `rule`, 사용자의 Sui 서명은 브라우저에서 생성한 **Ed25519 demo signer**다.
Google OAuth/zkLogin, 실제 CX/OpenDID 제공자, LLM, 서비스 `redeem`, OmniOne 기록은 실행하지 않았다.
OpenDID의 별도 실제 제공자 구현 경로는 유지하며, 이 테스트 결과로 그 구현 완료를 주장하지 않는다.

## 최종 회귀·UX 검수

- 단위 테스트 **337/337**, 서버/provider 검증 **53/53**, Move **7/7** 통과.
- 최종 코드의 optimized production build 및 TypeScript 검사 통과.
- 모바일 브라우저 fixture **35/35**: skip/flake/failure 0.
- 외부 서비스가 차단된 실제 로컬 BFF 검증 **4/4** 통과.
- 위 fixture/BFF 테스트는 별도 샘플 검증이며, 실제 Testnet 성공 근거는 아래 새 3거래와 독립 receipt 검사다.
- 기존 화면 구성은 유지했다. 외부 기록 실패를 계속 “기록 중”으로 표시하던 문제만 수정했다.
  KO/EN/JA로 기록 확인 실패와 `다시 확인`을 안내하되, 이미 확정된 **혜택 사용 결과는 성공으로 유지**한다.
  기록 실패 때문에 사용 자체를 재실행하도록 유도하지 않는다.
- `390 × 844` 모바일 캡처에서 성공 제목·별도 오류 안내·복귀 버튼의 겹침이나 가로 넘침이 없음을 직접 확인했다.
- 테스트용 wrapper/fixture의 URL 및 응답 주입 문제도 수정하고 전체 suite를 다시 통과시켰다.
  실제 chain E2E에는 응답 fixture를 사용하지 않았다.

공개 앱, CX-only Preview, Sumsub Preview, Vercel branch 환경은 이 작업으로 변경하지 않았다.
로컬 구현과 검증 완료를 운영 배포 완료로 읽으면 안 된다.

## 격리된 배포 대상

| 항목 | 값 |
| --- | --- |
| Network | Sui Testnet |
| Chain identifier | `69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD` |
| 새 package | `0x7a28a5e59d87e385f2eb3047ca2bbe76301627343f8d88eeb0f03733d4f2389e` |
| 새 Campaign | `0xa273ccd96315ae187b16eb3192c822795bc2031e6f79405739daec4a52275afd` |
| Campaign initial shared version | `349181963` |
| 새 issuer / sponsor | `0x900cd55f3d9de4541e306c6a3b1fe85cd4ddbf04319ee316ae21b6bb3ba95d76` |
| 새 agent | `0x17ee59f56d182c010732daaf509a2b35b221bf7ec62e4a59c3b2ceca2c3bbce4` |
| 새 AdminCap | `0xfef110f26863217ed373df9964754fe0b8e16d1feacb67123e91c81363630202` |

기존 `create_campaign`은 기존 AdminCap 권한을 요구한다. 기존 소유자의 키를 가져오거나
권한 검사를 바꾸지 않고, 동일 Move 소스를 새 package로 publish하여 자체 AdminCap과 Campaign을 만들었다.
기존 Harvey package/Campaign, 배포 metadata, 사용자 지갑, 운영 배포·환경 설정은 변경하지 않았다.

첫 자동 공식 Testnet faucet 요청은 HTTP `429`였으며 자동 재시도하지 않았다.
이후 사용자가 공식 faucet에서 새 issuer 주소를 수동 충전했고, 실행 담당자가
**1,000,000,000 MIST = 1 Testnet SUI** 잔액을 읽어 확인한 뒤 publish를 진행했다.
manifest의 `faucetHttpStatus=429`는 첫 자동 요청의 결과이며, 이후 수동 충전 실패를 뜻하지 않는다.
이는 실제 자산 구매나 Mainnet 송금이 아니다.

설정 거래도 별도 성공했다:

- [새 package publish](https://suiscan.xyz/testnet/tx/7nLh9ZjtfmhV4HfLurk7iXjX2xznWHvHUCScefQmuUE2)
- [새 Campaign 생성](https://suiscan.xyz/testnet/tx/74ckikLkHb58wokEy1keaBpahLpwyuHFvVhHB5wGcFKX)

## 새 여정 거래 3개

| 단계 | 실제 트랜잭션 | 확인한 이벤트 |
| --- | --- | --- |
| Sui 권한 발급 | [Ebkkj9PvNfmWG3yi3wJP7kEezzZbbwAUMizqNXeguYWn](https://suiscan.xyz/testnet/tx/Ebkkj9PvNfmWG3yi3wJP7kEezzZbbwAUMizqNXeguYWn) | `EntitlementIssued` |
| 사용자 위임·동의 attestation | [Ha24iPjTYdmkJdJ5KAFMMvUonAJuuBP61orQpQbisUMc](https://suiscan.xyz/testnet/tx/Ha24iPjTYdmkJdJ5KAFMMvUonAJuuBP61orQpQbisUMc) | `GrantCreated`, `ConsentAttested` |
| Agent 소비·실행 attestation | [3PfGw4ffKwb13VG5EGwNDSZqMY5vg6RPRx6T7oajttKq](https://suiscan.xyz/testnet/tx/3PfGw4ffKwb13VG5EGwNDSZqMY5vg6RPRx6T7oajttKq) | `GrantConsumed`, `ExecutionAttested` |

브라우저 harness는 BFF가 반환한 각 digest를 공식 Testnet fullnode에서 다시 읽어
digest 일치와 `status.success=true`, 새 package의 이벤트를 확인했다.
링크만 생성해 놓고 성공으로 판정한 것이 아니다.

실제 사용자 동작 및 검증 순서:

1. 장소 상세 → 혜택 여정 열기. 동의 전 시작 버튼이 비활성화됨을 확인하고 동의했다.
2. sample identity → credential 발급·holder 서명 ack → presentation challenge와 서명 제출 → rule 제안을 수행했다.
3. 새 demo signer 선택 후, 범위 승인 checkbox 전 위임 버튼이 비활성화됨을 확인했다.
4. 승인 후 `delegation/prepare`가 **Sui 발급 거래**를 만들고, 브라우저가 PTB에 사용자 서명하여
   `delegation/submit`이 위임·동의 거래를 실행했다. UI의 `credential/issue`는 이 Sui 발급과 다른 단계다.
5. 별도 Agent 실행 클릭으로 소비·실행 거래를 만들고 `fulfillment` 화면까지 진행했다.
6. BFF evidence의 manifest commitment 재계산 일치, Grant의 `uses=1` 및 owner/agent/Campaign,
   ExecutionRecord의 사용자 소유권과 grant/agent/Campaign 연결을 확인했다.
7. 같은 operation에 Agent 실행을 다시 요청하여 **HTTP 409** 거절을 확인했다.
   이후에도 Grant `uses=1`, Campaign 세 counter 모두 `1`이었다.
8. Escape로 여정을 닫고 원래 장소 `mois-0021cd596bc5b2a922ad` 상세로 돌아왔다.

`credential/issue`, `delegation/prepare`, `delegation/submit`, `agent/run`의 성공 POST는 각각 한 번이었다.
개발 모드의 중복 session/config bootstrap 읽기는 별개이며, 두 번째 발급·위임·소비 거래가 아니다.
중복 Agent 요청은 Playwright request client로 직접 검사했으므로 브라우저 page-response 목록에는 없지만,
HTTP 409 assertion을 통과해야 보고서의 `duplicateRejected=true`와 최종 `passed`가 기록된다.
보고서의 `externalMutations=[]`는 차단 대상 브라우저 요청이 없었다는 뜻이며,
BFF가 수행한 위의 승인된 Sui 거래 3개가 없었다는 뜻이 아니다.

### 별도 작성자의 독립 receipt 검증

재현용 [읽기 전용 검증기](../k-tour-id-app/scripts/hackathon-selfhosted-verify.ts)와
[공개 검증 JSON](./SUI_SELFHOSTED_RECEIPTS_2026-09-28.json)을 저장했다.
root도 `13:36:58.897Z`에 같은 검증기를 실행해 PASS를 재확인했다: 읽기 5회, 23,268 bytes,
비공개 파일 읽기·새 서명·거래 전송 0회. 이는 아래 최초 독립 검증 이후의 별도 조회다.

2026-09-28 **13:28:09.256Z**에 별도 검증자가 공식 fullnode를 5회, 총 **23,267 bytes**의
제한된 읽기로 조회하여 다음을 교차 확인했다. 비공개 파일 읽기, 새 서명, broadcast는 없었다.

- 세 거래 모두 transaction BCS에서 digest를 재계산해 요청 digest와 대조하고, 성공 effects와
  정확한 Move 호출 목록, 새 package/Campaign 및 initial shared version을 확인했다.
- checkpoint는 발급 `388746483`, 위임 `388746490`, 실행 `388746497`이었다.
- 공개 서명 **5개 모두 Ed25519 서명으로 로컬 암호 검증**했다:
  발급 `issuer`, 위임 `user + issuer(sponsor)`, 실행 `agent + issuer(sponsor)`.
  zkLogin 서명은 없었다. 서명 종류만 읽은 검사보다 강한 실제 서명 검증이다.
- holder `0xe6dfb060…9a194e`, Grant `0xab4216c4…4a4a363`,
  ExecutionRecord `0xa7aa2463…5e44480`의 연결을 확인했다. 이 표기는 공개 object/address의 축약이다.
  Grant는 `uses=1`, `max_uses=1`, `revoked=false`였고 Record는 같은 holder 소유였다.
- 5개 이벤트의 sender와 holder/intent/grant/record 연결, 해당 거래의 객체 생성 effects,
  현재 앱의 `verifyExecutionEvidence` 검증을 모두 통과했다. Campaign counter도 `1/1/1`이었다.

설정 거래와 여정 실행 후 issuer/sponsor 잔액은 **0.953559100 Testnet SUI**였다.
확인된 초기 1 SUI 대비 감소는 **0.046440900 Testnet SUI**이며, package publish와 Campaign 생성까지
포함한 이번 run의 잔액 차이다. 여정 거래 3개만의 비용이라고 분리해서 주장하지 않는다.

## 처음 발생한 harness 오류와 안전한 재실행

초기 harness는 상대 경로 `page.goto('/?...')`를 사용하면서 Playwright context의 `baseURL`을 설정하지 않아
브라우저 탐색 전에 실패했다. `baseURL: 'http://127.0.0.1:3160'` 설정으로 수정했다.
초기 실패 보고서는 journey API 호출 목록이 비어 있었고, 발급·서명·체인 쓰기가 시작되지 않았다.
단, runner의 사전 `GET /config`와 Campaign 읽기는 이미 수행됐으므로 **모든 API 호출 전 실패**라고 표현하지 않는다.

실행 담당자는 실패한 one-shot 표식을 보존하고 체인 counter가 `0/0/0`임을 확인한 후 수정된 harness를 실행했다.
성공한 여정은 위 operation 하나이며 최종 counter가 `1/1/1`이다.
표식을 무조건 삭제하거나, 거래 결과가 불명확한 상태에서 다시 발급하지 않는다.

## 동일 Move 소스의 새 컴파일 근거

- CLI: `/tmp/ktour-own-sui-build.C1UT0A/bin/sui`, `sui 1.79.0-46f18562f1f5`.
- [MystenLabs 공식 Testnet v1.79.0 릴리스](https://github.com/MystenLabs/sui/releases/tag/testnet-v1.79.0)의
  macOS ARM64 archive SHA-256을 공식 release metadata와 대조했다:
  `79900034cb533832a3bf9f10d783c309bfa8259697d6417e6dccdb0758f0f613`.
- framework tag commit: `46f18562f1f5af2438d35828e8b62d5e0b972db7`.
- 원본 `sources/entitlement.move` SHA-256:
  `45abd2e7e67c74de2fbc19e53397d65100ac55acabd4c4d4c6f034c6a341e8f1`.
- 소스와 Move tests는 임시 package에 그대로 복사했다. 임시 `Move.toml`의 의존성만
  추출한 고정 공식 릴리스로 연결했으며, 원본 Move 소스·manifest·lock·deploy-info는 수정하지 않았다.
- 네트워크가 차단된 빌드에서 발행용 module 1개, **3,066 bytes**, 의존성 `0x1`, `0x2`를 생성했다.
  발행 전 module SHA-256은
  `f266e663f8045ecef8806fe0fc1ddf77ae74acf97c32d90dec2dbb38d6b94ffc`이며,
  기존 `move/ondo_entitlement/bytecode-testnet-v1.79.0.json`과 동일했다.
  이는 발행 입력 bytecode의 hash이며 package 주소가 반영된 온체인 module hash와 혼동하지 않는다.
- Move tests **7/7 통과**: 정상 issue/delegate/consume, 무권한 mint, 타인 위임, 만료,
  취소된 grant, 두 번째 consume, 잘못된 agent 거절.

임시 공개 빌드 자료:

- `/tmp/ktour-own-sui-build.C1UT0A/compiled-public-bundle.json`
- `/tmp/ktour-own-sui-build.C1UT0A/source-manifest.json` — compiler/source/dependency provenance와 hash.
- `/tmp/ktour-own-sui-build.C1UT0A/move-test-public.log`

Move test 실행이 build directory를 바꿀 수 있으므로 publication은 따로 저장된
발행용 JSON bundle을 검증해서 사용했다. 임시 디렉터리는 영구 배포 저장소가 아니다.

## 운영 명령과 안전 경계

세 script는 `k-tour-id-app` 디렉터리에서 실행하는 수동 작업용이며 자동 CI에 포함되지 않는다.
아래는 명령 계약 설명이며, **이미 성공한 이 run의 browser 여정을 다시 실행하라는 지시가 아니다.**

| 명령 | 의미 / 주의 |
| --- | --- |
| `node scripts/hackathon-selfhosted-testnet.mjs prepare` | 별도 run directory와 새 키 생성. 기존 지갑을 가져오지 않는다. |
| `node scripts/hackathon-selfhosted-testnet.mjs status <runDir>` | 공식 Testnet chain identifier·잔액과 저장된 manifest 확인. dev 종료 후 사용. |
| `node scripts/hackathon-selfhosted-testnet.mjs fund <runDir>` | 공식 faucet 요청 1회. 이 run에서는 이미 사용했으므로 재실행하지 않는다. |
| `node scripts/hackathon-selfhosted-testnet.mjs publish <runDir>` | 고정 module hash/dependencies 검증 후 새 package publish. digest를 전송 전에 저장한다. |
| `node scripts/hackathon-selfhosted-testnet.mjs campaign <runDir>` | 자체 AdminCap으로 Campaign 생성. 기존 digest가 있으면 조회만 한다. |
| `node scripts/hackathon-selfhosted-testnet.mjs dev <runDir>` | 환경을 명시적으로 격리하여 loopback `127.0.0.1:3160`에 앱 실행. |
| `node scripts/hackathon-selfhosted-browser.mjs <runDir>` | 실행 중인 자체 앱에 대한 one-shot 브라우저 여정. 실제 Testnet 쓰기 3개를 유발한다. |
| `node --import tsx scripts/hackathon-selfhosted-verify.ts --read-only <runDir>/manifest.json <runDir>/browser-public-report.json` | 앱 서버 없이 가능한 독립 읽기 검증. 고정 Testnet 읽기 최대 5회, 원문 BCS/서명 검증, private.json 입력 거절. |

이번 run directory는 `/Users/woogieboogie/.local/share/ktour-sui-e2e/run-20260928-pukp3X`다.
키는 Git 밖의 제한된 run directory에 `0600` 파일로 보관하며 값은 문서·보고서에 넣지 않는다.
앱은 해당 run의 독립 ledger를 사용하고 기존 provider 환경을 상속하지 않는다.
앱 root에 Next.js가 사용하는 `.env`, `.env.local`, `.env.development[.local]`,
`.env.production[.local]` 파일이 있으면 실행을 거절한다.

setup script는 `.operator.lock`을 독점 획득하고, manifest를 임시 파일 → fsync → rename → directory fsync로 저장한다.
**dev도 child가 끝날 때까지 lock을 유지하므로 dev 실행 중에는 같은 run의 status/publish/campaign 등이 거절된다.**
dev를 정상 종료한 후 status를 확인한다. 다른 process의 lock이나 browser one-shot 표식을 임의로 지우지 않는다.
중단된 거래는 저장된 digest부터 조회하며 불명확한 결과를 새 전송으로 해결하지 않는다.

publish의 gas budget은 `100,000,000 MIST`, Campaign 생성은 `20,000,000 MIST`다.
이 값은 설정 거래 한도이며 실제 사용료나 브라우저 여정 전체 지출 한도라는 뜻은 아니다.
위 독립 검증의 잔액 차이와 각 거래의 gas budget을 구분하며, 거래별 사용료를 추정하지 않는다.

공개 증거 파일은 run directory의 `manifest.json`, `browser-public-report.json`이며,
화면 증거는 `01-user-approval.png`, `02-delegated.png`, `03-agent-executed.png`, `04-return-to-place.png`다.
실패 진단 자료나 비공개 키 파일을 공개 증거로 복사하지 않는다.

## 과거 조회 문제 수정과 남은 범위

[과거 세 거래 재검증 기록](SUI_HISTORICAL_RECHECK_2026-09-28.md)의 fullnode 보관 범위 문제에 대해
현재 작업 소스의 `sui-historical-read.ts`에 **읽기 전용 공식 Testnet GraphQL fallback**을 추가했다.
정확한 typed `notFound`일 때만 고정 endpoint로 한 번 조회하며, 다른 network·일반 장애·실행 실패에는
거래 재전송이나 재발급을 하지 않는다. 15초/512 KiB/50-event 한도와 chain identifier·digest·BCS effects·status·checkpoint
검사를 적용하고 기존 operation-bound grant/record/event/commitment 검증은 유지한다. 관련 offline tests는 **11/11 통과**했다.

GraphQL 조회는 데이터 접근 경로이며 독립 checkpoint 서명 검증을 뜻하지 않는다.
현재 Grant/ExecutionRecord 객체 읽기는 여전히 fullnode가 필요하므로 모든 과거 객체의 보관을 보장하지 않는다.
이 수정이나 새 Testnet 검증 결과가 운영 배포 완료, 실제 CX/OpenDID·Google/zkLogin 통합,
서비스 사용·OmniOne 확정까지의 전체 완료를 뜻하지는 않는다.
