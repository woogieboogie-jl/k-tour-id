# CX 실제 Preview 검증 — 2026-09-26

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

## 검수 경계

실제 holder 승인, `verified` 결과, OpenDID 발급, Sui 신규 서명/실행, OmniOne 신규 기록은 이 시점에 미수행이다. 테스트 성공 수에 실제 인증 완주를 포함하지 않는다. 체인 공개 인프라의 병렬 조회는 [별도 기록](./CHAIN_READONLY_2026-09-26.md)을 따른다.
