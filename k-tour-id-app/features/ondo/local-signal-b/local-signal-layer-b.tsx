"use client"

import type { ChangeEvent } from "react"
import { useEffect, useReducer, useRef, useState } from "react"
import type { LucideIcon } from "lucide-react"
import {
  ArrowRight,
  Bookmark,
  Check,
  CircleAlert,
  HeartHandshake,
  ImagePlus,
  LoaderCircle,
  MapPin,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  Timer,
  Trash2,
  Waves,
  X,
} from "lucide-react"
import { canonicalMapVenueById } from "@/lib/ondo/venues/map-data"
import { venueNamePresentation } from "@/lib/ondo/venues/display"
import { canonicalVenueMoodImage } from "../map/canonical-venue-capsule-b"
import {
  abandonPendingBAction,
  actionReturnFromBEvent,
  B_ACTION_GATE_CANCEL_EVENT,
  B_ACTION_GATE_COMPLETE_EVENT,
  B_ACTION_GATE_READY_EVENT,
  consumePendingBActionAtMutation,
  createBLocalSignalActionReturn,
  finalizeConsumedBActionWithMutation,
  hashBActionReturnTo,
  privateContextForBAction,
  requestBActionGate,
  restoreBActionGateSession,
  type BLocalSignalActionReturn,
} from "../identity-b/action-gate-contract-b"
import { useBActivityProfile } from "../identity-b/activity-profile-b-provider"
import { B_DISCOVERY_TRAVERSAL_EVENT } from "../map/b-discovery-history"
import type { OndoBLocale } from "../shared/state/ondo-b-preferences"
import type { OndoBLocalSignalTag } from "../shared/state/ondo-b-provider"
import { useOndoB } from "../shared/state/ondo-b-provider"
import { SheetB } from "../shared/ui/sheet-b"
import { useSheetPresence } from "../shared/ui/use-sheet-presence"
import { qaReviewFixtureOptions, readQaRuntime } from "../shared/ui/use-qa-controls"
import {
  createLocalSignalDraftBindingB,
  createLocalSignalMutationPayloadB,
  INITIAL_LOCAL_SIGNAL_FLOW_STATE_B,
  reduceLocalSignalFlowB,
  sameLocalSignalDraftBindingB,
  type LocalSignalDraftBindingB,
} from "./local-signal-model-b"
import styles from "./local-signal-layer-b.module.css"
import { identityReviewOptionsB } from "../identity-b/identity-review-mode-b"
import { consumeJitAuthorization, jitAuthorizationExpiresAt } from "../identity-b/jit-identity-authority-b"

const actionGateSessionOptions = identityReviewOptionsB
export const MAX_LOCAL_SIGNAL_PHOTO_BYTES = 10 * 1024 * 1024
const LOCAL_SIGNAL_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])
type PhotoError = "photoTypeError" | "photoSizeError" | "photoPrepareError"
type SocialLocale = OndoBLocale
type LocalSignalGateSession = {
  origin: "local_signal"
  venueId: string
  draftNonce: string
  issuedAt: number
  expiresAt: number
  outcome: "success" | "cancel" | "failure" | "unavailable" | "expired"
}

async function decodeLocalSignalPhoto(url: string) {
  const candidateImage = new Image()
  candidateImage.src = url
  await candidateImage.decode()
  if (candidateImage.naturalWidth < 1 || candidateImage.naturalHeight < 1) throw new Error("Photo has no decodable pixels")
}

const TAGS: ReadonlyArray<{ id: OndoBLocalSignalTag; icon: LucideIcon } & Record<SocialLocale, string>> = [
  { id: "calm_now", icon: Waves, en: "Easygoing", ko: "여유로워요", ja: "落ち着く" },
  { id: "lively_now", icon: Sparkles, en: "Lively", ko: "활기차요", ja: "にぎやか" },
  { id: "quick_stop", icon: Timer, en: "Quick stop", ko: "금방 들러요", ja: "さっと寄れる" },
  { id: "welcoming", icon: HeartHandshake, en: "Welcoming", ko: "친절해요", ja: "親しみやすい" },
]

