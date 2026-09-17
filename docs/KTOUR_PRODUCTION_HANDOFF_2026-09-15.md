# K-Tour ID · 현재 운영 배포와 개발자 인계

갱신일: 2026-09-16. 상태: **Ready — 지도 안내·타이포·모바일 하단 확장 운영 배포**. 앱 source는 `5ba76a2`이며 실제 환경별 검사 결과는 [지도 UI 보정 기록](./KTOUR_MAP_LAYOUT_FIX_2026-09-16.md)을 따른다. 아래 과거 배포의 증거는 별도로 보존한다.

**로컬 후속 작업은 위 배포와 별개다.** `local/journey-pass-20260916`(`9902d7e` 기반의 미커밋 변경)에서 Journey–Pass 통합과 모바일 개선을 진행했다. 이 작업과 문서는 아직 commit/push/배포하지 않았으며, main/Harvey에 반영됐다는 뜻이 아니다. [로컬 변경·검수 기록](./KTOUR_MOBILE_REFINEMENT_LOCAL_2026-09-16.md)을 먼저 확인한다. 아래 Ready·원격 동기화 표시는 각 당시 배포 기록이며 이번 작업에서 원격 상태를 재확인하지 않았다.

## 최신 앱·개발 시작점 — 5ba76a2

- 대표 앱: [ktour-id.vercel.app](https://ktour-id.vercel.app). `dpl_53qYCXhsb89oAYatA83QLc7Lb86t`, [고유 Production](https://ondo-hadlaqqrp-jaewook-9643s-projects.vercel.app), Ready·대표 주소 alias와 실제 page `86674988c0801dda` 확인.
- 앱 source: `5ba76a2b701f740969782207791ed7814b5f24bd`. main/`handoff/harvey-20260914`를 같은 소스로 atomic fast-forward했다. 이후 결과 문서 커밋은 앱 소스와 구분한다.
- 지도 안내의 대비·겹침, 첫 화면 로고/설명 간격, 모바일 하단 지도 확장을 보정했다. 내비게이션과 지도 조작·목록 영역은 분리한다. 기존 공개 가이드·선택적 저장과 외부 네 기술의 개발 계약은 변경하지 않았다.
- [선행 Preview](https://ondo-5yqz8wntm-jaewook-9643s-projects.vercel.app), `dpl_quqBe3Q4KTqH4H2UNUWDUKJL9qsf`. 로컬/Preview/운영의 검수 수와 한계는 [보정 기록](./KTOUR_MAP_LAYOUT_FIX_2026-09-16.md)에 환경별로 구분한다.

## 이전 가이드 앱·개발 시작점 — 9980472

- 대표 앱: [ktour-id.vercel.app](https://ktour-id.vercel.app). `dpl_EPhXrY7zDf5pgPk5CBUUWXiPYwPy`, [고유 Production](https://ondo-dxilo68xo-jaewook-9643s-projects.vercel.app), Ready·대표 주소 alias 확인.
- 앱 source: `99804728133245baef441c47df1a2643c3e28690`. main/`handoff/harvey-20260914`를 같은 소스로 atomic fast-forward했다. 이후 문서 전용 결과 커밋도 같은 브랜치로 전달하며 실제 앱 검수 source와 구분한다.
- 가이드는 바로 읽는다. ‘내 패스에 담기’ 선택 때만 Person·패스·목적별 VP·저장 승인을 요청한다. 담은 가이드는 여행 패스에서 다시 읽는다. 이전 v1 열람 동의는 새 v2 저장 권한으로 재사용하지 않는다.
- [선행 Preview](https://ondo-kybuyzuj1-jaewook-9643s-projects.vercel.app), `dpl_2KWK9RPXy9ZpKXSHun1LeCpejDwN`, 같은 Git source. 로컬/Preview/운영 실행 수와 한계는 D04 기록에서 구분한다.
- [짧은 인계](./HARVEY_HACKATHON_HANDOFF_2026-09-14.md)와 [화면·저장 계약](./EXPERIENCE_MOCK_HANDOFF_2026-09-15.md)을 함께 읽는다. 실제 CX/OpenDID/Sui/OmniOne·AI·금융·예약은 미연동이고, 브라우저 저장 이력은 서명 VC가 아니다.

## 이전 UX 앱·개발 시작점 — 8fcbeb1

- 대표 앱: [ktour-id.vercel.app](https://ktour-id.vercel.app). `dpl_8EPi7GPt4yP5pzdVYBZTQkLpGFPK`, [고유 Production](https://ondo-ese4000rf-jaewook-9643s-projects.vercel.app), Ready·대표 주소 alias 확인.
- 앱 source: `8fcbeb1c0dfaa0c4df99ffb197f9490aea260539`. main/Harvey 원격을 같은 source로 atomic fast-forward했다. 강제 push나 다른 개발자의 변경 덮어쓰기는 없었다.
- 선행 [Git Preview](https://ondo-cmk176e1e-jaewook-9643s-projects.vercel.app): `dpl_HijeFmjAMEDC29CRtX3GmTdsPuTb`, 같은 Git source. 환경별 실행 근거는 최신 라운드에 분리한다.
- 매장 결제 CTA/복귀 focus, 주문 충전의 장소·부족액, Person 체험의 holder 준비1회 단축, 온도 label/변경 강조, 제주 신설오름 실제 음식 사진을 반영했다. guide 공개 정책은 사용자 선택 전 기존대로 유지했다.
- [짧은 인계](./HARVEY_HACKATHON_HANDOFF_2026-09-14.md), [체험 계약](./EXPERIENCE_MOCK_HANDOFF_2026-09-15.md), [전체 명세](./DEPLOYMENT_SPEC.md)는 같은 브랜치에서 읽는다. 이후 문서 전용 커밋은 이 앱 source와 구분하며 최종 HEAD는 GitHub에서 확인한다. 실제 네 기술/AI/금융/예약 연동·실기기 검수는 완료되지 않았다.

## 이전 체험 배포·개발 시작점 — 5712aed

| 항목 | 확인한 값 |
|---|---|
| 대표 앱 | [ktour-id.vercel.app](https://ktour-id.vercel.app) |
| 배포 source | `5712aede4cba3549dc15b1565f1f05257e1c1bd0` · main |
| main / Harvey 원격 HEAD | 앱 검수 기준 `5712aede4cba3549dc15b1565f1f05257e1c1bd0`에서 양쪽 일치 확인. atomic fast-forward, force push 없음 |
| 배포 ID·고유 URL | `dpl_87smepbXSj8DRwm8nveLJ9SuQRbS` · [검수 기준 Production](https://ondo-ixgksyq9e-jaewook-9643s-projects.vercel.app) · Ready, 대표 주소 alias 확인. Git 로그 main/5712aed |
| 선행 Git Preview | `dpl_8anxp7yz8pgNXMnGmdJk3nMwDMGb` · [검수 Preview](https://ondo-8egc96uut-jaewook-9643s-projects.vercel.app), 같은 앱 소스 |
| 개발자 시작 | [Harvey 브랜치](https://github.com/woogieboogie-jl/k-tour-id/tree/handoff/harvey-20260914) · [짧은 인계](./HARVEY_HACKATHON_HANDOFF_2026-09-14.md) · [체험의 실제 연결점](./EXPERIENCE_MOCK_HANDOFF_2026-09-15.md) |

이번에는 한국 골목·음식 공유 이미지와 **로바 상세 → Person 확인·패스·목적별 제시 → 범위 승인 → 디지털 가이드 → 같은 장소**를 추가했다. 실제 CX/OpenDID/AI/Sui/OmniOne Chain은 미연동이며, 단축 발급은 Person 외의 연령·체류·결제·혜택 권한을 만들지 않는다. Sumsub 실험은 여전히 별도다.

이후 결과 문서·대표 캡처·테스트 하네스만 바꾼 후속 커밋은 main/Harvey에 함께 반영한다. 검수 source를 새 문서 커밋으로 바꾸거나 같은 검사를 반복 합산하지 않는다. 최종 HEAD는 GitHub에서 확인하며, 현재 기록은 위 고정 source의 실제 배포와 검수를 보존한다.

## 직전 UX 배포·개발 시작점 — 505e475

다음은 신규 체험 추가 전의 확인 기록이다. 당시 Ready와 해당 SHA의 검수이며, 새 릴리스의 PASS나 배포 ID로 합산하지 않는다.

| 항목 | 확인한 값 |
|---|---|
| 대표 앱 | [ktour-id.vercel.app](https://ktour-id.vercel.app) |
| 배포 source | `505e4757e202a96492044f85e0a5b2bb2e75ff67` · main |
| main / Harvey 원격 HEAD | 앱 검수 기준 `505e475`로 양쪽 동일 확인 · 정상 fast-forward, 강제 push 없음 |
| 배포 ID·고유 URL | `dpl_2hKcfi3WSy2oAYYVVQZ1yC7kWzCZ` · [고유 Production](https://ondo-4vw2z449i-jaewook-9643s-projects.vercel.app) · Ready. 빌드 로그에서 `Branch: main, Commit: 505e475` 확인 |
| 선행 Git Preview | `dpl_9XhfXc2EtnAY1Swkwe6ovPnPKvS3` · [검수 Preview](https://ondo-98b34nyyl-jaewook-9643s-projects.vercel.app) · 같은 앱 소스 |
| 개발자 시작 | [Harvey 브랜치](https://github.com/woogieboogie-jl/k-tour-id/tree/handoff/harvey-20260914) · [짧은 인계서](./HARVEY_HACKATHON_HANDOFF_2026-09-14.md) |
| 변경·검수·보류 | [UX 릴리스](./ux-refinement/2026-09-15/RELEASE.md) · [전체 여정 지도와 합의](./ux-refinement/2026-09-15/README.md) |

이 묶음에서 순수 목업의 매장 액션, 충전/주문 복귀, 공통 환불, 주문별 내역, 사진 콘텐츠를 정리했다. 이후 UX-08은 별도 `5712aed`에서 구현·검수·운영 배포했다. [새 체험 연결 계약](./EXPERIENCE_MOCK_HANDOFF_2026-09-15.md)과 신규 릴리스의 결과를 따르며, 이 과거 금융 목업의 PASS를 새 체험의 완료 증거로 쓰지 않는다. 실제 CX/OpenDID/OmniOne Chain/Sui 실연동은 개발 대상이고 Sumsub Sandbox는 아래 별도 경로를 유지한다.

당시 검수 기준 SHA와 결과 기록·테스트 하네스만 바꾼 후속 커밋을 구분한다. 그 후속 기록은 앱 배포 입력이 `505e475`와 같은 범위에만 적용하며, 새로운 체험/OG 코드는 같은 입력이라고 간주하지 않는다. 배포별 실제 실행 수와 실패 재검사 이력은 해당 릴리스에 기록한다.

## 이전 브랜드 배포 기록 · 4cb1964

아래는 이전 배포 당시의 경로·검수 증거다. 현재 배포 결과나 새 UX의 PASS로 합산하지 않는다. 당시 상태: Ready — 대표 주소 운영 배포·검수 및 main/Harvey 동기화 확인 완료.

### 당시 공유 경로

| 항목 | 기준 |
|---|---|
| 대표 앱 | [ktour-id.vercel.app](https://ktour-id.vercel.app) |
| 기준 소스 | [main](https://github.com/woogieboogie-jl/k-tour-id/tree/main) |
| Harvey 시작 브랜치 | [handoff/harvey-20260914](https://github.com/woogieboogie-jl/k-tour-id/tree/handoff/harvey-20260914) · 기존 이름 유지 |
| 짧은 개발 인계서 | [해커톤 연동 개발 요약](./HARVEY_HACKATHON_HANDOFF_2026-09-14.md) |
| 실행·개발 작업표 | [README](../README.md#run-the-handoff) · [개발자 시작 문서](./DEVELOPER_START_HERE.md) |
| 배포 source | 앱 코드·배포 검수 기준 `4cb1964a0ed6d071601c69cfae5b276fa8cd9e83` · Git source / ref `main` |
| 배포 ID·고유 URL | `dpl_7t3mdwdw744frAaiqG6muF3F2ywZ` · [검수 기준 Production](https://ondo-9nq835j26-jaewook-9643s-projects.vercel.app), Ready |
| main / Harvey 원격 HEAD | 동기화 검수 기준 `4cb1964a0ed6d071601c69cfae5b276fa8cd9e83`로 양쪽 일치 확인. 후속 문서 전용 커밋도 두 브랜치에 동일 반영 |

앱은 `k-tour-id-app/`에 있다. `main`과 Harvey 브랜치를 **동일한 앱·문서 소스로 동기화**했으며 기존 Harvey 브랜치 이름을 유지했다. 위 SHA에서 원격 양쪽 일치를 확인했고 로컬 Harvey도 fast-forward했다. 이후 결과 기록용 문서 전용 커밋은 두 브랜치에 동일 반영하며, 앱 코드를 바꾸거나 과거 실행 증거의 source를 새 문서 커밋으로 바꾸지 않는다. 이 문서 안에 매번 자기 자신의 최종 HEAD를 적어 반복 수정하지 않고 **검수 기준과 후속 문서 반영을 구분**한다.

### 당시 확인된 배포 구성

- 대표 주소 `ktour-id.vercel.app`은 프로젝트 도메인으로 등록해 Production을 자동으로 따른다. 위 Git 기반 Ready 배포와 대표 주소의 실제 응답을 확인했다. 기존 `ondo-tau.vercel.app`·`ondo-k-tour-id.vercel.app`도 같은 Production에 자동 연결됨을 확인했다.
- 운영 Vercel 프로젝트 `ondo`의 Git 연결을 `woogieboogie-jl/k-tour-id`, Production 브랜치를 `main`으로 맞췄다.
- 구 `k-tour-id` Vercel 프로젝트는 Git 연결만 해제해 중복 자동 배포를 막았다. 프로젝트·기존 배포·키는 삭제하지 않았다.
- Production의 `NEXT_PUBLIC_SITE_URL`과 `NEXT_PUBLIC_ONDO_B_ORIGIN`은 대표 URL로 설정했다. 기존 환경 키 이름은 유지하며 Preview 환경·KYC secret은 변경하지 않았다.
- GitHub About·homepage는 K-Tour ID 이름과 대표 URL로 정리했다. 저장소·기존 인계 브랜치 이름은 유지했다.

### 유지하는 개발자 연동 범위

현재 앱은 **순수 목업**이다. CX·OpenDID·OmniOne Chain·Sui는 모두 팀 필수이며 실제 연동은 개발 대상이다. 현재 v2 기준은 장소 1곳의 **무료 골목 가이드 읽기 + 선택적 패스 컬렉션 저장**이다. 과거 문서의 ‘비금전 체험 혜택 사용’은 아래 저장 처리이며 금전 혜택이나 매장 제공 의무가 아니다.

```text
지도 → 장소 → 골목 가이드 무료 읽기 → [선택] 내 패스에 담기
 → CX 신원 확인 → OpenDID 패스 발급·제시
 → AI의 허용된 제안 → 사용자 승인 → zkLogin/PTB 제한 위임 → Sui Move 실행
 → 서버의 실제 결과·최종 자격 확인 → 컬렉션에 1회 저장 → OmniOne 기록 → 같은 장소 복귀
```

실제 충전·결제·환불·예약·bridge·여권/체류증 운영 연동은 이번 최소 범위가 아니다. 사용자의 승인, 실패·취소·만료·중복·복귀 처리는 실제 SDK/API에 연결해야 한다. Sui 권한 소비와 DB 저장·OmniOne 기록은 각각 확인한다. 무료 읽기는 인증·저장 성공에 의존하지 않는다. 상세 계약과 Sui 제출 조건은 [Sui 추가 명세](./HACKATHON_SUI_REQUIRED_ADDENDUM_2026-09-14.md)와 [1주 명세](./HACKATHON_ONE_WEEK_SPEC_2026-09-14.md), 현재 v2 UX는 [가이드 연결 계약](./EXPERIENCE_MOCK_HANDOFF_2026-09-15.md)을 따른다.

### 별도 Sandbox와 과거 기록

[Sumsub Preview](https://ondo-hinsi4hdz-jaewook-9643s-projects.vercel.app)는 별도 [`feat/sumsub-sandbox-onboarding-20260914`](https://github.com/woogieboogie-jl/k-tour-id/tree/feat/sumsub-sandbox-onboarding-20260914) 실험이다. 이 순수 목업 릴리스에는 Sumsub 코드·API·설정을 포함하지 않는다. 실제 WebSDK/API 테스트는 운영 KYC, 실제 얼굴/liveness·전체 촬영/제출 완료 또는 DID 패스 발급 증거가 아니다. [별도 인계 문서](https://github.com/woogieboogie-jl/k-tour-id/blob/feat/sumsub-sandbox-onboarding-20260914/docs/SUMSUB_SANDBOX_HANDOFF_2026-09-14.md)의 검수 한계를 유지한다.

원 인계는 [snapshot `9d4aec9`](https://github.com/woogieboogie-jl/k-tour-id/tree/9d4aec9)로 고정해 보존한다. `cc3d7c3`의 [9/14 공유 이미지 릴리스](./BRAND_SHARE_REFRESH_2026-09-14.md), `0ddc9e1`의 [브랜드 배포 기록](./GITHUB_BRAND_CLEANUP_2026-09-15.md)은 당시 source·URL·검수 증거다. 해당 기록의 PASS를 새 대표 주소나 새 배포에서 재실행한 결과로 합산하지 않는다.

### 당시 검수 결과

- **로컬 앱 코드 기준:** 전체 계약 **847/847** 통과(14.8초), production build·artifact scan 통과.
- **운영 대표 주소 브라우저:** 모바일·데스크톱 브랜드 **8/8** 통과(21.4초, workers 1, retries 0), 모바일 EN/KO/JA fallback **4/4** 통과(39.3초). 후자에서 점검한 24개 화면은 4개 테스트의 범위이며 별도 테스트 수로 추가하지 않는다. KYC 요청·브라우저 오류 각각 0회.
- **운영 대표 주소 HTTP:** 공개 27개·차단 41개·build asset 19개, root `200`·legacy redirect `308`·discovery 7개 검사 통과. Sumsub session/status 두 API는 `404`. canonical·OG URL 및 Twitter 공유 이미지의 origin/path가 대표 주소 기준임을 확인했다.
- **배포 전 Git Preview:** 같은 앱 source `4cb1964`의 [검수 Preview](https://ondo-7p0s0az4l-jaewook-9643s-projects.vercel.app), `dpl_BnMza5U6P2azwtJeS5JzHZ27kSxA`에서 HTTP 공개 27개·차단 41개와 모바일 8/8(43.8초) 통과. 이 결과는 운영 검사 수에 합산하지 않는다.
- **최종 문서:** 인계 정합성 계약 9/9 통과(454ms), 문서 11개의 로컬 링크 224개 확인, `git diff --check` 통과. 문서 정합성 검사이며 추가 앱 여정 검사로 합산하지 않는다.

이 검수는 목업·브랜딩·지정 화면과 배포 경계 확인이다. CX/OpenDID/OmniOne Chain/Sui 실제 연동, 실자금 이동·예약 확정, 실제 iPhone Safari/Android 기기 검수나 Sumsub 실제 얼굴/liveness·전체 제출 완료를 뜻하지 않는다.

### 당시 공개·인계 확인

- [x] 실제 배포 source·Ready·고유 URL·대표 주소 응답 확인.
- [x] 검수 기준 `4cb1964`에서 main과 Harvey 원격 HEAD 및 로컬 Harvey fast-forward 확인.
- [x] 대표 주소의 canonical·공유 이미지·모바일/데스크톱 지정 화면 검수.
- [x] 순수 목업 산출물의 Sumsub SDK·서버 경로 제외 및 API `404` 확인; 실제 자격·결제·예약 연동 미완료 경계 유지.
- [x] 최종 문서 계약·링크 검사와 확인한 테스트 범위 기록; 미검수 항목은 미검수로 유지.
- [x] 완료 사실에 맞춰 README·짧은 인계서의 대기 표시 갱신.
