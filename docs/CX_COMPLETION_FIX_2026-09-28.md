# CX 승인 후 `cx_transaction_missing` 수정 — 2026-09-28

## 원인과 확인 범위

사용자가 모바일 신분증 앱에서 제출을 승인한 뒤 K-Tour 결과 확인에서
`cx_transaction_missing`을 받았다. 사용자 화면만으로 서버 검증·동일인 결합·성인 판정의
전체 성공을 단정하지는 않지만, **공급자 매뉴얼과 다른 앱 파서 요구사항**을 확인했다.

기존 adapter는 `/authen/qr/result` 또는 `/authen/app/result` 완료 후
`/trans/token`의 `data.txId` 또는 `data.txid`를 반드시 요구했다.
제공받은 매뉴얼의 token 파싱 응답 예시는 `data.jti`, `sub`, `ci` 등을 포함하지만
`data.txId`와 `data.cxId`는 없다. 따라서 문서에 맞는 완료 응답도 이 오류를 낼 수 있었다.
실제 사용자 응답 원문·CI·token을 읽거나 저장해 진단한 것이 아니므로,
실제 응답이 그 예시와 완전히 같았다고 주장하지 않는다.

검토한 원본:

- `OmniOne CX_VC-Verifier_v1.0_API 매뉴얼_해커톤_20250709.docx`.
- SHA-256: `bd4d948eadb947399e1b6903cf0cc93cdabd24b148e058a80bbf3992d76b80b3`.
- §2.3.3/2.3.4: 완료 result의 바깥 envelope에 `txId`, `cxId`, `reqTxId`, 새 `token`,
  `oacxStatus=AFTER_RESULT`, `data.verified`를 설명한다. `reqTxId`는 요청 txId와 같다.
- §2.4: **result API에서 받은 token**을 서버 `/trans/token`에 전달해 파싱한다.
  응답 예시의 decoded claims에는 txId/cxId가 없다.
- 샘플 설명의 주의사항: 단계마다 새 token을 발급하고 호출 단계를 검사한다.
- 부록의 claim 표는 `txid`/`cxid` 소문자도 사용한다. 서로 다른 이름이 동시에 있으면
  우선순위로 하나를 골라 충돌을 숨기지 않는다.

매뉴얼의 예시 데이터 자체는 새 테스트에 복사하지 않았다. fixture의 token/CI/ID는 모두 합성값이다.

## 수정한 검증 순서

1. provider result code와 완료 상태를 확인하고 `data.verified === true`만 받는다.
2. 완료 result envelope가 반환한 transaction reference와 `cxId`를 저장된 서버 요청과 대조한다.
   `txId`/`txid`/`reqTxId` 중 적어도 하나와 `cxId`/`cxid`가 있어야 하며,
   존재하는 모든 별칭과 중첩 echo가 같아야 한다. 모두 누락되면 계속 `cx_transaction_missing`이다.
3. result가 반환한 새 token을 요구한다. 누락·형식 오류·이전 request token 재사용을 거절한다.
   그 token 하나만 서버 `/trans/token`으로 전달한다. client가 준 성공 boolean은 쓰지 않는다.
4. decoded claims에는 txId/cxId를 새로 요구하지 않는다. 다만 파싱 응답의 envelope나
   `data`가 해당 값을 제공하면 모두 동일해야 한다. `sub`가 있으면 `AFTER_RESULT`여야 한다.
   `jti`를 임의로 txId로 재해석하거나 비검증 JWT decode를 인증 근거로 쓰지 않는다.
5. 현재 1인 1회 정책의 stable CI 요구사항은 유지한다. CI 없음을 요청 ID·DID·이름/생년월일
   해시·브라우저 UUID로 대신하지 않는다. 공개 결과에는 CI 원문을 내보내지 않는다.

이는 요청 txId를 누락된 provider 필드에 복사하는 우회가 아니다.
**공급자가 반환한 완료 transaction + cxId + 그 결과 token의 서버 파싱**으로 결합한다.
claim과 envelope가 모순되거나 필수 완료 근거가 없으면 계속 거절한다.

