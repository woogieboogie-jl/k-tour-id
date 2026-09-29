"use client"

import type { KeyboardEvent, ReactNode, SyntheticEvent } from "react"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import {
  ArrowRight, BadgeCheck, Camera, Check, ChevronLeft, ChevronRight, IdCard, Info,
  BookOpenCheck, Clock3, RefreshCw, ScanFace, ShieldCheck, SlidersHorizontal, Smartphone, TriangleAlert, WalletCards, X,
} from "lucide-react"
import { createReviewFixtureAuthority, providerUnavailable, reviewFixture } from "../contracts/execution-mode"
import {
  createIdentityManualReview, identitySampleInterruption, identitySamplesForMethod,
  mayDeliverIdentityManualReview, resolveIdentityManualReview,
  type IdentityJourneySample, type IdentityManualOutcome, type IdentityManualReview, type IdentitySampleCheckpoint,
} from "../contracts/identity-journey-samples"
import { useOndoB } from "../shared/state/ondo-b-provider"
import type { OndoBLocale } from "../shared/state/ondo-b-preferences"
import { focusFirstAvailableDestination } from "../shared/ui/focus-destination"
import { KTourIdMark } from "../shared/ui/ktour-id-mark"
import { isRenderedFocusable } from "../shared/ui/is-rendered-focusable"
import { ONDO_MODAL_PRIORITY } from "../shared/ui/modal-layer-priority"
import { useDocumentScrollLock, useModalIsolation } from "../shared/ui/use-modal-isolation"
import { enterReviewSample, qaReviewFixtureOptions, readQaRuntime, useQaControls } from "../shared/ui/use-qa-controls"
import { createBExperiencePersonHandoff, isBExperiencePersonHandoffCurrent, restoreBActionGateSession, type BExperiencePersonHandoff } from "./action-gate-contract-b"
import { EXPERIENCE_COPY_B } from "../experience-b/experience-copy-b"
import { useSheetPresence } from "../shared/ui/use-sheet-presence"
import {
  createPresentationRequestB,
  createIdentitySetupSessionB,
  isIdentitySetupSessionActiveB,
  isPersonOnlySimulatedCredentialB,
  isPresentationRequestActiveB,
      isReviewCredentialDraftB,
      isSimulatedCredentialActiveB,
  simulatedCredentialStatusB,
  KTOUR_ID_RECOVERY_CODES,
  resolvePresentationRequestB,
  type OndoBCredentialStatus,
  type OndoBIdentityMethod,
  type OndoBIdentityRecoveryCode,
  type OndoBIdentitySetupSession,
  type OndoBPresentationRequest,
} from "./ktour-id-setup-model-b"
import { PassportOcrStepB } from "./passport-ocr-step-b"
import { PassportFaceStepB } from "./passport-face-step-b"
import { IdentityHandoffStepB } from "./identity-handoff-step-b"
import { IdentityHolderStepB } from "./identity-holder-step-b"
import { SumsubPassportStepB, SUMSUB_PASSPORT_DISCLOSURE, SUMSUB_PASSPORT_ENABLED, type SumsubPassportStepHandle } from "./sumsub-passport-step-b"
import styles from "./ktour-id-setup-b.module.css"
import { useIdentityReviewModeB } from "./identity-review-mode-b"
import { JitPassSetupB } from "./jit-pass-setup-b"

type Phase =
  | "method_select" | "consent" | "cx_handoff_preview" | "verified_person_consent"
  | "document_preview" | "face_liveness_preview" | "provider_processing_preview"
  | "holder_delivery_preview"
  | "credential_ready" | "presentation_request" | "presentation_consent"
  | "presentation_result" | "failed" | "unavailable" | "expired"
  | "cancelled" | "manual_review" | "recovery_intro" | "sumsub_sandbox"

type QaRuntime = {
  identitySetupOutcome?: "success" | OndoBIdentityRecoveryCode
  credentialStatus?: Exclude<OndoBCredentialStatus, "none">
  identity?: {
    outcome?: "IDENTITY_METHOD_UNAVAILABLE"
    credentialStatus?: Exclude<OndoBCredentialStatus, "none">
    presentationOutcome?: "PRESENTATION_DENIED" | "PRESENTATION_REQUEST_EXPIRED" | "PRESENTATION_REPLAY"
  }
}

const SAMPLE_COPY = {
  en: {
    controls: "Sample outcome", boundary: "Prepared responses only. No identity check or document upload.",
    outcomes: { success: "Successful check", cancelled: "Provider cancelled", method_unavailable: "Method not supported", app_missing: "ID app not installed", session_expired: "QR / session expired", nfc_unsupported: "NFC not supported", document_read_failed: "Document unreadable", unsupported_document: "Document not supported", document_auth_failed: "Document check declined", face_mismatch: "Face does not match", liveness_failed: "Liveness check failed", manual_review: "Manual review needed", provider_timeout: "Provider timed out", callback_invalid: "Response could not be verified", issuer_failed: "Pass issuance failed", holder_failed: "Pass could not be saved" },
    pending: "Review in progress", pendingBody: "The sample review is in progress. No pass has been issued.", check: "Check status", checking: "Checking…",
    reviewResult: "Sample review result", approved: "Review approved", approvedBody: "Continue to save the sample pass. This is not a real identity approval.",
    declined: "Review declined", declinedBody: "No pass was issued. Choose another sample route or return to your trip.",
    needsInfo: "One more check", needsInfoBody: "Try the redacted document sample again, then request another review.", addInfo: "Review sample document",
    checked: "Checked", startAgain: "Start a new sample request", cancelled: "Check cancelled", cancelledBody: "No pass was issued. Your trip and existing pass are unchanged.",
    retry: "Retry sample step", different: "Choose another sample", nfcFallback: "Use document review", safeFailure: "Sample result · no pass issued. Your existing pass is unchanged.",
    recovery: "Pass & device recovery", renew: "Try pass renewal", restore: "Try device recovery", recoveryTitle: "Prepare a new sample pass", recoveryBody: "Repeat consent and identity checks with prepared data. The existing pass stays unchanged until you save the new one.",
    recoveryBoundary: "Same sample person and ID method. Age, stay dates, spending and used benefits stay unchanged. No real ID is recovered.", recoveryStart: "Start sample recovery", returnCurrent: "Keep current pass",
  },
  ko: {
    controls: "샘플 결과", boundary: "준비된 응답만 사용해요. 실제 신원 확인·문서 업로드는 없어요.",
    outcomes: { success: "확인 성공", cancelled: "제공자 화면에서 취소", method_unavailable: "지원하지 않는 방법", app_missing: "신분증 앱 미설치", session_expired: "QR·세션 만료", nfc_unsupported: "NFC 미지원", document_read_failed: "문서를 읽지 못함", unsupported_document: "지원하지 않는 문서", document_auth_failed: "문서 확인 거절", face_mismatch: "얼굴 불일치", liveness_failed: "실재성 확인 실패", manual_review: "수동 검토 필요", provider_timeout: "응답 시간 초과", callback_invalid: "응답 검증 실패", issuer_failed: "패스 발급 실패", holder_failed: "패스 보관 실패" },
    pending: "검토 중이에요", pendingBody: "샘플 요청을 접수했어요. 패스는 아직 발급되지 않았어요.", check: "진행 상태 확인", checking: "확인 중…",
    reviewResult: "샘플 검토 결과", approved: "검토가 승인됐어요", approvedBody: "샘플 패스를 보관할 수 있어요. 실제 신원 확인 승인은 아니에요.",
    declined: "검토가 거절됐어요", declinedBody: "패스는 발급되지 않았어요. 다른 샘플 방법을 선택하거나 여행으로 돌아가세요.",
    needsInfo: "한 번 더 확인해 주세요", needsInfoBody: "가림 처리된 문서 샘플을 다시 확인한 뒤 검토를 요청하세요.", addInfo: "문서 샘플 다시 확인",
    checked: "확인 시각", startAgain: "새 샘플 요청 시작", cancelled: "확인을 취소했어요", cancelledBody: "발급된 패스는 없어요. 여행과 기존 패스는 그대로예요.",
    retry: "샘플 단계 다시 시도", different: "다른 샘플 선택", nfcFallback: "문서 검토로 진행", safeFailure: "샘플 결과 · 발급된 패스 없음. 기존 패스는 그대로예요.",
    recovery: "패스·기기 복구", renew: "패스 갱신 체험", restore: "기기 복구 체험", recoveryTitle: "새 샘플 패스 준비", recoveryBody: "준비된 데이터로 동의와 신원 확인을 다시 진행해요. 새 패스를 보관하기 전에는 기존 패스가 바뀌지 않아요.",
    recoveryBoundary: "같은 샘플 사용자와 확인 방법이에요. 나이·체류 기간·사용 금액·사용한 혜택은 유지돼요. 실제 신분증 복구는 아니에요.", recoveryStart: "샘플 복구 시작", returnCurrent: "기존 패스 유지",
  },
  ja: {
    controls: "サンプル結果", boundary: "用意された応答のみ。実際の本人確認・書類送信はありません。",
    outcomes: { success: "確認成功", cancelled: "事業者画面でキャンセル", method_unavailable: "非対応の方法", app_missing: "IDアプリ未インストール", session_expired: "QR・セッション期限切れ", nfc_unsupported: "NFC非対応", document_read_failed: "書類を読み取れない", unsupported_document: "非対応の書類", document_auth_failed: "書類確認が拒否", face_mismatch: "顔が一致しない", liveness_failed: "実在性確認の失敗", manual_review: "手動審査が必要", provider_timeout: "応答タイムアウト", callback_invalid: "応答を検証できない", issuer_failed: "パス発行の失敗", holder_failed: "パス保存の失敗" },
    pending: "審査中です", pendingBody: "サンプル依頼を受け付けました。パスはまだ発行されていません。", check: "状況を確認", checking: "確認中…",
    reviewResult: "サンプル審査結果", approved: "審査が承認されました", approvedBody: "サンプルパスを保存できます。実際の本人確認承認ではありません。",
    declined: "審査が拒否されました", declinedBody: "パスは発行されていません。別のサンプル方法か旅行に戻れます。",
    needsInfo: "もう一度確認", needsInfoBody: "マスキング済み書類サンプルを再確認して、もう一度審査を依頼してください。", addInfo: "書類サンプルを再確認",
    checked: "確認時刻", startAgain: "新しいサンプル依頼", cancelled: "確認をキャンセルしました", cancelledBody: "パスは発行されていません。旅行と既存のパスは変わりません。",
    retry: "サンプル手順を再試行", different: "別のサンプルを選ぶ", nfcFallback: "書類審査を利用", safeFailure: "サンプル結果・パス未発行。既存のパスは変わりません。",
    recovery: "パス・端末の復旧", renew: "パス更新を体験", restore: "端末復旧を体験", recoveryTitle: "新しいサンプルパスを準備", recoveryBody: "用意されたデータで同意と本人確認をやり直します。新しいパスを保存するまでは既存のパスを変更しません。",
    recoveryBoundary: "同じサンプル利用者・確認方法です。年齢・滞在期間・利用額・使用済み特典は変わりません。実際のID復旧ではありません。", recoveryStart: "サンプル復旧を開始", returnCurrent: "現在のパスを保持",
  },
} as const