const COPY = {
  en: {
    close: "Close place signal", header: "Place signal", eyebrow: "Right now", title: "What’s it like here?",
    choose: "Choose what fits", note: "Anything else?", notePlaceholder: "Optional note", photo: "Add photo",
    replacePhoto: "Replace", removePhoto: "Remove", photoTypeError: "Choose a JPEG, PNG, or WebP photo.",
    photoSizeError: "Choose a photo that is 10 MB or smaller.", photoPrepareError: "That photo didn’t open.",
    photoRetry: "Try again", photoChooseAnother: "Choose another", photoAlt: "Private photo preview", photoLoading: "Preparing photo",
    privateLine: "Note and photo stay private", boundary: "What is kept",
    boundaryBody: "Only this place, your picks and the time are kept on this device. The note and photo disappear when you close. This never changes the public temperature.",
    personBoundary: "Saving may ask for an account, then a one-time person check.", action: "Continue to save", confirmAction: "Save to my visits",
    retry: "Try again", postError: "Couldn’t save. Your draft is still here.",
    abandonError: "Couldn’t update yet. Your draft is still here. Try again.",
    cancel: "Check cancelled. Your draft is unchanged.", failure: "Check didn’t finish. Your draft is unchanged.",
    unavailable: "Check unavailable. Your draft is unchanged.", expired: "Check expired. Your draft is unchanged.",
    savedTitle: "Added to your visits", duplicateTitle: "Already in your visits",
    savedBody: "This private signal is on your device.", duplicateBody: "Nothing new was added.", privateResult: "No public post was created",
    categoryImage: "Category illustration", selected: "selected",
    backToPlace: "Back to place", discardTitle: "Discard this draft?",
    discardBody: "Your picks, note and photo will disappear.", keepEditing: "Keep editing", discard: "Discard",
    visit: "Visit", contribution: "Contribution",
  },
  ko: {
    close: "장소 느낌 닫기", header: "장소 느낌", eyebrow: "지금", title: "이곳 분위기는 어때요?",
    choose: "느낌을 골라주세요", note: "더 남길 말이 있나요?", notePlaceholder: "선택 메모", photo: "사진 추가",
    replacePhoto: "교체", removePhoto: "삭제", photoTypeError: "JPEG, PNG 또는 WebP 사진을 골라주세요.",
    photoSizeError: "10MB 이하 사진을 골라주세요.", photoPrepareError: "사진을 열지 못했어요.",
    photoRetry: "다시 시도", photoChooseAnother: "다른 사진", photoAlt: "비공개 사진 미리보기", photoLoading: "사진 준비 중",
    privateLine: "메모와 사진은 공개되지 않아요", boundary: "기기에 남는 것",
    boundaryBody: "이 장소와 선택한 느낌, 시각만 기기에 남아요. 메모와 사진은 닫을 때 사라지고 공개 온도는 바뀌지 않아요.",
    personBoundary: "저장할 때 계정 생성 후 일회성 본인 확인을 요청할 수 있어요.", action: "저장하러 가기", confirmAction: "내 방문에 저장",
    retry: "다시 시도", postError: "저장하지 못했어요. 작성 내용은 그대로예요.",
    abandonError: "아직 변경하지 못했어요. 작성 내용은 그대로예요. 다시 시도해 주세요.",
    cancel: "확인을 취소했어요. 작성 내용은 그대로예요.", failure: "확인을 마치지 못했어요. 작성 내용은 그대로예요.",
    unavailable: "지금은 확인할 수 없어요. 작성 내용은 그대로예요.", expired: "확인 시간이 지났어요. 작성 내용은 그대로예요.",
    savedTitle: "내 방문에 담았어요", duplicateTitle: "이미 내 방문에 있어요",
    savedBody: "이 비공개 느낌은 내 기기에만 남아요.", duplicateBody: "새로 추가된 내용은 없어요.", privateResult: "공개 게시물은 만들어지지 않았어요",
    categoryImage: "카테고리 일러스트", selected: "개 선택",
    backToPlace: "장소로 돌아가기", discardTitle: "작성 내용을 버릴까요?",
    discardBody: "고른 느낌과 메모, 사진이 사라져요.", keepEditing: "계속 작성", discard: "버리기",
    visit: "방문", contribution: "참여",
  },
  ja: {
    close: "スポットの印象を閉じる", header: "スポットの印象", eyebrow: "今", title: "ここはどんな雰囲気？",
    choose: "近いものを選ぶ", note: "ほかにありますか？", notePlaceholder: "任意のメモ", photo: "写真を追加",
    replacePhoto: "変更", removePhoto: "削除", photoTypeError: "JPEG、PNG、WebPの写真を選んでください。",
    photoSizeError: "10MB以下の写真を選んでください。", photoPrepareError: "写真を開けませんでした。",
    photoRetry: "もう一度", photoChooseAnother: "別の写真", photoAlt: "非公開写真のプレビュー", photoLoading: "写真を準備中",
    privateLine: "メモと写真は公開されません", boundary: "端末に残るもの",
    boundaryBody: "この場所、選んだ印象、時刻だけが端末に残ります。メモと写真は閉じると消え、公開温度は変わりません。",
    personBoundary: "保存時にアカウント作成後、一度だけ本人確認を求める場合があります。", action: "保存へ進む", confirmAction: "訪問履歴に保存",
    retry: "もう一度", postError: "保存できませんでした。下書きはそのままです。",
    abandonError: "まだ変更できませんでした。下書きはそのままです。もう一度お試しください。",
    cancel: "確認をやめました。下書きはそのままです。", failure: "確認を完了できませんでした。下書きはそのままです。",
    unavailable: "現在確認できません。下書きはそのままです。", expired: "確認時間が過ぎました。下書きはそのままです。",
    savedTitle: "訪問履歴に追加しました", duplicateTitle: "すでに訪問履歴にあります",
    savedBody: "この非公開の印象は端末だけに残ります。", duplicateBody: "新しく追加された内容はありません。", privateResult: "公開投稿は作成されていません",
    categoryImage: "カテゴリーイラスト", selected: "件選択",
    backToPlace: "スポットに戻る", discardTitle: "下書きを破棄しますか？",
    discardBody: "選択、メモ、写真が消えます。", keepEditing: "編集を続ける", discard: "破棄",
    visit: "訪問", contribution: "参加",
  },
} as const satisfies Record<SocialLocale, Record<string, string>>

