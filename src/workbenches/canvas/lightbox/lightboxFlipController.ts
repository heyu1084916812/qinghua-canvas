import { useCallback, useLayoutEffect, useRef } from 'react'
import type { CanvasStore } from '../../../state/workbenches/canvas/store'
import { predictedMediaRect } from './lightboxViewportMath'
export const LIGHTBOX_MOTION = {
  enterMs: 440,
  exitMs: 400,
  overlayMs: 360,
  easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
} as const
const SOURCE_SHADOW = '0 8px 24px rgba(0,0,0,.18)'
const TARGET_SHADOW = '0 30px 70px -12px rgba(0,0,0,.65)'

export function sourceNodeIdOf(nodes: readonly { id: string; data?: unknown }[], hash: string, preferredNodeId?: string) {
  if (preferredNodeId && nodes.some((n) => n.id === preferredNodeId && (n.data as { assetHash?: string } | undefined)?.assetHash === hash)) return preferredNodeId
  return nodes.find((n) => (n.data as { assetHash?: string } | undefined)?.assetHash === hash)?.id ?? null
}

export function sourceRectFromFrame(frame: HTMLElement | null): DOMRect | null {
  const media = frame?.querySelector<HTMLElement>('img, video'), mediaRect = media?.getBoundingClientRect()
  if (mediaRect && mediaRect.width > 0 && mediaRect.height > 0) return mediaRect
  const rect = frame?.getBoundingClientRect()
  return rect && rect.width > 0 && rect.height > 0 ? rect : null
}

