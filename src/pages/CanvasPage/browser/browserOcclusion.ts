/**
 * 原生视图遮挡判定（2026-11-13）。
 *
 * 原生 webview 是操作系统层的子窗口，永远画在 DOM 之上；任何 DOM 浮层（菜单、对话框、
 * 下拉、灯箱）只要压到它的区域，就会被它盖住。所以要先找出「压在内容区上的浮层」，
 * 有就把原生视图藏起来，浮层关掉再显示。
 */
export interface PlainRect {
  left: number
  top: number
  right: number
  bottom: number
}

/** 认为是「浮层」的元素：ARIA 弹出角色 + 项目里通用的浮层锚点 */
export const BROWSER_OCCLUDER_SELECTOR = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[role="tooltip"]',
  '[data-param-popup]',
  '[data-context-menu]',
  '[data-color-picker-popover]',
  '[data-loop-number-popover]',
  '[data-browser-occluder]',
].join(',')

export function rectsOverlap(a: PlainRect, b: PlainRect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

/**
 * 在候选浮层里找第一个压在内容区上的。`ownRoot` 是浏览器浮层自己（它的弹出不算）。
 * 宽或高为 0 的（隐藏 / 未布局）不算。
 */
export function findBrowserOccluder<T>(
  content: PlainRect,
  candidates: ReadonlyArray<{ node: T; rect: PlainRect; insideOwnRoot: boolean }>,
): T | null {
  for (const candidate of candidates) {
    if (candidate.insideOwnRoot) continue
    const { rect } = candidate
    if (rect.right - rect.left <= 0 || rect.bottom - rect.top <= 0) continue
    if (rectsOverlap(content, rect)) return candidate.node
  }
  return null
}

/** DOM 版：扫一遍文档里的浮层 */
export function domBrowserOccluder(content: Element, ownRoot: Element | null): Element | null {
  const contentRect = content.getBoundingClientRect()
  const nodes = Array.from(document.querySelectorAll(BROWSER_OCCLUDER_SELECTOR))
  return findBrowserOccluder(
    contentRect,
    nodes.map((node) => ({
      node,
      rect: node.getBoundingClientRect(),
      insideOwnRoot: Boolean(ownRoot?.contains(node)),
    })),
  )
}