const COPY = {
  en: {
    dialog: "K-Tour ID", close: "Close K-Tour ID setup", back: "Previous step",
    env: "K-Tour ID",
    envDetail: "No identity provider or OpenDID service is connected.",
    boundary: "This in-app K-Tour pass is saved only in this browser tab. It is not an identity check or official ID. No identity service is connected, no DID or VC is issued, and selected documents and personal details are not stored.",
    optional: "K-Tour ID", title: "Choose a method",
    lead: "Choose one when an action needs it.",
    mobile: "Mobile ID", mobileNote: "Use your Korean mobile ID",
    residence: "Residence Card", residenceNote: "For registered foreign residents",
    passport: "Passport", passportEvidence: "Passport check", passportNote: "For visitors without a Korean ID", notConfigured: "not connected",
    methodUnavailable: "Unavailable now", methodReview: "Review path", reviewTruth: "Review path · no external service confirmation", presentationReviewPending: "Review only · nothing will be sent", presentationReviewResult: "Review result · nothing sent",
    separate: "Passport eKYC uses a separate provider — not OmniOne CX.", review: "Review consent", later: "Not now — keep exploring",
    consentTitle: "Check before you continue", consentBody: "Review what this step needs, then continue when you’re ready.",
    requester: "Requester", requesterValue: "K-Tour ID", purpose: "Purpose", purposeValue: "Set up K-Tour ID for this trip",
    provider: "Proofing route", evidence: "Requested evidence", retention: "Retention",
    mobileRetention: "No Mobile ID payload, name, birth date, signed callback or provider result is stored. Only trip eligibility and private K-Tour credential state remain in this tab.",
    residenceRetention: "No residence-card payload, name, birth date, signed callback or provider result is stored. Only trip eligibility and private K-Tour credential state remain in this tab.",
    passportRetention: "The review route uses only a bundled redacted sample. No user image, passport field, face image or provider result is collected or stored.",
    wallet: "Payments stay separate", walletConsent: "K-Tour ID does not prepare or connect a balance. Add KRW or USD later in ID & Wallet.",
    consentDetails: "Data & storage details",
    accept: "Agree and continue", decline: "Go back", next: "Continue",
    cx: "Preview the ID handoff", cxBody: "See the next step with a prepared sample. No ID app opens and no personal data is sent.",
    handoffRoute: "How your ID returns to K-Tour ID", handoffConsent: "Consent reviewed", handoffConsentNote: "Only the evidence you agreed to.",
    handoffCheck: "Review an ID response", handoffCheckNote: "Prepared sample · not a provider result.",
    handoffReturn: "Add your travel pass", handoffReturnNote: "You decide whether to save it in K-Tour ID.", handoffContinue: "Review sample response",
    document: "Check the passport page", documentBody: "The review route uses a bundled redacted sample and does not collect passport data.",
    face: "Face check", faceBody: "Continue when you’re ready.",
    processing: "Preparing the next step", processingBody: "Keep this screen open for a moment.",
    holder: "Add to Travel Pass", holderBody: "Keep it with your trip pass.", holderLabel: "K-Tour ID",
    ready: "Travel pass draft saved", readyBody: "Kept with this trip.",
    walletReady: "Payments stay separate", walletReadyNote: "Add KRW or USD later in ID & Wallet",
    present: "Review eligibility", request: "Review travel eligibility", requestBody: "This review shows one minimum yes/no result here. Nothing is sent to an external service.",
    presentConsent: "Review this one request?", presentConsentBody: "This applies once. There is no always allow, and declining does not change the draft.",
    presentationRequester: "K-Tour ID Table", presentationPurpose: "Minimum trip eligibility for this one request",
    presentationEvidence: "K-Tour travel eligibility · yes/no only", presentationRetention: "This request only · expires automatically · result not stored",
    presentationPredicate: "K-Tour travel eligibility · yes/no only", presentationPredicateRetention: "One request · result not stored",
    presentationRequestEyebrow: "TRAVEL ELIGIBILITY",
    presentationResultApproved: "REVIEW RESULT", presentationResultNotApproved: "NO RESULT", unchanged: "draft unchanged",
    approve: "Review once", deny: "Not now", result: "Review complete", resultBody: "The yes/no result was shown only here. Nothing was sent or stored.",
    resultDenied: "Nothing sent", resultDeniedBody: "You declined this review. The draft is unchanged and nothing was sent.",
    resultExpired: "Request expired", resultExpiredBody: "This one-time request expired before approval. Start a new request when you are ready.",
    resultReplay: "Request already used", resultReplayBody: "This one-time request cannot be used again. Start a new request without changing the credential.",
    presentationStatusDenied: "DECLINED · NOTHING SENT", presentationStatusExpired: "REVIEW EXPIRED", presentationStatusReplay: "ALREADY REVIEWED", newRequest: "Start a new review",
    returnOnboarding: "Open Korea map", returnTraveler: "Return to Travel Pass", returnAction: "Back to my action", backToKTourId: "Back to K-Tour ID",
    unavailable: "This method is unavailable right now", unavailableBody: "Continue with prepared sample data, or return to your trip.", sample: "Continue with sample",
    unavailableTechnical: "No provider for this method is connected.",
    assurance: "A passport does not confirm registered-resident status or replace a Residence Card check.", usePassport: "Use passport instead",
    failure: "This step did not complete", failureBody: "Nothing changed. Try again or choose another method.",
    expired: "This setup session expired", expiredBody: "The ten-minute setup window ended. Start a new route without losing guest Explore.", retry: "Retry safe step", another: "Choose another route",
    expiredStatus: "This local credential expired.", suspendedStatus: "This local credential is suspended.", revokedStatus: "This local credential is revoked.",
    onDevice: "K-TOUR ID", mobileEyebrow: "MOBILE ID", faceEyebrow: "K-TOUR ID", holderEyebrow: "TRAVEL PASS", holderMeta: "Ready to add",
    protocolSummary: "About K-Tour ID",
    chooseStep: "Choose", checkStep: "Check", issueStep: "Add", presentStep: "Present",
  },
  ko: {
    dialog: "K-Tour ID", close: "K-Tour ID 설정 닫기", back: "이전 단계",
    env: "K-Tour ID",
    envDetail: "신원확인 기관이나 OpenDID 서비스에 연결하지 않습니다.",
    boundary: "앱 안에서 쓰는 K-Tour 패스 상태는 이 브라우저 탭에만 저장됩니다. 신원 확인이나 공식 신분증이 아니며, 신원확인 서비스와 연결되지 않고 DID·VC를 발급하지 않습니다. 선택한 문서와 개인정보도 저장하지 않습니다.",
    optional: "K-Tour ID", title: "확인 방법을 선택하세요",
    lead: "행동에 필요할 때 한 가지를 선택해요.",
    mobile: "모바일 신분증", mobileNote: "한국 모바일 신분증이 있다면",
    residence: "체류 카드", residenceNote: "한국에 등록된 외국인이라면",
    passport: "여권", passportEvidence: "여권 확인", passportNote: "한국 신분증이 없는 여행자라면", notConfigured: "미연결",
    methodUnavailable: "현재 이용할 수 없음", methodReview: "검토 경로", reviewTruth: "검토 경로 · 외부 서비스 확인 없음", presentationReviewPending: "검토용 · 외부 전송 없음", presentationReviewResult: "검토용 결과 · 전송 없음",
    separate: "여권 eKYC는 OmniOne CX가 아닌 별도 제공자입니다.", review: "동의 내용 보기", later: "나중에 — 게스트로 계속",
    consentTitle: "계속하기 전에 확인하세요", consentBody: "이 단계에 필요한 내용을 확인한 뒤 계속하세요.",
    requester: "요청자", requesterValue: "K-Tour ID", purpose: "목적", purposeValue: "이번 여행에서 사용할 K-Tour ID 준비",
    provider: "확인 경로", evidence: "요청 증빙", retention: "보관",
    mobileRetention: "모바일 신분증 원문·이름·생년월일·서명 콜백·기관 응답은 저장하지 않습니다. 이 탭에는 여행 자격과 민간 K-Tour 자격 상태만 남습니다.",
    residenceRetention: "외국인등록증 원문·이름·생년월일·서명 콜백·기관 응답은 저장하지 않습니다. 이 탭에는 여행 자격과 민간 K-Tour 자격 상태만 남습니다.",
    passportRetention: "검토 경로는 앱에 포함된 가림 처리 샘플만 사용합니다. 사용자 이미지·여권 항목·얼굴 이미지·기관 결과를 수집하거나 저장하지 않습니다.",
    wallet: "결제는 별도로 준비", walletConsent: "K-Tour ID는 잔액을 만들거나 연결하지 않습니다. 원화·달러는 나중에 ID·지갑에서 준비하세요.",
    consentDetails: "데이터·보관 상세",
    accept: "동의하고 계속", decline: "돌아가기", next: "계속",
    cx: "신분증 연결을 미리 볼게요", cxBody: "준비된 샘플로 다음 단계를 살펴봐요. 신분증 앱을 열거나 개인정보를 보내지 않아요.",
    handoffRoute: "신분증 확인 후 K-Tour ID로 돌아오는 과정", handoffConsent: "동의 내용 확인", handoffConsentNote: "동의한 증빙만 요청해요.",
    handoffCheck: "신분증 응답 검토", handoffCheckNote: "준비된 샘플 · 실제 기관 응답 아님",
    handoffReturn: "여행 패스에 담기", handoffReturnNote: "K-Tour ID에 보관할지 직접 선택해요.", handoffContinue: "샘플 응답 확인",
    document: "여권 면 확인", documentBody: "검토 경로는 가림 처리 샘플을 사용하며 여권 데이터를 수집하지 않습니다.",
    face: "얼굴 확인", faceBody: "준비되면 계속하세요.",
    processing: "다음 단계 준비 중", processingBody: "잠시 이 화면을 열어두세요.",
    holder: "여행 패스에 담기", holderBody: "이번 여행 패스와 함께 보관하세요.", holderLabel: "K-Tour ID",
    ready: "여행 패스 초안을 저장했어요", readyBody: "이번 여행에만 보관해요.",
    walletReady: "결제는 별도로 준비", walletReadyNote: "원화·달러는 나중에 ID·지갑에서 추가",
    present: "여행 자격 검토", request: "여행 자격 검토", requestBody: "최소한의 예/아니오 결과 하나를 이 화면에서만 확인합니다. 외부 서비스로 전송하지 않아요.",
    presentConsent: "이번 요청을 검토할까요?", presentConsentBody: "이번 한 번만 적용됩니다. 항상 허용은 없고 거절해도 초안은 바뀌지 않아요.",
    presentationRequester: "K-Tour ID 테이블", presentationPurpose: "이번 한 번의 요청을 위한 최소 여행 자격 확인",
    presentationEvidence: "K-Tour 여행 자격 · 예/아니오만", presentationRetention: "이번 요청에만 사용 · 자동 만료 · 결과 저장 안 함",
    presentationPredicate: "K-Tour 여행 자격 · 예/아니오만", presentationPredicateRetention: "한 번의 요청 · 결과 저장 안 함",
    presentationRequestEyebrow: "여행 자격 확인",
    presentationResultApproved: "검토용 결과", presentationResultNotApproved: "결과 없음", unchanged: "초안 변경 없음",
    approve: "한 번 검토", deny: "나중에", result: "검토 완료", resultBody: "예/아니오 결과를 이 화면에서만 확인했습니다. 전송하거나 저장하지 않았어요.",
    resultDenied: "전송된 내용 없음", resultDeniedBody: "이번 검토를 진행하지 않았습니다. 초안은 그대로이며 전송된 내용은 없어요.",
    resultExpired: "요청이 만료됐어요", resultExpiredBody: "승인 전에 일회성 요청이 만료됐습니다. 준비되면 새 요청을 시작하세요.",
    resultReplay: "이미 사용한 요청이에요", resultReplayBody: "일회성 요청은 다시 사용할 수 없습니다. 자격증명은 그대로 유지한 채 새 요청을 시작하세요.",
    presentationStatusDenied: "진행 안 함 · 전송 없음", presentationStatusExpired: "검토 만료", presentationStatusReplay: "이미 검토함", newRequest: "새 검토 시작",
    returnOnboarding: "한국 지도 열기", returnTraveler: "여행 패스로 돌아가기", returnAction: "하던 작업으로 돌아가기", backToKTourId: "K-Tour ID로 돌아가기",
    unavailable: "지금은 이 방법을 이용할 수 없어요", unavailableBody: "준비된 샘플로 이어보거나 여행으로 돌아가세요.", sample: "샘플로 계속",
    unavailableTechnical: "이 방법에 연결된 확인 기관이 없습니다.",
    assurance: "여권은 등록외국인 체류 자격을 확인하거나 외국인등록증 확인을 대신할 수 없어요.", usePassport: "여권으로 대신 확인",
    failure: "이 단계를 완료하지 못했어요", failureBody: "바뀐 내용은 없어요. 다시 확인하거나 다른 방법을 선택하세요.",
    expired: "설정 세션이 만료됐어요", expiredBody: "10분 설정 시간이 끝났습니다. 게스트 탐색은 유지한 채 새 경로를 시작하세요.", retry: "안전한 단계 다시 시도", another: "다른 경로 선택",
    expiredStatus: "이 로컬 자격증명은 만료됐습니다.", suspendedStatus: "이 로컬 자격증명은 정지됐습니다.", revokedStatus: "이 로컬 자격증명은 폐기됐습니다.",
    onDevice: "K-TOUR ID", mobileEyebrow: "모바일 신분증", faceEyebrow: "K-Tour ID", holderEyebrow: "여행 패스", holderMeta: "담을 준비 완료",
    protocolSummary: "K-Tour ID 안내",
    chooseStep: "선택", checkStep: "확인", issueStep: "담기", presentStep: "제시",
  },
  ja: {
    dialog: "K-Tour ID", close: "K-Tour ID設定を閉じる", back: "前のステップ",
    env: "K-Tour ID",
    envDetail: "本人確認事業者やOpenDIDサービスには接続しません。",
    boundary: "アプリ内で使うK-Tourパスの状態は、このブラウザタブだけに保存されます。本人確認や公的身分証ではなく、本人確認サービスには接続せず、DID・VCも発行しません。選択した書類や個人情報も保存しません。",
    optional: "K-Tour ID", title: "確認方法を選択",
    lead: "操作に必要な時に一つ選びます。",
    mobile: "モバイルID", mobileNote: "韓国のモバイルIDをお持ちの方",
    residence: "在留カード", residenceNote: "韓国で外国人登録済みの方",
    passport: "パスポート", passportEvidence: "パスポート確認", passportNote: "韓国のIDを持たない旅行者の方", notConfigured: "未接続",
    methodUnavailable: "現在利用できません", methodReview: "検証用ルート", reviewTruth: "検証用ルート・外部サービスによる確認なし", presentationReviewPending: "レビュー用 · 外部送信なし", presentationReviewResult: "レビュー結果 · 送信なし",
    separate: "パスポートeKYCはOmniOne CXではなく別の事業者です。", review: "同意内容を確認", later: "今はしない — ゲスト利用を続ける",
    consentTitle: "続ける前に確認", consentBody: "この手順に必要な内容を確認してから続けてください。",
    requester: "依頼者", requesterValue: "K-Tour ID", purpose: "目的", purposeValue: "今回の旅行で使うK-Tour IDを準備",
    provider: "確認ルート", evidence: "依頼する証拠", retention: "保持",
    mobileRetention: "モバイルID本文、氏名、生年月日、署名済みコールバック、事業者結果は保存しません。このタブには旅行資格と民間K-Tour資格状態だけが残ります。",
    residenceRetention: "在留カード本文、氏名、生年月日、署名済みコールバック、事業者結果は保存しません。このタブには旅行資格と民間K-Tour資格状態だけが残ります。",
    passportRetention: "検証ルートではアプリ内のマスキング済みサンプルだけを使います。利用者の画像、パスポート項目、顔画像、事業者結果は収集・保存しません。",
    wallet: "支払いは別に設定", walletConsent: "K-Tour IDは残高を作成・接続しません。KRWまたはUSDは後からID・ウォレットで追加できます。",
    consentDetails: "データと保存の詳細",
    accept: "同意して続ける", decline: "戻る", next: "続ける",
    cx: "ID連携をプレビュー", cxBody: "用意されたサンプルで次の手順を確認します。IDアプリは開かず、個人情報も送信しません。",
    handoffRoute: "ID確認からK-Tour IDに戻るまで", handoffConsent: "同意内容を確認", handoffConsentNote: "同意した証明だけを依頼します。",
    handoffCheck: "IDの応答をレビュー", handoffCheckNote: "サンプル・実際の事業者応答ではありません。",
    handoffReturn: "トラベルパスに追加", handoffReturnNote: "K-Tour IDに保存するか自分で選べます。", handoffContinue: "サンプル応答を確認",
    document: "パスポート面を確認", documentBody: "検証ルートではマスキング済みサンプルを使い、パスポート情報を収集しません。",
    face: "顔確認", faceBody: "準備ができたら続けてください。",
    processing: "次の手順を準備中", processingBody: "この画面をしばらく開いたままにしてください。",
    holder: "トラベルパスに追加", holderBody: "今回のトラベルパスと一緒に保管します。", holderLabel: "K-Tour ID",
    ready: "トラベルパスの下書きを保存しました", readyBody: "今回の旅行だけに保持します。",
    walletReady: "支払いは別に設定", walletReadyNote: "KRWまたはUSDは後からID・ウォレットで追加",
    present: "旅行資格をレビュー", request: "旅行資格をレビュー", requestBody: "最小限の可否結果をこの画面だけで確認します。外部サービスには送信しません。",
    presentConsent: "今回の依頼をレビューしますか？", presentConsentBody: "今回一回だけ適用します。「常に許可」はなく、進めなくても下書きは変わりません。",
    presentationRequester: "K-Tour ID テーブル", presentationPurpose: "今回一回の依頼に必要な最小限の旅行資格確認",
    presentationEvidence: "K-Tour旅行資格 · 可否のみ", presentationRetention: "今回の依頼だけに使用 · 自動で期限切れ · 結果は保存しない",
    presentationPredicate: "K-Tour旅行資格 · 可否のみ", presentationPredicateRetention: "一回の依頼 · 結果は保存しない",
    presentationRequestEyebrow: "旅行資格の確認",
    presentationResultApproved: "レビュー結果", presentationResultNotApproved: "結果なし", unchanged: "下書き変更なし",
    approve: "一回レビュー", deny: "今はしない", result: "レビュー完了", resultBody: "可否結果はこの画面だけに表示しました。送信・保存していません。",
    resultDenied: "送信なし", resultDeniedBody: "今回のレビューは進めませんでした。下書きは変わらず、送信した内容はありません。",
    resultExpired: "依頼の有効期限が切れました", resultExpiredBody: "承認前に一回限りの依頼が期限切れになりました。準備ができたら新しい依頼を始めてください。",
    resultReplay: "使用済みの依頼です", resultReplayBody: "一回限りの依頼は再利用できません。資格情報を変えずに新しい依頼を始めてください。",
    presentationStatusDenied: "未実施 · 送信なし", presentationStatusExpired: "レビュー期限切れ", presentationStatusReplay: "レビュー済み", newRequest: "新しいレビューを始める",
    returnOnboarding: "韓国マップを開く", returnTraveler: "トラベルパスに戻る", returnAction: "元の操作に戻る", backToKTourId: "K-Tour IDに戻る",
    unavailable: "現在この方法は利用できません", unavailableBody: "用意されたサンプルで続けるか、旅行に戻れます。", sample: "サンプルで続ける",
    unavailableTechnical: "この方法に接続された確認事業者はありません。",
    assurance: "パスポートでは登録外国人としての在留資格を確認できず、在留カード確認の代わりにはなりません。", usePassport: "パスポートで確認",
    failure: "この手順を完了できませんでした", failureBody: "変更はありません。もう一度確認するか別の方法を選べます。",
    expired: "設定セッションが期限切れです", expiredBody: "10分の設定時間が終了しました。ゲスト利用を失わず新しい方法を始められます。", retry: "安全な段階を再試行", another: "別の方法を選ぶ",
    expiredStatus: "このローカル資格情報は期限切れです。", suspendedStatus: "このローカル資格情報は停止中です。", revokedStatus: "このローカル資格情報は失効済みです。",
    onDevice: "K-TOUR ID", mobileEyebrow: "モバイルID", faceEyebrow: "K-Tour ID", holderEyebrow: "トラベルパス", holderMeta: "追加できます",
    protocolSummary: "K-Tour IDについて",
    chooseStep: "選択", checkStep: "確認", issueStep: "追加", presentStep: "提示",
  },
} satisfies Record<OndoBLocale, Record<string, string>>

