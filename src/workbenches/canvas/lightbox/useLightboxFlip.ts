import { useCallback, useEffect, useRef } from 'react'
import type { CanvasStore } from '../../../state/workbenches/canvas/store'

/**
 * 灯箱的打开 / 关闭 FLIP（#1161 第三、四轮）。
 *
 * - **打开**：media 从"画布上那个节点"的矩形平移+缩放到自己的落位（260ms）；
 *   必须**等 media 尺寸稳定**再量 —— 图片刚挂载时又小又会被重新 fit，
 *   拿中间态去算会出现"起点不是当前视图中的节点位置"（用户实测）。
 * - **关闭**：同一段动画反着播（220ms），播完才真正 `closeLightbox()` ——
 *   所以不需要"延迟卸载"那种额外状态，灯箱在动画期间仍然开着。
 * - 每次打开都要重播：关掉时清掉"已播过"的记号（否则第二次打开没有动画）。
 *
 * 抽成 hook 的原因：`LightboxLayer` 已经顶到 1040 行预算，这段是自成一体的时序。
 */

export function sourceNodeIdOf(nodes: readonly { id: string; data?: unknown }[], hash: string, preferredNodeId?: string) {
  if (preferredNodeId && nodes.some((node) => node.id === preferredNodeId && (node.data as { assetHash?: string } | undefined)?.assetHash === hash)) return preferredNodeId
  return nodes.find((node) => (node.data as { assetHash?: string } | undefined)?.assetHash === hash)?.id ?? null
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
    // When the caller opened the lightbox from a specific node, never silently
    // fall back to another node carrying the same hash. That made duplicate
    // references animate from the wrong canvas position.
    const candidateIds = preferred
      ? [preferred]
      : [sourceNodeIdOf(nodes, hash)].filter((id): id is string => Boolean(id))
    for (const nodeId of candidateIds) {
      const frame = document.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`)
      // The requested origin is the node's boxed position, not the inner
      // image element. The inner image can be letterboxed or smaller than the
      // selected frame, which makes the zoom visibly start from an offset.
      const rect = frame?.getBoundingClientRect()
      if (rect?.width) return rect
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
      const from = sourceRectOf(assetHash, sourceNodeId)
      // Keep retrying if the exact source node has not mounted yet. Marking it
      // flipped before this check would permanently skip the opening animation.
      if (!from || !from.width) return
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
