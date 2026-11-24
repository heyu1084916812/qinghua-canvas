import type { CanvasStore } from '../../../state/workbenches/canvas/store'
import type { CanvasDetailMode } from './detailMode'

/**
 * The canvas keeps real thumbnails at every supported zoom level. There is no
 * mode boundary to wait for, so viewport updates must not trigger a node-type
 * swap or a detail-mode React render.
 */
export function useCanvasDetailMode(_store: CanvasStore): CanvasDetailMode {
  return 'full'
}
