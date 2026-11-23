export type CanvasDetailMode = 'full' | 'coarse'

export const COARSE_ENTER_ZOOM = 0.18
export const COARSE_EXIT_ZOOM = 0.28
export const GESTURE_COARSE_MIN_NODES = 120
/**
 * 缩放手势连续穿过档位边界时，先等视口稳定再换节点类型。真实图片大画布上，
 * full/coarse 一帧内来回切换会让 150 张 `<img>` 反复卸载、解码和重挂载。
 */
export const DETAIL_MODE_SETTLE_MS = 220

export function nextCanvasDetailMode(
  current: CanvasDetailMode,
  zoom: number,
): CanvasDetailMode {
  if (current === 'coarse') return zoom <= COARSE_EXIT_ZOOM ? 'coarse' : 'full'
  return zoom < COARSE_ENTER_ZOOM ? 'coarse' : 'full'
}

/**
 * A low-zoom viewport can contain the entire graph. Switching that gesture to
 * the lightweight node renderer avoids painting every real thumbnail while the
 * viewport moves. Small visible sets keep their full appearance.
 */
export function shouldCoarsenGestureNodes(input: {
  moving: boolean
  detailMode: CanvasDetailMode
  renderedNodeCount: number
}): boolean {
  return (
    input.moving &&
    input.detailMode === 'full' &&
    input.renderedNodeCount >= GESTURE_COARSE_MIN_NODES
  )
}