export function rectStyle(rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>): Record<string, string> {
  return { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` }
}

/** DOMRect geometry lives on the prototype; copy every consumed field explicitly. */
export function snapshotRect(rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>): DOMRect {
  const left = Number.isFinite(rect.left) ? rect.left : 0
  const top = Number.isFinite(rect.top) ? rect.top : 0
  const width = Number.isFinite(rect.width) ? rect.width : 0
  const height = Number.isFinite(rect.height) ? rect.height : 0
  return {
    left,
    top,
    width,
    height,
    x: left,
    y: top,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({ left, top, width, height }),
  } as DOMRect
}

function usableRect(rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'> | null): DOMRect | null {
  return rect && rect.width > 0 && rect.height > 0 ? snapshotRect(rect) : null
}

export function settledMediaRect(
  target: Pick<HTMLElement, 'style' | 'getBoundingClientRect'> | null,
): DOMRect | null {
  if (!target) return null
  const width = Number.parseFloat(target.style.width)
  const height = Number.parseFloat(target.style.height)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  return usableRect(target.getBoundingClientRect())
}

const mediaOf = (id?: string) => id && typeof document !== 'undefined'
  ? document.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"] img, [data-node-id="${CSS.escape(id)}"] video`)
  : null
const rectOf = (id?: string) => usableRect(mediaOf(id)?.getBoundingClientRect() ?? null)
const rectFromSnapshot = (value?: { left: number; top: number; width: number; height: number }) => usableRect(value ?? null)

function computedRadius(element: HTMLElement | null) {
  return element ? getComputedStyle(element).borderRadius : null
}

function computedShadow(element: HTMLElement | null, fallback: string) {
  const shadow = element ? getComputedStyle(element).boxShadow : ''
  return shadow && shadow !== 'none' ? shadow : fallback
}

function motionFrame(rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>, borderRadius: string, boxShadow: string) {
  return {
    ...rectStyle(rect),
    borderRadius,
    boxShadow,
    opacity: '1',
  }
}

function cloneOf(source: HTMLElement, rect: DOMRect, borderRadius: string, boxShadow: string) {
  const clone = source.cloneNode(true) as HTMLElement
  const objectFit = getComputedStyle(source).objectFit || 'cover'
  clone.removeAttribute('data-node-asset')
  clone.setAttribute('data-lightbox-flip-clone', '')
  Object.assign(clone.style, {
    position: 'fixed',
    zIndex: '9999',
    margin: '0',
    pointerEvents: 'none',
    objectFit,
    transform: 'none',
    opacity: '1',
    willChange: 'left, top, width, height, border-radius, box-shadow, opacity',
    ...rectStyle(rect),
    borderRadius,
    boxShadow,
  })
  return clone
}

export function useLightboxFlipController({ stageRef, store, assetHash, sourceNodeId, natural, open }: {
  stageRef: React.RefObject<HTMLElement | null>; store: CanvasStore; assetHash?: string; sourceNodeId?: string; natural?: { w: number; h: number } | null; open: boolean
}) {
  const clone = useRef<HTMLElement | null>(null), source = useRef<HTMLElement | null>(null), first = useRef<DOMRect | null>(null), animation = useRef<Animation | null>(null), overlayAnimation = useRef<Animation | null>(null), closing = useRef(false), completionTimer = useRef<number | null>(null), enterTimer = useRef<number | null>(null)
  const naturalRef = useRef(natural)
  naturalRef.current = natural
  const cleanup = useCallback(() => {
    if (completionTimer.current !== null) window.clearTimeout(completionTimer.current)
    completionTimer.current = null
    if (enterTimer.current !== null) window.clearTimeout(enterTimer.current)
    enterTimer.current = null
    animation.current?.cancel()
    overlayAnimation.current?.cancel()
    animation.current = null
    overlayAnimation.current = null
    if (source.current) source.current.style.visibility = ''
    source.current = null
    first.current = null
    clone.current?.remove()
    clone.current = null
    const overlay = stageRef.current?.closest<HTMLElement>('[data-lightbox]')
    if (overlay) {
      overlay.setAttribute('data-lightbox-flipping', '')
      overlay.style.opacity = ''
      overlay.style.pointerEvents = ''
    }
  }, [stageRef])

  useLayoutEffect(() => {
    if (!open || !assetHash) { if (!open) { cleanup(); closing.current = false }; return }
    if (clone.current || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const lightbox = store.getLightbox()
    const sourceEl = mediaOf(sourceNodeId), storedRect = rectFromSnapshot(lightbox?.sourceRect), sourceRect = storedRect ?? usableRect(sourceEl?.getBoundingClientRect() ?? null)
    if (!sourceRect || sourceRect.width <= 0 || sourceRect.height <= 0) return
    const sourceRadius = lightbox?.sourceRect?.borderRadius ?? computedRadius(sourceEl) ?? '0px'
    const sourceShadow = computedShadow(sourceEl, SOURCE_SHADOW)
    source.current = sourceEl
    first.current = sourceRect
    const floating = sourceEl
      ? cloneOf(sourceEl, sourceRect, sourceRadius, sourceShadow)
      : document.createElement('img')
    if (!sourceEl) {
      floating.setAttribute('data-lightbox-flip-clone', '')
      Object.assign(floating.style, {
        position: 'fixed',
        zIndex: '9999',
        pointerEvents: 'none',
        objectFit: 'cover',
        ...rectStyle(sourceRect),
        borderRadius: sourceRadius,
        boxShadow: sourceShadow,
      });
      (floating as HTMLImageElement).src = lightbox?.sourceRect?.src ?? ''
    }
    document.body.appendChild(floating)
    clone.current = floating
    if (sourceEl) sourceEl.style.visibility = 'hidden'
    const overlay = stageRef.current?.closest<HTMLElement>('[data-lightbox]')
    overlay?.setAttribute('data-lightbox-flipping', '')
    if (overlay) {
      const overlayIn = overlay.animate(
        [{ opacity: '0' }, { opacity: '1' }],
        { duration: LIGHTBOX_MOTION.overlayMs, easing: LIGHTBOX_MOTION.easing, fill: 'forwards' },
      )
      overlayAnimation.current = overlayIn
      overlayIn.finished.then(() => {
        if (overlayAnimation.current !== overlayIn) return
        overlay.style.opacity = ''
        overlayAnimation.current = null
      }, () => undefined)
    }
    let frames = 0, raf = 0
    const play = () => {
      const target = stageRef.current?.querySelector<HTMLElement>('[data-lightbox-media]')
      if (target) target.style.opacity = '0'
      const to = settledMediaRect(target ?? null) ?? predictedMediaRect(stageRef.current, naturalRef.current)
      if (!to) {
        if (++frames < 120) {
          raf = requestAnimationFrame(play)
        } else {
          cleanup()
        }
        return
      }
      const targetRadius = computedRadius(target ?? null) ?? '0px'
      const anim = floating.animate([
        motionFrame(first.current!, sourceRadius, sourceShadow),
        motionFrame(to, targetRadius, TARGET_SHADOW),
      ], { duration: LIGHTBOX_MOTION.enterMs, easing: LIGHTBOX_MOTION.easing, fill: 'forwards' })
      animation.current = anim
      if (enterTimer.current !== null) window.clearTimeout(enterTimer.current)
      enterTimer.current = window.setTimeout(() => {
        enterTimer.current = null
        if (closing.current || clone.current !== floating) return
        const latestTarget = stageRef.current?.querySelector<HTMLElement>('[data-lightbox-media]')
        if (!latestTarget?.isConnected) return
        latestTarget.style.opacity = ''
        overlay?.removeAttribute('data-lightbox-flipping')
        floating.remove()
        clone.current = null
      }, LIGHTBOX_MOTION.enterMs + 80)
      anim.finished.then(() => {
        if (clone.current !== floating) return
        const latestTarget = stageRef.current?.querySelector<HTMLElement>('[data-lightbox-media]')
        const settledTarget =
          usableRect(latestTarget?.isConnected ? latestTarget.getBoundingClientRect() : null) ??
          settledMediaRect(latestTarget?.isConnected ? latestTarget : null) ??
          to
        const settledRadius = computedRadius(latestTarget?.isConnected ? latestTarget : null) ?? targetRadius
        anim.cancel()
        if (latestTarget?.isConnected) {
          latestTarget.style.opacity = ''
          overlay?.removeAttribute('data-lightbox-flipping')
          floating.remove()
          if (clone.current === floating) clone.current = null
        } else {
          Object.assign(floating.style, rectStyle(settledTarget), {
            borderRadius: settledRadius,
            boxShadow: TARGET_SHADOW,
          })
        }
        animation.current = null
      }, () => undefined)
    }
    // One frame lets the overlay stage settle; the clone already shows First.
    raf = requestAnimationFrame(play)
    return () => { cancelAnimationFrame(raf); cleanup() }
  }, [assetHash, cleanup, open, sourceNodeId, stageRef, store])

  const requestClose = useCallback(() => {
    if (closing.current) return
    const lightbox = store.getLightbox()
    const target = stageRef.current?.querySelector<HTMLElement>('[data-lightbox-media]')
    let floating = clone.current
    if (!floating && target?.isConnected) {
      const current = usableRect(target.getBoundingClientRect())
      if (current) {
        floating = cloneOf(
          target,
          current,
          computedRadius(target) ?? '0px',
          computedShadow(target, TARGET_SHADOW),
        )
        document.body.appendChild(floating)
        clone.current = floating
        target.style.opacity = '0'
      }
    }
    const destination = rectOf(lightbox?.sourceNodeId ?? sourceNodeId) ?? rectFromSnapshot(lightbox?.sourceRect) ?? first.current
    const overlay = stageRef.current?.closest<HTMLElement>('[data-lightbox]')
    if (!target || !floating || !destination || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      cleanup()
      store.closeLightbox()
      return
    }
    closing.current = true
    overlay?.setAttribute('data-lightbox-flipping', '')
    overlay?.style.setProperty('pointer-events', 'none')
    target.style.opacity = '0'
    const overlayStart = overlay ? getComputedStyle(overlay).opacity : '1'
    overlayAnimation.current?.cancel()
    if (overlay) overlay.style.opacity = overlayStart
    const overlayOut = overlay?.animate(
      [{ opacity: overlayStart }, { opacity: '0' }],
      { duration: LIGHTBOX_MOTION.overlayMs, easing: LIGHTBOX_MOTION.easing, fill: 'forwards' },
    ) ?? null
    overlayAnimation.current = overlayOut

    const current = snapshotRect(floating.getBoundingClientRect())
    const currentRadius = computedRadius(floating) ?? '0px'
    const currentShadow = computedShadow(floating, TARGET_SHADOW)
    animation.current?.cancel()
    Object.assign(floating.style, rectStyle(current), { borderRadius: currentRadius, boxShadow: currentShadow })
    const sourceEl = mediaOf(lightbox?.sourceNodeId ?? sourceNodeId)
    const destinationRadius = lightbox?.sourceRect?.borderRadius ?? computedRadius(sourceEl) ?? '0px'
    const destinationShadow = computedShadow(sourceEl, SOURCE_SHADOW)
    const anim = floating.animate([
      motionFrame(current, currentRadius, currentShadow),
      motionFrame(destination, destinationRadius, destinationShadow),
    ], { duration: LIGHTBOX_MOTION.exitMs, easing: LIGHTBOX_MOTION.easing, fill: 'forwards' })
    animation.current = anim
    let completed = false
    const done = () => {
      if (completed || !closing.current) return
      completed = true
      cleanup()
      closing.current = false
      store.closeLightbox()
    }
    void Promise.allSettled([anim.finished, overlayOut?.finished ?? Promise.resolve()]).then(done)
    completionTimer.current = window.setTimeout(done, Math.max(LIGHTBOX_MOTION.exitMs, LIGHTBOX_MOTION.overlayMs) + 80)
  }, [cleanup, sourceNodeId, stageRef, store])
  return { requestClose }
}
