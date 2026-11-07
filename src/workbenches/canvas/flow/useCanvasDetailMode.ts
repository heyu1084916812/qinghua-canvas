import { useEffect, useRef, useState } from 'react'
import type { CanvasStore } from '../../../state/workbenches/canvas/store'
import {
  DETAIL_MODE_SETTLE_MS,
  nextCanvasDetailMode,
  type CanvasDetailMode,
} from './detailMode'

const ZOOM_EPSILON = 0.001

/**
 * full/coarse 切换会替换全部节点的 React 类型。缩放手势连续穿过阈值时，
 * 等视口稳定一拍再切换，避免真实图片节点整批卸载、解码、重挂载。
 */
export function useCanvasDetailMode(store: CanvasStore): CanvasDetailMode {
  const [mode, setMode] = useState<CanvasDetailMode>(() =>
    nextCanvasDetailMode('full', store.getViewport().zoom),
  )
  const modeRef = useRef(mode)
  modeRef.current = mode

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let lastZoom = store.getViewport().zoom

    const settle = () => {
      timer = null
      const viewport = store.getViewport()
      const target = nextCanvasDetailMode(modeRef.current, viewport.zoom)
      if (target !== modeRef.current) {
        modeRef.current = target
        setMode(target)
      }
    }

    const schedule = (initial = false) => {
      const viewport = store.getViewport()
      const zoomChanged =
        initial || Math.abs(viewport.zoom - lastZoom) >= ZOOM_EPSILON
      lastZoom = viewport.zoom
      if (!zoomChanged) return

      if (timer) clearTimeout(timer)
      const target = nextCanvasDetailMode(modeRef.current, viewport.zoom)
      if (target === modeRef.current) {
        timer = null
        return
      }
      timer = setTimeout(settle, DETAIL_MODE_SETTLE_MS)
    }

    schedule(true)
    const unsubscribe = store.subscribeViewport(() => schedule())
    return () => {
      unsubscribe()
      if (timer) clearTimeout(timer)
    }
  }, [store])

  return mode
}
