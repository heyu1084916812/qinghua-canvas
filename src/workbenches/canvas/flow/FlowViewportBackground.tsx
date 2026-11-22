import { memo, useEffect, useRef } from 'react'
import { useCanvasStore } from '../storeContext'
import styles from './FlowViewportBackground.module.css'

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

  useEffect(() => {
    const apply = () => {
      const viewport = store.getViewport()
      const zoom = viewport.zoom || 1
      const element = ref.current
      if (!element) return
      const size = `${22 * zoom}px ${22 * zoom}px`
      element.style.backgroundSize = size
      element.style.backgroundPosition = `${-viewport.x * zoom}px ${-viewport.y * zoom}px`
    }
    apply()
    return store.subscribeViewport(apply)
  }, [store])

  return (
    <div
      ref={ref}
      className={styles.layer}
      data-viewport-background={variant}
      aria-hidden
    />
  )
})
