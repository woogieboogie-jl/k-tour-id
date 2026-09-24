# 모바일 전역 UX·시각 검토 · 2026-09-17

## 판정

**현재 앱을 시각 QA 완료 또는 ‘Toss급 완성’으로 표시하면 안 됩니다.** 기능 흐름 통과와 별개로 정보 위계·문구 밀도·공통 sheet 규격에 남은 문제가 있습니다. 사용자가 보낸 장소 상세는 실제로 서로 다른 행동을 동급 카드로 과도하게 노출합니다.

검토 대상은 로컬 `integration/harvey-sync-20260917`의 앱 코드 `60a3c835`, `http://127.0.0.1:3137`입니다. 운영 배포를 검사한 결과가 아닙니다. 이번에는 앱을 수정하거나 배포하지 않았습니다.

## 1. 검토 방법과 범위

세 독립 검토 관점으로 소스와 UX 계약을 대조했습니다.

1. 레이아웃: 헤더·스크롤·viewport·portal·겹친 modal·잘림.
2. 정보 구조: 주 행동·중복 진입·단계적 공개·기능 및 동의 보존.
3. 타이포/간격: 모바일 줄바꿈·글자 크기·버튼 규격·기존 테스트의 사각지대.

브라우저 기준은 EN/dark 390×844, JA/light 320×568, EN/dark 가로 844×390입니다. 기본 시각 순회에서 **46개 화면 상태의 스크린샷과 geometry**를 기록하고, 추가 독립 검토에서 자연 스크롤 후 Pass 팝업과 Settings 중첩 sheet를 검사했습니다. 이는 46개의 독립 사용자 여정 또는 모든 조건부 상태의 통과 수가 아닙니다. 주요 캡처를 직접 시각 검토하고 나머지는 소스·geometry와 대조했습니다.

| 화면군 | 브라우저에서 본 상태 | 경계 |
|---|---|---|
| 장소 상세 | 최초 열기·중간 스크롤·방문 기록 왕복·가이드 왕복, 세 viewport | 첨부한 헤더 잘림은 이 조건에서는 재현되지 않음 |
| 방문 기록 | 상세 진입·닫기/원 장소 복귀 | 모든 stamp 수/보상 상태를 이번에 다시 수행하지 않음 |
| 공개 가이드 | 읽기·내 패스 저장 account gate·복귀 | 저장 완료/실연동은 이번 시각 순회 대상 아님 |
| 결제 | 장소의 결제 검토 화면, 세 viewport | 실제 결제 없음. provider/금융 API 차단 |
| Travel Pass | 첫 화면·준비 상태 열기, 세 viewport | 상태별 카드 전부를 완료로 집계하지 않음 |
| Pass 샘플 선택 | 자연 wheel 330px 후 보이는 설정 버튼을 좌표 클릭 | **추가 잘림 재현.** header/close가 화면 위로 사라짐 |
| 신원 확인 | account, 방법 선택, consent | sample UI만 확인. 실제 신분증 제출 없음 |
| 예약 | 장소·날짜·시간·인원·조건·하단 행동 | 실제 매장 요청 없음 |
| 식사 계획/Table | 계획 상세·목록 | 참여·채팅·신고 전체 분기는 소스 검토 |
| 지갑 | Pass 내 지갑 및 결제수단 선택 | 충전/환불 전체 상태는 소스와 기존 검수 경계 검토 |
| 지도 | 국가/도시 shell, options | 외부 타일을 차단했으므로 지도 영상·heat 아름다움은 판정하지 않음 |
| After19 | 장소에서 진입한 확인 화면 | 실제 연령 인증 없음 |
| 설정/My Korea | 설정·privacy·빈 저장 목록, privacy 내 계정 서비스 중첩 sheet | 삭제 실행 없음. 추가 중첩 sheet는 close hit-test/단일 modal 격리 정상 |
| 해커톤 통합 | 전용 sheet·9단계·동의·완료/오류 구조 소스 및 이전 캡처 | 이번 순회 말미 재진입 1건은 timeout. 시각 통과로 집계하지 않음 |
| 최초 온보딩 | map-first/선호 설정 구조 소스 검토 | fresh-user 모든 화면의 이번 브라우저 완주라고 주장하지 않음 |

