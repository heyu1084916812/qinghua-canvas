import { useEffect, useLayoutEffect, useRef } from 'react'

const RESERVE = '--mapping-scroll-reserve'
const useBeforePaint = typeof window === 'undefined' ? useEffect : useLayoutEffect

/** Keep the category bar under the pointer without inflating the mapping table. */
export function useMappingTabAnchor(category: string, scope?: string) {
  const sectionRef = useRef<HTMLElement | null>(null)
  const pendingTop = useRef<number | null>(null)
  const reserve = useRef(0)

  useBeforePaint(() => {
    const editor = sectionRef.current?.closest<HTMLElement>('[data-settings-editor]')
    if (!editor) return
    const release = () => {
      reserve.current = 0
      editor.style.removeProperty(RESERVE)
    }
    const releaseWhenBackInRange = () => {
      if (reserve.current === 0) return
      const naturalMax = Math.max(0, editor.scrollHeight - editor.clientHeight - reserve.current)
      if (editor.scrollTop <= naturalMax) release()
    }
    editor.addEventListener('scroll', releaseWhenBackInRange, { passive: true })
    window.addEventListener('resize', release)
    return () => {
      editor.removeEventListener('scroll', releaseWhenBackInRange)
      window.removeEventListener('resize', release)
      pendingTop.current = null
      release()
    }
  }, [scope])

  useBeforePaint(() => {
    const previousTop = pendingTop.current
    pendingTop.current = null
    const section = sectionRef.current
    const editor = section?.closest<HTMLElement>('[data-settings-editor]')
    if (previousTop === null || !section || !editor) return

    // The browser may already have clamped scrollTop to the shorter content. The
    // anchor delta recovers the desired offset before painting the new category.
    const target = Math.max(0, editor.scrollTop + section.getBoundingClientRect().top - previousTop)
    editor.style.removeProperty(RESERVE)
    const naturalMax = editor.scrollHeight - editor.clientHeight
    // scrollHeight is floored at clientHeight: a form shorter than the viewport
    // also needs to fill that gap before any additional padding can preserve scrollTop.
    const shortfall = naturalMax === 0 && target > 0
      ? Math.max(0, editor.clientHeight - (editor.firstElementChild?.getBoundingClientRect().height ?? 0)
          - (parseFloat(getComputedStyle(editor).paddingBottom) || 0))
      : 0
    reserve.current = Math.max(0, Math.ceil(target - naturalMax + shortfall))
    if (reserve.current > 0) editor.style.setProperty(RESERVE, `${reserve.current}px`)
    editor.scrollTop = target
  }, [category])

  return {
    sectionRef,
    capture: () => {
      pendingTop.current = sectionRef.current?.getBoundingClientRect().top ?? null
    },
  }
}
