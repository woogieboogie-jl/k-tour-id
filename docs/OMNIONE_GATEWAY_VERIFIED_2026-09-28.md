# OmniOne Gateway 규격·실조회·추가 입력 정리 — 2026-09-28

## 결론

사용자가 제공한 인증 URL·KTourAnchor 소스·내부 `OMB API-Gateway API document`를
기존 앱 코드와 대조했다. **인증 RPC 접근은 확보됐고, 현재 앱용 계약과 recorder 권한을
실제로 조회했다. RPC 토큰이나 공개 계약 주소를 다시 요청할 필요가 없다.**

다만 조회 성공은 새 거래 서명·기록 또는 전체 사용자 여정 성공이 아니다.
OmniOne 신규 기록에 남은 외부 입력은 **기존 승인 recorder의 서명 수단**이다.
OpenDID 자체 구현은 **취소가 아니라 별도 workflow**로 계속 진행한다.
기존 credential/VP 검사를 건너뛰는 CX→Sui 대체 경로를 새로 만드는 합의가 아니다.
[최신 야간 인계](./MORNING_HANDOFF_2026-09-28.md)와
[OpenDID 연결 계약](./OPENDID_WORKFLOW_BOUNDARY_2026-09-28.md)을 함께 따른다.

확인 환경: 로컬 통합 worktree, revision `fe28944f0d611e8874cec6d49de02c43b9370648`.
조회일: 2026-09-28 KST. 두 계약의 owner·누적 기록 추가 조회 시각은 01:06:50 KST다.
이 문서에는 API 토큰·개인키·개인정보가 없다.
위 조회 시점에는 신규 거래·서명·배포·권한 변경·원격 설정 변경을 하지 않았다.
이후 야간 준비에서 제공된 RPC와 기존 연결값을 **별도 통합 Preview 브랜치 전용 설정**으로
저장했다. 신규 거래·배포·기존 CX 설정 변경은 하지 않았다. 아래 5절은 조회 시점의 기록이다.

## 1. 사용자가 제공한 내부 Gateway 규격

출처는 9/28 대화에 붙여 준 OmniOne의 `OMB API-Gateway API document`다.
내부 페이지를 공개 링크로 접근했다고 주장하지 않는다. 아래는 비밀값을 제거한 요약이다.

| 항목 | 규격 / 주의 |
| --- | --- |
| 정식 RPC | `https://stage-chainapi.omnione.net/?token=<API_KEY>` |
| 전송 | HTTP POST, `Content-Type: application/json`, JSON-RPC 2.0 |
| 인증 | query의 `token`. URL 전체를 서버 비밀값으로 취급 |
| 성공 HTTP | 문서와 실제 조회 모두 `201 Created` 관측. `200`만 허용하면 안 됨 |
| 성공 본문 | 요청 `id`와 같은 `id`, `jsonrpc: "2.0"`, `result`. HTTP 성공만으로 판정하지 않음 |
| 체인 ID | `0x311fa` = `201210`, 이번 실제 조회와 일치 |
| 새 거래 | 이미 서명된 거래를 `eth_sendRawTransaction`으로 전송. API 토큰 자체가 거래 서명키는 아님 |

안전하게 공유 가능한 조회 요청 본문:

```json
{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}
```

문서에 나열된 읽기 메서드:
`eth_blockNumber`, `eth_chainId`, `eth_getBlockByHash`, `eth_getBlockByNumber`,
`eth_getBlockTransactionCountByHash`, `eth_getBlockTransactionCountByNumber`,
`eth_protocolVersion`, `eth_getCode`, `eth_getTransactionCount`, `eth_call`, `eth_getProof`.
이는 문서 목록이며 전부 호출해 검증했다는 의미는 아니다.
`eth_getTransactionReceipt`는 제공된 발췌에는 없지만 기존 앱의 사전 검사에서 실제 성공했다.

문서 예제를 그대로 실행하지 말아야 하는 부분:

- `sendRawTransaction`의 curl 예제에는 메서드명 끝 공백, 불필요한 배열과 JSON 괄호 문제가 있다.
  예제 서명 거래는 재전송하지 않는다. 실제 SDK가 생성한 거래와 정규 메서드명을 사용해야 한다.
- `getProof` 예제 중 주소에는 `0x`가 빠져 있다. 요청 주소는 유효한 20-byte hex 형식으로 검증한다.
- 예제 응답의 블록 번호·주소·거래 해시는 설명용이며 우리 계약의 현재 상태를 입증하지 않는다.

처음 전달된 `test.stage-chainapi.omnione.net`은 이번 조회에서 HTTP 404였다.
사용자가 추가 제공한 문서 및 저장소가 가리키는 **`stage-chainapi.omnione.net`에서는 실제 조회가 성공**했다.
초기 진단 도중 정식 주소에 대해서도 실패 결과가 있었지만, 최종 판정은 아래 기존 사전 검사와
앱과 동일한 ethers client의 성공 결과에 근거한다. 실패 원인을 지역/IP 차단이나 토큰 만료로 단정하지 않는다.
Accept 헤더 유무 및 요청 객체의 키 순서를 달리한 확인은 모두 성공했으므로 이들을 원인으로 지목하지 않는다.

