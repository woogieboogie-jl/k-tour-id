# K-Tour ID 공개 UX 배포 — 2026-09-25

## 배포 범위

- 공개 주소: https://ktour-id.vercel.app
- GitHub: `woogieboogie-jl/k-tour-id`, Production 자동 배포 브랜치 `main`.
- Vercel: 기존 `jaewook-9643s-projects / ondo`. CLI 계정을 바꾸거나 새 프로젝트를 만들지 않고 GitHub 연결을 사용한다.
- 검수한 앱 소스: `3c776ea8e116c01f414a3ce3ded2926baaf328b7`.
- 포함: 기존 모바일 UX/패스·지갑 개선, 콘텐츠→지도·이야기 카드, 분위기 스펙트럼/검색·목록 연결, A 헤더, 일반 페이지 제목·여백 통일.

**공개 UI와 실제 연동은 구분한다.** 기존 `vercel.json`의 standalone 설정을 유지한다. Harvey 코드는 같은 저장소 이력에 보존되지만, 이 공개 패키지에는 해커톤 API·OAuth callback·체인 실행 기능이 포함되지 않는다. `vercel.hackathon.json` full-stack 프로필과 별도 `ktourid.vercel.app` 환경/키는 변경하지 않는다. `/api/hackathon/v1/config`의 404는 이 배포 경계에 맞는 결과이며 연동 장애 해결이나 연동 완료의 증거가 아니다.

## Preview 검수

- Preview: https://ondo-raub6vacb-jaewook-9643s-projects.vercel.app
- GitHub deployment: `6644974728`, Preview `success`.
- Vercel deployment: `HKpJjaFWp6rqx3k6HZ2Yt7B65CMN`.
- 로컬 공개 패키지 빌드·client artifact scan 통과. 개발용 Lab·QA 실패 주입 제어는 공개 패키지에서 제외된다.
- 전체 contract 최종 `960/960` 통과. 문서 길이 제한과 오래된 After19 focus 표현 검사를 정정한 후 재실행했으며 앱 동작을 검수 통과용으로 바꾸지 않았다.
- Preview HTTP: root 200, 공개 이미지 30개, build asset 20개, 차단 경로 41개, `/ondo-b` 308 및 허용 discovery query 10개 검사 통과. HTTP probe도 추가된 collection 관련 query 3개를 검사하도록 갱신했다.
- 공개 모바일 기본 시나리오 7개(KO/EN/JA × 320/390px 제목·지도 헤더 6개 + JA dark 1개) 통과. 별도 JA discovery→3곳 추천→목록→검색어 유지·재열기→지갑→지도 복귀도 최종 재실행 1/1 통과(49.2초). **서로 다른 실행의 7+1개이며, 한 번에 8/8 무실패로 실행한 결과는 아니다.**
- 후속 인계 문서 계약 10/10 통과. [해커톤 실연동 점검](./HACKATHON_LIVE_READINESS_2026-09-25.md)을 새로 작성하고 공식 요건/백엔드 증거 독립 리뷰를 반영했다.

추가 공개 상호작용 검사에서 오래된 list selector와 ‘Enter 뒤에도 검색 input이 남는다’는 잘못된 기대를 수정했다. 실제 동작은 검색 패널을 접고 query를 유지하므로 재열기와 접근성 label을 검사한다. 앱 코드는 바꾸지 않았다. 또 로컬 머신의 높은 부하에서 WebGL 지도 복귀·선택이 전체 timeout에 걸리거나 지도 로딩 fallback으로 전환된 실행이 있었다. 3x 렌더링/녹화 및 CSS 1x 재실행을 구분하고, 실패를 성공 횟수에 합산하지 않는다. CSS 1x는 실기기/고해상도 성능 검증이 아니다. 마지막 상호작용은 일본어 저장 설정을 가진 재방문자로 시작하며, 실제 Settings 언어 변경은 별도 기본 시나리오에서 검사한다.

