import { TAB_LEFT_EXTEND } from './folderTabGeometry'

/** DOM 更新后按含左扩轮廓的新宽度只滚动标签栏，不触碰外层纵向锚点。 */
export function revealFolderTab(host: HTMLElement | null, tab: HTMLElement): void {
  if (!host) return
  const left = Math.max(0, tab.offsetLeft - TAB_LEFT_EXTEND)
  const right = tab.offsetLeft + tab.offsetWidth
  if (left < host.scrollLeft) host.scrollLeft = left
  else if (right > host.scrollLeft + host.clientWidth) {
    host.scrollLeft = right - host.clientWidth
  }
}
