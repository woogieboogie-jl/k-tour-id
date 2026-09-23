# Harvey 런타임 재현 정보 인계 — 2026-09-23

목적은 이미 받은 최종 코드와 데모를 우리 환경에서 재현하는 것이다. 신규 기능 개발·새 거래 생성·기존 데모 링크/Sui 거래 3건 재전송 요청이 아니다. 이 문서는 백엔드 담당자용이며 실제 비밀 값은 포함하지 않는다.

## 그대로 보낼 요청문

> 하비, 보내준 최종 코드·데모 링크·Sui 거래 3건은 확인했어. 다시 보내줄 필요 없어.
> 추가 개발 말고, 우리가 같은 환경을 재현할 수 있도록 아래 인계 정보만 부탁해.
> ① 현재 데모의 Vercel team/project·배포 commit과 접근권한, 또는 승인된 비밀관리 경로로 서버 환경설정 인계 부탁해. 키·토큰은 채팅에 붙이지 않아도 돼.
> ② OmniOne까지 기록된 기존 실행이 있다면, 같은 operation의 txHash·eventKey·payloadCommitment·registry 주소와 receipt/조회 결과를 부탁해. 없으면 아직 없다고만 알려줘—새 거래를 만들 필요는 없어.
> ③ Sui 거래 3건은 오늘 공식 Testnet gRPC에서 각각 `not found`로 나왔어. 성공 당시 네트워크·RPC·package/campaign과 지금 조회 가능한 기존 거래나 보관된 결과가 있는지 확인 부탁해. 실제 Google zkLogin이었는지 demo signer였는지, 성공한 로그인→승인 순서와 callback/prover 설정도 알려줘. 같은 링크 재전송이나 새 거래 생성은 불필요해.
> ④ CX는 현재 mock 유지인지, 실제 인증까지 확인한 설정이 따로 있는지만 알려줘. 있다면 필요한 휴대폰 앱·신분증 종류와 stable CI 제공 여부도 부탁해(개인정보 원문은 불필요).
> OpenDID 추가 구현이나 새 시연은 요청하지 않을게. 나머지 통합·보완은 우리가 이어서 진행할게.

## 무엇이 이미 확인됐고 무엇을 더 받아야 하나

- **9/23 새 읽기 확인:** 공개 `/api/hackathon/v1/config` GET HTTP 200. 선언은 `cx: mock`, `opendid: mock`, `ai: rule`, `sui: testnet`, `omnione: stage`, `zklogin: google`이다. 이는 실행 성공이나 실제 사용한 signer/prover를 입증하지 않는다. 이번에는 새 인증·OAuth·서명·체인 거래를 수행하지 않았다.
- **이미 받은 것:** 데모 링크와 과거 Sui 발급/위임/Agent 실행 거래 3건. **9/23 재조회에서는 공식 Testnet gRPC가 세 건 각각 `not found`를 반환했다.** 9/21의 과거 성공 기록과 오늘의 조회 불가를 구분한다. 초기 스크립트 일괄 실패 뒤 세 건을 독립 조회했으며, 원인을 네트워크 초기화·삭제·위조로 단정하지 않는다. [Sui 검증 보고서](SUI_INTEGRATION_VERIFICATION_2026-09-21.md) 참고. 같은 링크 대신 성공 당시 환경과 현재 조회 가능한 기존 증거를 요청한다.
- **이전 진단의 접근 제한:** 9/21 OmniOne 무인증 `eth_chainId`는 HTTP 401이었다. 메인 작업트리 환경에도 관련 RPC 자격 증명은 없었으며, 현재 사용 가능한 Vercel 계정에서는 해당 데모 프로젝트 접근이 확인되지 않았다. 이 과거 관측을 9/23 재인증 결과라고 표시하지 않는다.
- **CX 추가 읽기 결과:** 9/21 `GET /oacx/api/v1.0/provider/list`는 HTTP 200, `comdl`·`coidentitydocument`는 `status_code: y`, `comrc`·`coresidence`는 `n`이었다. 공급자 목록 조회와 실제 holder 인증 완료는 다르다. 지역 제한은 확인하지 않았다.
- **같은 operation의 OmniOne 증거가 필요한 이유:** 계약 배포 receipt와 Sui 실행 digest만으로 최종 서비스 결과가 OmniOne에 기록됐다고 판단할 수 없다. 기존 operation ↔ eventKey ↔ payloadCommitment ↔ registry/receipt의 대응이 필요하다. 세션 쿠키·JWT·VC 원문·CI는 요청하지 않는다.
- **zkLogin 절차가 필요한 이유:** 소스에 demo signer와 zkLogin, Enoki와 별도 prover 경로가 공존한다. 공개 `google` 선언만으로 실제 실행 경로를 재현할 수 없다. 새 Google 계정 비밀번호나 사용자의 ephemeral private key를 받을 필요는 없다.

## 환경설정 인계 체크리스트 — 이름만

모든 변수를 새로 만들거나 채워 달라는 요청이 아니다. **기존 성공 환경에서 사용한 항목·배포 환경 범위·비밀관리 위치**를 먼저 확인한다. 비밀 값이 있는 URL도 채팅/문서/로그에 복사하지 않는다. 프로젝트 접근권한으로 해결되면 별도 env 파일 전달은 생략한다.

