export type CanvasDetailMode = 'full' | 'coarse'

export function nextCanvasDetailMode(
  _current: CanvasDetailMode,
  _zoom: number,
): CanvasDetailMode {
  return 'full'
}
