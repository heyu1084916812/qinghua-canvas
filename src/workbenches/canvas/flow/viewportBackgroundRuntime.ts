import type { Viewport } from '../../../domain/canvas/geometry/coords'
import {
  viewportBackgroundMetrics,
  viewportDotPattern,
} from './viewportBackground'

export type ViewportBackgroundVariant = 'dots' | 'grid'

export function syncViewportBackground({
  element,
  variant,
  viewport,
  pattern,
}: {
  element: HTMLElement
  variant: ViewportBackgroundVariant
  viewport: Viewport
  pattern: string | null
}): string | null {
  let nextPattern = pattern
  if (variant === 'dots' && nextPattern === null) {
    const color = getComputedStyle(element).getPropertyValue('--canvas-grid-line')
    nextPattern = viewportDotPattern(color)
    element.style.backgroundImage = nextPattern
  }
  const metrics = viewportBackgroundMetrics(viewport)
  element.style.setProperty('--viewport-pattern-size', metrics.size)
  element.style.setProperty('--viewport-pattern-position', metrics.position)
  return nextPattern
}

export function watchViewportBackgroundTheme(
  refresh: () => void,
  root: HTMLElement = document.documentElement,
): () => void {
  const observer = typeof MutationObserver === 'function'
    ? new MutationObserver(refresh)
    : null
  observer?.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
  // ThemeProvider writes data-theme in a passive effect. Refresh once after
  // that commit so a just-mounted pattern never keeps the previous palette.
  const frame = requestAnimationFrame(refresh)
  return () => {
    cancelAnimationFrame(frame)
    observer?.disconnect()
  }
}
