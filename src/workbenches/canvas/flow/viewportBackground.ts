import type { Viewport } from '../../../domain/canvas/geometry/coords'

export const VIEWPORT_BACKGROUND_GAP_PX = 22
export const VIEWPORT_BACKGROUND_DOT_DIAMETER_PX = 1.4

export interface ViewportBackgroundMetrics {
  size: string
  position: string
}

const px = (value: number): string => `${Number(value.toFixed(4))}px`
const SAFE_COLOR = /^(?:#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i

/**
 * Mirrors React Flow's BackgroundComponent: the pattern gap and the dot itself
 * both scale with zoom. The CSS dots variant reuses this size for a repeating
 * SVG mask, so the radius scales without a fixed-pixel radial-gradient dot.
 */
export function viewportBackgroundMetrics(viewport: Viewport): ViewportBackgroundMetrics {
  const zoom = Number.isFinite(viewport.zoom) && viewport.zoom > 0 ? viewport.zoom : 1
  const gap = VIEWPORT_BACKGROUND_GAP_PX * zoom
  return {
    size: `${px(gap)} ${px(gap)}`,
    position: `${px(-viewport.x * zoom)} ${px(-viewport.y * zoom)}`,
  }
}

/** A tiny SVG tile keeps the same circle geometry and anti-aliasing as React Flow. */
export function viewportDotPattern(color: string): string {
  const fill = SAFE_COLOR.test(color.trim()) ? color.trim() : 'transparent'
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">` +
    `<circle cx="11.7" cy="11.7" r="0.7" fill="${fill}" /></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}
