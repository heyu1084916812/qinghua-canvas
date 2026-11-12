import { useEffect, useRef, useState, type RefObject } from 'react'
import {
  researchOverlayBounds,
  type ResearchOverlayBounds,
} from './researchOverlayGeometry'

export function researchTabDestination(
  activeIndex: number,
  itemCount: number,
  shiftKey: boolean,
): number | null {
  if (itemCount <= 0) return null
  if (activeIndex < 0 || activeIndex >= itemCount) return shiftKey ? itemCount - 1 : 0
  if (shiftKey && activeIndex === 0) return itemCount - 1
  if (!shiftKey && activeIndex === itemCount - 1) return 0
  return null
}

export function researchFocusableElements(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => element.offsetParent !== null)
}

export function containResearchTabFocus(
  root: HTMLElement,
  event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'preventDefault'>,
): boolean {
  if (event.key !== 'Tab') return false
  const items = researchFocusableElements(root)
  const destination = researchTabDestination(
    items.indexOf(document.activeElement as HTMLElement),
    items.length,
    event.shiftKey,
  )
  if (destination === null) return false
  event.preventDefault()
  items[destination]?.focus()
  return true
}

export function useResearchOverlay(
  containerRef: RefObject<HTMLElement>,
  onRequestClose: () => void,
): ResearchOverlayBounds {
  const closeRef = useRef(onRequestClose)
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null),
  )
  const [bounds, setBounds] = useState<ResearchOverlayBounds>(
    () => researchOverlayBounds(0, 0, null),
  )
  closeRef.current = onRequestClose

  useEffect(() => {
    const measure = () => {
      const surface = document.querySelector<HTMLElement>('[data-canvas-surface]')
      setBounds(
        researchOverlayBounds(
          window.innerWidth,
          window.innerHeight,
          surface?.getBoundingClientRect() ?? null,
        ),
      )
    }
    measure()
    window.addEventListener('resize', measure)
    const observer = new ResizeObserver(measure)
    const surface = document.querySelector<HTMLElement>('[data-canvas-surface]')
    if (surface) observer.observe(surface)
    return () => {
      window.removeEventListener('resize', measure)
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    const root = containerRef.current
    if (!root) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    researchFocusableElements(root)[0]?.focus()

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRef.current()
        return
      }
      if (!containResearchTabFocus(root, event) && event.key === 'Tab') {
        event.preventDefault()
        root.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = previousOverflow
      returnFocusRef.current?.focus?.()
    }
  }, [containerRef])

  return bounds
}