export function LocalSignalLayerB() {
  const { state, actions } = useOndoB()
  const { actions: activityActions } = useBActivityProfile()
  const [flow, sendFlow] = useReducer(reduceLocalSignalFlowB, INITIAL_LOCAL_SIGNAL_FLOW_STATE_B)
  const [draftRevision, setDraftRevision] = useState("")
  const [gateSession, setGateSession] = useState<LocalSignalGateSession | null>(null)
  const [gateBinding, setGateBinding] = useState<LocalSignalDraftBindingB | null>(null)
  const [gateOpen, setGateOpen] = useState(false)
  const [closeDecision, setCloseDecision] = useState(false)
  const [abandonError, setAbandonError] = useState(false)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [photoError, setPhotoError] = useState<PhotoError | null>(null)
  const [photoCanRetry, setPhotoCanRetry] = useState(false)
  const [photoFailedOnce, setPhotoFailedOnce] = useState(false)
  const [photoPreparing, setPhotoPreparing] = useState(false)
  const revisionSerialRef = useRef(0)
  const postInFlightRef = useRef(false)
  const [postPending, setPostPending] = useState(false)
  const liveDraftRef = useRef({ draft: state.localSignalDraft, revision: draftRevision, account: state.account })
  liveDraftRef.current = { draft: state.localSignalDraft, revision: draftRevision, account: state.account }
  const checkRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const keepEditingRef = useRef<HTMLButtonElement>(null)
  const photoAddRef = useRef<HTMLButtonElement>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const photoUrlRef = useRef<string | null>(null)
  const photoPreparationRef = useRef(0)
  const photoSectionRef = useRef<HTMLElement>(null)
  const photoErrorRef = useRef<HTMLParagraphElement>(null)
  const postErrorRef = useRef<HTMLParagraphElement>(null)
  const abandonErrorRef = useRef<HTMLParagraphElement>(null)
  const draft = state.localSignalDraft
  const venue = draft ? canonicalMapVenueById(draft.venueId) : undefined
  const locale = state.locale
  const copy = COPY[locale]
  const open = state.tab === "ondo" && Boolean(draft && venue && state.surface.kind === "venue" && state.surface.venueId === draft.venueId)
  const sheetPresence = useSheetPresence(open && draft && venue ? draft : null)
  const presentedDraft = sheetPresence.value
  const presentedVenue = presentedDraft ? canonicalMapVenueById(presentedDraft.venueId) : undefined
  const activeVenueId = presentedVenue?.id ?? null
  // The domain subject clears one render before useSheetPresence commits its
  // retained exit phase. Mark that interim frame as closing so SheetB freezes
  // the accepted discard decision, rather than an apparently live draft,
  // while its outer layer owns the painted exit interval.
  const presentedSignalPhase = open && sheetPresence.phase === "open" ? "open" : "closing"

  function nextDraftRevision(venueId: string) {
    revisionSerialRef.current += 1
    return `draft:${venueId}:${revisionSerialRef.current}`
  }

  function releasePhotoUrl() {
    if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current)
    photoUrlRef.current = null
    setPhotoUrl(null)
  }

  useEffect(() => {
    photoPreparationRef.current += 1
    setGateSession(null)
    setGateBinding(null)
    setGateOpen(false)
    setCloseDecision(false)
    setAbandonError(false)
    setPhotoFile(null)
    setPhotoError(null)
    setPhotoCanRetry(false)
    setPhotoFailedOnce(false)
    setPhotoPreparing(false)
    if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current)
    photoUrlRef.current = null
    setPhotoUrl(null)
    setDraftRevision(activeVenueId ? nextDraftRevision(activeVenueId) : "")
    sendFlow({ type: "reset" })
  }, [activeVenueId])

  useEffect(() => {
    function returnFromGate(event: Event, outcome: LocalSignalGateSession["outcome"]) {
      const payload = event instanceof CustomEvent
        ? event.detail as BLocalSignalActionReturn & { gateOutcome?: Exclude<LocalSignalGateSession["outcome"], "success"> }
        : null
      const detail = actionReturnFromBEvent(payload)
      if (!detail || detail.cta !== "SUBMIT_LOCAL_SIGNAL" || detail.venueId !== activeVenueId) return
      const context = privateContextForBAction(detail)
      if (!context || context.cta !== "SUBMIT_LOCAL_SIGNAL") return
      const restored = restoreBActionGateSession(window.sessionStorage, new Date(), actionGateSessionOptions())
      const expiresAt = actionGateSessionOptions().allowReviewFixture
        ? restored.person.expiresAt ? Date.parse(restored.person.expiresAt) : Date.now()
        : Math.min(Date.parse(detail.expiresAt), jitAuthorizationExpiresAt(detail.tokenId, hashBActionReturnTo(detail)) ?? Date.now())
      const gateOutcome = payload?.gateOutcome ?? outcome
      const returnedBinding = createLocalSignalDraftBindingB({
        venueId: detail.venueId,
        revision: context.draftNonce,
        tags: context.tags,
        note: context.note,
        photo: photoUrlRef.current ? "preview" : "none",
      })
      setDraftRevision(context.draftNonce)
      setGateBinding(returnedBinding)
      setGateSession({ origin: "local_signal", venueId: detail.venueId, draftNonce: context.draftNonce, issuedAt: Date.now(), expiresAt, outcome: gateOutcome })
      setGateOpen(false)
      sendFlow({ type: gateOutcome === "success" ? "gate_ready" : "gate_returned" })
      window.requestAnimationFrame(() => checkRef.current?.focus({ preventScroll: true }))
    }
    const complete = (event: Event) => returnFromGate(event, "success")
    const cancel = (event: Event) => returnFromGate(event, "cancel")
    window.addEventListener(B_ACTION_GATE_READY_EVENT, complete)
    window.addEventListener(B_ACTION_GATE_CANCEL_EVENT, cancel)
    return () => {
      window.removeEventListener(B_ACTION_GATE_READY_EVENT, complete)
      window.removeEventListener(B_ACTION_GATE_CANCEL_EVENT, cancel)
    }
  }, [activeVenueId])

  useEffect(() => {
    if (!open) return
    const discardOnTraversal = (event: Event) => {
      if (!discardPendingSignalAction()) {
        // This capture listener runs before the map's traversal consumer. Keep
        // the exact draft mounted when its durable gate record cannot be
        // retired; the user can retry after storage becomes available again.
        event.preventDefault()
        event.stopImmediatePropagation()
        return
      }
      actions.closeLocalSignal()
    }
    window.addEventListener(B_DISCOVERY_TRAVERSAL_EVENT, discardOnTraversal, { capture: true })
    return () => window.removeEventListener(B_DISCOVERY_TRAVERSAL_EVENT, discardOnTraversal, { capture: true })
  }, [actions, activeVenueId, draftRevision, gateBinding, gateOpen, gateSession, open])

  useEffect(() => {
    if (!gateSession || gateSession.outcome !== "success") return
    const remaining = gateSession.expiresAt - Date.now()
    if (remaining <= 0) {
      setGateSession((current) => current ? { ...current, outcome: "expired" } : null)
      sendFlow({ type: "gate_returned" })
      return
    }
    const timer = window.setTimeout(() => {
      setGateSession((current) => current?.outcome === "success" ? { ...current, outcome: "expired" } : current)
      sendFlow({ type: "gate_returned" })
    }, remaining)
    return () => window.clearTimeout(timer)
  }, [gateSession])

  useEffect(() => {
    if (!closeDecision) return
    const frame = window.requestAnimationFrame(() => keepEditingRef.current?.focus({ preventScroll: true }))
    return () => window.cancelAnimationFrame(frame)
  }, [closeDecision])

  useEffect(() => {
    if (flow.outcome !== "failed") return
    const frame = window.requestAnimationFrame(() => postErrorRef.current?.focus({ preventScroll: true }))
    return () => window.cancelAnimationFrame(frame)
  }, [flow.outcome])

  useEffect(() => {
    if (!abandonError) return
    const frame = window.requestAnimationFrame(() => abandonErrorRef.current?.focus({ preventScroll: true }))
    return () => window.cancelAnimationFrame(frame)
  }, [abandonError])

  useEffect(() => () => {
    photoPreparationRef.current += 1
    if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current)
    photoUrlRef.current = null
  }, [])

  if (!presentedDraft || !presentedVenue) return null
  const activeDraft = presentedDraft
  const activeVenue = presentedVenue
  const name = venueNamePresentation(presentedVenue.name.ko, locale)
  const currentBinding = createLocalSignalDraftBindingB({
    venueId: activeVenue.id,
    revision: draftRevision,
    tags: activeDraft.tags,
    note: activeDraft.note,
    photo: photoUrl ? "preview" : "none",
  })
  const exactGateSession = gateSession
    && gateSession.origin === "local_signal"
    && gateSession.venueId === activeVenue.id
    && gateSession.draftNonce === draftRevision
    && sameLocalSignalDraftBindingB(gateBinding, currentBinding)
      ? gateSession
      : null
  const gateReturn = exactGateSession?.outcome ?? null
  const personReady = exactGateSession?.outcome === "success" && exactGateSession.expiresAt > Date.now()
  const dirty = activeDraft.tags.length > 0 || activeDraft.note.length > 0 || Boolean(photoUrl)
  const terminal = flow.outcome === "unique" || flow.outcome === "duplicate"
  const photoStage = photoPreparing ? "loading" : photoError ?? (flow.upload === "UPL-PREVIEW" || photoUrl ? "ready" : "empty")

  function discardPendingSignalAction(expectedRevision = draftRevision) {
    const latest = restoreBActionGateSession(window.sessionStorage, new Date(), actionGateSessionOptions())
    const pending = latest.pending
    const context = pending ? privateContextForBAction(pending) : null
    const expectsPendingAction = gateOpen
      || (gateBinding?.revision === expectedRevision && gateSession?.outcome === "success")
    if (pending?.cta === "SUBMIT_LOCAL_SIGNAL"
      && pending.venueId === activeVenueId
      && context?.cta === "SUBMIT_LOCAL_SIGNAL"
      && context.draftNonce === expectedRevision) {
      if (!abandonPendingBAction(window.sessionStorage, pending, new Date(), actionGateSessionOptions())) {
        setAbandonError(true)
        return false
      }
      setAbandonError(false)
      return true
    }
    if (expectsPendingAction) {
      setAbandonError(true)
      return false
    }
    setAbandonError(false)
    return true
  }

  function finishAndReturnToPlace() {
    if (!discardPendingSignalAction(gateBinding?.revision ?? draftRevision)) return
    // Keep the exact last-painted draft/result visible for SheetB's retained
    // exit. Volatile photo and gate state are cleared by the activeVenueId
    // lifecycle only after the retained presentation has actually unmounted.
    actions.closeLocalSignal()
  }

  function requestClose() {
    if (closeDecision) {
      keepDraftEditing()
      return
    }
    if (terminal || !dirty) finishAndReturnToPlace()
    else setCloseDecision(true)
  }

  function keepDraftEditing() {
    setCloseDecision(false)
    window.requestAnimationFrame(() => closeRef.current?.focus({ preventScroll: true }))
  }

  function invalidateGateBinding() {
    const oldRevision = gateBinding?.revision ?? draftRevision
    if (!discardPendingSignalAction(oldRevision)) return false
    setGateSession(null)
    setGateBinding(null)
    setGateOpen(false)
    setDraftRevision(nextDraftRevision(activeVenue.id))
    sendFlow({ type: "gate_returned" })
    return true
  }

  function toggleTag(tag: OndoBLocalSignalTag) {
    if (!invalidateGateBinding()) return
    actions.updateLocalSignalDraft({
      tags: activeDraft.tags.includes(tag) ? activeDraft.tags.filter((item) => item !== tag) : [...activeDraft.tags, tag],
      note: activeDraft.note,
    })
  }

  function updateNote(note: string) {
    if (!invalidateGateBinding()) return
    actions.updateLocalSignalDraft({ tags: activeDraft.tags, note })
  }

  function revealPhotoState() {
    window.requestAnimationFrame(() => {
      photoSectionRef.current?.scrollIntoView({ block: "nearest" })
      if (photoErrorRef.current) {
        photoErrorRef.current.scrollIntoView({ block: "nearest" })
        photoErrorRef.current.focus({ preventScroll: true })
      }
    })
  }

  async function preparePhoto(file: File, allowQaFailure = true) {
    const preparation = ++photoPreparationRef.current
    setPhotoPreparing(false)
    const preservedPreview = Boolean(photoUrlRef.current)
    if (!LOCAL_SIGNAL_PHOTO_TYPES.has(file.type)) {
      setPhotoFile(file)
      setPhotoCanRetry(false)
      setPhotoError("photoTypeError")
      sendFlow({ type: "photo_failed", preservePreview: preservedPreview })
      revealPhotoState()
      return
    }
    if (file.size > MAX_LOCAL_SIGNAL_PHOTO_BYTES) {
      setPhotoFile(file)
      setPhotoCanRetry(false)
      setPhotoError("photoSizeError")
      sendFlow({ type: "photo_failed", preservePreview: preservedPreview })
      revealPhotoState()
      return
    }
    if (allowQaFailure && readQaRuntime<{ localSignalPhoto?: "failure" }>()?.localSignalPhoto === "failure" && !photoFailedOnce) {
      setPhotoFile(file)
      setPhotoFailedOnce(true)
      setPhotoCanRetry(true)
      setPhotoError("photoPrepareError")
      sendFlow({ type: "photo_failed", preservePreview: preservedPreview })
      revealPhotoState()
      return
    }
    setPhotoPreparing(true)
    const previousUrl = photoUrlRef.current
    let candidateUrl: string
    try {
      candidateUrl = URL.createObjectURL(file)
    } catch {
      if (preparation === photoPreparationRef.current) setPhotoPreparing(false)
      setPhotoFile(file)
      setPhotoCanRetry(false)
      setPhotoError("photoPrepareError")
      sendFlow({ type: "photo_failed", preservePreview: preservedPreview })
      revealPhotoState()
      return
    }
    try {
      await decodeLocalSignalPhoto(candidateUrl)
    } catch {
      URL.revokeObjectURL(candidateUrl)
      if (preparation !== photoPreparationRef.current) return
      setPhotoPreparing(false)
      setPhotoFile(file)
      setPhotoCanRetry(false)
      setPhotoError("photoPrepareError")
      sendFlow({ type: "photo_failed", preservePreview: preservedPreview })
      revealPhotoState()
      return
    }
    if (preparation !== photoPreparationRef.current) {
      URL.revokeObjectURL(candidateUrl)
      return
    }
    if (!invalidateGateBinding()) {
      URL.revokeObjectURL(candidateUrl)
      setPhotoPreparing(false)
      return
    }
    setPhotoPreparing(false)
    setPhotoFile(file)
    setPhotoCanRetry(false)
    setPhotoError(null)
    photoUrlRef.current = candidateUrl
    setPhotoUrl(candidateUrl)
    if (previousUrl) URL.revokeObjectURL(previousUrl)
    sendFlow({ type: "photo_ready" })
    revealPhotoState()
  }

  function selectPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) void preparePhoto(file)
    event.target.value = ""
  }

  function removePhoto() {
    if (!invalidateGateBinding()) return
    photoPreparationRef.current += 1
    setPhotoFile(null)
    releasePhotoUrl()
    setPhotoCanRetry(false)
    setPhotoError(null)
    setPhotoPreparing(false)
    sendFlow({ type: "photo_removed" })
    window.requestAnimationFrame(() => photoAddRef.current?.focus({ preventScroll: true }))
  }

  function beginGate() {
    if (!currentBinding || activeDraft.tags.length === 0 || photoPreparing) return
    if (!discardPendingSignalAction(gateBinding?.revision ?? draftRevision)) return
    setGateBinding(currentBinding)
    setGateSession(null)
    sendFlow({ type: "gate_requested" })
    const envelope = createBLocalSignalActionReturn({
      venueId: activeVenue.id,
      draftNonce: currentBinding.revision,
      tags: currentBinding.tags,
      note: currentBinding.note,
      photoPreviewUrl: photoUrl,
    })
    setGateOpen(true)
    if (!requestBActionGate(envelope, actionGateSessionOptions())) {
      const issuedAt = Date.now()
      setGateOpen(false)
      setGateSession({ origin: "local_signal", venueId: activeVenue.id, draftNonce: currentBinding.revision, issuedAt, expiresAt: issuedAt, outcome: "failure" })
      sendFlow({ type: "gate_returned" })
    }
  }

  async function post() {
    if (postInFlightRef.current) return
    if (!currentBinding || !sameLocalSignalDraftBindingB(gateBinding, currentBinding)) {
      sendFlow({ type: "save_failed" })
      return
    }
    if (!exactGateSession || exactGateSession.expiresAt <= Date.now()) {
      setGateSession((current) => current ? { ...current, outcome: "expired" } : null)
      sendFlow({ type: "gate_returned" })
      return
    }
    if (exactGateSession.outcome !== "success" || activeDraft.tags.length === 0) return
    const actionSession = restoreBActionGateSession(window.sessionStorage, new Date(), actionGateSessionOptions())
    const pending = actionSession.pending
    const context = pending ? privateContextForBAction(pending) : null
    if (!pending
      || pending.cta !== "SUBMIT_LOCAL_SIGNAL"
      || pending.venueId !== activeVenue.id
      || context?.cta !== "SUBMIT_LOCAL_SIGNAL"
      || context.draftNonce !== currentBinding.revision
      || context.note !== currentBinding.note
      || context.tags.length !== currentBinding.tags.length
      || !context.tags.every((tag, index) => tag === currentBinding.tags[index])) {
      sendFlow({ type: "save_failed" })
      return
    }
    const payload = createLocalSignalMutationPayloadB({ venueId: activeVenue.id, tags: activeDraft.tags })
    if (!payload) {
      sendFlow({ type: "save_failed" })
      return
    }
    const satisfied = new Set<"account" | "person">()
    if (state.account === "ACC-ACTIVE") satisfied.add("account")
    if (actionGateSessionOptions().allowReviewFixture) {
      if (actionSession.person.status === "eligible" && actionSession.person.expiresAt && Date.parse(actionSession.person.expiresAt) > Date.now()) satisfied.add("person")
    } else {
      postInFlightRef.current = true
      setPostPending(true)
      const originalDraft = liveDraftRef.current.draft
      const isCurrent = () => liveDraftRef.current.draft === originalDraft && liveDraftRef.current.revision === currentBinding.revision && liveDraftRef.current.account === "ACC-ACTIVE"
      const allowed = await consumeJitAuthorization(pending.tokenId, hashBActionReturnTo(pending), isCurrent)
      postInFlightRef.current = false
      setPostPending(false)
      if (!allowed || !isCurrent()) { sendFlow({ type: "save_failed" }); return }
      satisfied.add("person")
    }
    const consumed = consumePendingBActionAtMutation(window.sessionStorage, pending, satisfied, new Date(), { ...actionGateSessionOptions(), credential: state.identityCredential })
    if (!consumed) {
      sendFlow({ type: "save_failed" })
      return
    }
    sendFlow({ type: "save_requested" })
    const knownDuplicate = state.localSignalPostedVenueIds.includes(activeVenue.id)
    let mutationResult: "accepted" | "duplicate" | null = null
    const finalized = finalizeConsumedBActionWithMutation(
      window.sessionStorage,
      consumed,
      () => {
        // The coarse, device-persisted venue key survives the session-only
        // activity receipt. Do not mutate either store a second time when the
        // same device account has already contributed for this venue.
        if (knownDuplicate) {
          mutationResult = "duplicate"
          return true
        }
        const result = activityActions.recordActivityAxes(
          payload.evidenceId,
          payload.axes,
          () => actions.markLocalSignalPosted(activeVenue.id),
        )
        if (result === "accepted" || result === "duplicate") mutationResult = result
        return result === "accepted" || result === "duplicate"
      },
      new Date(),
      actionGateSessionOptions(),
    )
    if (!finalized) {
      sendFlow({ type: "save_failed" })
      return
    }
    if (!mutationResult) {
      sendFlow({ type: "save_failed" })
      return
    }
    setGateSession(null)
    setGateBinding(null)
    photoPreparationRef.current += 1
    releasePhotoUrl()
    setPhotoFile(null)
    setPhotoError(null)
    setPhotoPreparing(false)
    sendFlow({ type: mutationResult === "accepted" ? "save_unique" : "save_duplicate" })
    window.dispatchEvent(new CustomEvent(B_ACTION_GATE_COMPLETE_EVENT, { detail: consumed }))
  }

  const notice = flow.outcome === "failed" ? copy.postError : gateReturn && gateReturn !== "success" ? copy[gateReturn] : null

  return (
    <SheetB
      locale={locale}
      label={copy.header}
      onClose={requestClose}
      navigation="none"
      variant="full-task"
      size="full"
      presenceState={sheetPresence.phase}
      suspended={gateOpen}
      initialFocusSelector="[data-testid='local-signal-tag-calm_now']"
    >
      <section
        className={styles.layer}
        tabIndex={-1}
        data-testid="ondo-b-local-signal"
        data-signal-presence={presentedSignalPhase}
        data-venue-id={activeVenue.id}
        data-visual-direction="apple-contribution-strava"
        data-flow-direction="visual-draft-local-result"
        data-signal-stage={flow.outcome}
        data-photo-stage={photoStage}
        data-upl-state={flow.upload}
      >
        <header>
          <span className={styles.headerPlace}><MapPin size={16} aria-hidden="true" />{name.officialName}</span>
          <strong>{copy.header}</strong>
          <button ref={closeRef} type="button" data-testid="local-signal-close" onClick={requestClose} aria-label={copy.close}><X size={20} aria-hidden="true" /></button>
        </header>

        <div className={styles.body} data-testid="local-signal-draft" data-gate-return={gateReturn ?? "none"}>
          {abandonError ? <p ref={abandonErrorRef} tabIndex={-1} className={`${styles.notice} ${styles.abandonNotice}`} role="alert" data-testid="local-signal-abandon-error"><CircleAlert size={17} aria-hidden="true" />{copy.abandonError}</p> : null}
          {closeDecision ? (
            <section className={styles.closeDecision} aria-labelledby="local-signal-discard-title" aria-describedby="local-signal-discard-body">
              <div className={styles.decisionIcon}><Trash2 size={25} aria-hidden="true" /></div>
              <h2 id="local-signal-discard-title">{copy.discardTitle}</h2>
              <p id="local-signal-discard-body">{copy.discardBody}</p>
              <div className={styles.decisionActions}>
                <button ref={keepEditingRef} type="button" className={styles.primary} onClick={keepDraftEditing}>{copy.keepEditing}</button>
                <button type="button" className={styles.secondaryDanger} data-testid="local-signal-discard" onClick={finishAndReturnToPlace}>{copy.discard}</button>
              </div>
            </section>
          ) : terminal ? (
            <section className={styles.result} data-testid="local-signal-result" data-result={flow.outcome} data-result-tone={flow.outcome === "unique" ? "success" : "neutral"}>
              <div className={styles.resultAnnouncement} role="status" aria-live="polite">
                <div className={styles.resultMark} data-testid="local-signal-result-mark">{flow.outcome === "unique" ? <Check size={30} strokeWidth={2.4} aria-hidden="true" /> : <Bookmark size={28} strokeWidth={2.1} aria-hidden="true" />}</div>
                <p className={styles.eyebrow}>{name.officialName}</p>
                <h2>{flow.outcome === "unique" ? copy.savedTitle : copy.duplicateTitle}</h2>
                <p>{flow.outcome === "unique" ? copy.savedBody : copy.duplicateBody}</p>
                {flow.outcome === "unique" ? <div className={styles.resultAxes} data-testid="local-signal-result-axes" aria-label={`${copy.visit}, ${copy.contribution}`}>
                  <span><MapPin size={17} aria-hidden="true" />{copy.visit}</span>
                  <span><Sparkles size={17} aria-hidden="true" />{copy.contribution}</span>
                </div> : null}
                <p className={styles.resultTruth}><ShieldCheck size={17} aria-hidden="true" />{copy.privateResult}</p>
              </div>
              <button type="button" className={styles.primary} data-testid="local-signal-return" onClick={finishAndReturnToPlace}>{copy.backToPlace}<ArrowRight size={18} aria-hidden="true" /></button>
            </section>
          ) : (
            <>
              <div className={styles.intro}>
                <figure className={styles.venueThumb} data-image-kind="category-mood" data-photo-kind="category-illustration" data-source-class="category_illustration">
                  <img src={canonicalVenueMoodImage(activeVenue)} alt="" loading="lazy" decoding="async" />
                  <figcaption role="img" aria-label={copy.categoryImage}><Sparkles size={14} aria-hidden="true" /></figcaption>
                </figure>
                <div>
                  <p className={styles.eyebrow}>{copy.eyebrow}</p>
                  <h2 id="local-signal-title">{copy.title}</h2>
                  {name.transliteration ? <p className={styles.place}>{name.transliteration}</p> : null}
                </div>
              </div>

              <div className={styles.draft}>
                <fieldset>
                  <legend>{copy.choose}</legend>
                  <div className={styles.tags}>
                    {TAGS.map((tag) => {
                      const TagIcon = tag.icon
                      const selected = activeDraft.tags.includes(tag.id)
                      return (
                        <button key={tag.id} type="button" data-testid={`local-signal-tag-${tag.id}`} aria-pressed={selected} onClick={() => toggleTag(tag.id)}>
                          <TagIcon size={18} strokeWidth={1.9} aria-hidden="true" />
                          <span>{tag[locale]}</span>
                          {selected ? <Check className={styles.selectionMark} size={15} strokeWidth={2.6} aria-hidden="true" /> : null}
                        </button>
                      )
                    })}
                  </div>
                </fieldset>

                <label className={styles.note}>
                  <span>{copy.note}</span>
                  <textarea
                    data-testid="local-signal-note"
                    maxLength={240}
                    value={activeDraft.note}
                    aria-label={copy.note}
                    placeholder={copy.notePlaceholder}
                    onChange={(event) => updateNote(event.target.value)}
                  />
                  {activeDraft.note.length > 0 ? <small aria-live="polite">{activeDraft.note.length}/240</small> : null}
                </label>

                <section ref={photoSectionRef} className={styles.photo} data-testid="local-signal-photo-slot" data-photo-stage={photoStage} data-has-preview={photoUrl ? "true" : "false"}>
                  <input ref={photoInputRef} className={styles.photoInput} type="file" accept="image/jpeg,image/png,image/webp" aria-label={copy.photo} data-testid="local-signal-photo-input" tabIndex={-1} onChange={selectPhoto} />
                  {photoUrl ? (
                    <figure role="status">
                      <img data-testid="local-signal-photo-preview" src={photoUrl} alt={copy.photoAlt} />
                      <figcaption>
                        <button type="button" data-testid="local-signal-photo-replace" aria-label={copy.replacePhoto} onClick={() => photoInputRef.current?.click()}><ImagePlus size={16} aria-hidden="true" /><span>{copy.replacePhoto}</span></button>
                        <button type="button" data-testid="local-signal-photo-remove" aria-label={copy.removePhoto} onClick={removePhoto}><Trash2 size={16} aria-hidden="true" /><span>{copy.removePhoto}</span></button>
                      </figcaption>
                    </figure>
                  ) : null}
                  {photoPreparing ? <p className={styles.photoLoading} role="status"><LoaderCircle size={18} aria-hidden="true" /><span>{copy.photoLoading}</span></p> : null}
                  {photoError ? (
                    <p ref={photoErrorRef} tabIndex={-1} role="alert" data-testid="local-signal-photo-error" data-error={photoError}>
                      <CircleAlert size={17} aria-hidden="true" />
                      <span>{copy[photoError]}</span>
                      {photoError === "photoPrepareError" && photoCanRetry ? (
                        <button type="button" data-testid="local-signal-photo-retry" onClick={() => { if (photoFile) void preparePhoto(photoFile, false) }}><RotateCcw size={16} aria-hidden="true" />{copy.photoRetry}</button>
                      ) : (
                        <button type="button" data-testid="local-signal-photo-choose-another" onClick={() => photoInputRef.current?.click()}><ImagePlus size={16} aria-hidden="true" />{copy.photoChooseAnother}</button>
                      )}
                    </p>
                  ) : null}
                  {!photoUrl && !photoError && !photoPreparing ? <button ref={photoAddRef} type="button" className={styles.photoAdd} onClick={() => photoInputRef.current?.click()}><ImagePlus size={18} aria-hidden="true" />{copy.photo}</button> : null}
                </section>

                <details className={styles.truth} data-testid="local-signal-privacy">
                  <summary data-testid="local-signal-privacy-toggle"><ShieldCheck size={18} aria-hidden="true" /><strong>{copy.boundary}</strong></summary>
                  <div><p>{copy.boundaryBody}</p><p>{copy.personBoundary}</p></div>
                </details>

                {notice ? <p ref={postErrorRef} tabIndex={-1} className={styles.notice} role={flow.outcome === "failed" ? "alert" : "status"} data-testid={flow.outcome === "failed" ? "local-signal-post-error" : undefined}><CircleAlert size={17} aria-hidden="true" />{notice}</p> : null}
              </div>
            </>
          )}
        </div>

        {!closeDecision && !terminal ? (
          <footer>
            <div className={styles.draftAnchor} data-testid="local-signal-draft-anchor" aria-label={`${activeDraft.tags.length} ${copy.selected}`}>
              <span className={styles.anchorGlyphs} aria-hidden="true">
                {activeDraft.tags.slice(0, 3).map((tagId) => {
                  const TagIcon = TAGS.find((tag) => tag.id === tagId)?.icon ?? Sparkles
                  return <i key={tagId}><TagIcon size={14} /></i>
                })}
              </span>
              <strong>{activeDraft.tags.length}</strong>
              <span className={styles.anchorPrivacy}><ShieldCheck size={15} aria-hidden="true" /><span>{copy.privateLine}</span></span>
              {photoUrl ? <img src={photoUrl} alt={copy.photoAlt} data-testid="local-signal-anchor-photo" /> : null}
            </div>
            {personReady ? (
              <button ref={checkRef} type="button" className={styles.primary} data-testid="local-signal-post" aria-busy={postPending} disabled={activeDraft.tags.length === 0 || flow.outcome === "saving" || photoPreparing || postPending} onClick={post}>{postPending ? <LoaderCircle size={18} aria-hidden="true" /> : <Send size={18} aria-hidden="true" />}{copy.confirmAction}</button>
            ) : (
              <button ref={checkRef} type="button" className={styles.primary} data-testid="local-signal-person-check" disabled={activeDraft.tags.length === 0 || gateOpen || photoPreparing} onClick={beginGate}>
                {gateReturn ? <RotateCcw size={17} aria-hidden="true" /> : <Send size={18} aria-hidden="true" />}
                {gateReturn ? copy.retry : copy.action}
              </button>
            )}
          </footer>
        ) : null}
      </section>
    </SheetB>
  )
}
