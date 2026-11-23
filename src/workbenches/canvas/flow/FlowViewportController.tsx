import { useEffect } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useCanvasStore } from '../storeContext'
import { shouldSyncStoreViewport } from './flowSurfaceViewport'
import { storeViewportToFlow } from './viewportBridge'

/** Applies external viewport commands without echoing React Flow's gesture frames. */
export function FlowViewportController() {
  const store = useCanvasStore()
  const flow = useReactFlow()

  useEffect(() => {
    const sync = () => {
      const target = storeViewportToFlow(store.getViewport())
      if (!shouldSyncStoreViewport(flow.getViewport(), target)) return
      void flow.setViewport(target)
    }
    sync()
    return store.subscribeViewport(sync)
  }, [flow, store])

  return null
}
