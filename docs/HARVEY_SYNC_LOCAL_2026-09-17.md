# Harvey 연동 코드 · 로컬 통합 검수 (2026-09-17)

## 이번 통합 범위

- 통합 브랜치: `integration/harvey-sync-20260917` (로컬 전용, 미푸시·미배포).
- 가져온 원본: `JSHan94/k-tour-id`, `feat/hackathon-integration-harvey`. 최초 `b151c745d59c9ac8aaeba9892302f371c8e63edb`, 검사 중 추가된 `84254d24db3d7d91a2ce40ec1a2b53a3e3525824`까지 `0a73b5b5`에서 병합했습니다.
- 기존 모바일 UI·Pass 방문 기록 등 90개 파일을 `d55a31f0`에 먼저 보존하고, `aee13d92`에서 Harvey 코드를 병합했습니다. 원래 UI 작업 폴더와 그 미커밋 변경은 건드리지 않았습니다.
- 계약/체인 주소·Move/Solidity 로직은 이번 작업에서 변경하지 않았습니다. 비밀값·기존 `.env`도 가져오지 않았습니다.

**완료된 제품/실연동으로 해석하지 마세요.** 이번 목적은 기존 화면을 보존하면서 Harvey 구현을 가져오고, 외부 호출 없는 연결·회귀 검사를 확보하는 것입니다.

## 연결한 흐름과 변경

지정 장소 → 체험 혜택 → 동의 → 샘플 신원 확인 → 패스 발급·보관 → 직접 패스 제시 → 제안 → 명시 승인 → 실행 → 사용 확정 → 기록 확인 → 같은 장소 복귀.

- 자동 실행 버튼·URL·저장 상태가 동의/서명을 대신하지 않도록 정리했습니다. 패스 발급, 제시, 위임, 실행은 직접 버튼으로 진행합니다. 새로고침은 작업 조회만 재개하며 실행 동의를 복원하지 않습니다.
- 기존 지도·가이드·결제 목업·방문 기록은 유지했습니다. 새 여정은 기능 플래그를 켠 전체 앱에서만 열립니다. 일반 공개 배포는 기존 지도 전용 빌드를 유지합니다.
- 일본어, 모바일 폭·내부 스크롤·44px 터치 영역, 닫기/장소 복귀 포커스, 라이트·다크 표면을 정리했습니다.
- 로컬 격리 모드는 CX를 샘플 결과, OpenDID를 로컬 서명 샘플, AI를 규칙 제안으로 고정하고 Sui·OmniOne·Google 인증·외부 QR·Redis 접근은 차단합니다. 체인 결과를 가짜 성공으로 만들지 않습니다.
- 미구현 OpenDID 제공자 경로는 503으로 차단합니다. 클라이언트가 `__verifierConfirmed`를 보내도 승인하지 않습니다. 실제 holder 발급/보관/제시 수명주기 구현이 필요합니다.
- 최종 사용 이후 동일 요청 재시도의 멱등성과 파일 저장소 실패 롤백을 보강했습니다.
- 추가 커밋 `84254d24`의 화면 간소화도 반영했습니다. 결과 검증과 연결되지 않은 브라우저 CX QR·개발용 결과 버튼·기술 배지는 제거하고, 실제 Google 경로가 설정된 경우 샘플 서명자 선택 버튼을 숨깁니다. 이것은 UI 선택지 정리이며 서버의 실제 zkLogin 서명 검증을 증명하지 않습니다. 샘플 고지·필수 동의 범위와 기존 수동 승인/일본어 개선은 유지합니다. 이 추가 커밋에는 Sui 계약 변경이 없습니다.

## 실행과 검수 경계

새 통합 worktree의 `k-tour-id-app/`에서 실행합니다. Next 개발/프로덕션이 읽는 `.env`·`.env.local`·`.env.development[.local]`·`.env.production[.local]` 파일이 있으면 안전 실행기가 시작을 거부합니다.

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm build:harvey:local
pnpm start:harvey:local
# http://127.0.0.1:3137/hackathon