Safari/WKWebView 실기기, 브라우저 확대/OS 글자 크기 200%, 키보드 활성 상태, 모든 KO 문구 및 legacy 독립 route는 이번 브라우저 표본 밖입니다. 파일 목록이나 이전 test pass를 이번 시각 검수 완료로 대체하지 않습니다.

## 2. 첨부 화면에 대한 판단

### A. 장소 헤더 잘림 — 해결로 처리하지 않음

사용자 첨부에서는 뒤로·지역명·닫기 상단이 잘립니다. 현재 Chromium에서 최초 열기, 실제 wheel 스크롤, 방문 기록/가이드에서 복귀를 수행했을 때는 header 58px, 버튼 44px이며 고정 영역 안에 있었습니다. article의 `scrollTop`은 0입니다.

따라서 **‘flex-shrink 때문에 생겼다’ 같은 원인을 단정할 근거는 없습니다.** 소스의 header는 이미 `flex: 0 0 58px`입니다. 별도 custom dialog의 hidden overflow 조상, 포커스 복귀, viewport/렌더러 차이를 추가 확인해야 합니다. 첨부를 정상으로 취급하거나 수정 완료라고 하지 않습니다.

근거: `features/ondo/place/canonical-place.module.css:48`, `:49`, `:924`; `features/ondo/place/canonical-place-overlay.tsx:1079`. 아래 경로는 별도 표시가 없으면 `k-tour-id-app/` 기준입니다.

### B. 정보 과밀 — 재현·소스 확인

장소명/지역/주소 → 큰 온도 카드 → 체험 혜택 → 결제·예약 타일 → 가이드 → 스탬프 → 식사 계획 → 19+ → 저장·길찾기 → 방문 전 정보 → After19 → 후기/출처가 누적됩니다.

이는 **글자를 조금 줄여서 해결할 문제가 아닙니다.** 같은 viewport에서 무엇을 먼저 선택해야 하는지가 불명확하고, 보조 설명마다 비슷한 시각적 무게를 갖습니다. EN 결제 타일은 좁은 2열 구조에서 제목·혜택 설명이 여러 줄로 쪼개집니다.

근거: `features/ondo/place/canonical-place-overlay.tsx:1145`; `features/ondo/place/place-service-actions-b.tsx:55`. 캡처 `en-dark-390x844-place-open.png`, `en-dark-390x844-place-scroll.png`.

### C. 추가로 재현된 잘림 — Pass 샘플 선택

EN/dark 390×844에서 `/?review=1` → Pass → wheel 330px → 보이는 `kpass-sample-picker` 버튼 좌표 클릭. 레이아웃이나 scrollTop을 강제로 변경하지 않았습니다.

- modal layer top **−330px**, bottom 514px.
- header는 **−92.67…−27.67px**, 닫기는 **−84.67…−36.67px**로 완전히 화면 밖.
- backdrop도 화면 끝까지 덮지 못해 밑의 지갑 내용이 드러납니다.
- 원인: 스크롤된 Pass 내부에 `SheetB`를 inline mount하고, absolute layer의 위치 계산에서 해당 스크롤 변위를 반영하지 않음.
- 근거: `features/ondo/identity-b/kpass-service-card-b.tsx:53`; `features/ondo/shared/ui/ui.module.css:2`; `features/ondo/shared/ui/use-modal-isolation.ts:173`.
- 권장: 스크롤하지 않는 canvas/modal host에 portal로 소유권을 통일하고 동일 header/body/footer 검사를 적용. 이 샘플 화면 하나의 결함을 모든 sheet의 동일 원인이라고 일반화하지 않습니다.
- 증거: `reviewer-picker-natural-scroll-before.png`, `reviewer-picker-confirmed-clipped.png`.

### D. 추가 가독성 결함 — 신원 확인 안내의 대비

다크 신원 확인의 `Review result · no external service confirmation`는 `#6b3552` / 배경 `#202126`, 계산 대비 **약 1.73:1**입니다. 프로젝트 본문 기준 4.5:1에 미달하며 캡처에서도 읽기 어렵습니다. 중요한 실제/샘플 경계이므로 삭제하지 말고 대비를 충족하는 semantic token으로 수정해야 합니다.

