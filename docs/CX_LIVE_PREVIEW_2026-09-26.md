# CX 실제 Preview 검증 — 2026-09-26

## 최신 결론

**실제 서울 Preview에서 CX QR/app handoff와 미인증 결과 처리·복원·취소·장소 복귀를 확인했다. 본인인증 성공은 아직 확인하지 않았다.** 공개 Production, megan, Harvey 별도 배포는 유지했다.

- 검수 링크: [CX-only Preview](https://ondo-58rpahn56-jaewook-9643s-projects.vercel.app/?venueId=mois-0021cd596bc5b2a922ad&review=0).
- 검수한 앱 SHA: `bdc7b2afae65bff16667f7ea3ac53c299795e487`. 이후 검수 스크립트/문서 수정은 이 앱의 runtime 변경이 아니다.
- 장소 상세의 인증 CTA → Preview access → 동의 → QR 또는 앱 선택 → 시작. **신분증 앱에서 실제 승인을 마친 다음에만 결과 확인**을 누른다.
- 접근 코드는 `ondo` 프로젝트의 정확한 Preview 브랜치 변수 `HK_CX_PREVIEW_ACCESS_CODE`에 저장돼 있다. 채팅/Git/로컬 env 파일에 복사하지 않았다. immutable URL을 사용해야 하며 다른 배포 URL의 접근 쿠키는 재사용할 수 없다.
- 환경 만료: **2026-09-30 23:59:59 KST**. 실제 승인·기기 왕복 검수는 해당 기간 내 별도 수행해야 한다.

### 남은 사람/외부 시스템 의존성

1. **실제 Mobile ID 보유자:** QR 또는 앱 링크로 본인 기기에서 동의·승인 후 결과 확인. 서버 `verified`, 거래 일치, CI 기반 동일인 결합 및 성인 결과까지 확인해야 CX 인증 완료다. 미인증 `identity_failed`의 정확한 원인도 이 단계의 실제 응답/공급자 기준으로 확인한다.
2. **체인용 승인된 별도 환경:** 현재 CX-only의 체인 차단을 그대로 유지한다. OmniOne 인증된 RPC 접근, recorder 설정과 Sui issuer/agent/sponsor의 승인된 서버 설정·권한/gas 확인 후 신규 실제 연계 E2E가 필요하다. 비밀키를 채팅으로 보내는 방식은 사용하지 않는다. Sui 현재 객체와 OmniOne 401 관측은 [체인 읽기 검증](./CHAIN_READONLY_2026-09-26.md) 참조.
3. **OpenDID native:** 기존 합의대로 후속이며 현재 CX/체인 완료로 대체하지 않는다.

## 완료한 기반 작업

- 전용 jaewook CLI 프로필·프로젝트·작업 폴더 경계 검증. megan 및 공개 Production은 변경하지 않았다.
- 기존 앱 Redis store를 fixture 없이 실제 Redis에서 검증: 동시 writer 2개 + 새 reader, **6/6 PASS, cleanup=true, failures=0**. 고유 TTL 테스트 공간만 사용했고 테스트 데이터만 소유권 확인 후 정리했다.
- 정확한 Preview 브랜치에 CX runtime 변수 12개 등록. 기존 변수 메타데이터 유지, issuer/access signing secrets는 Sensitive 저장, 접근 코드는 encrypted 저장. 민감값은 출력하거나 로컬 파일로 저장하지 않았다.
- 로컬 hackathon **149/149**, 앱 계약 **964/964**, CX-only production build/TypeScript PASS. 초기 로컬 browser artifact는 mock API 검수이며 실제 QR 증거가 아니다.
- 로컬 `.next/static` 파일 72개에서 서버 secret 변수명 참조 0건. 빌드 자식 프로세스는 기존 명시적 허용 목록으로만 환경을 상속한다.

## 첫 실제 배포 및 발견한 문제

- 소스 `3e5dedc52f7a595fe9ef094a27c68f8084992d9b`.
- 배포 `dpl_7UaSNvU51oU1dwdQ9Ap2AuFtD1FH`, `ondo-nb3rfl2dq-jaewook-9643s-projects.vercel.app`.
- Vercel 상태 READY, region `icn1`, Preview, 정확한 GitHub 브랜치·SHA 일치.
- 그러나 실제 config/session 접근은 기대한 401보다 앞선 **503 `cx_preview_unavailable`**로 차단됐다. 세션 cookie는 생성되지 않았고, 이 배포에서 CX transaction/QR/앱 인증 요청은 시작하지 않았다.
- AI `/api/ask`, `/api/chat`은 의도한 503 차단을 확인했다. 이를 본인인증 성공이나 전체 검수 통과로 세지 않는다.
- 원격에서 비민감 CX 설정 9개는 각각 기대값과 비교해 모두 일치했고 접근 코드 형식도 유효했다. 값 자체는 출력하지 않았다.

## 진단 변경

- 원인을 추정해 보안 조건을 완화하지 않았다. `cxPreviewPreflightIssues`가 고정된 실패 조건명만 반환하고, 서버가 각 조건명을 warm instance당 한 번 기록하도록 했다. 환경값·URL·토큰·코드·QR·원본 오류는 기록하지 않는다.
- 외부 응답은 기존 generic 503 그대로이며 새로운 진단 endpoint는 없다. 모든 기존 차단 조건을 유지했다. 작성자 외 독립 리뷰 GO.
- 진단 revision `20e781ecca47fd2a86d4b33d1466a1ec0b03cf16`: 단위 **150/150**, production build/TypeScript PASS.

## TLS 종료 프록시 호환 수정

- 진단 Preview `dpl_Ghafrzbni91Dqr7epQfrVcfvWzQ4`의 실제 서버 로그에서 실패 조건은 `https` 하나뿐이었다. 외부 HTTPS 요청이 Next.js 내부에서는 HTTP URL로 전달되는 경우를 기존 가드가 거부했다.
- 고정된 `VERCEL_URL`과 요청 URL의 호스트를 일치시키고, 전달 프로토콜이 정확히 `https`인 경우에만 내부 HTTP를 외부 HTTPS origin으로 정규화한다. Host / X-Forwarded-Host가 있으면 같은 고정 호스트여야 한다. 임의 Origin이나 forwarded host로 목적지를 결정하지 않는다.
- 대상 검사·CSRF·접근 쿠키 서명이 모두 같은 origin을 사용한다. Production·다른 프로젝트/브랜치·다른 호스트·위조된 전달 헤더·만료·Redis 미설정 차단은 그대로다.
- 의도적으로 **정확한 immutable 배포 URL만** 허용한다. 브랜치 별칭 URL은 사용할 수 없고 새 배포 URL에서는 접근 코드를 다시 입력해야 한다.
- 독립 adversarial 리뷰 GO, 독립 접근/라우터 검사 **18/18**, 전체 hackathon 단위 **151/151**, CX-only production build/TypeScript **PASS**. 실제 요청 재검증은 배포 후 별도로 기록한다.
- 근거: [Vercel 요청 헤더 문서](https://vercel.com/docs/headers/request-headers)의 `x-forwarded-proto` 정의.

### 재배포 후 남은 내부 URL 차이

- `d1bb81ba17f017709429a17d27a7343c92a672ac` / `dpl_utM6VCKp2qfpFWMrwgceU9kBKyZr`는 정확한 Preview·`icn1`으로 READY였다. 그러나 접근은 계속 503이었으며, 서버 진단은 `request_origin`을 지목했다. 실제 CX transaction은 아직 시작하지 않았다.
- 사용자 정의 `VERCEL_*` 환경변수는 없었다. Production은 `dpl_HHDmk5SoQPmdJbonqjE2w7pLwJNj` / `58d284b9c6f51e8563765df7b7a3c13b4d575bdd` 그대로임을 다시 확인했다.
- 설치된 Next 16.2.6의 `RouteModule.prepare`와 `NextRequestAdapter`에는 공개 Host와 별개인 내부 hostname/localhost로 Request URL을 만드는 경로가 있다. 별도 담당자가 합성 입력으로 이를 재현했다. 이번 배포의 실제 URL 형태와 동일하다고 아직 단정하지 않는다.
- 허용 정책은 유지하고 각 origin 검사 결과를 고정된 조건명으로 세분화했다. 호스트 불일치 시 loopback 여부와 port 존재 여부만 고정 분류명으로 남긴다. 실제 주소·포트·헤더값은 출력하지 않는다. 검사를 완화하기 전에 실제 조건을 확인하기 위한 변경이다.
- 기존 앱 계약 회귀도 독립 재실행 **964/964 PASS**였다.

### 관측에 근거한 외부 origin 계약

- 세분화 진단 revision `dfa0c259401ec11b6a0395bba63ed66ab7793c96`의 실제 로그는 `origin_url_host` 불일치, non-loopback, port 없음만 가리켰다. 따라서 localhost였다고 단정하지 않는다. Next adapter에는 `http://n` 같은 dummy URL 경로도 있으며 내부 authority는 외부 접속 도메인 식별자가 아니다.
- 독립 검토자 2명의 설계 GO 후, Preview에서 **Host와 X-Forwarded-Host 둘 다 고정 `VERCEL_URL`과 정확히 일치**, **X-Forwarded-Proto는 정확히 `https`**를 필수화했다. 기존 선택적 헤더보다 엄격하다. 내부 URL은 HTTP(S)·credentials 없음만 검사한다.
- 외부 origin은 서버의 고정 배포 환경값으로만 구성한다. 이 헤더 검사는 접근 인증이 아니며 기존 접근코드·서명 쿠키·정확한 POST Origin·Fetch-Site·지역/Git/만료 가드가 여전히 필요하다. 프로젝트 ID는 배포 wrapper의 metadata 검사로 확인한다.
- 내부 URL 호스트 불일치를 실패로 세던 진단도 제거했다. 정상 프록시 입력에서 preflight `[]`, 내부 URL의 실제 router config 200, 필수 헤더 하나라도 없으면 storage 이전 503, 다른 Origin은 403, 다른 배포의 접근 쿠키 재사용은 401을 검사한다.
- `x-vercel-deployment-url`의 새 필수 조건이나 전역 Next `trustHostHeader` 설정은 도입하지 않았다.

## 실제 요청 검증 — bdc7b2af

- 소스 `bdc7b2afae65bff16667f7ea3ac53c299795e487`, 배포 `dpl_FpNR7um6pjzxpzY55cEd9yh8g7z1`.
- 검증 URL: `https://ondo-58rpahn56-jaewook-9643s-projects.vercel.app`. 정확한 project/Preview/branch/SHA와 `icn1`을 wrapper에서 확인했다.
- 로컬 hackathon **153/153**, CX-only build/TypeScript PASS. 설계 2명·구현 별도 리뷰 GO.
- 실제 unauthenticated 경계 **6/6 PASS**: config/session 401, foreign Origin 403, 금지 chain 경로 403, ask/chat 503. 모두 새 cookie 없음.
- 실제 Chromium 375×812: 접근코드 → 실제 CX config → Redis session → 동의/작업 생성 → **실제 QR handoff 생성·이미지 decode 성공** → 새로고침 → 같은 장소에서 상태 복원까지 도달했다. 캡처/QR decode payload/원본 응답 기록 없음.
- 실제 결과 조회는 HTTP 200이었으나 검수 스크립트의 **pending-only 상태 가정**과 달라 전체 run은 실패로 기록했다. 이 최초 run의 응답 본문은 저장하지 않았으므로 세부 provider 결과를 추정해서 확정하지 않는다. 실패 후 자기 작업 취소의 ID/status/phase/identity 제거 계약을 확인했고 로그에서도 cancel 200이었다.
- 이번 최초 run에서는 app handoff 단계까지 진행하지 않았다. QR 성공을 앱 연결 성공 또는 본인인증 완료로 확대하지 않는다.

### 후속 실제 브라우저 검수 완료

- pending-only 가정을 실제 서비스 계약과 맞췄다. 정확한 작업 ID의 CX 미검증 QR 대기, 또는 identity 제거 + 정확한 `identity_failed`/`identity_cancelled`/`identity_expired` + retryable 응답만 분리해 허용한다. mock·verified·다른 phase·알 수 없는 오류는 거절한다. 앱/adapter의 성공 조건은 바꾸지 않았다.
- 분류기 반례, TypeScript, 독립 리뷰 GO 이후 같은 immutable 앱 배포에서 새 세션으로 재검수했다. 최종 로컬 hackathon **154/154 PASS**, 기존 앱 계약 **964/964 PASS**.
- 실제 집계: access **1**, 명시적 동의 **2**, QR 생성/decode **1**, 앱 handoff 시작 **1** 및 링크 표시 **2**, 결과 조회 **1**, 대기 응답 **0**, 미인증 응답 **1**, 검증된 취소 **2**, 장소 CTA focus 복귀 **1**.
- 관측한 미인증 상태 코드는 **`identity_failed`**다. QR 제거·재시작 컨트롤·오류 표시를 확인했으며 이를 본인인증 성공이나 원인이 확정된 정상 응답으로 기록하지 않는다. 이전 최초 run의 원인도 이 결과로 소급 단정하지 않는다.
- 금지 요청 **0**, 동의 전 시작 **0**, page error **0**. QR payload/CI/토큰/접근 코드·원본 응답은 검수 로그·로컬 아티팩트에 저장하지 않았고 스크린샷/trace/HAR도 생성하지 않았다. 정상 동작에 필요한 Vercel 환경변수 및 서버 Redis의 제한된 임시 상태 저장과는 구분한다. Native 링크를 클릭하거나 실제 사용자 승인·서명을 수행하지 않았다.
- 기존 최초 실패 run도 자기 작업 취소를 검증했다. 이번 두 작업 역시 앱 원장에서 cancelled/identity=null을 확인했다. 공급자 자체의 서버 거래를 삭제했다고 주장하지 않는다.
- 마무리 읽기 확인에서도 전용 jaewook 프로필이 유효했고 기본 megan 로그인 및 공개 Production 배포 ID/SHA는 변경되지 않았다.

## 검수 경계

실제 holder 승인, `verified` 결과, OpenDID 발급, Sui 신규 서명/실행, OmniOne 신규 기록은 이 시점에 미수행이다. 테스트 성공 수에 실제 인증 완주를 포함하지 않는다. 체인 공개 인프라의 병렬 조회는 [별도 기록](./CHAIN_READONLY_2026-09-26.md)을 따른다.