pnpm test:harvey:unit
pnpm test:contracts --workers=4
pnpm test:harvey:e2e
pnpm test:harvey:bff
```

`dev:harvey:local`도 같은 격리 설정을 사용합니다. 서버는 loopback에만 열리고 매번 새 임시 저장소를 씁니다. 환경 변수는 허용한 OS 값만 전달하며 제공자 키를 상속하지 않습니다. 빌드 표식이 없는 일반 빌드를 `start:harvey:local`로 재사용할 수 없습니다.

| 검사 | 증명하는 범위 |
|---|---|
| 정적 계약 검사 | 기존 UI/샘플 경계, 기능 플래그, 공개 빌드에 제공자 코드 미포함 |
| 백엔드 9개 격리 단위 검사 | 실제 로컬 서명·위조 거부·재시도·롤백·외부 호출 차단. 네트워크 요청 0건 |
| 신규 브라우저 fixture 검사 | 실제 화면의 직접 조작·취소·실패 재시도·복귀·모바일 배치. 모든 연동 API 응답은 가상 fixture |
| 로컬 실제 BFF 브라우저 검사 | 실제 로컬 API의 동의·샘플 신원·서명된 패스 발급/제시·제안 후, Sui 준비 요청을 503으로 차단하고 취소·같은 장소 복귀 |
| 기존 UI 브라우저 회귀 검사 | 보존한 지도/패스/방문/결제 목업의 선택된 여정 |

**로컬 서버 자체는 제안 이후 Sui 준비 단계에서 중단되는 것이 정상입니다.** 끝까지 이어지는 신규 브라우저 fixture의 “사용/기록 확정”은 화면 검사일 뿐이며 실제 API·블록체인 성공 증거가 아닙니다. CX 실기기, OpenDID 실제 holder, zkLogin, 실제 체인 거래·영수증은 이번에 실행하지 않았습니다.

실행 결과는 아래 검수 결과에 기록했습니다.

## 다음 Harvey 동기화에서 확인할 사항

1. **Sui 실행 검증:** `agentRun`·`reconcile`·`redeem`이 동일 작업의 package/campaign/grant/recipient/commitment/event와 연결되어야 합니다. `grantUses=1`만으로 실행 확인을 승격시키는 경로와 `eventOk=false` 상태의 처리를 재검토해야 합니다. Google zkLogin 실제 서명·중단/복귀도 별도 검증 대상입니다.
2. **OpenDID:** 서버 주소 설정만으로 완료되지 않습니다. 실제 holder·Issuer/TAS/Verifier 프로토콜을 연결해야 하며 현재 `opendid` 모드는 미구현으로 차단됩니다.
3. **CX:** 제공자 응답을 실제 기기/서버에서 검증해야 합니다. 서울 region이나 브라우저 QR 표시만으로 해결/검증 완료라고 단정하지 않습니다.
4. **상태 저장/세션:** 파일 손상 시 빈 저장소로 초기화되는 처리, 알 수 없는 쿠키 값 수용, Redis 5초 lock lease, 발급 재시도 응답 shape는 운영 전 추가 보강 대상입니다.
5. **기획 계약 차이:** 기존 가이드 저장은 `save-neighborhood-guide-to-pass` / `ktour-neighborhood-guide-save-v2`, Harvey 체험 혜택은 `redeem_demo_entitlement` / `hk-identity-perk-v1`입니다. 현재는 분리 유지했습니다. 단순 이름 교체로 기존 승인·기록을 가이드 저장으로 취급하지 않습니다. 최종 시연 대상을 맞추고 scope/VC claim/Move commitment/DB 결과/UI 복귀를 함께 정렬해야 합니다.

## 배포 시 주의

- `vercel.json`: 기존 공개 지도 전용 `build:vercel:ondo-b`. 해커톤 제공자/API는 포함하지 않습니다.
- `vercel.hackathon.json`: 별도 전체 앱 프로필. **이번에 Vercel 빌드·배포 검증하지 않았습니다.** 기존 ESM 계약 검사를 보존하기 위해 root `type: module`을 유지하므로 원본의 Vercel 런타임 우회와 다릅니다.
- 전체 앱 활성화에는 빌드 시 `NEXT_PUBLIC_HK_ENABLED=1`과 서버 런타임 `HK_API_ENABLED=1` 둘 다 필요합니다. 격리 검수는 `HK_ISOLATED_MOCK=1`을 유지합니다. 실연동은 별도 승인·설정·검수 후 켭니다.
- `scripts/hackathon-smoke.mjs`는 **실제 체인 거래를 만들 수 있어 이번 검사에 사용하지 않았습니다.** 일반 mock E2E로 오인해 자동 실행하지 마세요.

## 검수 결과

- 최신 `84254d24` 통합 후 전체 앱 production 빌드·TypeScript 검사 통과.
- 정적 계약 검사 **917/917**, 격리 백엔드 단위 검사 **9/9** 통과.
- 최신 빌드의 브라우저 fixture **10/10** 통과(27.1초, 재시도·skip 없음). Google 설정 시 샘플 버튼 숨김도 외부 OAuth 없이 확인했습니다.
- 최신 빌드의 실제 로컬 BFF 브라우저 검사 **1/1** 통과(3.2초). 로컬 패스 서명·제시 후 Sui 준비 요청은 503, 위임 제출·실행·사용 요청은 0건입니다.
- 서버 런타임 API 플래그를 뺀 별도 프로세스에서 GET config와 POST session 모두 **404** 확인. 점검용 프로세스는 종료했습니다.
- 공개 지도용 `build:vercel:ondo-b`와 client artifact scanner 통과. 생성된 공개 앱에는 hackathon API가 없고, 기능 컴포넌트는 inert stub입니다. 운영 배포를 실행했다는 뜻은 아닙니다.
- 보존한 UI의 9개 spec을 mobile Chromium으로 실행: **51 통과 / 3 기존 일본어 기대값 실패 / 10 desktop 전용 건 skip** (7분). 이 넓은 회귀 검사는 `b151c745` 통합+보호 변경 빌드를 사용했습니다. 이후 `84254d24`가 수정한 것은 연동 전용 UI와 CX 샘플 라벨이며 기존 지도/Pass/결제/방문 UI 파일은 바뀌지 않았습니다.
- 일본어 테스트는 통합 전 `d55a31f0`와 비교해 오래된 문구·모바일 메뉴 경로를 현재 UI에 맞췄습니다. 언어 저장 검사를 강화하고, 방문 전 빈 상태/방문 후 정확한 Recent 장소/저장 목록은 별개라는 확인을 유지했습니다. **최신 빌드 재검사 3/3** 통과(16.2초, 재시도·skip 없음). 앱 코드를 옛 테스트에 맞춰 되돌리지 않았습니다.
- 모바일 실행에서 제외된 데스크톱 건을 **최신 빌드에서 10/10** 별도 통과(1.3분, 재시도·skip 없음): EN/KO/JA × 라이트/다크의 1440px Pass, 820/1440px 라이트/다크 시트 모서리.
- 따라서 선택한 기존 UI 시나리오 **64개**와 신규 연동 시나리오 **11개**가 각 위 실행에서 통과했습니다. 단일 실행의 전체 서비스 E2E 75개라는 뜻은 아니며, 처음 실패한 항목과 재검사 범위를 숨기지 않습니다.

기존 UI 검사 파일: `ktour-journey-pass`, `ktour-journey-keepsake-completion`, `ktour-mobile-dialog-position`, `ktour-mobile-footer-alignment`, `ktour-public-guide-visual`, `ktour-sheet-corner-paint`, `ktour-ux-refinement-commerce`, `ondo-b-ja-critical-journey`, `ondo-stablecoin-funding` (`k-tour-id-app/tests/e2e/*.spec.ts`). 전용 연동 결과/스크린샷은 로컬 `artifacts/qa/harvey-integration-fixtures/`에 있습니다.

브라우저 범위는 선택한 Chromium 시나리오입니다. Safari/WebKit·실기기·실제 제공자·실제 체인까지 모두 통과했다고 해석하면 안 됩니다.
