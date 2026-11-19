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
export function useLightboxFlip(options: {
  stageRef: React.RefObject<HTMLElement | null>
  store: CanvasStore
  assetHash: string | undefined
  open: boolean
}): { requestClose: () => void } {
  const { stageRef, store, assetHash, open } = options
  const flippedRef = useRef<string | null>(null)
  const closingRef = useRef(false)

  const sourceRectOf = (hash: string) => {
    const node = store.getSnapshot().nodes.find((n) => (n.data as { assetHash?: string }).assetHash === hash)
    if (!node) return null
    return document.querySelector<HTMLElement>(`[data-node-id="${node.id}"]`)?.getBoundingClientRect() ?? null
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
      flippedRef.current = assetHash
      const from = sourceRectOf(assetHash)
      if (!from || !from.width) return
      const scale = Math.max(0.05, Math.min(2.5, Math.min(from.width / to.width, from.height / to.height)))
      const dx = from.left + from.width / 2 - (to.left + to.width / 2)
      const dy = from.top + from.height / 2 - (to.top + to.height / 2)
      media.animate(
        [
          { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0.6 },
          { transform: 'translate(0, 0) scale(1)', opacity: 1 },
        ],
        { duration: 260, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
      )
    }
    raf = window.requestAnimationFrame(attempt)
    return () => window.cancelAnimationFrame(raf)
  }, [assetHash, open, stageRef, store])

  const requestClose = useCallback(() => {
    if (closingRef.current) return
    const media = stageRef.current?.querySelector<HTMLElement>('[data-lightbox-media]')
    const hash = store.getLightbox()?.assetHash
    const from = hash ? sourceRectOf(hash) : null
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
      { duration: 220, easing: 'cubic-bezier(0.4, 0, 0.6, 1)', fill: 'forwards' },
    )
    anim.finished.then(done, done)
    window.setTimeout(done, 420)
  }, [stageRef, store])

  return { requestClose }
}