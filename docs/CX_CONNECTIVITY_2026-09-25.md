# CX 연결 점검 — 2026-09-25

## 범위

사용자의 Vercel 재연결 후 동일 UI/BFF Preview에서 서울 서버 → CX 공개 provider catalogue 통신을 확인하는 단계다. 공개 Production, Harvey의 기존 환경, 실제 인증·서명·체인 실행은 변경하지 않는다.

## 확인한 것

- Vercel CLI 소유 계정·프로젝트 접근 정상: `jaewook-9643s-projects / ondo`.
- Preview/Production 변수 이름은 공개 URL 설정 2개뿐이다. 이 프로젝트에는 durable Redis·서버 seed·체인·AI 설정이 아직 등록되지 않았다. 다른 계정에 해당 자원이 없다는 뜻은 아니다.
- 로컬 무인증 GET `https://cx.raonsecure.co.kr:18543/oacx/api/v1.0/provider/list` → HTTP 200. `comdl`, `coidentitydocument` prod 활성. `comrc`, `coresidence`는 관측된 dev/prod 비활성.
- 실제 모바일 신분증 / CI / QR / token 검증은 수행하지 않았다.
- 진단 경계 fixture 7개 포함 Harvey 단위 테스트 81/81, 타입 검사, Preview 배포 보호 계약 3/3 통과. 별도 검토자가 만료·요청 body 반례 보완 후 승인했다. 실제 원격 build 결과와는 구분한다.

## 원격 결과

**2026-09-25 14:05:23 KST, 실제 icn1 → CX 공개 catalogue GET 성공.**

| 항목 | 관측값 |
| --- | --- |
| Preview | https://ondo-gni2iy43m-jaewook-9643s-projects.vercel.app/hackathon |
| 실행 앱 SHA | `4450d2c0e36f04fa37629adf1b9529f1acb202fb` |
| GitHub / Vercel 배포 | `6654110098` / `dpl_5RH866qg4u745W1FtqDAsSyYhcE5`, success |
| config 및 probe의 실행 지역 | `icn1` |
| upstream HTTP / diagnostic HTTP | `200` / `200` |
| 인증·신원 검증 | `authenticated:false`, `identityVerified:false` |
| 활성 관측 | `comdl`, `coidentitydocument`: prod / v1.5 / available true |
| 비활성 관측 | `comrc`, `coresidence`: dev·prod / v1.5 / available false |
| 응답 캐시·세션 | `cache-control:no-store`, Set-Cookie 없음 |

따라서 이 **공개 조회에 대해서는 Vercel 서울에서 통신 가능**하다. 인증 거래 생성·앱 왕복·result/claims까지 되는지, 모든 egress IP가 허용되는지 또는 IP가 고정됐는지는 아직 증명하지 않았다.

추가 원격 경계 4/4 통과: HEAD 및 query GET은 400, extra suffix GET과 POST는 503. provider 인증/서명/체인 실행은 계속 차단돼 있다. 진단 endpoint는 15:00 KST부터 자체 비활성화된다.

기존 원격 API 회귀 22/22와 모바일 Chromium 3/3도 통과했다. 준비 안내→같은 장소·포커스 복원, 지도 ready, 5탭, fake callback URL 정리·토큰 무저장·지도 복귀, Lab 404를 확인했다. 실제 신분증/기기 인증 E2E가 아니다.

최초 브라우저 실행은 Vercel toolbar가 추가한 sessionStorage 항목 때문에 실패했다. QA의 `ondo-*` 키만 비교하는 완화는 최종 증거로 채택하지 않았다. 주 검토자가 관측된 `__vtkb-hide-key`, `vc-dt-src`, `vc-mfe-session-cleared` 세 키만 원격 비교에서 제외하고, 그 밖의 **전체 sessionStorage 동일성 + 제외한 키를 포함한 모든 session/localStorage에서 fake JWT 미저장**을 검사하도록 보정했다. 이 엄격한 최종 실행은 3/3 PASS(7.4초)이며 앱 코드는 변경하지 않았다.

최종 산출물: `k-tour-id-app/artifacts/qa/preview-cx-readiness-remote-exact/`. 최초 실패 trace는 `preview-cx-readiness-remote/`에 보존한다. 검증 앱 SHA와 후속 test/docs 커밋 SHA는 구분한다.

주 검토자가 최종 준비 안내/지도 복귀 캡처를 직접 확인했다. 별도 검토자도 정확한 호스팅 키 예외와 나머지 전체 session 비교를 승인했다. 이 검사는 callback 후 상태를 확인하며, localStorage의 JWT 이외 모든 변경이나 저장 후 즉시 삭제하는 순간까지 검증했다고 주장하지 않는다.

Production/main은 `58d284b9c6f51e8563765df7b7a3c13b4d575bdd`, GitHub Production 배포 `6645990285` 그대로다. 공개 앱의 `/api/hackathon/v1/config`는 여전히 404(UI-only); 이 진단을 공개 앱 실연동 완료로 설명하지 않는다.

## 남은 선행 조건

1. Harvey의 승인된 서버 환경을 인계받을지, Preview 전용 durable Redis를 새로 준비할지 결정. 새 외부 자원·비용은 선택 확인 전 생성하지 않는다.
2. 전용 namespace와 안정적인 서버 seed, 접근 보호 구성. 기존 seed를 덮어쓰지 않는다. 비밀키는 채팅에 붙이지 않는다.
3. 현재 `HK_ISOLATED_MOCK=0`은 CX뿐 아니라 다른 실연동 경로에도 영향을 준다. 따라서 단순 flag 전환이 아니라 **CX 인증/세션만 허용하고 체인·AI는 계속 차단하는 별도 제한 단계**를 먼저 검토한다.
4. 지원되는 실제 신분증 보유자가 본인 기기에서 동의·인증. 서버는 완료/verified, transaction 일치, 안정적 CI를 확인한다. provider 목록 활성만으로 연령 기준이나 CI 제공을 보장하지 않는다.
5. 취소·만료·재시도·새로고침·중복 완료 및 같은 장소 복귀를 검증한 뒤 CX E2E를 완료 처리한다.
