# Sui / CX 공개 반영 및 검수 기록

## 범위

- 기존 서울·부산·제주 지도/스토리 UI는 유지한다.
- 공개 메인의 기존 장소 → 혜택 진입에서 실제 Sui Testnet 거래를 실행한다.
- CX는 완료 응답 처리 수정본을 별도 보호 Preview에서 검수한다. 실제 모바일 신분증 소지자의 새 승인 완료를 확인하기 전까지 Sui 메인과 연결됐다고 주장하지 않는다.
- OpenDID는 별도 Claude 워크플로에 남겨 두며 이번 작업에서 수정하지 않는다.

## 검수 상태

- 애플리케이션 단위 테스트: 395개 통과.
- 배포 도구/빌드 정책 테스트: 36개 통과.
- TypeScript 검사와 로컬 hosted-Sui 빌드 통과.
- 모바일 회귀: 도시별 스토리/지도 13개, Sui 진입·동의 4개 통과.
- 공개 배포 후 읽기 전용 화면 검수: 접근 화면 390px/360px, 서울·부산·제주 390px에서 가로 넘침·페이지 오류·원치 않는 변경 요청 없음. 초기 이미지 집계에 포함된 숨김 lazy 이미지는 0×0 요소였고, 보이는 이미지의 깨짐이나 404는 확인되지 않았다.
- CX 배포: `e4ef20b4a16fa862ecc62ea57681c48c2dbdd564`, `dpl_61tNMUFwy6wwhGbqHXgjXknn8upG`.
- CX 실제 제공자 QR·앱 요청·취소 smoke 통과. 소지자 최종 승인 검수는 별도 필요.
- Sui Preview와 공개 Production 모두 실제 브라우저 E2E 통과. 각각 새 Testnet 거래 3개를 발행하고, 공식 노드에서 성공·서명·대상·사용 횟수를 재검증했다.

## 바로 확인하기

