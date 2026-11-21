import { useLayoutEffect, useRef, useState } from 'react'

/** Keep the last visible canvas overlay mounted briefly after its selection disappears. */
export function useOverlayExit<T>(active: T | null, retainAfterDismiss: boolean, durationMs = 160) {
  const previousRef = useRef<T | null>(null)
  const [exiting, setExiting] = useState<T | null>(null)
  if (active !== null) previousRef.current = active

  // Layout effect is intentional: the dismiss render must retain the previous overlay
  // before the browser paints. A passive effect creates one empty frame, which is the
  // visible "flash twice" when selection and canvas state settle in separate commits.
  useLayoutEffect(() => {
    if (active !== null) {
      setExiting(null)
      return
    }
    const previous = previousRef.current
    if (!retainAfterDismiss) {
      previousRef.current = null
      setExiting(null)
      return
    }
    if (previous === null) return
    setExiting(previous)
    const timer = globalThis.setTimeout(() => {
      setExiting(null)
      previousRef.current = null
    }, durationMs)
    return () => globalThis.clearTimeout(timer)
  }, [active, retainAfterDismiss, durationMs])

  // Keep the previous value in the render that starts dismissal as well as after the
  // layout effect. This makes the hook paint-stable even under concurrent rendering.
  const value = active ?? (retainAfterDismiss ? (exiting ?? previousRef.current) : exiting)
  return {
    value,
    closing: active === null && value !== null,
  }
}
