export interface ResearchOverlayRect {
  left: number
  top: number
  right: number
  bottom: number
}

export interface ResearchOverlayBounds {
  left: number
  top: number
  right: number
  bottom: number
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(value)))

export function researchOverlayBounds(
  viewportWidth: number,
  viewportHeight: number,
  surface: ResearchOverlayRect | null,
): ResearchOverlayBounds {
  if (
    !surface ||
    !Number.isFinite(surface.left) ||
    !Number.isFinite(surface.top) ||
    !Number.isFinite(surface.right) ||
    !Number.isFinite(surface.bottom) ||
    surface.right <= surface.left ||
    surface.bottom <= surface.top
  ) {
    return { left: 0, top: 0, right: 0, bottom: 0 }
  }
  const left = clamp(surface.left, 0, viewportWidth)
  const top = clamp(surface.top, 0, viewportHeight)
  const right = clamp(viewportWidth - surface.right, 0, viewportWidth - left)
  const bottom = clamp(viewportHeight - surface.bottom, 0, viewportHeight - top)
  return { left, top, right, bottom }
}
