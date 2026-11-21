import { useCallback, useEffect, useRef } from 'react'
import type { CanvasStore } from '../../../state/workbenches/canvas/store'

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

const snapshot = (r: DOMRect) => ({ ...r, toJSON: () => ({}) }) as DOMRect
const mediaOf = (id?: string) => id && typeof document !== 'undefined'
  ? document.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"] img, [data-node-id="${CSS.escape(id)}"] video`)
  : null
const rectOf = (id?: string) => { const r = mediaOf(id)?.getBoundingClientRect(); return r && r.width > 0 && r.height > 0 ? snapshot(r) : null }

function cloneOf(source: HTMLElement, rect: DOMRect) {
  const clone = source.cloneNode(true) as HTMLElement
  clone.removeAttribute('data-node-asset')
  clone.setAttribute('data-lightbox-flip-clone', '')
  Object.assign(clone.style, { position: 'fixed', zIndex: '9999', margin: '0', pointerEvents: 'none', objectFit: 'cover', transform: 'none', opacity: '1', willChange: 'left, top, width, height, border-radius, opacity', ...rectStyle(rect) })
  return clone
}

export function useLightboxFlip({ stageRef, store, assetHash, sourceNodeId, open }: {
  stageRef: React.RefObject<HTMLElement | null>; store: CanvasStore; assetHash?: string; sourceNodeId?: string; open: boolean
}) {
  const clone = useRef<HTMLElement | null>(null), source = useRef<HTMLElement | null>(null), first = useRef<DOMRect | null>(null), animation = useRef<Animation | null>(null), closing = useRef(false)
  const cleanup = useCallback(() => { animation.current?.cancel(); animation.current = null; if (source.current) source.current.style.visibility = ''; source.current = null; first.current = null; clone.current?.remove(); clone.current = null }, [])

  useEffect(() => {
    if (!open || !assetHash) { if (!open) { cleanup(); closing.current = false }; return }
    if (clone.current || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const sourceEl = mediaOf(sourceNodeId), sourceRect = sourceEl?.getBoundingClientRect()
    if (!sourceEl || !sourceRect || sourceRect.width <= 0 || sourceRect.height <= 0) return
    source.current = sourceEl; first.current = snapshot(sourceRect)
    const floating = cloneOf(sourceEl, sourceRect); document.body.appendChild(floating); clone.current = floating; sourceEl.style.visibility = 'hidden'
    let frames = 0, raf = 0
    const play = () => {
      const target = stageRef.current?.querySelector<HTMLElement>('[data-lightbox-media]'), to = target?.getBoundingClientRect()
      if (!target || !to || to.width < 48 || to.height < 48) { if (++frames < 60) raf = requestAnimationFrame(play); return }
      target.style.opacity = '0'
      const anim = floating.animate([
        { ...rectStyle(first.current!), borderRadius: getComputedStyle(sourceEl).borderRadius, opacity: 1 },
        { ...rectStyle(to), borderRadius: getComputedStyle(target).borderRadius, opacity: 1 },
      ], { duration: 440, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' })
      animation.current = anim
      anim.finished.then(() => { if (animation.current !== anim) return; Object.assign(floating.style, rectStyle(to)); target.style.opacity = ''; animation.current = null }, () => undefined)
    }
    raf = requestAnimationFrame(play)
    return () => { cancelAnimationFrame(raf); cleanup() }
  }, [assetHash, cleanup, open, sourceNodeId, stageRef])

  const requestClose = useCallback(() => {
    if (closing.current) return
    const target = stageRef.current?.querySelector<HTMLElement>('[data-lightbox-media]'), floating = clone.current, destination = rectOf(store.getLightbox()?.sourceNodeId ?? sourceNodeId) ?? first.current
    if (!target || !floating || !destination || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { cleanup(); store.closeLightbox(); return }
    closing.current = true; animation.current?.cancel(); target.style.opacity = '0'
    const anim = floating.animate([{ ...rectStyle(floating.getBoundingClientRect()), opacity: 1 }, { ...rectStyle(destination), opacity: 1 }], { duration: 380, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' })
    animation.current = anim
    const done = () => { if (!closing.current) return; cleanup(); closing.current = false; store.closeLightbox() }
    anim.finished.then(done, done); window.setTimeout(done, 420)
  }, [cleanup, sourceNodeId, stageRef, store])
  return { requestClose }
}
