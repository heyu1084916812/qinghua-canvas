export type CanvasDetailMode = 'full' | 'coarse'

export const COARSE_ENTER_ZOOM = 0.18
export const COARSE_EXIT_ZOOM = 0.28

export function nextCanvasDetailMode(
  current: CanvasDetailMode,
  zoom: number,
): CanvasDetailMode {
  if (current === 'coarse') return zoom <= COARSE_EXIT_ZOOM ? 'coarse' : 'full'
  return zoom < COARSE_ENTER_ZOOM ? 'coarse' : 'full'
}