| 구분 | 현재 코드에서 사용하는 이름 | 인계 시 확인할 사항 |
| --- | --- | --- |
| API/모드 | `HK_API_ENABLED`, `NEXT_PUBLIC_HK_ENABLED`, `HK_ISOLATED_MOCK`, `HK_MODE_CX`, `HK_MODE_OPENDID` | 실제 성공한 환경의 모드. 격리 실행기는 체인을 차단하며 live 설정 재현용이 아님 |
| CX | `HK_CX_BASE_URL`, `HK_CX_PROVIDER`, `HK_CX_ZKP_TYPE`, `HK_CX_API_KEY` | provider/zkpType 조합, API key 사용 여부, stable CI 제공 여부. 키 미설정 자체가 모든 CX API의 차단을 뜻하지 않음 |
| 신원 pseudonym/sample 서명 | `HK_ISSUER_SIGNING_SEED` | 기존 값은 비밀관리 경로로만. 임의 변경은 동일인 식별/기존 sample 검증에 영향을 줄 수 있음 |
| Sui 연결·객체 | `HK_SUI_NETWORK`, `HK_SUI_GRPC_URL`, `HK_SUI_PACKAGE_ID`, `HK_SUI_CAMPAIGN_ID`, `HK_SUI_CAMPAIGN_INITIAL_VERSION` | 기존 배포·campaign·네트워크 대응. 신규 배포 요청 아님 |
| Sui 실행 권한 | `HK_SUI_ISSUER_SECRET_KEY`, `HK_SUI_AGENT_SECRET_KEY`, `HK_SUI_SPONSOR_SECRET_KEY` | 서버 비밀 보관/권한 위치만 우선 확인. 과거 거래 읽기에는 이 키들이 불필요하며 이번에 사용하지 않음 |
| zkLogin | `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `HK_ZKLOGIN_SALT_SEED`, `HK_ZKLOGIN_PROVER_URL`, `ENOKI_API_KEY`, `ENOKI_API_URL` | 실제 사용한 prover/salt 경로와 등록 callback/origin. Enoki/별도 prover 경로를 무작정 바꾸지 않음. Google client ID는 공개 설정이며 나머지 비밀은 비밀관리 경로로만 |
| OmniOne 읽기 | `HK_OMNIONE_RPC_URL`, `HK_OMNIONE_CHAIN_ID`, `HK_OMNIONE_REGISTRY_ADDRESS` | 인증된 RPC 읽기 접근과 기존 registry. RPC URL에 토큰이 있으면 URL 전체가 비밀 |
| OmniOne 쓰기 | `HK_OMNIONE_PRIVATE_KEY`, `HK_OMNIONE_GAS_LIMIT` | 기존 recorder 구성 확인만. receipt/registry 읽기에는 서명키가 불필요하며 이번에 쓰기 권한을 요청하지 않음 |
| 내구 저장소 | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` 또는 `KV_REST_API_URL`, `KV_REST_API_TOKEN`; `HK_STORE_KEY`, `HK_DATA_DIR` | 데모가 실제 사용한 backend/namespace와 기존 operation·outbox 증거 보존 여부. 운영 데이터를 새 테스트로 변경하지 않음 |
| 캠페인 범위 | `HK_CAMPAIGN_ID`, `HK_CAMPAIGN_VENUE_ID`, `HK_CAMPAIGN_ENDS_AT` | 데모에 사용한 정책·장소·기간. 변경/연장 요청 아님 |

근거: [설정](../k-tour-id-app/lib/hackathon/config.ts), [zkLogin 경로](../k-tour-id-app/lib/hackathon/adapters/zklogin.ts), [저장소 선택](../k-tour-id-app/lib/hackathon/store.ts).

## 우리 쪽에서 이어갈 일 / 사용자 참여가 필요한 시점

- 프로젝트/RPC 접근이 준비되면 먼저 chainId·계약·기존 receipt/registry를 읽어 대조한다. 이 단계는 휴대폰이나 개인 서명이 필요 없다.
- CX/OpenDID mock을 유지한 **Sui 단독 검증은 별도 가능**하다. OpenDID 실구현은 그 필수 선행조건이 아니며, Sui 단독 성공을 전체 DID 완료로 표시하지 않는다.
- 실제 CX holder 인증 시점에만 사용자의 지원 신분증 앱·휴대폰 조작과 명시적 참여가 필요하다. 환경 인계를 위해 지금 신분증 원문이나 로그인 비밀번호를 제출할 필요는 없다.
- Outbox 동시 dispatch와 receipt 없는 `confirmed`의 두 P1은 [9/21 감사](CX_CHAIN_INTEGRATION_VERIFICATION_2026-09-21.md)에 남은 우리 쪽 보완 항목이다. 이번 인계 요청에 Harvey의 신규 개발 의무를 섞지 않는다.
- 새 인증·서명·거래·설정 변경·배포는 인계 정보 수령과 별개이며, 실제 실행 범위를 승인받기 전 자동으로 시작하지 않는다.