근거: `features/ondo/identity-b/local-check-walkthrough-b.module.css:68`, `:310`; `app/globals.css:129`; `en-dark-390x844-identity-consent.png`.

## 3. 페이지별 수정 목록

| 우선순위 | 페이지/구성 | 반드시 정리할 문제 | 권장 변경 | 보존할 경계 |
|---|---|---|---|---|
| P1 | Pass 샘플 선택 팝업 | **재현됨:** scroll 후 header·닫기가 화면 밖, backdrop도 잘림 | inline scroll container에서 분리된 modal host/portal로 이동 후 좌표 기반 회귀 검사 | 샘플 선택·기존 상태/동의 구분 및 opener 복귀 |
| P1 | 장소 헤더/공통 overlay | 사용자 첨부의 잘림; 화면군마다 별도 shell | 정확한 재현 조건 확보 후 header/body/footer의 scroll 소유권 통일. 텍스트·아이콘 전체의 clip/hit-test 검사 추가 | 뒤로/닫기 구분, 원 장소/scroll/focus 복원 |
| P1 | 장소 상세 | 6개 이상의 동급 행동 블록, 긴 타일 문구 | 장소 정보 → **맥락에 맞는 주 행동 하나** → 짧은 보조 행동 목록 → 방문 전 정보. 온도는 장소 상태에 붙인 compact 요소로 축소 | 기능 삭제 금지. 저장·길찾기는 사용자의 요청대로 보조 |
| P1 | 예약 vs Table | `Book a table`과 `View Table`이 같은 기능처럼 읽힘 | ‘매장 예약 / Reserve a table’과 ‘식사 계획 / Dining plans’처럼 서로 다른 결과를 이름에서 구분 | 예약 요청과 로컬 식사 계획을 같은 상태/권한으로 합치지 않음 |
| P1 | 체험 혜택 vs 가이드 | 구체적 결과 없는 perk 카드와 읽기/저장이 경쟁 | 가이드는 내용 진입, 저장은 선택 행동. v1 체험은 기능을 설명하는 보조 진입으로 구분 | v1 혜택 사용과 v2 저장의 동의·scope·결과 재사용 금지 |
| P1 | 결제 검토 | 금액·혜택 적용·지갑 설정·긴 privacy 문단·동의·체험 진입이 한 화면에 경쟁 | 금액 관계 → 현재 필요한 준비/선택 하나 → 명시적 결제 동의. privacy는 핵심 공유 항목 1–2줄 + 상세 | 금액/수수료/보류/실제 금액 이동 여부·사용자 승인은 숨기지 않음 |
| P1 | 신원 동의/해커톤 sheet | 별도 규격, 작은 copy, 기술/모델 용어, 반복 설명 | 소비자 목적 제목 + 승인 요약 + 승인/거절. 공통 15–17px 본문·52–56px primary. 기술 증거는 상세 | 요청 주체·대상·수신자·공유 항목·목적·횟수·만료·비용·거절 경로는 결정점에 유지. 발급·보관·제시·agent 실행 승인 자동 병합 금지 |
| P1 | 신원 안내 다크 대비 | **1.73:1**의 중요한 안내 문구 | semantic contrast token 적용, 실제 배경 기준 재측정 | 실제 인증이 아니라는 경계는 삭제 금지 |
| P2 | Travel Pass 첫 화면 | guest 장식 카드·빈 스탬프·설정 카드가 커서 실제 내용/지갑이 아래로 밀림 | 빈 상태는 작게, 패스/컬렉션을 중심에. 자격 관리 disclosure 유지 | 방문 기록은 Pass에 통합하되 장소 진입 유지. 결제와 방문 인정 구분 |
| P2 | 지갑 | 충전/장소 탐색의 중복 진입, 설정 상태의 작은 글씨 | 잔액/보류를 하나의 요약, 충전·수단·내역에 각각 한 진입점 | 미확정 거래는 같은 거래 상태 확인이 우선. 권한 한도와 잔액 합산 금지 |
| P2 | 결제수단 선택 | 큰 질문 아래 12px 옵션/설명, 작은 시계에 가용성 의존 | 옵션명을 15px 수준으로, 상태는 짧은 말로, primary 52–56px | radio 자체 크기가 아닌 전체 label의 실제 클릭 영역으로 검사 |
| P2 | 예약 폼 | 큰 상단 여백과 샘플/조건 설명이 반복 | 장소·날짜·시간·인원을 빠르게 읽는 구조. 무료/취소/전송 여부를 짧은 조건 요약으로 통합 | 예약금·취소 조건·실제 매장 전송 여부 보존 |
| P2 | 식사 계획 상세 | 큰 제목/사진과 긴 사실 목록 때문에 행동까지 멀어짐 | 시간·인원·비용·언어를 compact facts로 묶고 현재 참여/상태 행동 가까이 배치 | 장소/시간/비용/음식 계획/좌석/만남 방식·안전/신고·19+ 조건 유지 |
| P2 | 가이드 | navigation 제목과 본문 일반 제목 반복, generic prose 비중 | 장소/동네 중심 제목, 짧은 항목 구조. 읽기 우선 및 저장 footer 유지 | 공개 읽기에 인증 추가 금지 |
| P2 | After19/전역 알림 | 모드 전환·자격 요구·상태 알림이 서로 다른 사건 | 모드 설명과 필요한 자격 요청 분리, 같은 사건 알림은 한 곳에서 표시 | 장소 전체가 19+인 것처럼 만들지 않음 |
| P2 | OAuth 복귀 실패 | 소스에 영어 오류문만 있고 복귀 행동이 없음 | 현 언어의 복구 설명 + 원 작업/장소로 돌아갈 행동 | 실패를 로그인·동의 성공으로 바꾸지 않음. 이번 브라우저 표본 밖 |
| 유지+검증 | 설정/선호 온보딩 | 현재 단순한 행+하위 sheet 구조는 상대적으로 안정적 | 새 카드/필수 단계를 추가하지 말고 공통 타이포/짧은 화면 검수만 적용 | map-first, skip, 선택적 식이 조건 유지 |