## 2. 이번에 실제로 확인한 체인 상태

기존 [읽기 전용 사전 검사](../k-tour-id-app/scripts/hackathon-omnione-readiness.ts)를
사용했다. 토큰은 메모리와 자식 프로세스의 stdin으로만 전달했으며 파일·명령행 인자·보고서에 저장하지 않았다.
검사는 앱 설정이나 Wallet/signing key를 불러오지 않는다.

| 검사 | 결과 |
| --- | --- |
| `eth_chainId` | `201210`, 기대값과 일치 |
| 현재 앱용 registry의 `eth_getCode` | 비어 있지 않은 배포 코드 확인 |
| `recorders(기존 recorder)` | `true` |
| registry 배포 receipt | 성공 상태, 배포 주소·거래 해시·블록 `0x1828553` 일치 |
| 종합 | `ok: true`, 4 RPC calls, `issues: []`, `newTransactions: 0` |

추가로 앱과 같은 ethers `JsonRpcProvider` 생성 방식(`staticNetwork: true`)으로
블록 번호·registry 누적 기록·recorder 권한을 읽었고 **3/3 성공**했다.
직접 HTTP 조회만 통과하고 앱 SDK는 검증하지 않은 상태와 구분한다.
단, 실제 배포된 Vercel 서버에서 같은 비밀 설정으로 호출한 검사는 아직 아니다.

### 두 계약을 혼동하지 않는다

| 구분 | 현재 앱용 계약 | 과거 앵커 계약 |
| --- | --- | --- |
| 이름 | `DemoEntitlementRegistry` | `KTourAnchor` |
| 주소 | `0x696bc4e29c8f8079b6d3cd49d310a09577550e4c` | `0x9112d8a1a251c6a07eb7bde307fef3b3b4aa5a97` |
| 쓰기 / 읽기 | `recordRedemption` / `getRedemption` | `anchor` / `verify` |
| 기록 권한 | `recorders(address)` | `onlyOwner` |
| 조회한 owner | `0x003403Cb95c2FFd66BC5748738d96C4A5B48b4ba` | 같은 주소 |
| 조회 시 누적 기록 | `total() = 22` | `totalAnchored() = 1` |
| 배포 검증 | 코드 존재·배포 receipt 성공 | 코드 존재·배포 receipt 성공 |

배포 거래:

- Registry: `0x1a82867d7608d3f473d2c2c5b4ef2995021a616de7b8d647f22544ea29e333db`
- Anchor: `0xac5e5b2f9a824245ccb47c22bbec091c84f0180090ce38fc7aebd9864ee1a9e0`

포털의 `Contract Resources / 승인완료`만으로 배포·앱 사용 여부를 알 수는 없다.
이번에는 별도로 실제 코드와 receipt까지 확인했다. 앱에 사용하지 않는 Anchor로
registry 주소만 바꾸면 ABI와 권한 모델이 맞지 않으므로 교체하지 않는다.
누적 22건/1건은 기존 기록의 존재를 뜻할 뿐, 이번 앱 버전의 신규 E2E 성공 증거는 아니다.
코드 존재 확인이며 Solidity 소스 재컴파일 결과와 배포 bytecode의 일치 검증까지 수행한 것은 아니다.

## 3. OmniOne에 추가로 필요한 사람의 입력

필요한 것은 기존 recorder `0x003403Cb95c2FFd66BC5748738d96C4A5B48b4ba`의
**서명 권한**이다. 현재 adapter는 서버 환경변수 `HK_OMNIONE_PRIVATE_KEY`를 사용한다.
이미 확보한 JWT/RPC 접근권한과는 다른 비밀값이다.

Harvey 또는 그 계정 보유자가 기존 데모용 recorder 키를 승인된 서버 비밀 설정으로 인계해야 한다.
키를 채팅·Markdown에 붙일 필요는 없다. 기존 키 인계가 불가능하다면 승인된 원격 signer 또는
새 recorder의 권한 위임을 별도 협의한다. 기존 owner를 임의 교체하거나 권한을 바꾸지 않는다.

다시 요청하지 않을 항목:

- RPC 토큰 및 내부 API 문서: 제공됨. 읽기 성공.
- chain ID, registry 주소, recorder 공개 주소, 두 계약의 배포 거래: 확보·읽기 검증 완료.
- 계약 소스, 조회용 개인키, 가스 구매: 지금 읽기 검사에 불필요.
- 기존 Vercel 로그인·Redis·CX 설정·Sumsub SDK 키: 이미 준비된 범위는 재요청하지 않음.
- 기존 `HK_ISSUER_SIGNING_SEED`: CX Preview에 존재하며 동일인 가명화에 쓰이므로 보존한다.
  다만 이후 확인에서 sensitive 값의 원문 조회가 불가했다. 통합 브랜치로 기존 값의 안전한
  이전에는 원본 보관자의 도움이 필요하다. 새 seed 생성이나 기존 CX 값 교체는 하지 않는다.

## 4. 별도 OpenDID workflow와 병행하는 통합·검수

