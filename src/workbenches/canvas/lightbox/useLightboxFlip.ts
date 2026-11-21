import { useCallback, useEffect, useRef } from 'react'
import type { CanvasStore } from '../../../state/workbenches/canvas/store'

/** Lightbox open/close FLIP; the source rect is captured before target layout settles. */

export function sourceNodeIdOf(nodes: readonly { id: string; data?: unknown }[], hash: string, preferredNodeId?: string) {
  if (preferredNodeId && nodes.some((node) => node.id === preferredNodeId && (node.data as { assetHash?: string } | undefined)?.assetHash === hash)) return preferredNodeId
  return nodes.find((node) => (node.data as { assetHash?: string } | undefined)?.assetHash === hash)?.id ?? null
}

/** Prefer the actual visible asset box; fall back to the frame for non-media nodes. */
export function sourceRectFromFrame(frame: HTMLElement | null): DOMRect | null {
  const media = frame?.querySelector<HTMLElement>('img, video')
  const mediaRect = media?.getBoundingClientRect()
  if (mediaRect && mediaRect.width > 0 && mediaRect.height > 0) return mediaRect
  const frameRect = frame?.getBoundingClientRect()
  return frameRect && frameRect.width > 0 && frameRect.height > 0 ? frameRect : null
}

export function useLightboxFlip(options: {
  stageRef: React.RefObject<HTMLElement | null>
  store: CanvasStore
  assetHash: string | undefined
  sourceNodeId?: string
  open: boolean
}): { requestClose: () => void } {
  const { stageRef, store, assetHash, sourceNodeId, open } = options
  const flippedRef = useRef<string | null>(null)
  const closingRef = useRef(false)

  const sourceRectOf = (hash: string, preferredNodeId?: string) => {
    const nodes = store.getSnapshot().nodes
    const preferred = preferredNodeId
      ? sourceNodeIdOf(nodes, hash, preferredNodeId)
      : null
    const candidateIds = preferred
      ? [preferred]
      : [sourceNodeIdOf(nodes, hash)].filter((id): id is string => Boolean(id))
    for (const nodeId of candidateIds) {
      const frame = document.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`)
      const rect = sourceRectFromFrame(frame)
      if (rect) return rect
    }
    return null
  }

  useEffect(() => {
    if (!open) {
      flippedRef.current = null
      return
    }
    if (!assetHash || flippedRef.current === assetHash) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      flippedRef.current = assetHash
      return
    }
    let frames = 0
    let raf = 0
    let last = { w: 0, h: 0 }
    const first = sourceRectOf(assetHash, sourceNodeId)
    const attempt = () => {
      const media = stageRef.current?.querySelector<HTMLElement>('[data-lightbox-media]')
      const to = media?.getBoundingClientRect()
      const stable = !!to && Math.abs(to.width - last.w) < 1 && Math.abs(to.height - last.h) < 1
      if (!media || !to || to.width < 48 || to.height < 48 || !stable) {
        if (to) last = { w: to.width, h: to.height }
        frames += 1
        if (frames < 40) raf = window.requestAnimationFrame(attempt)
        return
      }
      const from = first ?? sourceRectOf(assetHash, sourceNodeId)
      if (!from || !from.width) {
        frames += 1
        if (frames < 40) raf = window.requestAnimationFrame(attempt)
        return
      }
      flippedRef.current = assetHash
      const scale = Math.max(0.05, Math.min(2.5, Math.min(from.width / to.width, from.height / to.height)))
      const dx = from.left + from.width / 2 - (to.left + to.width / 2)
      const dy = from.top + from.height / 2 - (to.top + to.height / 2)
      media.animate(
        [
          { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0.6 },
          { transform: 'translate(0, 0) scale(1)', opacity: 1 },
        ],
        { duration: 440, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' },
      )
    }
    raf = window.requestAnimationFrame(attempt)
    return () => window.cancelAnimationFrame(raf)
  }, [assetHash, open, sourceNodeId, stageRef, store])

  const requestClose = useCallback(() => {
    if (closingRef.current) return
    const media = stageRef.current?.querySelector<HTMLElement>('[data-lightbox-media]')
    const hash = store.getLightbox()?.assetHash
    const from = hash ? sourceRectOf(hash, store.getLightbox()?.sourceNodeId) : null
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (!media || !from || !from.width || reduced) {
      store.closeLightbox()
      return
    }
    closingRef.current = true
    const to = media.getBoundingClientRect()
    const scale = Math.max(0.05, Math.min(2.5, Math.min(from.width / to.width, from.height / to.height)))
    const dx = from.left + from.width / 2 - (to.left + to.width / 2)
    const dy = from.top + from.height / 2 - (to.top + to.height / 2)
    const done = () => {
      if (!closingRef.current) return
      closingRef.current = false
      store.closeLightbox()
    }
    const anim = media.animate(
      [
        { transform: 'translate(0, 0) scale(1)', opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0.35 },
      ],
      { duration: 400, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' },
    )
    anim.finished.then(done, done)
    window.setTimeout(done, 420)
  }, [stageRef, store])

  return { requestClose }
}