const FOCUSABLE = "button:not([disabled]),input:not([disabled]):not([tabindex='-1']),summary,[href],[tabindex]:not([tabindex='-1'])"
function methodDetails(method: OndoBIdentityMethod, copy: typeof COPY.en) {
  if (method === "mobile_id") return { title: copy.mobile, note: copy.mobileNote, provider: "OmniOne CX", evidence: copy.mobile, retention: copy.mobileRetention }
  if (method === "mobile_residence_card") return { title: copy.residence, note: copy.residenceNote, provider: "OmniOne CX", evidence: copy.residence, retention: copy.residenceRetention }
  return { title: copy.passport, note: copy.passportNote, provider: `${copy.separate} ${copy.passportEvidence} · ${copy.notConfigured}`, evidence: copy.passportEvidence, retention: copy.passportRetention }
}

function progressStep(phase: Phase) {
  if (phase === "method_select" || phase === "recovery_intro") return 1
  if (["consent", "cx_handoff_preview", "document_preview", "face_liveness_preview", "provider_processing_preview", "unavailable", "failed", "expired", "cancelled", "manual_review"].includes(phase)) return 2
  if (["holder_delivery_preview", "credential_ready", "verified_person_consent"].includes(phase)) return 3
  return 4
}

export function KTourIdSetupB() {
  const { state } = useOndoB()
  const review = useIdentityReviewModeB()
  const [passport, setPassport] = useState(false)
  useEffect(() => { if (!state.identitySetupOrigin) setPassport(false) }, [state.identitySetupOrigin])
  if (!review && !passport) return <JitPassSetupB onPassport={SUMSUB_PASSPORT_ENABLED ? () => setPassport(true) : undefined} />
  return <ReviewKTourIdSetupB />
}

