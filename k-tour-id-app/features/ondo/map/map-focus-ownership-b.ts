/** A one-frame accessibility retry must not replace a newer focus owner. */
export function retryFocusForUnchangedOwner<T>(focus: () => void, environment: {
  active: () => T
  schedule: (callback: () => void) => number
  cancel: (frame: number) => void
}): () => void {
  const owner = environment.active()
  let cancelled = false
  const frame = environment.schedule(() => {
    if (!cancelled && environment.active() === owner) focus()
  })
  return () => {
    cancelled = true
    environment.cancel(frame)
  }
}
