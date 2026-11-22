import { memo, useEffect, useRef } from 'react'
import { useCanvasStore } from '../storeContext'
import styles from './FlowViewportBackground.module.css'
import { viewportBackgroundMetrics, viewportDotPattern } from './viewportBackground'

export type ViewportBackgroundVariant = 'dots' | 'grid'

/**
 * Gesture-only replacement for React Flow's SVG background. The pattern stays
 * in the same world-space position as the viewport, but moving two CSS
 * properties avoids repainting the large pattern that ships with React Flow.
 */
export const FlowViewportBackground = memo(function FlowViewportBackground({
  variant,
}: {
  variant: ViewportBackgroundVariant
}) {
  const store = useCanvasStore()
  const ref = useRef<HTMLDivElement>(null)
  const dotPatternRef = useRef<string | null>(null)

  useEffect(() => {
    const apply = () => {
      const viewport = store.getViewport()
      const element = ref.current
      if (!element) return
      if (variant === 'dots' && dotPatternRef.current === null) {
        const color = getComputedStyle(element).getPropertyValue('--canvas-grid-line')
        dotPatternRef.current = viewportDotPattern(color)
        element.style.backgroundImage = dotPatternRef.current
      }
      const metrics = viewportBackgroundMetrics(viewport)
      element.style.setProperty('--viewport-pattern-size', metrics.size)
      element.style.setProperty('--viewport-pattern-position', metrics.position)
    }
    apply()
    return store.subscribeViewport(apply)
  }, [store, variant])

  return (
    <div
      ref={ref}
      className={styles.layer}
      data-viewport-background={variant}
      aria-hidden
    />
  )
})