로컬 standalone build와 source packaging contract는 같은 생성 폴더를 사용하므로 직렬 실행해야 한다. 최초 병렬 실행의 폴더 재생성 충돌 뒤 빌드를 단독 재실행해 통과했다. 실패한 첫 빌드를 성공 횟수로 계산하지 않는다.

## Production

9/25 같은 앱 소스 `3c776ea8`을 `main`에 fast-forward했다(`9902d7ea → 3c776ea8`). 강제 push, 기존 공개 프로젝트 이전, 별도 Harvey 환경의 덮어쓰기는 하지 않았다. GitHub push와 Production Ready는 별개이며, 배포 상태·운영 HTTP 검사는 아래 후속 관측으로 남긴다. 이후 문서·검수 스크립트 전용 커밋은 앱 소스와 구분한다.

- GitHub Production deployment `6645798841`: `success`.
- Vercel deployment `6NRaiZA2kSPR71MCJq5MNgRwgH47`: 완료. [배포 기록](https://vercel.com/jaewook-9643s-projects/ondo/6NRaiZA2kSPR71MCJq5MNgRwgH47)
- 고정 배포 주소: https://ondo-g3ckfc0r2-jaewook-9643s-projects.vercel.app
- 운영 주소 https://ktour-id.vercel.app HTTP probe 통과: root 200, legacy 308, query 10개, 차단 경로 41개, build asset 20개, 공개 이미지 30개.
- 마지막 TypeScript 검사 통과.
- **Production 모바일 8/8 통과, 6.5분, worker 1, retry/skip 0.** KO/EN/JA × 320/390px에서 My Korea·Tables·Pass·Settings 제목/여백, 지도 헤더·스토리 카드; JA 390px dark; JA 390px 분위기 추천 3곳→목록→검색 유지·재열기→지갑→지도 복귀를 검사했다. 외부 쓰기 요청 및 page error는 0이다.
- 이 최종 실행은 공개 운영 주소, Chromium 모바일 CSS viewport, deviceScaleFactor 1, video/trace off 조건이다. 실 iOS/Safari·고해상도·성능 부하 테스트 완료를 뜻하지 않는다. 초기 Preview의 실패·재시도 기록은 위에 그대로 남긴다.
- 시각 증거는 로컬 `k-tour-id-app/artifacts/qa/public-ux-production`에 보관한다. Git에는 PNG/video/trace를 올리지 않는다.
- 독립 리뷰어가 최종 8개 PNG를 확인했고 주 검토자도 KO 320·JA 320·JA dark 및 interaction 캡처를 직접 확인했다. 이 범위에서 헤더/카드/내비게이션 잘림·겹침의 blocker는 없었다. 검색 결과 0건인 화면의 큰 여백은 개선 여지가 있으나 기능 차단으로 분류하지 않았다.

재현 명령:

```sh
cd k-tour-id-app
ONDO_B_PROBE_BASE_URL=https://ktour-id.vercel.app node scripts/ondo-b-standalone/probe-http.mjs
PLAYWRIGHT_BASE_URL=https://ktour-id.vercel.app pnpm exec playwright test tests/e2e/ktour-public-release-smoke.spec.ts --project=mobile-chromium --workers=1 --trace=off --reporter=list --output=artifacts/qa/public-ux-production
```

이 기록 이후의 문서·검수 스크립트 커밋은 앱 runtime 변경이 없다. 해당 커밋으로 자동 배포가 다시 발생하면 동일 앱 소스임을 확인하고 운영 HTTP probe를 재실행한다.

## 다음 단계

사용자와 함께 해커톤 필수/가점 조건별로 **구현 코드 · 배포 설정 · 실제 E2E 증거**를 나눠 검수한다. 부족한 연동은 확인 후 범위를 정한다. 이번 공개 UI 검수를 CX·OpenDID·Sui·OmniOne 실연동 완료 판정으로 사용하지 않는다.
