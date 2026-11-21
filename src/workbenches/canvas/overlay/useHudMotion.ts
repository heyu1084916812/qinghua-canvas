import { useLayoutEffect, type RefObject } from 'react'

const easeIn = 'cubic-bezier(0.16, 1, 0.3, 1)'
const easeOut = 'cubic-bezier(0.4, 0, 0.2, 1)'

export function useHudMotion(ref: RefObject<HTMLElement | null>, kind: 'bar' | 'panel', closing: boolean, identity: string) {
  useLayoutEffect(() => {
    const host = ref.current
    if (!host) return
    const root = kind === 'panel' ? host.querySelector<HTMLElement>('[data-creation-panel], [data-emotion-panel]') ?? host : host
    root.getAnimations().forEach((animation) => animation.cancel())
    const parts = kind === 'panel' ? [...root.querySelectorAll<HTMLElement>('[data-panel-part]')] : []
    parts.forEach((part) => part.getAnimations().forEach((animation) => animation.cancel()))
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      root.style.opacity = closing ? '0' : '1'
      root.style.transform = 'none'
      root.style.filter = 'none'
      return
    }
    const animation = root.animate(
      closing
        ? [
            { opacity: 1, transform: kind === 'bar' ? 'translate3d(0, 0, 0) scale(1)' : 'translate3d(0, 0, 0) scale(1)', filter: 'blur(0px)' },
            { opacity: 0, transform: kind === 'bar' ? 'translate3d(0, 12px, 0) scale(.92)' : 'translate3d(0, -14px, 0) scale(.94)', filter: 'blur(4px)' },
          ]
        : [
            { opacity: 0, transform: kind === 'bar' ? 'translate3d(0, 14px, 0) scale(.92)' : 'translate3d(0, -16px, 0) scale(.94)', filter: 'blur(4px)' },
            { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)', filter: 'blur(0px)' },
          ],
      { duration: closing ? (kind === 'bar' ? 210 : 230) : (kind === 'bar' ? 300 : 340), delay: closing ? 0 : kind === 'panel' ? 30 : 0, easing: closing ? easeOut : easeIn, fill: 'both' },
    )
    const partAnimations = closing ? [] : parts.map((part, index) => part.animate(
      [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }],
      { duration: 260, delay: 65 + index * 48, easing: easeIn, fill: 'both' },
    ))
    return () => { animation.cancel(); partAnimations.forEach((item) => item.cancel()) }
  }, [closing, identity, kind, ref])
}
