import { useEffect } from 'react'
import { useCanvasStore } from '../storeContext'
import { nodeOutsideViewport, shouldCullCanvasNode } from './nodeViewportCulling'

const CULL_ATTRIBUTE = 'data-node-viewport-culled'

/**
 * Keeps every React Flow node mounted, but lets off-screen prompt/generation
 * wrappers skip content rendering. Updating the attribute imperatively avoids a
 * React render for every viewport frame.
 */
export function FlowNodeViewportCulling({
  paused = false,
}: {
  paused?: boolean
}) {
  const store = useCanvasStore()

  useEffect(() => {
    let frame = 0
    let graph = store.getSnapshot()
    let elements = new Map<string, HTMLElement>()
    let observer: MutationObserver | null = null

    const refreshElements = () => {
      elements = new Map(
        Array.from(
          document.querySelectorAll<HTMLElement>('.react-flow__node[data-id]'),
        ).map((element) => [element.dataset.id ?? '', element]),
      )
      const host = document.querySelector('.react-flow__nodes')
      if (host && !observer) {
        observer = new MutationObserver(refreshElements)
        observer.observe(host, { childList: true })
      }
      schedule()
    }

    const sync = () => {
      frame = 0
      const snapshot = store.getSnapshot()
      if (snapshot !== graph) {
        graph = snapshot
        refreshElements()
        return
      }
      const surface = store.getSurfaceSize()
      const viewport = store.getViewport()
      for (const node of graph.nodes) {
        const element = elements.get(node.id)
        if (!element) continue
        if (!shouldCullCanvasNode(node)) {
          element.removeAttribute(CULL_ATTRIBUTE)
          continue
        }
        const hidden = nodeOutsideViewport(node, viewport, surface)
        const next = hidden ? 'hidden' : 'visible'
        if (element.getAttribute(CULL_ATTRIBUTE) !== next) {
          element.setAttribute(CULL_ATTRIBUTE, next)
        }
      }
    }

    function schedule() {
      if (store.isDragging()) return
      if (frame) return
      frame = requestAnimationFrame(sync)
    }

    refreshElements()
    if (paused) {
      if (frame) {
        cancelAnimationFrame(frame)
        frame = 0
      }
      for (const element of elements.values()) {
        if (element.getAttribute(CULL_ATTRIBUTE) !== 'visible') {
          element.setAttribute(CULL_ATTRIBUTE, 'visible')
        }
      }
      return () => {
        observer?.disconnect()
        if (frame) cancelAnimationFrame(frame)
      }
    }
    const unsubscribeGraph = store.subscribe(schedule)
    const unsubscribeViewport = store.subscribeViewport(schedule)
    window.addEventListener('resize', schedule)
    return () => {
      unsubscribeGraph()
      unsubscribeViewport()
      window.removeEventListener('resize', schedule)
      observer?.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [paused, store])

  return null
}
