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

별도 readonly Preview 배포 후 실행 지역·revision을 대조하여 기록 예정. 로컬 성공을 icn1 성공으로 간주하지 않는다.

## 남은 선행 조건

1. Harvey의 승인된 서버 환경을 인계받을지, Preview 전용 durable Redis를 새로 준비할지 결정. 새 외부 자원·비용은 선택 확인 전 생성하지 않는다.
2. 전용 namespace와 안정적인 서버 seed, 접근 보호 구성. 기존 seed를 덮어쓰지 않는다. 비밀키는 채팅에 붙이지 않는다.
3. 현재 `HK_ISOLATED_MOCK=0`은 CX뿐 아니라 다른 실연동 경로에도 영향을 준다. 따라서 단순 flag 전환이 아니라 **CX 인증/세션만 허용하고 체인·AI는 계속 차단하는 별도 제한 단계**를 먼저 검토한다.
4. 지원되는 실제 신분증 보유자가 본인 기기에서 동의·인증. 서버는 완료/verified, transaction 일치, 안정적 CI를 확인한다. provider 목록 활성만으로 연령 기준이나 CI 제공을 보장하지 않는다.
5. 취소·만료·재시도·새로고침·중복 완료 및 같은 장소 복귀를 검증한 뒤 CX E2E를 완료 처리한다.