[공개 앱의 대상 장소 열기](https://ktour-id.vercel.app/?venueId=mois-0021cd596bc5b2a922ad&review=0)

장소 상세 → `체험 혜택 보기 / See experience perk` → 기존 CX 접근 코드 입력 → 동의 → 샘플 신원 확인 → 패스 발급·제시 → 제안 승인·서명 → 대리 실행 → 장소 복귀.
현재 메인은 요청된 fallback 범위인 **Sui-only**다. 모바일 신분증 실인증은 아래 별도 CX URL을 이용한다.
공통 접근 화면의 `Integration preview access` 문구/`integration-preview-access` test id는 공유 컴포넌트 이름이며, 실제 실행 모드는 API config와 거래 증거로 확인했다.

## 무엇이 실제이고 무엇이 아직 아닌가

Sui 연결 경로는 실제 Testnet의 `issue` → `delegate`/`attest_consent` → `consume`/`attest_execution`이다.
브라우저 ED25519 키로 사용자가 승인하고, 서버가 제한된 테스트넷 가스를 후원한다.
Google zkLogin, 실제 CX 신원확인, 실제 OpenDID VC 발급, OmniOne 기록, 실매장 혜택 사용까지 검증한 경로는 아니다.
이 경로의 신원·패스는 샘플이며, 서버 제안은 rule 모드다. 이를 실제 인증/실제 혜택 성공으로 표시하지 않는다.

## 실행 제한

- 기존 CX 검수 접근 코드를 재사용하지만, Sui 접근 쿠키와 Redis 데이터 영역은 분리한다.
- 쿠키 유효기간: 2시간. 다른 호스트에서는 재사용할 수 없다.
- 연결 유효기간: 2026-09-30 23:59:59 KST까지.
- Preview/Production을 합쳐 최대 10개 작업. 실패·취소한 작업도 포함된다.
- 이번 실거래 검수에서는 Preview 1개, Production 1개 작업을 사용했다. 동시 외부 사용이 없다면 8개가 남는다.
- 작업당 최대 3개 거래, 거래당 가스 예산 10,000,000 MIST. 전체 예산 상한 0.3 SUI.
- 알 수 없는 거래 결과나 이미 기록된 실행은 자동 재전송하지 않는다.
- 만료/예산 소진 후에는 구성 재검토가 필요하다. 일반 지도/스토리 UI가 종료되는 것은 아니다.

## CX 오류의 원인과 재검수

모바일 신분증 앱의 제출 완료와 K-Tour 서버의 결과 수락은 서로 다른 단계다.
기존 코드는 완료 결과 토큰을 해석한 claims 안에 `txId`가 반드시 반복된다고 가정했다.
제공자 문서의 완료 결과 외부 응답에는 거래 참조가 있지만, 내부 claims 예시에는 같은 필드가 없다.
수정본은 검증된 완료 응답의 참조를 서버 요청 상태와 대조하고, 새 완료 토큰만 서버에서 해석한다.
참조 불일치, 이전 토큰 재사용, 안정적인 사용자 식별값 누락은 계속 거부한다.

재검수 URL:
https://ondo-74illm55t-jaewook-9643s-projects.vercel.app/?venueId=mois-0021cd596bc5b2a922ad&review=0

1. 위 수정본에서 기존 접근 코드를 입력하고 **새 요청**을 시작한다.
2. 모바일 신분증 앱에서 정보를 보내고 브라우저로 돌아온다.
3. 서버 결과를 확인한다. 기존 토큰이나 세션을 재사용하지 않는다.
4. 실패하면 오류 코드와 시각만 공유한다. QR, 원본 토큰, CI 등 개인정보는 공유하지 않는다.
5. `cx_subject_unavailable`이면 CI 제공 계약 확인이 필요하다. `zkp=true`만으로 성인 판정 성공을 대신하지 않는다.

상세 근거: [CX 완료 응답 수정 기록](CX_COMPLETION_FIX_2026-09-28.md).

## 확정 배포 및 실거래 기록

- 승인된 Vercel 프로젝트: `ondo` / `prj_w5rckTz9B1DO55fvVRXjQRy9L5RM` / `jaewook-9643`.
- 공통 실행 코드: `a34f7be9b5e7a3d2d00b9a2bf47c05754db7f90f`.
- 배포 브랜치: `deploy/sui-main-20260928`. Git 자동 배포는 이 브랜치에서 꺼져 있으며, 검증된 계정으로 수동 배포했다. `main` 브랜치 자체를 바꾼 것은 아니다.
- Preview: `dpl_GiM81mYLDMkcPb9mN3RAsQd7xBJm`, https://ondo-7mua7q3qi-jaewook-9643s-projects.vercel.app
- Production: `dpl_9Z5fEmN4JzVuBifRtUPwqEQnEJah`, https://ondo-env7841v8-jaewook-9643s-projects.vercel.app
- 공개 alias `https://ktour-id.vercel.app`가 위 Production을 가리키는 것도 API로 확인한 후 E2E를 실행했다.
- 두 배포 모두 함수 region `icn1`. 빌드가 실행된 region과 함수 실행 region은 다를 수 있다.

| Production 단계 | 실제 Testnet 거래 |
| --- | --- |
| 권한 발급 | [DFfzxMW…](https://suiscan.xyz/testnet/tx/DFfzxMWsvueFJqcQCpofGkpCv45UdT4Q3mssvYiXRHCu) |
| 사용자 승인·위임 | [C63nNft…](https://suiscan.xyz/testnet/tx/C63nNftsgtJG9duJ1S9Ho6iQLYowWknwfThcFA1HTApw) |
| 대리 실행·기록 | [97T1Jer…](https://suiscan.xyz/testnet/tx/97T1JermTRhWiJs8mqvFBkasnjsYWniHcUjHmXqXPkUD) |

검증은 Explorer 화면 존재 여부가 아니라 공식 Testnet gRPC에서 수행했다. 각 거래의 BCS digest,
ED25519 서명, 발행자/사용자/대리 실행자와 가스 후원자, Move 호출, Campaign 및 이벤트의
연결 관계, Grant의 `uses=1 / max_uses=1`, 실행 기록의 사용자 귀속을 확인했다.

Production에서 13개 변경 요청은 각각 1회였고, 중복 실행이나 redeem 호출은 없었다.
페이지 오류 0, API HTTP 오류 0, 예상치 못한 동일 출처 요청 실패 0이었다.
검증기가 명시적으로 차단한 외부 읽기 자산은 3개다. Preview의 이전 검증기는 네트워크 실패
4개를 세부 분류하지 않았으므로, 그 4개 전부가 외부 자산 차단이었다고 소급 주장하지 않는다.

`fulfillment=pending`, `chain=null`은 이 Sui-only 배포의 의도된 종료점이다. 실제 혜택 사용이나
OmniOne 기록까지 완료한 결과가 아니며, UI에서 장소 복귀까지 검수했다.

[개인정보/키가 없는 전체 거래 검수 증거](SUI_CX_RELEASE_2026-09-29_RECEIPTS.json)

검수 스크립트 `k-tour-id-app/scripts/hackathon-hosted-sui-browser.mjs`의 배포 ID 경로/네트워크 실패
분류 수정본은 문서 브랜치 `docs/sui-cx-release-20260929`에 함께 보관한다. 이 스크립트는 읽기
전용이 아니며, 한 번 실행하면 작업 슬롯 1개와 실제 Testnet 거래 최대 3건을 사용한다.
실패 후에는 보고서의 단계와 기존 거래부터 확인하며, 무조건 전체를 다시 실행하지 않는다.

배포 후 다른 브랜치를 자동 배포하거나 프로젝트 환경을 바꾸면 위 검증 범위에서 벗어난다.
다음 통합 시 이 배포의 UI/체인 경로를 보존하고 새 환경에서 다시 검수한다.