## 4. 장소 상세의 정리 방향

```text
[뒤로] 장소명                         [닫기]
사진/이름 · 업태 · 지역 · 작은 온도 상태

[현재 목적에 맞는 주 행동 하나]
다른 이용 방법  ›   (짧은 행, 필요한 때 펼침)

골목 가이드     ›   읽기 자체가 목적
방문 기록       ›   스탬프는 Pass로 연결
방문 전 정보   ›   시간·메뉴·카드·언어

저장 · 길찾기       (보조)
```

주 행동은 컴포넌트 렌더 순서나 `commerce` 존재만으로 무조건 결제가 되면 안 됩니다. **사용자의 진입 목적 → 명시된 장소 지원 기능 → 정해진 기본 우선순위**를 사용합니다. 일반 탐색에서 어떤 행동을 기본으로 둘지는 구현 전에 정책을 고정해야 합니다. 이를 고르기 위해 신원 인증부터 요구하지 않습니다.

짧은 이름 예시: `Review payment`→‘결제 확인’, `Journey stamps`→‘방문 기록’. 이는 문구 후보이며 번역·상태별 의미를 확인한 뒤 적용합니다. 이름만 바꿔 결과를 허위로 보이게 하면 안 됩니다.

## 5. 기존 QA가 놓친 이유

- 클릭 가능/다음 단계 도달/문서 가로 overflow가 없다는 검사만으로는 header 안의 글자·아이콘이 실제로 잘리는지 판단할 수 없습니다.
- `ondo-b-canonical-place-palette.spec.ts:53`은 control의 bounding-box 높이를 검사하지만 조상의 clipping intersection 전체를 검사하지 않습니다.
- `ktour-sheet-corner-paint.spec.ts`는 주로 shared `data-sheet-header`를 검사합니다. 장소 상세는 별도 custom header여서 같은 검사를 받지 않습니다.
- Harvey fixture의 `assertFits`는 outer layer 중심입니다. 내부 title/close/본문의 top/bottom, 여러 CTA의 경쟁 정도를 품질 기준으로 다루지 않습니다.
- locator click이 자동 스크롤한 뒤만 검사하면, 최초 화면에서 가려져 있던 상태를 놓칠 수 있습니다.
- 정보량·반복 문구·명명 충돌은 단순 ‘테스트 green’ 지표로 검증되지 않습니다. 첫 viewport와 중간 스크롤을 실제 이미지로 검수해야 합니다.

