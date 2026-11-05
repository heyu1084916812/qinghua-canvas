/** FlowSurface 的兼容 DOM 锚点：冒烟仍按 data-world / data-marquee 读旧引擎几何。 */
export function tagWorldAnchor(): () => void {
  const el = typeof document === 'undefined'
    ? null
    : document.querySelector<HTMLElement>('[data-canvas-surface] .react-flow__viewport')
  if (!el) return () => {}
  el.setAttribute('data-world', '')
  return () => el.removeAttribute('data-world')
}

export function tagMarqueeAnchors(surface: HTMLElement): () => void {
  const tag = () => {
    for (const el of surface.querySelectorAll('.react-flow__selection')) {
      if (!el.hasAttribute('data-marquee')) el.setAttribute('data-marquee', '')
    }
  }
  tag()
  const observer = new MutationObserver(tag)
  observer.observe(surface, { childList: true, subtree: true })
  return () => observer.disconnect()
}

export function installCanvasDomAnchors(): () => void {
  const cleanupWorld = tagWorldAnchor()
  const surface = typeof document === 'undefined'
    ? null
    : document.querySelector<HTMLElement>('[data-canvas-surface]')
  const cleanupMarquee = surface ? tagMarqueeAnchors(surface) : () => {}
  return () => {
    cleanupWorld()
    cleanupMarquee()
  }
}
