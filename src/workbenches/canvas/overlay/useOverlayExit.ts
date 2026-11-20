import { useEffect, useRef, useState } from 'react'

/** Keep the last visible canvas overlay mounted briefly after its selection disappears. */
export function useOverlayExit<T>(active: T | null, retainAfterDismiss: boolean, durationMs = 160) {
  const previousRef = useRef<T | null>(null)
  const [exiting, setExiting] = useState<T | null>(null)
  const [retaining, setRetaining] = useState(false)
  if (active !== null) previousRef.current = active

  useEffect(() => {
    if (active !== null) {
      setExiting(null)
      setRetaining(false)
      return
    }
    const previous = previousRef.current
    if (!retainAfterDismiss) {
      previousRef.current = null
      setExiting(null)
      setRetaining(false)
      return
    }
    if (previous === null) return
    setExiting(previous)
    setRetaining(true)
    const timer = globalThis.setTimeout(() => {
      setExiting(null)
      setRetaining(false)
      previousRef.current = null
    }, durationMs)
    return () => globalThis.clearTimeout(timer)
  }, [active, retainAfterDismiss, durationMs])

  const value = active ?? (retainAfterDismiss && retaining ? previousRef.current : exiting)
  return {
    value,
    closing: active === null && value !== null,
  }
}