**따라서 기존 기능 E2E 통과를 시각 QA 완료로 표현한 것은 범위가 과했습니다.** 이번 결과는 원인을 검증한 항목과 미재현 항목을 구분합니다.

## 6. 수정 후 수락 기준

1. 모든 modal 계열에서 최초 열기, 중간/끝 스크롤, 하위 화면 복귀, 포커스 이동 **직후** screenshot/geometry를 수집. click 자동 스크롤 이전에 검사합니다.
2. header title과 아이콘 rect 전체가 viewport 및 clipping 조상 안에 존재. close/back 44px 이상, 실제 hit-test 확인. body만 scroll하고 footer는 키보드/safe area에 묻히지 않음.
3. 320/360/390/430px, short landscape, KO/EN/JA, light/dark, Safari/WKWebView, 글자 확대 200%를 명시적 matrix로 실행.
4. 본문 15–17px, metadata 12–14px, primary CTA 52–56px을 기준으로 실제 computed style 확인. 좁은 폭을 해결하려고 필수 문구를 축소/ellipsis 처리하지 않음.
5. 첫 화면에서 사용자가 ‘어느 장소인지, 지금 무엇을 하는지, 주 행동이 무엇인지’를 설명할 수 있어야 함. 장문 helper를 가려도 핵심 흐름이 이해되어야 함.
6. 요청 주체·대상·수신자·공유 항목·목적·횟수·만료·금액/비용·거절 경로는 승인 결정점에 유지하며 기술 상세 안으로 숨기지 않음. 자격 요구·실패·실제/샘플 경계도 유지. 기능 단순화가 권한 자동 부여로 바뀌지 않음.
7. 리뷰어는 ‘시각·모바일’과 ‘기능/상태 보존’을 독립 검토. 수정 항목마다 기존 E2E+새 시각 회귀 검사를 실행한 뒤 다음 화면군으로 진행.

최소 다음 시각 gate는 **34개 표본**으로 구성할 수 있습니다: 14개 화면군의 EN390 대표 결정 14개, 신원/결제/충전/Harvey 승인 4개를 JA320·KO360에서 8개, 같은 4개를 글자 200%·가로 화면에서 8개, identity expiry/payment unknown/reservation cancel failure/OAuth failure 4개. 이번에 겹치는 캡처를 재사용하되 모든 분기의 완전 검증이라고 부르지 않습니다.

## 7. 실행 순서와 증거

**공통 sheet/재현 결함 → 장소 정보 위계 → 결제·지갑 → Pass → 신원·해커톤 → 예약·식사 계획 → 나머지 회귀** 순서가 효율적입니다. 동일 CSS 문제를 화면마다 임시 offset으로 덮지 않습니다.

제품 UI와 무관한 backend/OpenDID/Sui 작업은 Harvey가 진행하는 범위로 유지합니다. 화면 수정 시 새 action/state/return 계약을 바꾸는 경우에만 인계 명세를 갱신합니다. 이번 검토로 API/동의 scope를 임의 변경하지 않았습니다.

기본 증거: `k-tour-id-app/artifacts/qa/global-mobile-visual-20260917/inventory.json` 및 같은 폴더의 PNG. 로컬 Git ignored 자료입니다. 재현 도구: `k-tour-id-app/scripts/mobile-visual-audit-local.mjs`.

이전 UX 기준의 ONDO branding 조항은 최신 K-Tour ID 단일 브랜드 결정으로 대체되어야 합니다. 기존 문서에서 유효한 간격·한 화면 한 결정·동의/기능 보존 원칙만 적용하고, 오래된 브랜드/길찾기 우선순위로 되돌리지 않습니다.
