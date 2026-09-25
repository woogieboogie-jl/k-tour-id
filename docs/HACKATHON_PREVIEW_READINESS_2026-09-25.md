# UI + API 통합 검증 Preview — 2026-09-25

> 9/25 후속 완료: 검증 브랜치 전용 Redis 설정과 서울 서버 실제 primitive smoke 11개를 통과했다. 임시 operator 진단은 경로·토큰·배포까지 제거했고 모든 앱 POST 차단을 복원했다. [최신 Redis 검증 기록](./REDIS_PREVIEW_VERIFICATION_2026-09-25.md)에 범위/결과/종료 증거를 기록한다. 앱 본인인증·서명·체인 차단은 그대로다.

## 목적과 한계

최신 UI와 Harvey의 BFF를 **같은 커밋·같은 origin**에서 배포할 첫 단계다.
이 Preview의 성공은 배포/라우팅 준비 완료이지 **CX 실인증 완료가 아니다**.
기존 Production `https://ktour-id.vercel.app`과 main은 변경하지 않는다.

- 작업 브랜치: `feat/hackathon-readiness-preview-20260925`
- 기준 main: `58d284b9c6f51e8563765df7b7a3c13b4d575bdd`
- `vercel.json`: 이 브랜치에서만 Next full-stack `.next` / `icn1`.
- `vercel.public-ui.json`: 기존 UI-only 설정의 보존본. 파일 존재만으로 활성화되지 않는다.
- 빌드 스크립트는 Production, 다른 원격 브랜치/저장소/provider, 불완전한 원격 메타데이터를 거절한다.
- **이 Preview 프로필을 main에 그대로 병합/승격하지 않는다.** 실연동용 프로필은 환경 접근·보호·저장소 확인 후 별도로 전환한다.

## 안전 경계

- 빌드에 provider/체인/AI/Redis 비밀키를 전달하지 않는다.
- 빌드 시 고정한 `NEXT_PUBLIC_HK_PREVIEW_READ_ONLY=1`로 서버·브라우저를 읽기 전용으로 고정한다.
- API에서는 정확한 `GET/HEAD /api/hackathon/v1/config`와 정적 장소 조회를 허용한다. 후속 CX 통신 점검은 아래의 한시적 public catalogue GET 예외만 사용한다.
- `/me`, 장소별 entitlement, zkLogin params도 세션/외부 조회 가능성이 있으므로 차단한다.
- 모든 hackathon POST와 기존 `/api/ask`, `/api/chat`을 provider·세션·본문 처리 전에 503으로 차단한다.
- 실제 여정 컴포넌트 대신 준비상태 안내를 표시한다. API 연결 확인 뒤 같은 장소로 돌아간다.
- callback은 query/fragment만 지우며 JWT·서명키·승인을 저장/복원하지 않는다.
- 로컬용 Lab은 원격 Preview에서 not-found 경계로 차단한다. 헤더 Lab은 HTTP 404이고, 중첩 discovery Lab은 Vercel streaming 응답에서 HTTP 200 + 404 fallback일 수 있다. 이 경우에도 Lab UI는 렌더링되지 않아야 한다.
- 지도 타일/폰트 같은 수동 조회는 남는다. “모든 외부 네트워크 차단”을 주장하지 않는다.
- Redis 및 파일 세션을 사용하지 않으므로, 이 단계에서 durable storage를 검증했다고 할 수 없다.

## 현재 확인한 검증

- 타입 검사 PASS.
- full-stack readiness production build PASS.
- 기존 전체 계약 963/963 PASS (새 프로필 계약 3개 포함).
- Harvey 관련 단위 테스트 74/74 PASS (새 readonly 검사 5개 포함).
- 빌드 후 runtime의 readonly=0, isolated=0 및 가짜 live 설정으로 실행해도 경계 유지.
- 해당 산출물 HTTP 검사 22/22 PASS: config GET/HEAD, 정적 장소 조회, 변경 요청 차단, 세션 쿠키 미생성, Lab 차단, callback/entry route.
- 독립 소스 리뷰에서 실행 경계 blocker 없음. 리뷰로 빌드 타깃 검증과 API route inventory 계약 보강.
- 모바일 Chromium 브라우저 3/3 PASS: 준비상태 → 같은 장소/포커스 복원 → 로딩 완료 지도, 5탭, 형식·state가 맞는 가짜 OAuth callback의 무저장·URL 정리·지도 복귀, Lab 404.
- 초기 브라우저 검수에서 테스트 harness의 modal close/callback 이동 가정을 수정했다. 최초 지도 캡처는 loading 상태여서 이를 완료 증거로 쓰지 않고 ready 대기 후 재검수했다. 최종 실행은 worker 1, DPR 1, video off; 실제 iOS/Safari 검증이 아니다.
- 독립 HTTP probe 22개 + 경로/메서드/헤더 변형 13개 통과. 원격 probe는 GitHub Preview 배포 ID·정확한 URL·커밋을 확인하도록 추가 제한했다.

## 원격 배포 기록

