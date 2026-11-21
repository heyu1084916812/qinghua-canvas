import { useLayoutEffect, type RefObject } from 'react'

export const HUD_MOTION = {
  easeIn: 'cubic-bezier(0.16, 1, 0.3, 1)',
  easeOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
  bar: {
    enterMs: 300,
    exitMs: 210,
    enterY: 14,
    exitY: 12,
  },
  panel: {
    enterMs: 340,
    exitMs: 230,
    enterDelayMs: 30,
    enterY: -16,
    exitY: -14,
  },
  part: {
    enterMs: 260,
    enterDelayMs: 65,
    staggerMs: 48,
    enterY: 8,
  },
} as const

export function hudMotionFrames(kind: 'bar' | 'panel', closing: boolean): Keyframe[] {
  const settings = HUD_MOTION[kind]
  if (closing) {
    return [
      { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)', filter: 'blur(0px)' },
      {
        opacity: 0,
        transform: `translate3d(0, ${settings.exitY}px, 0) scale(${kind === 'bar' ? 0.92 : 0.94})`,
        filter: 'blur(0px)',
      },
    ]
  }
  return [
    {
      opacity: 0,
      transform: `translate3d(0, ${settings.enterY}px, 0) scale(${kind === 'bar' ? 0.92 : 0.94})`,
      filter: 'blur(0px)',
    },
    { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)', filter: 'blur(0px)' },
  ]
}

export function hudMotionTiming(kind: 'bar' | 'panel', closing: boolean): KeyframeAnimationOptions {
  const settings = HUD_MOTION[kind]
  return {
    duration: closing ? settings.exitMs : settings.enterMs,
    delay: closing || kind === 'bar' ? 0 : HUD_MOTION.panel.enterDelayMs,
    easing: closing ? HUD_MOTION.easeOut : HUD_MOTION.easeIn,
    fill: closing ? 'forwards' : 'both',
  }
}

function clearMotionStyles(element: HTMLElement) {
  element.style.removeProperty('will-change')
  element.style.removeProperty('opacity')
  element.style.removeProperty('transform')
  element.style.removeProperty('filter')
}

export function useHudMotion(ref: RefObject<HTMLElement | null>, kind: 'bar' | 'panel', closing: boolean, identity: string) {
  useLayoutEffect(() => {
    const host = ref.current
    if (!host) return
    const root = host
    root.getAnimations().forEach((animation) => animation.cancel())
    const parts = kind === 'panel' ? [...root.querySelectorAll<HTMLElement>('[data-panel-part]')] : []
    parts.forEach((part) => part.getAnimations().forEach((animation) => animation.cancel()))
    root.style.transformOrigin = kind === 'bar' ? 'bottom center' : 'top center'
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      root.style.opacity = closing ? '0' : '1'
      root.style.transform = 'none'
      root.style.filter = 'none'
      root.style.willChange = 'auto'
      return
    }
    root.style.willChange = 'transform, opacity'
    const animation = root.animate(hudMotionFrames(kind, closing), hudMotionTiming(kind, closing))
    const partAnimations = closing ? [] : parts.map((part, index) => part.animate(
      [
        { opacity: 0, transform: `translateY(${HUD_MOTION.part.enterY}px)` },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      {
        duration: HUD_MOTION.part.enterMs,
        delay: HUD_MOTION.part.enterDelayMs + index * HUD_MOTION.part.staggerMs,
        easing: HUD_MOTION.easeIn,
        fill: 'both',
      },
    ))
    animation.finished.then(
      () => {
        root.style.opacity = closing ? '0' : '1'
        root.style.transform = 'none'
        root.style.filter = 'none'
        root.style.willChange = 'auto'
        animation.cancel()
        parts.forEach((part) => clearMotionStyles(part))
      },
      () => undefined,
    )
    return () => {
      animation.cancel()
      partAnimations.forEach((item) => item.cancel())
      clearMotionStyles(root)
      parts.forEach((part) => clearMotionStyles(part))
    }
  }, [closing, identity, kind, ref])
}
