import { memo, useEffect, useRef } from 'react'
import { useCanvasStore } from '../storeContext'
import styles from './FlowViewportBackground.module.css'
import {
  syncViewportBackground,
  watchViewportBackgroundTheme,
  type ViewportBackgroundVariant,
} from './viewportBackgroundRuntime'

export type { ViewportBackgroundVariant } from './viewportBackgroundRuntime'

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
      dotPatternRef.current = syncViewportBackground({
        element,
        variant,
        viewport,
        pattern: dotPatternRef.current,
      })
    }
    apply()
    const unsubscribe = store.subscribeViewport(apply)
    const stopThemeWatch = watchViewportBackgroundTheme(() => {
      dotPatternRef.current = null
      apply()
    })
    return () => {
      unsubscribe()
      stopThemeWatch()
    }
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
