# UI + API 통합 검증 Preview — 2026-09-25

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
- API에서는 정확한 `GET/HEAD /api/hackathon/v1/config`와 정적 장소 조회만 허용한다.
- `/me`, 장소별 entitlement, zkLogin params도 세션/외부 조회 가능성이 있으므로 차단한다.
- 모든 hackathon POST와 기존 `/api/ask`, `/api/chat`을 provider·세션·본문 처리 전에 503으로 차단한다.
- 실제 여정 컴포넌트 대신 준비상태 안내를 표시한다. API 연결 확인 뒤 같은 장소로 돌아간다.
- callback은 query/fragment만 지우며 JWT·서명키·승인을 저장/복원하지 않는다.
- 로컬용 Lab은 원격 Preview에서 404다.
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
- 원격 배포 검증은 완료 후 아래 기록에 추가한다.

## 실제 CX를 이 UI에서 검증하기 위한 다음 단계

1. 현재 앱 소유 프로젝트 `jaewook-9643s-projects / ondo`에 환경설정 접근 확보.
2. 접근 보호된 실연동 Preview에 전용 durable Redis·서명 seed·CX 설정을 서버 변수로 구성. 기존 환경변수 전체 복제 금지.
3. 해당 서버에서 CX provider 통신 및 지원 provider를 확인. `icn1`은 실행 지역 지정일 뿐 국내 IP 허용을 보장하지 않는다.
4. readonly 프로필을 의도적으로 해제한 새 빌드에서 CX만 활성화. OpenDID native 및 체인 검증 상태는 별도로 표시.
5. 지원되는 실제 모바일 신분증 보유자가 직접 동의/앱 인증.
6. 서버가 verified=true, 완료 상태, 요청 txId/cxId 일치, 안정적인 CI를 확인하고 원래 장소로 복귀.
7. 취소·만료·거절·새로고침·중복 완료를 검증. 신분증/CI/JWT/비밀키 원문은 보고서·로그·체인에 기록하지 않는다.

GitHub 자동 배포 권한은 확인됐다. 현재 CLI 계정은 앱 소유 Vercel scope에 접근하지 못한다.
Vercel 연결 또는 해당 계정의 프로젝트 접근이 필요하며, 비밀키를 채팅으로 보낼 필요는 없다.
이 설정 접근 전에는 “CX 연결 완료”로 보고하지 않는다.

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