function ReviewKTourIdSetupB() {
  const { state, actions } = useOndoB()
  const reviewMode = useIdentityReviewModeB()
  const desiredOrigin = state.identitySetupOrigin
  const setupPresence = useSheetPresence(desiredOrigin)
  const origin = setupPresence.value
  const closing = setupPresence.phase === "closing"
  const [method, setMethod] = useState<OndoBIdentityMethod>("passport_ekyc")
  const sumsubEnabled = SUMSUB_PASSPORT_ENABLED
  const sumsubStepRef = useRef<SumsubPassportStepHandle>(null)
  const [phase, setPhase] = useState<Phase>("method_select")
  const [session, setSession] = useState<OndoBIdentitySetupSession | null>(null)
  const [recoveryCode, setRecoveryCode] = useState<OndoBIdentityRecoveryCode | null>(null)
  const [retryPhase, setRetryPhase] = useState<Phase>("consent")
  const [presentationApproved, setPresentationApproved] = useState<boolean | null>(null)
  const [presentationRequest, setPresentationRequest] = useState<OndoBPresentationRequest | null>(null)
  const [credentialClock, setCredentialClock] = useState(() => Date.now())
  const [sampleCase, setSampleCase] = useState<IdentityJourneySample>("success")
  const [manualReview, setManualReview] = useState<IdentityManualReview | null>(null)
  const [manualOutcome, setManualOutcome] = useState<IdentityManualOutcome>("approved")
  const [manualChecking, setManualChecking] = useState(false)
  const [sampleRecovery, setSampleRecovery] = useState(false)
  const [fullPassChecks, setFullPassChecks] = useState(false)
  const [boundaryRetry, setBoundaryRetry] = useState(false)
  const [recoveryKind, setRecoveryKind] = useState<"renew" | "device">("renew")
  const sampleConsumedRef = useRef(false)
  const manualTimerRef = useRef<number | null>(null)
  const sessionRef = useRef(session)
  const manualReviewRef = useRef(manualReview)
  sessionRef.current = session
  manualReviewRef.current = manualReview
  const consumedSetupQaRef = useRef<OndoBIdentityRecoveryCode | null>(null)
  const consumedPresentationQaRef = useRef<OndoBIdentityRecoveryCode | null>(null)
  const issuedOnceRef = useRef(false)
  const holderReceiptRef = useRef(false)
  const experiencePersonRef = useRef<BExperiencePersonHandoff | null>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const exitRequestedRef = useRef(false)
  const restoreFocusAfterExitRef = useRef(false)
  const openerRef = useRef<HTMLElement | null>(null)
  const returnOriginRef = useRef<typeof origin>(null)
  const previousDesiredOriginRef = useRef<typeof desiredOrigin>(null)
  const desiredOriginRef = useRef(desiredOrigin)
  const exitVisualSnapshotRef = useRef<ReactNode>(null)
  desiredOriginRef.current = desiredOrigin
  const active = origin !== null
  const finalExitActive = closing || exitRequestedRef.current || desiredOrigin === null
  const copy = COPY[state.locale]
  const sampleCopy = SAMPLE_COPY[state.locale]
  const sandboxPassport = sumsubEnabled && !sampleRecovery && !fullPassChecks && !reviewMode && method === "passport_ekyc" && phase !== "method_select"
  const sandboxDisclosure = SUMSUB_PASSPORT_DISCLOSURE[state.locale]
  const details = sandboxPassport
    ? { title: copy.passport, note: copy.passportNote, provider: sandboxDisclosure.provider, evidence: sandboxDisclosure.evidence, retention: sandboxDisclosure.retention }
    : methodDetails(method, copy)
  const injectedStatus = reviewMode ? readQaRuntime<QaRuntime>()?.identity?.credentialStatus ?? readQaRuntime<QaRuntime>()?.credentialStatus : undefined
  const naturalCredentialStatus = simulatedCredentialStatusB(state.identityCredential, credentialClock)
  const credentialStatus: OndoBCredentialStatus = injectedStatus ?? naturalCredentialStatus
  const returnLabel = origin === "onboarding" ? copy.returnOnboarding : origin === "action_gate" ? copy.returnAction : copy.returnTraveler
  const steps = [copy.chooseStep, copy.checkStep, sandboxPassport ? sandboxDisclosure.returnStep : copy.issueStep]
  const currentStep = progressStep(phase)
  const presentationPhase = phase === "presentation_request" || phase === "presentation_consent" || phase === "presentation_result"
  const reviewScopeLabel = phase === "presentation_result"
    ? copy.presentationReviewResult
    : presentationPhase
      ? copy.presentationReviewPending
      : copy.reviewTruth

  const routes = useMemo(() => [
    { id: "mobile_id" as const, icon: Smartphone, title: copy.mobile, note: copy.mobileNote, oldId: "ktour-id-route-mobile-id", newId: "k-tour-id-method-mobile-id" },
    { id: "mobile_residence_card" as const, icon: IdCard, title: copy.residence, note: copy.residenceNote, oldId: "ktour-id-route-residence-card", newId: "k-tour-id-method-mobile-residence-card" },
    { id: "passport_ekyc" as const, icon: BookOpenCheck, title: copy.passport, note: copy.passportNote, oldId: "ktour-id-route-passport", newId: "k-tour-id-method-passport-ekyc" },
  ], [copy])

  useLayoutEffect(() => {
    const previousOrigin = previousDesiredOriginRef.current
    if (desiredOrigin !== null) {
      // A rapid reopen keeps the original outside control rather than capturing
      // an inert control from the retained outgoing sheet as its own opener.
      if (previousOrigin === null && (!openerRef.current || setupPresence.value === null)) {
        const activeElement = document.activeElement
        openerRef.current = activeElement instanceof HTMLElement && activeElement !== document.body && !layerRef.current?.contains(activeElement)
          ? activeElement
          : null
      }
      returnOriginRef.current = desiredOrigin
      restoreFocusAfterExitRef.current = false
      exitRequestedRef.current = false
    } else if (previousOrigin !== null) {
      // External traversal/reset is a real final dismissal too. Presence keeps
      // the last paint mounted; focus restoration waits for its actual removal.
      restoreFocusAfterExitRef.current = true
      returnOriginRef.current = previousOrigin
    }
    previousDesiredOriginRef.current = desiredOrigin
  }, [desiredOrigin, setupPresence.value])

  useEffect(() => {
    if (setupPresence.value !== null || !restoreFocusAfterExitRef.current) return
    restoreFocusAfterExitRef.current = false
    let cancelFallback = () => {}
    const frame = window.requestAnimationFrame(() => {
      // A new setup may replace the old subject before the retained frame is
      // removed. Never let the stale close steal focus from that new session.
      if (desiredOriginRef.current !== null) return
      const opener = openerRef.current
      openerRef.current = null
      exitVisualSnapshotRef.current = null
      if (opener?.isConnected && isRenderedFocusable(opener)) {
        opener.focus({ preventScroll: true })
        if (document.activeElement === opener) return
      }
      const fallback = returnOriginRef.current === "action_gate"
        ? ["[data-testid='ondo-b-action-gate'] [data-action-gate-initial-focus]", "[data-testid='ondo-b-action-gate'] button:not([disabled])", "[data-testid='nav-tables']", "[data-testid='nav-id']", "[data-testid='nav-ondo']"]
        : returnOriginRef.current === "traveler_id"
          ? ["[data-testid='kpass-manage-setup']", "[data-testid='kpass-start-setup']", "[data-testid='traveler-id-ktour-id-open']", "[data-testid='nav-id']", "[data-testid='nav-ondo']"]
          : ["[data-testid='ondo-onboarding-backdrop'] button:not([disabled])", "[data-testid='nav-ondo']"]
      cancelFallback = focusFirstAvailableDestination(fallback)
    })
    return () => { window.cancelAnimationFrame(frame); cancelFallback() }
  }, [setupPresence.value])

  useLayoutEffect(() => {
    if (!desiredOrigin || closing || exitRequestedRef.current) return
    const handoff = desiredOrigin === "action_gate" && !state.identityCredential && reviewMode
      ? createBExperiencePersonHandoff(window.sessionStorage, new Date(), { ...qaReviewFixtureOptions(), credential: state.identityCredential }) : null
    experiencePersonRef.current = handoff
    setMethod(handoff ? "mobile_id" : state.identityCredential?.method ?? "passport_ekyc")
    let additionalChecks = false
    if (desiredOrigin === "action_gate" && isPersonOnlySimulatedCredentialB(state.identityCredential)) {
      try { const pending = restoreBActionGateSession(window.sessionStorage, new Date(), qaReviewFixtureOptions()).pending; additionalChecks = Boolean(pending && pending.cta !== "REDEEM_DEMO_ENTITLEMENT") } catch { /* Preserve the existing pass when the gate cannot be read. */ }
    }
    setFullPassChecks(additionalChecks)
    setPhase(additionalChecks ? "method_select" : state.identityCredential ? "credential_ready" : handoff ? "verified_person_consent" : "method_select")
    setSession(null); setRecoveryCode(null); setPresentationApproved(null); setPresentationRequest(null)
    setCredentialClock(Date.now())
    consumedSetupQaRef.current = null
    consumedPresentationQaRef.current = null
    issuedOnceRef.current = !additionalChecks && Boolean(state.identityCredential)
    setSampleCase("success"); sampleConsumedRef.current = false
    setManualReview(null); setManualChecking(false); setManualOutcome("approved")
    setSampleRecovery(false)
    setBoundaryRetry(false); holderReceiptRef.current = false
  }, [closing, desiredOrigin, state.identityCredential, reviewMode])

  useEffect(() => {
    if (!active || finalExitActive || !session || ["method_select", "recovery_intro", "credential_ready"].includes(phase) || presentationPhase) return
    const expire = () => {
      setRecoveryCode("IDENTITY_SESSION_EXPIRED")
      setPhase("expired")
    }
    const delay = session.expiresAt - Date.now()
    if (delay <= 0) { expire(); return }
    const timer = window.setTimeout(expire, delay + 16)
    return () => window.clearTimeout(timer)
  }, [active, finalExitActive, phase, presentationPhase, session])

  useEffect(() => {
    if (phase !== "manual_review" || !active || finalExitActive) setManualChecking(false)
    return () => {
      if (manualTimerRef.current !== null) window.clearTimeout(manualTimerRef.current)
      manualTimerRef.current = null
    }
  }, [active, finalExitActive, phase])

  useEffect(() => {
    if (!active || finalExitActive || !state.identityCredential) return
    const delay = state.identityCredential.expiresAt - Date.now()
    if (delay <= 0) { setCredentialClock(Date.now()); return }
    const timer = window.setTimeout(() => setCredentialClock(Date.now()), delay + 16)
    return () => window.clearTimeout(timer)
  }, [active, finalExitActive, state.identityCredential])

  useEffect(() => {
    if (!active || finalExitActive || !presentationRequest || !["presentation_request", "presentation_consent"].includes(phase)) return
    const expire = () => {
      setPresentationApproved(false)
      setRecoveryCode("PRESENTATION_REQUEST_EXPIRED")
      setPhase("presentation_result")
    }
    const delay = presentationRequest.expiresAt - Date.now()
    if (delay <= 0) { expire(); return }
    const timer = window.setTimeout(expire, delay + 16)
    return () => window.clearTimeout(timer)
  }, [active, finalExitActive, phase, presentationRequest])

  useEffect(() => {
    if (!active || finalExitActive || phase !== "provider_processing_preview") return
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const timer = window.setTimeout(() => {
      if (exitRequestedRef.current || desiredOriginRef.current === null) return
      if (!session || !isIdentitySetupSessionActiveB(session)) {
        setRecoveryCode("IDENTITY_SESSION_EXPIRED")
        setRetryPhase("consent")
        setPhase("expired")
        return
      }
      if (applySampleCheckpoint("provider", "provider_processing_preview")) return
      // Evidence creation, credential preparation and holder delivery remain
      // distinct protocol boundaries, but they are one user decision. Do not
      // leak three implementation screens into the mobile journey.
      setPhase("holder_delivery_preview")
    }, reducedMotion ? 80 : 620)
    return () => window.clearTimeout(timer)
  }, [active, finalExitActive, phase, sampleCase, session])

  useModalIsolation(active, layerRef)
  useDocumentScrollLock(active)

  useEffect(() => {
    if (!active || finalExitActive) return
    const frame = window.requestAnimationFrame(() => {
      if (layerRef.current?.closest("[inert],[aria-hidden='true']")) return
      dialogRef.current?.scrollTo({ top: 0, behavior: "instant" })
      ;(dialogRef.current?.querySelector<HTMLElement>("[data-identity-initial-focus]") ?? dialogRef.current)?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [active, finalExitActive, phase])

  function consumeFinalExitInput(event: SyntheticEvent) {
    if (!closing && !exitRequestedRef.current && desiredOriginRef.current !== null) return
    event.preventDefault()
    event.stopPropagation()
    event.nativeEvent.stopImmediatePropagation()
  }

  function beginFinalDismiss() {
    if (!origin || closing || exitRequestedRef.current || desiredOriginRef.current === null) return false
    // Freeze before the provider publishes any credential/origin mutation. The
    // retained React frame therefore remains the exact phase and method the
    // person acted on, including action-gate completion.
    exitRequestedRef.current = true
    restoreFocusAfterExitRef.current = true
    returnOriginRef.current = origin
    return true
  }

  function finishFinalDismiss() {
    if (!beginFinalDismiss()) return
    actions.closeIdentitySetup()
  }

  function requestFinalDismiss() {
    if (sumsubStepRef.current) {
      void sumsubStepRef.current.requestExit().then(allowed => { if (allowed) finishFinalDismiss() })
      return
    }
    finishFinalDismiss()
  }

  useEffect(() => {
    if (!active) return
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (layerRef.current?.closest("[inert],[aria-hidden='true']")) return
      event.preventDefault(); event.stopImmediatePropagation()
      if (closing || exitRequestedRef.current) return
      requestFinalDismiss()
    }
    document.addEventListener("keydown", onEscape, true)
    return () => document.removeEventListener("keydown", onEscape, true)
  }, [active, closing])

  if (!active || !origin) return null

  function fail(code: OndoBIdentityRecoveryCode, safePhase: Phase) {
    setRecoveryCode(code); setRetryPhase(safePhase)
    setPhase(code === "IDENTITY_SESSION_EXPIRED" ? "expired" : code === "IDENTITY_METHOD_UNAVAILABLE" ? "unavailable" : "failed")
  }

  function startManualReview() {
    if (!reviewMode || !session || !isIdentitySetupSessionActiveB(session)) return fail("IDENTITY_SESSION_EXPIRED", "consent")
    setManualReview(createIdentityManualReview(session.nonce, Date.now(), session.expiresAt))
    setManualOutcome("approved")
    setManualChecking(false)
    setRecoveryCode("MANUAL_REVIEW_REQUIRED")
    setPhase("manual_review")
  }

  function applySampleCheckpoint(checkpoint: IdentitySampleCheckpoint, safePhase: Phase) {
    if (!reviewMode) return false
    const interruption = identitySampleInterruption(sampleCase, method, checkpoint, sampleConsumedRef.current)
    if (!interruption) return false
    sampleConsumedRef.current = true
    setRetryPhase(safePhase)
    setRecoveryCode(interruption.code)
    if (interruption.phase === "manual_review") startManualReview()
    else setPhase(interruption.phase)
    return true
  }

  function checkManualStatus() {
    if (!reviewMode || manualChecking || manualReview?.status !== "pending" || !session) return
    const expected = manualReview
    const nonce = session.nonce
    const outcome = manualOutcome
    setManualChecking(true)
    manualTimerRef.current = window.setTimeout(() => {
      manualTimerRef.current = null
      if (exitRequestedRef.current || desiredOriginRef.current === null || manualReviewRef.current !== expected || sessionRef.current?.nonce !== nonce) return
      const result = resolveIdentityManualReview(expected, outcome, nonce)
      setManualReview(result)
      setManualChecking(false)
      if (result.status === "expired") fail("IDENTITY_SESSION_EXPIRED", "consent")
    }, 420)
  }

  function continueReviewedSample() {
    if (!reviewMode || !session || !mayDeliverIdentityManualReview(manualReview, session.nonce)) return fail("IDENTITY_SESSION_EXPIRED", "consent")
    setRecoveryCode(null)
    setPhase("holder_delivery_preview")
  }

  function supplyReviewSample() {
    if (!reviewMode || manualReview?.status !== "needs_info") return
    setManualReview(null)
    setSampleCase("manual_review")
    sampleConsumedRef.current = false
    setPhase("document_preview")
  }

  function startFreshRequest() {
    experiencePersonRef.current = null
    setSession(null); setManualReview(null); setRecoveryCode(null)
    setSampleCase("success"); sampleConsumedRef.current = false
    setBoundaryRetry(false); holderReceiptRef.current = false
    setPhase("method_select")
  }

  function retrySampleStep() {
    if (sampleConsumedRef.current && sampleCase === "nfc_unsupported") return startManualReview()
    if (sampleConsumedRef.current && ["unsupported_document", "document_auth_failed", "app_missing"].includes(sampleCase)) return startFreshRequest()
    if (sampleConsumedRef.current && sampleCase === "callback_invalid") {
      setSession(null); setRecoveryCode(null); setPhase("consent")
      return
    }
    setRecoveryCode(null)
    setPhase(retryPhase)
  }

  function beginSampleRecovery(kind: "renew" | "device") {
    if (!reviewMode || !state.identityCredential) return
    setFullPassChecks(false)
    setRecoveryKind(kind)
    setPhase("recovery_intro")
  }

  function beginAdditionalPassChecks() {
    if (!reviewMode || !isPersonOnlySimulatedCredentialB(state.identityCredential)) return
    setSampleRecovery(false); setFullPassChecks(true); issuedOnceRef.current = false
    startFreshRequest()
  }

  function confirmSampleRecovery() {
    if (!reviewMode || !state.identityCredential) return
    // Keep the old credential until the consent/check/holder journey succeeds.
    // The provider reissues this sample's proof revision, retaining all claims
    // and economic lineage. This does not repair a real ID or reset benefits.
    issuedOnceRef.current = false
    setSampleRecovery(true)
    startFreshRequest()
  }

  function chooseMethod(nextMethod: OndoBIdentityMethod) {
    if (sampleRecovery && nextMethod !== state.identityCredential?.method) return
    setMethod(nextMethod)
    setRecoveryCode(null)
    setSampleCase("success"); sampleConsumedRef.current = false; setManualReview(null)
    if (!reviewMode && !(sumsubEnabled && !sampleRecovery && !fullPassChecks && nextMethod === "passport_ekyc")) {
      setRetryPhase("method_select")
      setPhase("unavailable")
      return
    }
    setPhase("consent")
  }

  function continueWithSample() {
    if (!enterReviewSample()) return
    setRecoveryCode(null)
    setRetryPhase("consent")
    setPhase("consent")
  }

  function advance(next: Phase, safePhase = phase) {
    if (!reviewMode) return fail("IDENTITY_METHOD_UNAVAILABLE", "method_select")
    if (!session || !isIdentitySetupSessionActiveB(session)) return fail("IDENTITY_SESSION_EXPIRED", "consent")
    const checkpoint = phase === "document_preview" ? "document" : phase === "face_liveness_preview" ? "face" : phase === "cx_handoff_preview" ? "handoff" : null
    if (checkpoint && applySampleCheckpoint(checkpoint, safePhase)) return
    const qa = readQaRuntime<QaRuntime>()
    const outcome = qa?.identity?.outcome ?? qa?.identitySetupOutcome ?? "success"
    if (outcome !== "success" && consumedSetupQaRef.current !== outcome) {
      consumedSetupQaRef.current = outcome
      return fail(outcome, safePhase)
    }
    setPhase(next)
  }

  function acceptConsent() {
    if (sandboxPassport) {
      setSession(null)
      setRecoveryCode(null)
      setPhase("sumsub_sandbox")
      return
    }
    if (!reviewMode) return fail("IDENTITY_METHOD_UNAVAILABLE", "method_select")
    setSession(createIdentitySetupSessionB(origin!, method))
    setRecoveryCode(null)
    holderReceiptRef.current = false; setBoundaryRetry(false)
    setPhase(method === "passport_ekyc" ? "document_preview" : "cx_handoff_preview")
  }

  function experienceHandoffCurrent() {
    const handoff = experiencePersonRef.current
    return Boolean(handoff && origin === "action_gate" && reviewMode && !state.identityCredential
      && isBExperiencePersonHandoffCurrent(window.sessionStorage, handoff, new Date(), qaReviewFixtureOptions()))
  }
  function acceptCheckedPerson() {
    if (!experienceHandoffCurrent()) return fail("IDENTITY_SESSION_EXPIRED", "verified_person_consent")
    // Explicit issuance consent follows the already completed Person check.
    // It does not repeat the provider and does not itself issue a credential.
    setSession(createIdentitySetupSessionB("action_gate", "mobile_id"))
    setRecoveryCode(null); holderReceiptRef.current = false; setBoundaryRetry(false)
    setPhase("holder_delivery_preview")
  }

  function interruptBoundary(reason: "cancelled" | "timeout" | "expired", safePhase: Phase) {
    holderReceiptRef.current = false
    if (reason === "expired") return fail("IDENTITY_SESSION_EXPIRED", "consent")
    if (reason === "timeout") return fail("PROVIDER_TIMEOUT", safePhase)
    setRecoveryCode("CONSENT_DECLINED"); setRetryPhase(safePhase); setBoundaryRetry(true); setPhase("cancelled")
  }

  function resumeCancelledBoundary() {
    if (!boundaryRetry) return startFreshRequest()
    setRecoveryCode(null); setBoundaryRetry(false)
    setPhase(session && isIdentitySetupSessionActiveB(session) ? retryPhase : "consent")
  }

  function prepareHolder() {
    holderReceiptRef.current = false
    if (!reviewMode) { fail("IDENTITY_METHOD_UNAVAILABLE", "method_select"); return false }
    if (experiencePersonRef.current && !experienceHandoffCurrent()) { fail("IDENTITY_SESSION_EXPIRED", "verified_person_consent"); return false }
    if (!session || !isIdentitySetupSessionActiveB(session)) { fail("IDENTITY_SESSION_EXPIRED", "consent"); return false }
    if (manualReview && !mayDeliverIdentityManualReview(manualReview, session.nonce)) { fail("MANUAL_REVIEW_REQUIRED", "consent"); return false }
    if (applySampleCheckpoint("holder", "holder_delivery_preview")) return false
    holderReceiptRef.current = true
    return true
  }

  function finishHolder() {
    if (issuedOnceRef.current) return setPhase("credential_ready")
    if (!holderReceiptRef.current || !reviewMode) return
    if (experiencePersonRef.current && !experienceHandoffCurrent()) return fail("IDENTITY_SESSION_EXPIRED", "verified_person_consent")
    if (!session || !isIdentitySetupSessionActiveB(session)) return fail("IDENTITY_SESSION_EXPIRED", "holder_delivery_preview")
    if (manualReview && !mayDeliverIdentityManualReview(manualReview, session.nonce)) return fail("MANUAL_REVIEW_REQUIRED", "consent")
    if (applySampleCheckpoint("holder", "holder_delivery_preview")) return
    const fixtureId = method === "mobile_id" ? "FX-PER-CX-SUCCESS" : method === "mobile_residence_card" ? "FX-PER-RESIDENCE-SUCCESS" : "FX-PER-PASSPORT-SUCCESS"
    const authority = createReviewFixtureAuthority({ qaRuntimeEnabled: reviewMode, explicitlyRequested: reviewMode, fixtureId })
    const execution = authority ? reviewFixture(authority, { outcome: "success", value: { method, result: "travel_pass_draft" as const } }) : providerUnavailable("credential")
    if (execution.result !== "FIXTURE_SUCCESS") return fail("IDENTITY_METHOD_UNAVAILABLE", "method_select")
    if (origin === "action_gate" && !beginFinalDismiss()) return
    holderReceiptRef.current = false
    issuedOnceRef.current = true
    const saved = actions.completeIdentitySetup(method, experiencePersonRef.current
      ? { issuanceScope: "person", experiencePersonHandoff: experiencePersonRef.current }
      : sampleRecovery ? { sampleRecovery: true } : undefined)
    if (!saved) {
      issuedOnceRef.current = false
      exitRequestedRef.current = false
      restoreFocusAfterExitRef.current = false
      return fail("IDENTITY_SESSION_EXPIRED", experiencePersonRef.current ? "verified_person_consent" : "holder_delivery_preview")
    }
    // The provider atomically closes an action-gate setup with issuance so the
    // coordinator cannot reopen a missing-credential layer between updates.
    if (origin === "action_gate") return
    setPhase("credential_ready")
  }

  function openPresentation() {
    const credential = state.identityCredential
    if (!credential || !isSimulatedCredentialActiveB(credential)) {
      setCredentialClock(Date.now())
      return
    }
    setPresentationRequest(createPresentationRequestB())
    setPresentationApproved(null)
    setRecoveryCode(null)
    setPhase("presentation_request")
  }

  function continuePresentation() {
    if (!presentationRequest || !isPresentationRequestActiveB(presentationRequest)) {
      setPresentationApproved(false)
      setRecoveryCode("PRESENTATION_REQUEST_EXPIRED")
      setPhase("presentation_result")
      return
    }
    setPhase("presentation_consent")
  }

  function completePresentation(decision: "approve" | "deny") {
    if (!presentationRequest) {
      setPresentationApproved(false)
      setRecoveryCode("PRESENTATION_REQUEST_EXPIRED")
      setPhase("presentation_result")
      return
    }

    const credential = state.identityCredential
    const decisionAt = Date.now()
    if (!credential || !isSimulatedCredentialActiveB(credential, decisionAt)) {
      setCredentialClock(decisionAt)
      setPresentationApproved(false)
      setRecoveryCode("CREDENTIAL_EXPIRED")
      setPhase("credential_ready")
      return
    }

    const injected = readQaRuntime<QaRuntime>()?.identity?.presentationOutcome
    const outcome = injected && consumedPresentationQaRef.current !== injected ? injected : null
    if (outcome) consumedPresentationQaRef.current = outcome

    let resolution
    if (outcome === "PRESENTATION_REPLAY") {
      const firstUseAt = Math.max(presentationRequest.issuedAt, Math.min(Date.now(), presentationRequest.expiresAt - 2))
      const consumed = resolvePresentationRequestB(presentationRequest, "approve", firstUseAt).request
      resolution = resolvePresentationRequestB(consumed, "approve", firstUseAt + 1)
    } else {
      const now = outcome === "PRESENTATION_REQUEST_EXPIRED" ? presentationRequest.expiresAt : decisionAt
      resolution = resolvePresentationRequestB(presentationRequest, outcome === "PRESENTATION_DENIED" ? "deny" : decision, now)
    }

    setPresentationRequest(resolution.request)
    setPresentationApproved(resolution.approved)
    setRecoveryCode(resolution.code)
    setPhase("presentation_result")
  }

  function goBack() {
    if (phase === "sumsub_sandbox") { requestFinalDismiss(); return }
    holderReceiptRef.current = false
    // The saved result is terminal. Reopening method selection would promise
    // another issuance that the one-shot holder guard correctly refuses.
    // Renewal/device recovery remain explicit, separately consented journeys.
    if (phase === "credential_ready") { requestFinalDismiss(); return }
    if (phase === "recovery_intro") { setPhase("credential_ready"); return }
    if (experiencePersonRef.current && phase === "holder_delivery_preview") { setPhase("verified_person_consent"); return }
    const previous: Partial<Record<Phase, Phase>> = {
      consent: "method_select", cx_handoff_preview: "consent", document_preview: "consent",
      face_liveness_preview: "document_preview", provider_processing_preview: method === "passport_ekyc" ? "face_liveness_preview" : "cx_handoff_preview",
      holder_delivery_preview: method === "passport_ekyc" ? "face_liveness_preview" : "cx_handoff_preview",
      presentation_request: "credential_ready", presentation_consent: "presentation_request", presentation_result: "credential_ready",
    }
    setPhase(previous[phase] ?? "method_select")
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (closing || exitRequestedRef.current) { event.preventDefault(); event.stopPropagation(); return }
    if (event.key !== "Tab") return
    const elements = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(isRenderedFocusable)
    const first = elements[0]; const last = elements.at(-1)
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  const statusMessage = credentialStatus === "expired" ? copy.expiredStatus : credentialStatus === "suspended" ? copy.suspendedStatus : credentialStatus === "revoked" ? copy.revokedStatus : null
  const credentialSurfaceStatus = credentialStatus === "none"
    ? "none"
    : statusMessage
      ? credentialStatus
      : isReviewCredentialDraftB(state.identityCredential)
        ? "review-draft"
        : "unavailable"
  const presentationNeedsNewRequest = recoveryCode === "PRESENTATION_REQUEST_EXPIRED" || recoveryCode === "PRESENTATION_REPLAY"
  const presentationResultTitle = recoveryCode === "PRESENTATION_DENIED"
    ? copy.resultDenied
    : recoveryCode === "PRESENTATION_REQUEST_EXPIRED"
      ? copy.resultExpired
      : recoveryCode === "PRESENTATION_REPLAY"
        ? copy.resultReplay
        : copy.result
  const presentationResultBody = recoveryCode === "PRESENTATION_DENIED"
    ? copy.resultDeniedBody
    : recoveryCode === "PRESENTATION_REQUEST_EXPIRED"
      ? copy.resultExpiredBody
      : recoveryCode === "PRESENTATION_REPLAY"
        ? copy.resultReplayBody
        : copy.resultBody
  const presentationResultStatus = presentationApproved
    ? copy.presentationResultApproved
    : recoveryCode === "PRESENTATION_REQUEST_EXPIRED"
      ? copy.presentationStatusExpired
      : recoveryCode === "PRESENTATION_REPLAY"
        ? copy.presentationStatusReplay
        : recoveryCode === "PRESENTATION_DENIED"
          ? copy.presentationStatusDenied
          : copy.presentationResultNotApproved

  const liveDialog = <section ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-label={copy.dialog} tabIndex={-1}
      data-testid="k-tour-id-setup" data-phase={phase} data-method={method} data-origin={origin} data-environment={sandboxPassport ? "sandbox" : "simulated"} data-integration-status={sandboxPassport ? "sandbox_check" : "not_configured"} data-execution-mode={reviewMode ? "review" : "normal"} data-public-sample={reviewMode && sampleConsumedRef.current ? "true" : undefined} data-recovery-in-progress={sampleRecovery ? "true" : "false"} onKeyDown={handleKeyDown}>
      <header className={styles.header}>
        {phase === "method_select" || phase === "verified_person_consent" || phase === "sumsub_sandbox" ? <span className={styles.brandMark}><KTourIdMark size={28} /></span> : <button type="button" className={styles.iconButton} aria-label={copy.back} onClick={goBack}><ChevronLeft size={21} aria-hidden="true" /></button>}
        <p data-testid="k-tour-id-environment"><span>{copy.env}</span></p>
        <button type="button" className={styles.iconButton} data-testid="k-tour-id-cancel" aria-label={copy.close} onClick={requestFinalDismiss}><X size={20} aria-hidden="true" /></button>
      </header>
      {!presentationPhase && phase !== "sumsub_sandbox" ? <div className={styles.progress} role="list" aria-label={copy.dialog}>{steps.map((label, index) => <div key={label} role="listitem" aria-label={label} aria-current={currentStep === index + 1 ? "step" : undefined} data-current={currentStep === index + 1} data-complete={currentStep > index + 1}><span aria-hidden="true">{currentStep > index + 1 ? <Check size={12} aria-hidden="true" /> : index + 1}</span><small>{label}</small></div>)}</div> : null}
      {reviewMode ? <p className={styles.reviewScope} data-testid="k-tour-id-review-scope" data-review-stage={phase === "presentation_result" ? "result" : presentationPhase ? "request" : "setup"}><ShieldCheck size={15} aria-hidden="true" />{reviewScopeLabel}</p> : null}

      {phase === "verified_person_consent" ? <div className={styles.body} data-testid="experience-pass-consent"><p className={styles.eyebrow}>{copy.mobile}</p><h1>{EXPERIENCE_COPY_B[state.locale].passTitle}</h1><p className={styles.lead}>{EXPERIENCE_COPY_B[state.locale].passBody}</p><Disclosure rows={[[copy.requester, "K-Tour ID", "identity-consent-requester"], [copy.evidence, EXPERIENCE_COPY_B[state.locale].proof, "identity-consent-evidence"]]} /><div className={styles.actions}><button type="button" data-identity-initial-focus data-testid="experience-pass-approve" className={styles.primary} onClick={acceptCheckedPerson}>{EXPERIENCE_COPY_B[state.locale].passApprove}<ChevronRight size={17} aria-hidden="true" /></button><button type="button" className={styles.secondary} onClick={requestFinalDismiss}>{copy.decline}</button></div></div> : null}

      {phase === "method_select" ? <div className={styles.body}>
        <h1>{copy.title}</h1>
        {fullPassChecks ? <p className={styles.lead} data-testid="identity-additional-checks-scope">{EXPERIENCE_COPY_B[state.locale].additionalBody}</p> : null}
        <div className={styles.routes} data-testid="k-tour-id-methods">{routes.filter(route => !sampleRecovery || route.id === state.identityCredential?.method).map(({ id, icon: Icon, title, note, oldId, newId }) => <button key={id} type="button" data-identity-initial-focus={sampleRecovery || id === "mobile_id" ? true : undefined} data-testid={oldId} className={styles.route} data-availability={sumsubEnabled && !sampleRecovery && !fullPassChecks && !reviewMode && id === "passport_ekyc" ? "sandbox" : reviewMode ? "review" : "unavailable"} aria-label={`${title} · ${note} · ${sumsubEnabled && !sampleRecovery && !fullPassChecks && !reviewMode && id === "passport_ekyc" ? sandboxDisclosure.scope : reviewMode ? copy.methodReview : copy.methodUnavailable}`} onClick={() => chooseMethod(id)}><span data-testid={newId}><Icon size={22} aria-hidden="true" /></span><span><strong>{title}</strong><small>{sumsubEnabled && !sampleRecovery && !fullPassChecks && !reviewMode && id === "passport_ekyc" ? sandboxDisclosure.scope : note}</small></span><i><ChevronRight size={17} aria-hidden="true" /></i></button>)}</div>
        {sampleRecovery ? <p className={styles.sampleBoundary}>{sampleCopy.recoveryBoundary}</p> : null}
      </div> : null}

      {phase === "consent" ? <div className={styles.body} data-testid="k-tour-id-consent"><p className={styles.eyebrow}>{details.title}</p><h1>{copy.consentTitle}</h1>
        {sandboxPassport ? <p className={styles.lead}>{sandboxDisclosure.scope}</p> : null}
        {fullPassChecks ? <p className={styles.lead} data-testid="identity-additional-checks-consent">{EXPERIENCE_COPY_B[state.locale].additionalBody}</p> : null}
        <Disclosure rows={[[copy.requester, copy.requesterValue, "identity-consent-requester"], [copy.purpose, sandboxPassport ? sandboxDisclosure.purpose : copy.purposeValue, "identity-consent-purpose"], [copy.evidence, details.evidence, "identity-consent-evidence"]]} />
        <Disclosure label={copy.consentDetails} rows={[[copy.retention, details.retention, "identity-consent-retention"], [copy.provider, details.provider, "identity-consent-provider"]]} />
        {reviewMode ? <details className={styles.sampleControls} data-testid="identity-sample-controls">
          <summary><SlidersHorizontal size={16} aria-hidden="true" />{sampleCopy.controls}<ChevronRight size={16} aria-hidden="true" /></summary>
          <label>{sampleCopy.controls}<select data-testid="identity-sample-outcome" value={sampleCase} onChange={event => { setSampleCase(event.target.value as IdentityJourneySample); sampleConsumedRef.current = false }}>
            {identitySamplesForMethod(method).map(value => <option key={value} value={value}>{sampleCopy.outcomes[value]}</option>)}
          </select></label><p>{sampleCopy.boundary}</p>
        </details> : null}
        <div className={styles.actions}><button type="button" data-identity-initial-focus data-testid="k-tour-id-consent-approve" className={styles.primary} onClick={acceptConsent}>{copy.accept}</button><button type="button" className={styles.secondary} onClick={requestFinalDismiss}>{copy.decline}</button></div>
      </div> : null}

      {phase === "cx_handoff_preview" ? <IdentityHandoffStepB locale={state.locale} session={session} reviewMode={reviewMode} methodTitle={details.title} onComplete={() => advance("provider_processing_preview", "cx_handoff_preview")} onInterrupted={reason => interruptBoundary(reason, "cx_handoff_preview")} /> : null}
      {phase === "sumsub_sandbox" ? <SumsubPassportStepB ref={sumsubStepRef} locale={state.locale} onReturn={finishFinalDismiss} /> : null}
      {phase === "document_preview" ? <div className={styles.body}><PassportOcrStepB locale={state.locale} reviewMode={reviewMode} onComplete={() => advance("face_liveness_preview", "document_preview")} /></div> : null}
      {phase === "face_liveness_preview" ? <div className={styles.body}><PassportFaceStepB locale={state.locale} reviewMode={reviewMode} onComplete={() => advance("provider_processing_preview", "face_liveness_preview")} /></div> : null}
      {phase === "provider_processing_preview" ? <Panel testId="k-tour-id-route-step" icon={<RefreshCw />} eyebrow={copy.onDevice} title={copy.processing} body={copy.processingBody} visual="processing" /> : null}
      {phase === "holder_delivery_preview" ? <IdentityHolderStepB locale={state.locale} onPrepare={prepareHolder} onAcknowledge={finishHolder} onCancel={() => interruptBoundary("cancelled", "holder_delivery_preview")} autoPrepare={experiencePersonRef.current !== null} /> : null}

      {phase === "credential_ready" ? <div className={`${styles.body} ${styles.centered}`} data-testid="k-tour-id-credential" data-status={credentialSurfaceStatus} data-review-result={credentialSurfaceStatus === "review-draft" ? "current" : statusMessage && isReviewCredentialDraftB(state.identityCredential) ? credentialSurfaceStatus : "none"} data-code={statusMessage ? `CREDENTIAL_${credentialStatus.toUpperCase()}` : undefined} data-issuance-count={issuedOnceRef.current ? 1 : 0} data-wallet-provisioning="separate">
        <span data-testid="ktour-id-result" className={styles.heroIcon}><KTourIdMark size={38} /></span><h1>{statusMessage ?? copy.ready}</h1>
        {isPersonOnlySimulatedCredentialB(state.identityCredential) ? <p className={styles.lead} data-testid="identity-person-only-scope">{EXPERIENCE_COPY_B[state.locale].limitedPass}</p> : null}
        {statusMessage ? null : <div className={styles.credentialStack}><div className={styles.credential} data-testid="k-tour-id-wallet-separate"><WalletCards size={27} aria-hidden="true" /><span><strong>{copy.walletReady}</strong><small>{copy.walletReadyNote}</small></span></div></div>}
        <div className={styles.actions}>
          {statusMessage && reviewMode ? <button type="button" data-identity-initial-focus data-testid="identity-recovery-open" className={styles.primary} onClick={() => beginSampleRecovery("renew")}><RefreshCw size={17} aria-hidden="true" />{sampleCopy.renew}</button> : statusMessage ? null : origin === "action_gate" ? <button type="button" data-identity-initial-focus data-testid="k-tour-id-presentation-open" className={styles.primary} onClick={openPresentation}>{copy.present}<ArrowRight size={17} aria-hidden="true" /></button> : null}
          <button type="button" data-identity-initial-focus={(!statusMessage || !reviewMode) && origin !== "action_gate" ? true : undefined} data-testid="k-tour-id-return" className={styles.secondary} onClick={requestFinalDismiss}>{returnLabel}</button>
        </div>
        {reviewMode && state.identityCredential ? <details className={styles.lifecycleControls} data-testid="identity-lifecycle-controls"><summary>{sampleCopy.recovery}<ChevronRight size={16} aria-hidden="true" /></summary>
          {isPersonOnlySimulatedCredentialB(state.identityCredential) ? <button type="button" data-testid="identity-additional-checks-open" onClick={beginAdditionalPassChecks}><ShieldCheck size={17} aria-hidden="true" />{EXPERIENCE_COPY_B[state.locale].additionalChecks}</button> : null}
          {!statusMessage ? <button type="button" data-testid="identity-renew-open" onClick={() => beginSampleRecovery("renew")}><RefreshCw size={17} aria-hidden="true" />{sampleCopy.renew}</button> : null}
          <button type="button" data-testid="identity-device-recovery-open" onClick={() => beginSampleRecovery("device")}><Smartphone size={17} aria-hidden="true" />{sampleCopy.restore}</button>
        </details> : null}
      </div> : null}

      {phase === "recovery_intro" && reviewMode ? <div className={`${styles.body} ${styles.sampleTask}`} data-testid="identity-recovery-intro" data-recovery-kind={recoveryKind}>
        <span className={styles.heroIcon}><RefreshCw size={28} aria-hidden="true" /></span><h1>{sampleCopy.recoveryTitle}</h1><p className={styles.lead}>{sampleCopy.recoveryBody}</p>
        <p className={styles.sampleBoundary}>{sampleCopy.recoveryBoundary}</p>
        <div className={styles.actions}><button type="button" data-identity-initial-focus className={styles.primary} data-testid="identity-recovery-start" onClick={confirmSampleRecovery}>{sampleCopy.recoveryStart}<ArrowRight size={17} aria-hidden="true" /></button><button type="button" className={styles.secondary} onClick={() => setPhase("credential_ready")}>{sampleCopy.returnCurrent}</button></div>
      </div> : null}

      {phase === "manual_review" && reviewMode && manualReview ? <div className={`${styles.body} ${styles.sampleTask}`} data-testid="identity-manual-review" data-review-status={manualReview.status} data-sample-only="true">
        <span className={styles.heroIcon}>{manualReview.status === "approved" ? <Check size={28} aria-hidden="true" /> : <Clock3 size={28} aria-hidden="true" />}</span>
        <h1>{manualReview.status === "approved" ? sampleCopy.approved : manualReview.status === "declined" ? sampleCopy.declined : manualReview.status === "needs_info" ? sampleCopy.needsInfo : sampleCopy.pending}</h1>
        <p className={styles.lead}>{manualReview.status === "approved" ? sampleCopy.approvedBody : manualReview.status === "declined" ? sampleCopy.declinedBody : manualReview.status === "needs_info" ? sampleCopy.needsInfoBody : sampleCopy.pendingBody}</p>
        {manualReview.checkedAt !== null ? <p className={styles.checkedAt} data-testid="identity-manual-checked-at">{sampleCopy.checked} <time dateTime={new Date(manualReview.checkedAt).toISOString()}>{new Date(manualReview.checkedAt).toLocaleTimeString(state.locale, { hour: "2-digit", minute: "2-digit" })}</time></p> : null}
        {manualReview.status === "pending" ? <details className={styles.sampleControls}><summary><SlidersHorizontal size={16} aria-hidden="true" />{sampleCopy.reviewResult}<ChevronRight size={16} aria-hidden="true" /></summary><label>{sampleCopy.reviewResult}<select data-testid="identity-manual-outcome" disabled={manualChecking} value={manualOutcome} onChange={event => setManualOutcome(event.target.value as IdentityManualOutcome)}><option value="approved">{sampleCopy.approved}</option><option value="declined">{sampleCopy.declined}</option><option value="needs_info">{sampleCopy.needsInfo}</option></select></label></details> : null}
        <div className={styles.actions}>
          {manualReview.status === "pending" ? <button type="button" data-identity-initial-focus className={styles.primary} data-testid="identity-manual-check" disabled={manualChecking} onClick={checkManualStatus}>{manualChecking ? sampleCopy.checking : sampleCopy.check}</button>
            : manualReview.status === "approved" ? <button type="button" data-identity-initial-focus className={styles.primary} data-testid="identity-manual-continue" onClick={continueReviewedSample}>{copy.next}<ArrowRight size={17} aria-hidden="true" /></button>
              : manualReview.status === "needs_info" ? <button type="button" data-identity-initial-focus className={styles.primary} data-testid="identity-manual-add-info" onClick={supplyReviewSample}>{sampleCopy.addInfo}</button>
                : <button type="button" data-identity-initial-focus className={styles.primary} data-testid="identity-manual-new-request" onClick={startFreshRequest}>{sampleCopy.startAgain}</button>}
          <button type="button" className={styles.secondary} onClick={requestFinalDismiss}>{copy.later}</button>
        </div>
      </div> : null}

      {phase === "presentation_request" ? <div className={styles.body} data-testid="k-tour-id-presentation-request" data-request-active={presentationRequest ? isPresentationRequestActiveB(presentationRequest) : false}><p className={styles.eyebrow}>{copy.presentationRequestEyebrow}</p><h1>{copy.request}</h1><Disclosure rows={[[copy.requester, copy.presentationRequester, "identity-presentation-requester"], [copy.purpose, copy.presentationPurpose, "identity-presentation-purpose"], [copy.evidence, copy.presentationEvidence, "identity-presentation-evidence"]]} /><Disclosure label={copy.consentDetails} rows={[[copy.retention, copy.presentationRetention, "identity-presentation-retention"]]} /><div className={styles.actions}><button type="button" data-identity-initial-focus data-testid="k-tour-id-continue" className={styles.primary} onClick={continuePresentation}>{copy.next}</button><button type="button" className={styles.secondary} onClick={() => setPhase("credential_ready")}>{copy.later}</button></div></div> : null}
      {phase === "presentation_consent" ? <div className={styles.body} data-testid="k-tour-id-presentation-consent"><p className={styles.eyebrow}>{copy.presentationRequester}</p><h1>{copy.presentConsent}</h1><p className={styles.lead}>{copy.presentConsentBody}</p><div className={styles.predicate} data-testid="identity-presentation-predicate"><ShieldCheck size={22} aria-hidden="true" /><span><strong>{copy.presentationPredicate}</strong><small>{copy.presentationPredicateRetention}</small></span></div><div className={styles.actions}><button type="button" data-identity-initial-focus data-testid="k-tour-id-presentation-approve" className={styles.primary} onClick={() => completePresentation("approve")}>{copy.approve}</button><button type="button" className={styles.secondary} onClick={() => completePresentation("deny")}>{copy.deny}</button></div></div> : null}
      {phase === "presentation_result" ? <div className={`${styles.body} ${styles.centered}`} data-testid="k-tour-id-presentation-result" data-result={recoveryCode === "PRESENTATION_REQUEST_EXPIRED" ? "expired" : recoveryCode === "PRESENTATION_REPLAY" ? "replay" : recoveryCode === "PRESENTATION_DENIED" ? "denied" : "success"} data-code={recoveryCode ?? undefined}><span className={styles.heroIcon}>{presentationApproved ? <BadgeCheck size={31} aria-hidden="true" /> : <X size={31} aria-hidden="true" />}</span><p className={styles.eyebrow} data-testid="identity-presentation-result-status">{presentationResultStatus}</p><h1>{presentationResultTitle}</h1><p className={styles.lead}>{presentationResultBody}</p><div className={styles.credential} data-testid="k-tour-id-credential" data-status={credentialStatus} data-issuance-count={issuedOnceRef.current ? 1 : 0}><KTourIdMark size={24} /><span><strong>{copy.holderLabel}</strong><small data-testid="identity-presentation-credential-state">{copy.unchanged}</small></span></div><div className={styles.actions}><button type="button" data-identity-initial-focus data-testid="k-tour-id-result-back" className={styles.primary} onClick={presentationNeedsNewRequest ? openPresentation : () => setPhase("credential_ready")}>{presentationNeedsNewRequest ? copy.newRequest : copy.backToKTourId}</button><button type="button" data-testid="k-tour-id-return" className={styles.secondary} onClick={requestFinalDismiss}>{returnLabel}</button></div></div> : null}

      {phase === "unavailable" ? reviewMode
        ? <StatusPanel testId="k-tour-id-unavailable" alias="ktour-id-setup-unavailable" code="IDENTITY_METHOD_UNAVAILABLE" title={copy.unavailable} body={method === "mobile_residence_card" ? copy.assurance : copy.unavailableBody} primary={sampleRecovery ? sampleCopy.startAgain : method === "mobile_residence_card" ? copy.usePassport : copy.another} onPrimary={() => sampleRecovery ? startFreshRequest() : method === "mobile_residence_card" ? chooseMethod("passport_ekyc") : setPhase("method_select")} primaryTestId={!sampleRecovery && method === "mobile_residence_card" ? "k-tour-id-alternate-passport" : "k-tour-id-choose-another"} secondary={copy.later} onSecondary={requestFinalDismiss} />
        : <StatusPanel testId="k-tour-id-unavailable" alias="ktour-id-setup-unavailable" code="IDENTITY_METHOD_UNAVAILABLE" title={copy.unavailable} body={copy.unavailableBody} primary={copy.sample} onPrimary={continueWithSample} primaryTestId="k-tour-id-sample-continue" secondary={copy.later} onSecondary={requestFinalDismiss} />
        : null}
      {phase === "failed" ? <StatusPanel testId="k-tour-id-failure" alias="ktour-id-setup-failure" code={recoveryCode ?? "PROVIDER_TIMEOUT"} title={sampleConsumedRef.current ? sampleCopy.outcomes[sampleCase] : copy.failure} body={sampleConsumedRef.current ? sampleCopy.safeFailure : copy.failureBody} primary={sampleConsumedRef.current ? sampleCase === "nfc_unsupported" ? sampleCopy.nfcFallback : ["unsupported_document", "document_auth_failed", "app_missing"].includes(sampleCase) ? sampleRecovery ? sampleCopy.startAgain : sampleCopy.different : sampleCopy.retry : copy.retry} onPrimary={retrySampleStep} primaryTestId="k-tour-id-retry" secondary={sampleRecovery ? sampleCopy.startAgain : copy.another} onSecondary={startFreshRequest} /> : null}
      {phase === "expired" ? <StatusPanel testId="k-tour-id-expired" alias="ktour-id-setup-expired" code="IDENTITY_SESSION_EXPIRED" title={copy.expired} body={copy.expiredBody} primary={copy.retry} onPrimary={() => {
        setManualReview(null); setRecoveryCode(null)
        if (sampleConsumedRef.current) { setSession(null); setPhase("consent") }
        else { setSession(createIdentitySetupSessionB(origin, method)); setPhase(method === "passport_ekyc" ? "document_preview" : "cx_handoff_preview") }
      }} primaryTestId="k-tour-id-retry" secondary={copy.later} onSecondary={requestFinalDismiss} /> : null}
      {phase === "cancelled" && reviewMode ? <StatusPanel testId="identity-sample-cancelled" alias="identity-sample-cancelled-icon" code="CONSENT_DECLINED" title={sampleCopy.cancelled} body={sampleCopy.cancelledBody} primary={boundaryRetry ? sampleCopy.retry : sampleCopy.startAgain} onPrimary={resumeCancelledBoundary} primaryTestId="identity-cancelled-restart" secondary={copy.later} onSecondary={requestFinalDismiss} /> : null}

      <details className={styles.protocolDetails} data-compact="true">
        <summary aria-label={copy.protocolSummary}><span>{copy.protocolSummary}</span><Info size={17} aria-hidden="true" /></summary>
        <div className={styles.protocolBody}>
          {phase === "unavailable" ? <p>{copy.unavailableTechnical}</p> : null}
          <p className={styles.privateBoundary} data-testid="k-tour-id-technical-truth"><ShieldCheck size={15} aria-hidden="true" /><span data-testid="k-tour-id-private-boundary">{sandboxPassport ? sandboxDisclosure.boundary : copy.boundary}</span></p>
        </div>
      </details>
      <span className={styles.contractOnly} aria-hidden="true">{KTOUR_ID_RECOVERY_CODES.join(" ")}</span>
    </section>

  if (!finalExitActive) exitVisualSnapshotRef.current = liveDialog
  const renderedDialog = finalExitActive ? exitVisualSnapshotRef.current ?? liveDialog : liveDialog

  return <div
    ref={layerRef}
    className={styles.root}
    data-testid="ondo-b-ktour-id-setup"
    data-origin={origin}
    data-identity-presence={setupPresence.phase}
    data-ondo-layer={origin === "action_gate" ? "critical" : "full-task"}
    data-modal-layer-priority={origin === "action_gate" ? ONDO_MODAL_PRIORITY.nestedCritical : ONDO_MODAL_PRIORITY.fullTask}
    aria-busy={finalExitActive ? "true" : undefined}
    onClickCapture={consumeFinalExitInput}
    onPointerDownCapture={consumeFinalExitInput}
    onKeyDownCapture={consumeFinalExitInput}
  >
    <button type="button" className={styles.backdrop} tabIndex={-1} aria-hidden="true" disabled={finalExitActive} onClick={requestFinalDismiss} />
    <div className={styles.dialogGuard} inert={finalExitActive ? true : undefined}>{renderedDialog}</div>
    {finalExitActive ? <span className={styles.exitShield} aria-hidden="true" /> : null}
  </div>
}

function Disclosure({ rows, label }: { rows: Array<[string, string, string?]>; label?: string }) {
  const content = <dl className={styles.disclosure}>{rows.map(([term, value, testId]) => <div key={`${term}:${value}`} data-testid={testId}><dt>{term}</dt><dd>{value}</dd></div>)}</dl>
  return label ? <details className={styles.disclosureDetails}><summary>{label}<ChevronRight size={16} aria-hidden="true" /></summary>{content}</details> : content
}

function Panel({ testId, aliases = [], icon, eyebrow, title, body, action, onAction, visual, meta }: { testId: string; aliases?: string[]; icon: ReactNode; eyebrow: string; title: string; body?: string; action?: string; onAction?: () => void; visual?: "phone" | "face" | "processing"; meta?: [string, string] }) {
  return <div className={`${styles.body} ${styles.centered}`} data-testid={testId}><span data-testid={aliases[0]} className={styles.heroIcon}><span data-testid={aliases[1]}>{icon}</span></span><p className={styles.eyebrow}>{eyebrow}</p><h1>{title}</h1>{body ? <p className={styles.lead}>{body}</p> : null}{visual ? <div className={styles.visual} data-visual={visual} aria-hidden="true">{visual === "face" ? <><Camera /><ScanFace /></> : visual === "phone" ? <><Smartphone /><BadgeCheck /></> : <><RefreshCw /><i /></>}</div> : null}{meta ? <div className={styles.meta}><strong>{meta[0]}</strong><span>{meta[1]}</span></div> : null}{action && onAction ? <div className={styles.actions}><button type="button" data-identity-initial-focus data-testid="k-tour-id-continue" className={styles.primary} onClick={onAction}>{action}<ArrowRight size={17} aria-hidden="true" /></button></div> : null}</div>
}

function StatusPanel({ testId, alias, code, title, body, extra, primary, onPrimary, primaryTestId, secondary, onSecondary }: { testId: string; alias: string; code: string; title: string; body: string; extra?: string; primary: string; onPrimary: () => void; primaryTestId?: string; secondary: string; onSecondary: () => void }) {
  const PrimaryIcon = primaryTestId === "k-tour-id-retry" ? RefreshCw : ChevronRight
  return <div className={`${styles.body} ${styles.centered}`} data-testid={testId} data-code={code} role="alert"><span data-testid={alias} className={styles.issueIcon}><TriangleAlert size={30} aria-hidden="true" /></span><h1>{title}</h1><p className={styles.lead}>{body}</p>{extra ? <p className={styles.assurance}>{extra}</p> : null}<div className={styles.actions}><button type="button" data-identity-initial-focus data-testid={primaryTestId} className={styles.primary} onClick={onPrimary}><PrimaryIcon size={17} aria-hidden="true" />{primary}</button><button type="button" className={styles.secondary} onClick={onSecondary}>{secondary}</button></div></div>
}