## AdultVerify와 CI는 별도 확인 사항

매뉴얼은 `AdultVerify` 요청 mode를 설명하지만, 확인한 result 예시는 일반 제출의
`data.zkp=false`다. 실제 양성 AdultVerify의 정확한 최소 공개 claim schema,
CI 제공 여부, 법적 나이 기준을 이 자료만으로 확정하지 않는다.

- `data.zkp=true`만으로 `adultVerified=true`를 만들던 추론을 제거했다.
  명시적 adult claim이 없으면 `adultVerified=null`로 남는다.
- 이미 지원하던 명시적 `adult`/`adultYn`/`isAdult` 값 처리는 별개다.
  이 별칭을 모든 provider가 반환한다거나 최종 나이 기준이 검증됐다고 주장하지 않는다.
- CI를 받지 못하면 수정 후에도 `cx_subject_unavailable`로 차단한다.
  이는 이번 transaction parser 결함과 다른 정책/제공자 계약 문제다.
- CI 없는 predicate-only 완료를 지원하려면 별도의 증거 타입·UI 상태·업무 정책이 필요하다.
  이번 변경에서는 `personVerified`의 의미나 1인 1회 조건을 바꾸지 않는다.
- OpenDID, Sui, OmniOne의 구현·설정·키·배포는 이 adapter 변경 범위가 아니다.

## 회귀와 실제 재검수

대상 테스트:

```sh
# k-tour-id-app에서. 모든 CX 응답은 합성 transport fixture다.
node --import tsx --test tests/hackathon/cx-boundaries.test.ts tests/hackathon/cx-completion-contract.test.ts tests/hackathon/identity-concurrency.test.ts
pnpm exec tsc --noEmit
```

추가 회귀는 app/QR 양쪽의 문서형 envelope, claims tx/cx 생략, 모든 별칭·중첩 충돌,
result transaction/cx 누락, 새 token 누락/이전 token, 단계 불일치, pending token 갱신,
CI 미제공, ZKP flag와 adult 판정의 분리를 검사한다. 테스트는 실제 제공자를 호출하지 않는다.

위 세 파일의 오프라인 회귀 **67/67 PASS**. 기존 동시성 fixture도 pending과 완료 단계에
서로 다른 token을 발급하도록 수정했다. 완료 token 재사용을 허용해 테스트를 맞춘 것이 아니다.
전체 앱 typecheck·빌드·배포 결과는 별도의 통합 검수로 확인한다.

독립 리뷰·회귀 후 CX-only 보호 배포에서 같은 당사자의 **새 요청에 대한 명시적 승인**이 필요하다.
기존 승인 화면을 새 transaction의 성공 증거로 재사용하지 않는다.

1. 수정된 CX-only Preview의 접근·세션·동의를 확인하고 새 QR/앱 요청을 만든다.
2. 당사자가 자기 모바일 신분증 앱에서 요청 내용을 확인하고 제출한다.
3. 같은 웹 세션으로 돌아와 결과를 확인한다. 자동 제출/재시작/chain 실행은 하지 않는다.
4. 기록할 것은 앱의 단계·오류 code와 비민감 판정뿐이다. QR/token/CI/JWT/신분증 화면/응답 원문은
   채팅·스크린샷·로그·Git으로 받거나 남기지 않는다.
5. `cx_subject_unavailable`이면 제공자에게 **해당 AdultVerify 모드의 stable subject 제공 여부**와
   실제 반환 규격을 확인한다. 사용자에게 CI를 직접 전달하거나 인증을 반복해 달라고 요구하지 않는다.

단위 테스트 통과나 새 배포는 실제 holder 성공 검수와 구분한다.
이 문서 작성 시점에는 이 수정으로 제공자 재호출·실제 승인 재검수·배포를 수행하지 않았다.
