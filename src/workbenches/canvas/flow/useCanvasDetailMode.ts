import { useEffect, useRef, useState } from 'react'
import type { CanvasStore } from '../../../state/workbenches/canvas/store'
import {
  DETAIL_MODE_SETTLE_MS,
  nextCanvasDetailMode,
  type CanvasDetailMode,
} from './detailMode'

interface DetailModeState {
  mode: CanvasDetailMode
  pendingMode: CanvasDetailMode | null
  settleAt: number
}

/**
 * full/coarse 切换会替换全部节点的 React 类型。缩放手势连续穿过阈值时，
 * 等视口稳定一拍再切换，避免真实图片节点整批卸载、解码、重挂载。
 */
export function useCanvasDetailMode(store: CanvasStore): CanvasDetailMode {
  const [state, setState] = useState<DetailModeState>(() => ({
    mode: nextCanvasDetailMode('full', store.getViewport().zoom),
    pendingMode: null,
    settleAt: 0,
  }))
  const modeRef = useRef(state.mode)
  modeRef.current = state.mode

  useEffect(
    () =>
      store.subscribeViewport(() => {
        const now = Date.now()
        const target = nextCanvasDetailMode(modeRef.current, store.getViewport().zoom)
        setState((current) => {
          if (target === current.mode) {
            if (!current.pendingMode && !current.settleAt) return current
            return { mode: current.mode, pendingMode: null, settleAt: 0 }
          }
          const settledAt =
            current.pendingMode === target
              ? current.settleAt
              : now + DETAIL_MODE_SETTLE_MS
          if (now >= settledAt) {
            modeRef.current = target
            return { mode: target, pendingMode: null, settleAt: 0 }
          }
          return { mode: current.mode, pendingMode: target, settleAt: settledAt }
        })
      }),
    [store],
  )

  useEffect(() => {
    if (!state.pendingMode || !state.settleAt) return
    const timer = setTimeout(() => {
      setState((current) => {
        const target = nextCanvasDetailMode(current.mode, store.getViewport().zoom)
        if (target === current.mode || current.pendingMode !== target) {
          return { mode: current.mode, pendingMode: null, settleAt: 0 }
        }
        modeRef.current = target
        return { mode: target, pendingMode: null, settleAt: 0 }
      })
    }, Math.max(0, state.settleAt - Date.now()))
    return () => clearTimeout(timer)
  }, [state.pendingMode, state.settleAt, store])

  return state.mode
}