이 항목들은 추가 자료를 달라는 요청이 아니다. 내가 처리해야 할 통합 작업이다.

1. **실행 환경 연결:** 제공된 RPC와 기존 signer를 별도 보호된 통합 Preview에 연결하고
   해당 서버에서 조회·서명·기록·확정을 검수한다. 기존 공개 UI, CX-only, Sumsub Preview를 덮어쓰지 않는다.
2. **OpenDID 연결 계약:** 현재 `identityComplete`는 CX 성공 후 `issuance`로 넘어가며,
   Sui 위임·실행·최종 판정은 credential/VP를 요구한다. 실제 provider adapter는 별도 작업이다.
   현 mock credential/VP는 실제 OpenDID 증거가 아니다. 서버 검증 신원·holder/operation 결합·
   명시적 동의·만료·중복 사용 검사를 유지한 채 별도 workflow 결과를 연결한다.
   native 담당자가 사용할 DTO·ack challenge·VP 판정·부정 시나리오는 연결 계약에 정리했다.
3. **Sumsub 경계:** 현재 SDK/상태 조회는 별도 Sandbox 흐름이고 hackathon identity와 연결되지 않는다.
   이 경로까지 데모에 연결한다면 동일인·세션·동의 결합 및 증거 구분을 구현해야 한다.
   Sandbox 승인을 실제 신원·성인·혜택 자격으로 승격하지 않는다. 상용 eKYC 전환은 별도 범위다.
4. **실제 완주 검수:** 본인 승인 후 같은 operation에서 Sui 발급·위임·실행 → 서버 최종 판정 →
   OmniOne receipt/event/payload commitment 일치 → 장소 복귀를 검증한다.
   중복·취소·만료·지연/재시도도 검수하고 실제 결과만 제출 증거에 반영한다.

근거: [서비스 흐름](../k-tour-id-app/lib/hackathon/service.ts),
[자격·VP 검증](../k-tour-id-app/lib/hackathon/operation-evidence.ts),
[OmniOne adapter](../k-tour-id-app/lib/hackathon/adapters/omnione.ts),
[Sumsub Sandbox 경계](../k-tour-id-app/lib/kyc/sumsub-sandbox.ts).

## 5. 전체 흐름에서 사람만 할 수 있는 남은 항목

승인된 Vercel `jaewook-9643 / ondo` 프로젝트의 환경변수 메타데이터 34개를 재조회했다.
비밀값은 열지 않았다. 반환된 모든 범위에서 Sui signer, OmniOne 설정, Google client,
zkLogin salt/prover, Gemini 설정 이름은 없었다. Sumsub 설정은 별도
`integration/sumsub-live-20260927` Preview에 있고, 기존 `HK_ISSUER_SIGNING_SEED`는
CX Preview 브랜치에 있다. 제공된 OmniOne RPC를 서버에 등록하는 일은 내 설정 작업이며
사용자가 토큰을 다시 전달해야 한다는 뜻이 아니다.

| 담당 | 필요한 입력/행동 | 이미 받은 것을 재요청하지 않는 범위 |
| --- | --- | --- |
| 모바일 신분증 보유 팀원 | 9/29 CX 정보 제출 동의·본인 승인 | 예정된 일정 유지. [진행 안내](./TUESDAY_MOBILE_ID_CHECK_2026-09-29.md) |
| Harvey / 기존 서버 설정 보유자 | OmniOne recorder, Sui issuer/agent 서명 수단; 기존 Google client·zkLogin salt/prover 설정 | 공개 주소와 OmniOne RPC는 다시 받을 필요 없음. [정확한 설정명](./HARVEY_ENV_HANDOFF_2026-09-26.md) |
| OAuth / prover 관리자 | 필요한 검수 origin·callback 등록 또는 관리 접근 | API key 제공과 callback 허용은 별개. 두 prover 경로를 동시에 요구하지 않음 |
| AI 설정 보유자 | 실제 모델 연동을 위한 Gemini key·model/mode | rule 방식은 실제 모델 호출 증거가 아님 |
| Sumsub 관리자 | 실제 provider webhook 배달까지 검증할 경우 webhook 등록 또는 `manageClientSettings` 관리 권한 | SDK·서버 상태 재조회·CX→체인의 선행 조건은 아님. 관리 API 403은 [9/28 기존 검수](./SUMSUB_LIVE_PREVIEW_2026-09-28.md) 결과이며 이번에 재호출하지 않음 |
| 인증·서명 당사자 | 준비된 환경에서 본인 Google 로그인·거래 동의/서명 | 본인 동의를 대신하지 않음. 실제 여권·얼굴 자료 제출은 이번 요청사항이 아님 |

Sumsub Sandbox 검수는 제공자가 승인한 테스트 자료로 진행하며 실제 신분증/얼굴 자료를
요구하지 않는다. 실제 개인정보를 처리하는 상용 eKYC 전환은 별도 승인 범위다.

설정만 받으면 모든 통합이 자동으로 끝나는 것은 아니다. 위 4절의 연결·배포·실제 검수는
우리 쪽 작업이고, OpenDID 자체 구현은 병렬 workflow다. 사용자에게 구현을 떠넘기는 목록이 아니다.