- 검증한 앱 SHA: `4dd58618435a9632a2f3e27677db4fdff1b1fbed`.
- GitHub Preview deployment: `6652830204`, success.
- Vercel deployment: `H56ydh8sFLmYowtA8QdQKXRQnmTe`.
- [검증한 Preview](https://ondo-mbirwhni1-jaewook-9643s-projects.vercel.app/hackathon).
- 실제 config 응답: 동일 SHA, `region=icn1`, `previewReadOnly=true`, `isolatedMock=true`, `chainExecutionEnabled=false`.
- 원격 HTTP 22/22 PASS. 최초 probe는 중첩 discovery Lab의 streaming 404를 단순 status=404로 가정하여 실패했다. 응답의 404 fallback·not-found 문구·Lab UI 부재를 함께 검사하도록 probe만 보정했다. 앱 실행 코드는 변경하지 않았다.
- 원격 모바일 Chromium 3/3 PASS: 준비 안내/같은 장소와 포커스 복원, 지도 ready, 5탭, fake callback 무저장/복귀, 헤더 Lab 404.
- 원격 브라우저에는 Vercel의 플랫폼 toolbar/auth 요청이 추가된다. `POST https://vercel.live/login/validate`는 차단하고 별도로 기록한다. 같은 origin의 `GET /_next-live/feedback/feedback.js`·`feedback.html`만 추가 허용한다. query는 기록하지 않으며, 이를 포함해 “전체 네트워크 요청 0”이라고 보고하지 않는다. 이 예외를 exact origin·path·method로 좁힌 최종 실행도 3/3 PASS.
- 원격 최종 캡처: `k-tour-id-app/artifacts/qa/preview-readiness-remote-final5/`. 초기·최종 캡처를 구분해 보존했다.
- 재확인한 main/Production은 여전히 `58d284b9c6f51e8563765df7b7a3c13b4d575bdd` / GitHub deployment `6645990285`.
- 위 결과는 이 immutable Preview의 증거다. 이후 검수 스크립트·문서 커밋과 실행 앱 SHA를 혼동하지 않는다.

## 실제 CX를 이 UI에서 검증하기 위한 다음 단계

1. **완료:** 현재 앱 소유 프로젝트 `jaewook-9643s-projects / ondo`에 환경설정 접근 확보.
2. 접근 보호된 실연동 Preview에 전용 durable Redis·서명 seed·CX 설정을 서버 변수로 구성. 기존 환경변수 전체 복제 금지.
3. 해당 서버에서 CX provider 통신 및 지원 provider를 확인. `icn1`은 실행 지역 지정일 뿐 국내 IP 허용을 보장하지 않는다.
4. readonly 프로필을 의도적으로 해제한 새 빌드에서 CX만 활성화. OpenDID native 및 체인 검증 상태는 별도로 표시.
5. 지원되는 실제 모바일 신분증 보유자가 직접 동의/앱 인증.
6. 서버가 verified=true, 완료 상태, 요청 txId/cxId 일치, 안정적인 CI를 확인하고 원래 장소로 복귀.
7. 취소·만료·거절·새로고침·중복 완료를 검증. 신분증/CI/JWT/비밀키 원문은 보고서·로그·체인에 기록하지 않는다.

9/25 사용자 재연결 뒤 CLI `jaewook-9643`으로 소유 프로젝트 접근을 확인했다. Preview/Production 환경변수 **목록만** 확인했으며 양쪽 모두 `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_ONDO_B_ORIGIN`만 등록돼 있다. 이 브랜치 전용 변수는 없다. 비밀 값은 출력하거나 pull하지 않았다. Harvey의 별도 `ktourid.vercel.app` 프로젝트는 이 scope에서 조회되지 않았다.

새 저장소 생성/비용 발생 또는 Harvey 환경 인계는 별도 선택이 필요하다. Vercel 접근 해결을 실제 CX 인증 완료로 보고하지 않는다.

## 후속: 서울 리전 CX 통신 점검

- 로컬에서 고정 공개 `provider/list`를 무인증 GET해 HTTP 200을 확인했다. `comdl`·`coidentitydocument` prod는 활성, `comrc`·`coresidence`의 관측된 dev/prod는 비활성이다. 실제 holder/claims 지원 여부를 뜻하지 않는다.
- `GET /api/hackathon/v1/readiness/cx`만 이 readonly Preview에 한시적으로 추가한다. `2026-09-25 15:00 KST`부터 자동 404이며, Production/readonly 미설정에서도 404다.
- 고정 upstream URL, 무자격증명, redirect 차단, 15초 제한, 256KB 제한, 허용한 provider 필드만 반환한다. query/body/HEAD/POST를 허용하지 않는다. 인스턴스 내 60초 캐시·동시 요청 합치기를 적용한다(글로벌 rate limit은 아님).
- `/trans`, QR/app 실행, `/result`, token claims, CI 수집, 실제 인증·AI·체인 실행은 하지 않는다. 원격 결과에도 `authenticated:false`, `identityVerified:false`를 명시한다.
- 작성자와 다른 검토자가 고정 URL·경계·만료·필드 제한을 검사했다. 응답 대기 중 만료 및 GET body 선언의 반례를 보완한 뒤 독립 fixture 7개가 통과했다.
- 실제 icn1 관측 결과는 [CX 연결 점검 기록](./CX_CONNECTIVITY_2026-09-25.md)에 기록한다.
- 후속 Preview 앱 `4450d2c0` / GitHub `6654110098`에서 **14:05 KST icn1 → CX 공개 provider 목록 HTTP 200**을 확인했다. 동일 UI/BFF·실행 지역을 대조했으며 인증 거래나 신원 검증을 수행한 것은 아니다.

## 재현

```sh
cd k-tour-id-app
pnpm build:vercel:readiness
node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3141
node scripts/hackathon-readiness-probe.mjs http://127.0.0.1:3141
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3141 pnpm exec playwright test tests/e2e/ktour-readiness-preview.spec.ts --project=mobile-chromium --workers=1
```

원격 probe는 세 번째 인자로 GitHub deployment ID가 필요하다. GitHub가 기록한 성공한 Preview·정확한 URL·커밋을 대조한 후에만 요청하며, config의 동일 커밋/안전 프로필 확인 전 POST를 보내지 않는다. 실행 환경에 로그인된 `gh`가 필요하다.
`hackathon-smoke.mjs`는 서명·거래를 수행할 수 있어 여기서는 사용하지 않는다.
