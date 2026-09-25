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

1. **선택 및 리소스 생성 완료:** 신규 Preview 전용 Redis를 준비했다. 브랜치 전용 비밀 환경변수 연결과 실제 저장소 검증은 아래와 같이 대기 중이다.
2. 전용 namespace와 안정적인 서버 seed, 접근 보호 구성. 기존 seed를 덮어쓰지 않는다. 비밀키는 채팅에 붙이지 않는다.
3. 현재 `HK_ISOLATED_MOCK=0`은 CX뿐 아니라 다른 실연동 경로에도 영향을 준다. 따라서 단순 flag 전환이 아니라 **CX 인증/세션만 허용하고 체인·AI는 계속 차단하는 별도 제한 단계**를 먼저 검토한다.
4. 지원되는 실제 신분증 보유자가 본인 기기에서 동의·인증. 서버는 완료/verified, transaction 일치, 안정적 CI를 확인한다. provider 목록 활성만으로 연령 기준이나 CI 제공을 보장하지 않는다.
5. 취소·만료·재시도·새로고침·중복 완료 및 같은 장소 복귀를 검증한 뒤 CX E2E를 완료 처리한다.

## 후속: 별도 Redis 준비

사용자가 기존 코드 재사용 + 별도 Redis 준비를 승인했다. 기존 인증/사용 이력을 승계하지 않는 신규 CX 검증용 환경이며, Harvey/Production 데이터는 이전하거나 변경하지 않는다.

- 대상 리소스 이름: `ktour-cx-preview-20260925` (**사용자 약관 승인 후 생성 완료**).
- Vercel Marketplace `upstash/upstash-kv`, `free`, `autoUpgrade=false`, `eviction=false`, `prodPack=false`를 명시했다. 제공 지역 중 `hnd1`(도쿄)을 선택했다. CX 호출을 수행하는 앱 서버 `icn1`(서울)과 Redis 저장 지역은 서로 다른 설정이다.
- `--no-connect --no-env-pull`로 Production/전체 Preview 자동 연결 및 비밀값 파일 출력을 막았다. 생성 후 검증용 브랜치 범위로만 서버 변수를 구성할 예정이다.
- 최초 CLI 시도는 `action_required / integration_terms_acceptance_required`로 중단됐고, 이후 사용자가 직접 약관을 승인했다. 승인은 대행하지 않았다.
- 승인 후 리소스 목록에 중복이 없음을 확인하고 동일 무료 설정으로 생성했다. 리소스 생성과 앱 연결·실 Redis 검증 완료는 구분한다.

실연결 전 필수 보호: CX 전용 프로필에서 Redis 누락 시 파일 폴백 금지, URL/token 동일 쌍 검증, Preview 전용 저장 키 및 비샘플 고정 seed, 서버 비밀 설정만 사용. 기존 `HK_ISOLATED_MOCK=0` 하나만 변경해 CX 외 실행을 여는 방식은 사용하지 않는다.

연결 후 사용할 `scripts/hackathon-redis-probe.mjs`를 준비했다. 전용 `ktour:probe:<UUID>` 키에만 120초 TTL을 두며 PING/GET/SET NX/EVAL/조건부 정리를 검사한다. Production·자격증명 인자 전달·URL/token 혼합을 거부하고, 비밀값 없이 결과 개수/boolean만 출력한다. 쓰기 응답 유실 시 정리 완료라고 주장하지 않는다. 실행에는 별도 `HK_REDIS_PROBE_ALLOW_WRITE=1`이 필요하다.

독립 검토로 Redis error/result 혼합 응답과 쓰기 응답 유실 반례를 보강했다. fixture 7/7, 전체 Harvey 단위 88/88, 타입 검사 PASS. 이는 메모리 fixture 결과이며 **실제 Redis 연결/쓰기 검증은 아직 0회**다. 기존 store/service/CX 실행 코드는 이번 준비 작업에서 변경하지 않았다.

### 생성 후 확인 (9/25 16시대 KST)

- 리소스 ID `store_vDZTRyB7NH00O95k`, installation `icfg_sjmu6Oe3iQmsJbfoknCOIEmU`.
- [Redis 대시보드](https://vercel.com/jaewook-9643s-projects/~/stores/integration/store_vDZTRyB7NH00O95k): `Available`, `Owned`, billing plan `free` 확인.
- 실제 반환 metadata: `primaryRegion=hnd1`, `autoUpgrade=false`, `eviction=false`, `prodPack=false`.
- 연결 프로젝트 수 0. `ondo`의 검증 브랜치 전용 env도 조회 시점에 0개다. Production/전체 Preview에 임시로 연결하지 않았다.
- CLI `integration-resource connect -e preview`는 Git 브랜치를 지정하지 못하고 모든 Preview에 적용된다. 따라서 사용하지 않았다. 독립 검토자가 CLI 60.0.1 소스와 공식 문서에서 범위를 교차 확인했다.
- resource GET의 `secrets`는 이름/길이 메타데이터뿐이다. 실제 값 조회 시도는 HTTP 403으로 중단했다. 다른 경로로 권한 제한을 우회하거나 토큰을 재발급하지 않았다. 현재 자동화에서 비밀값 확보가 안 된 상태이며, 403의 세부 원인을 별도 계정 역할 문제로 단정하지 않는다.
- 연결 관리 도구에서도 현재 사용 가능한 대시보드 조작 연결은 확인되지 않았다. 비밀값을 채팅/새 브라우저 서비스로 전달받는 대신 사용자가 Vercel 설정 화면에 직접 입력하도록 요청했다.

다음 사용자 설정: [프로젝트 환경변수](https://vercel.com/jaewook-9643s-projects/ondo/settings/environment-variables)에 `KV_REST_API_URL`, `KV_REST_API_TOKEN` 두 값을 등록한다. 대상은 `Preview` 및 정확한 Git branch `feat/hackathon-readiness-preview-20260925`; 토큰은 Sensitive. Production/Development/모든 Preview는 선택하지 않는다. 값은 채팅에 붙이지 않는다. 이후 root는 값이 아닌 범위·이름만 점검하고, 서버 런타임에서 제한된 검증을 준비한다.

추가 메모: CLI가 자동 설치한 vendor 참고 스킬 파일들은 앱 변경에 섞이지 않도록 `/tmp/ktour-upstash-cli-assets.rreW3V`에 옮겨 보관했다. 실제 app store의 다중 프로세스 canary 초안은 live cleanup/실제 backend 검증이 더 필요해 승인하지 않았고 `/tmp/ktour-store-canary-draft.M9G6nu`에 보관했다. 이를 Redis live 성공 증거로 사용하지 않는다. 기존 검수된 primitive probe만 유지한다.
