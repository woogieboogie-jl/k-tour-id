"use client"

import { useEffect, useId, useRef, useState } from "react"
import { Check, LockKeyhole, Pencil, X } from "lucide-react"
import { CANONICAL_PRIVATE_NOTE_MAX_LENGTH } from "@/lib/ondo/venues/canonical-allowlist"
import type { OndoBLocale } from "../shared/state/ondo-b-preferences"
import { useOndoB } from "../shared/state/ondo-b-provider"
import {
  clearPrivateNoteDraftMemory,
  readPrivateNoteDraftMemory,
  writePrivateNoteDraftMemory,
} from "../shared/state/private-note-draft-memory"
import styles from "../shared/ui/production-local.module.css"
import savedStyles from "./saved-entry-b.module.css"
import { canonicalMapVenueById } from "@/lib/ondo/venues/map-data"
import { usePlaceMemoriesB, writePlaceMemoryB } from "../place/place-memory-b"

const COPY = {
  en: {
    title: "Private note",
    placeholder: "Keep an ordering tip or a reason to return.",
    add: "Add private note",
    edit: "Edit private note",
    onlyHere: "Only on this device",
    savedHere: "Saved on this device",
    save: "Save private note",
    retry: "Retry saving note",
    cancel: "Cancel",
    saved: "Saved on this device.",
    failed: "Couldn’t save the note. Try again.",
  },
  ko: {
    title: "나만의 메모",
    placeholder: "주문 방법이나 다시 찾을 이유를 적어 두세요.",
    add: "개인 메모 추가",
    edit: "개인 메모 수정",
    onlyHere: "이 기기에만 저장",
    savedHere: "이 기기에 저장됨",
    save: "개인 메모 저장",
    retry: "메모 저장 다시 시도",
    cancel: "취소",
    saved: "이 기기에 저장했어요.",
    failed: "메모를 저장하지 못했어요. 다시 시도해 주세요.",
  },
  ja: {
    title: "プライベートメモ",
    placeholder: "注文のコツや、また訪れたい理由をメモできます。",
    add: "プライベートメモを追加",
    edit: "プライベートメモを編集",
    onlyHere: "この端末にのみ保存",
    savedHere: "この端末に保存済み",
    save: "プライベートメモを保存",
    retry: "メモの保存を再試行",
    cancel: "キャンセル",
    saved: "この端末に保存しました。",
    failed: "メモを保存できませんでした。もう一度お試しください。",
  },
} as const

export function PrivateNote({ venueId, venueName }: { venueId: string; venueName: string }) {
  const { state, actions } = useOndoB()
  const memories = usePlaceMemoriesB()
  const canonical = Boolean(canonicalMapVenueById(venueId))
  const stored = canonical ? state.privateNotesByVenue[venueId] ?? "" : memories[venueId]?.note ?? ""
  const restoredDraft = readPrivateNoteDraftMemory(venueId)
  const [draft, setDraft] = useState(() => restoredDraft?.value ?? stored)
  const [receipt, setReceipt] = useState<"idle" | "saved" | "failed">("idle")
  const [editing, setEditing] = useState(() => restoredDraft?.editing ?? false)
  const noteId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const locale = state.locale
  const copy = COPY[locale]

  useEffect(() => {
    if (editing || readPrivateNoteDraftMemory(venueId)) return
    setDraft(stored)
  }, [editing, stored, venueId])

  useEffect(() => {
    if (editing) window.requestAnimationFrame(() => fieldRef.current?.focus())
  }, [editing])

  function finishEditing() {
    setEditing(false)
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }

  function save() {
    if (!(canonical ? actions.setPrivateNote(venueId, draft) : writePlaceMemoryB(venueId, { note: draft }))) {
      setReceipt("failed")
      writePrivateNoteDraftMemory(venueId, { value: draft, editing: true })
      return
    }
    clearPrivateNoteDraftMemory(venueId)
    setReceipt("saved")
    finishEditing()
  }

  function cancel() {
    clearPrivateNoteDraftMemory(venueId)
    setDraft(stored)
    setReceipt("idle")
    finishEditing()
  }

  return (
    <section className={`${styles.note} ${savedStyles.noteShell}`} data-testid={`private-note-${venueId}`} aria-labelledby={noteId}>
      <button
        ref={triggerRef}
        type="button"
        className={savedStyles.noteTrigger}
        aria-expanded={editing}
        aria-controls={`${noteId}-editor`}
        aria-label={`${stored ? copy.edit : copy.add}: ${venueName}`}
        onClick={() => {
          setReceipt("idle")
          writePrivateNoteDraftMemory(venueId, { value: draft, editing: true })
          setEditing(true)
        }}
      >
        <span className={savedStyles.noteTriggerIcon}><LockKeyhole size={16} aria-hidden="true" /></span>
        <span><strong id={noteId}>{copy.title}</strong><small>{stored ? copy.savedHere : copy.onlyHere}</small></span>
        {stored ? <Check size={17} aria-hidden="true" /> : <Pencil size={17} aria-hidden="true" />}
      </button>
      {editing ? (
        <div id={`${noteId}-editor`} className={savedStyles.noteEditor}>
          <label className={savedStyles.srOnly} htmlFor={`${noteId}-field`}>{copy.title}: {venueName}</label>
          <textarea
            ref={fieldRef}
            id={`${noteId}-field`}
            aria-label={`${copy.title}: ${venueName}`}
            value={draft}
            maxLength={CANONICAL_PRIVATE_NOTE_MAX_LENGTH}
            rows={3}
            onChange={(event) => {
              const value = event.target.value
              setDraft(value)
              writePrivateNoteDraftMemory(venueId, { value, editing: true })
              setReceipt("idle")
            }}
            placeholder={copy.placeholder}
          />
          <div className={savedStyles.noteEditorActions}>
            <small>{draft.length}/{CANONICAL_PRIVATE_NOTE_MAX_LENGTH}</small>
            <span>
              <button type="button" className={savedStyles.noteCancel} onClick={cancel}><X size={15} aria-hidden="true" />{copy.cancel}</button>
              <button type="button" onClick={save}>{receipt === "failed" ? copy.retry : copy.save}</button>
            </span>
          </div>
          {receipt === "failed" ? <span className={styles.noteError} role="alert">{copy.failed}</span> : null}
        </div>
      ) : null}
      {!editing && receipt === "saved" ? <span className={styles.noteReceipt} role="status">{copy.saved}</span> : null}
    </section>
  )
}
