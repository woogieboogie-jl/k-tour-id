# OmniOne 다음 실행 게이트 — 2026-09-26

현재 추가한 것은 독립 **읽기 전용 준비 점검 도구**다. fixture 통과는 실제 RPC 인증·현재 recorder 권한·새 트랜잭션 성공 증거가 아니다. 이 작업에서는 실제 인증 RPC를 호출하지 않았으며 기존 adapter/service/config, CX-only 차단 정책, Production을 변경하지 않았다.

## 기존 계약과 공개 대상

[배포 메타데이터](../chain/omnione/deploy-info.stage.json)와 [기존 adapter](../k-tour-id-app/lib/hackathon/adapters/omnione.ts)를 따른다.

| 항목 | 승인된 stage 값 |
| --- | --- |
| Chain ID | `201210` |
| RPC 형식 | `https://stage-chainapi.omnione.net/?token=<API_KEY>` |
| Registry | `0x696bc4e29c8f8079b6d3cd49d310a09577550e4c` |
| Recorder 공개 주소 | `0x003403Cb95c2FFd66BC5748738d96C4A5B48b4ba` |
| 기존 배포 거래 | `0x1a82867d7608d3f473d2c2c5b4ef2995021a616de7b8d647f22544ea29e333db` |

기존 `HK_OMNIONE_RPC_URL`은 query token을 포함한 URL을 지원한다. 별도 인증 헤더나 새 인증 adapter가 필수라는 뜻이 아니다. 이 도구는 `HK_OMNIONE_PRIVATE_KEY`를 읽거나 존재 확인하지 않고 Wallet/Signer를 만들지 않는다. 공개 recorder의 읽기 검증으로 개인키 소유·서명 가능 여부는 확인할 수 없다.

## 실행 방법과 필요한 입력

앱 디렉터리에서 실행한다. 환경값은 승인된 비밀 주입 경로를 통해 프로세스 메모리로만 전달한다. `.env` 자동 로드, CLI 인수로 token 전달, shell history에 비밀 입력, 보고서 파일 저장은 하지 않는다.

```sh
node --import tsx scripts/hackathon-omnione-readiness.ts
node --import tsx scripts/hackathon-omnione-readiness.ts --read-only
```

- 기본 실행은 오프라인이다. `HK_OMNIONE_RPC_URL`, `HK_OMNIONE_REGISTRY_ADDRESS`, 선택적 `HK_OMNIONE_CHAIN_ID`(기본 `201210`)의 설정 적합 여부만 출력하며 RPC 요청 수는 0이다. 설정 누락/불일치면 실패 종료한다.
- `--read-only`만 네트워크를 허용한다. 정확한 HTTPS stage host·루트 경로·단일 유효 `token` query만 허용하고 redirect를 따라가지 않는다. 다른 host/port/path, URL 자격증명, placeholder/중복 query는 거부한다.
- 기본 온라인 점검은 `eth_chainId` → `eth_getCode` → `recorders(공개 주소)` → 기존 배포 receipt 순서의 최대 4회다. 체인·코드 존재·recorder 권한·배포 tx/address/block이 일치해야 통과한다. 코드 존재 검사는 bytecode/source 동일성 증명이 아니다.
- 기존 사용 거래의 증거를 확인할 때만 `HK_OMNIONE_READINESS_TX_HASH`, `HK_OMNIONE_READINESS_EVENT_KEY`, `HK_OMNIONE_READINESS_PAYLOAD_COMMITMENT`를 세트로 제공한다. 모두 0이 아닌 32-byte hex여야 한다. 도구는 값을 출력하지 않는다.
- 선택 증거 점검은 receipt status 1, 같은 registry/recorder, `getRedemption`의 commitment·recorder·시간, **해당 receipt 안의 같은 이벤트**까지 일치해야 `evidence: confirmed`다. pending/failed/mismatch를 성공으로 세지 않는다. 최대 총 6회 RPC, 요청당 fetch+body 5초, 전체 네트워크 예산 25초, body 256 KiB 제한이며 재시도·polling은 없다.
- 출력은 고정 공개 대상, 설정 boolean, 고정 실패 코드, 요청 수뿐이다. 실제 query token/RPC URL, 외부 오류 원문, 개인키는 출력하지 않는다. `newTransactions`는 항상 0이다.

## 다음 게이트와 명시적 중단 조건

1. 승인된 stage RPC API key를 안전하게 제공받아 **읽기 전용** 점검을 실행한다. 401/403이면 인증 미해결로 중단한다. chain/code/recorder/deploy receipt 불일치도 중단하고 공급자·배포 메타데이터를 확인한다. 우회 host·다른 recorder·임의 재배포로 대체하지 않는다.
2. 통과 후 별도로 승인된 실행 lane, 실제 서비스 사용 건, recorder 서명키 권한을 확인한다. 기존 CX-only Preview는 OmniOne 실행을 계속 거부하므로 그 환경을 몰래 확대하지 않는다. 이 도구로 서명·broadcast를 실행할 수 없다.
3. 신규 실행을 승인받은 경우 기존 durable outbox 경로로 진행하고, 같은 건의 tx/eventKey/commitment를 다시 읽어 대조한다. 키 존재나 tx hash만으로 완료 처리하지 않는다.
4. 읽기 증거 일치도 신규 사용자 동의·CX 승인·Sui 실행·전체 E2E 또는 체인 finality 보장은 아니다. 실제 수행한 범위와 fixture 결과를 분리해 기록한다.

로컬 fixture 검증: `node --import tsx --test tests/hackathon/omnione-readiness.test.ts`. 실제 계정·키·체인 호출 없이 401, 잘못된 체인, 빈 코드, recorder 거부, pending/failed receipt, commitment/event 불일치, 토큰 오류 redaction 및 bounded timeout을 검사한다.
