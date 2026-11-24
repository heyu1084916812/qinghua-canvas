import { useEffect } from 'react'
import { useCanvasStore } from '../storeContext'
import { nodeOutsideViewport, shouldCullCanvasNode } from './nodeViewportCulling'

const CULL_ATTRIBUTE = 'data-node-viewport-culled'

/**
 * Keeps every React Flow node mounted, but lets off-screen prompt/generation
 * wrappers skip content rendering. Updating the attribute imperatively avoids a
 * React render for every viewport frame.
 */
export function FlowNodeViewportCulling() {
  const store = useCanvasStore()

  useEffect(() => {
    let frame = 0
    let graph = store.getSnapshot()
    let elements = new Map<string, HTMLElement>()
    let observer: MutationObserver | null = null
    let surfaceObserver: MutationObserver | null = null
    const surface = document.querySelector<HTMLElement>('[data-canvas-surface]')

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
      if (surface && !surfaceObserver) {
        surfaceObserver = new MutationObserver(schedule)
        surfaceObserver.observe(surface, {
          attributes: true,
          attributeFilter: ['data-viewport-mode'],
        })
      }
      schedule()
    }

    const sync = () => {
      frame = 0
      /**
       * Let native `content-visibility:auto` carry viewport gestures, then
       * restore the imperative 320px warm window once the gesture settles.
       * Rewriting hundreds of culling attributes while the viewport moves
       * causes periodic long frames.
       */
      if (surface?.hasAttribute('data-viewport-moving')) return
      const snapshot = store.getSnapshot()
      if (snapshot !== graph) {
        graph = snapshot
        refreshElements()
        return
      }
      const surfaceSize = store.getSurfaceSize()
      const viewport = store.getViewport()
      for (const node of graph.nodes) {
        const element = elements.get(node.id)
        if (!element) continue
        if (!shouldCullCanvasNode(node)) {
          element.removeAttribute(CULL_ATTRIBUTE)
          continue
        }
        const hidden = nodeOutsideViewport(node, viewport, surfaceSize)
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
    const unsubscribeGraph = store.subscribe(schedule)
    const unsubscribeViewport = store.subscribeViewport(schedule)
    window.addEventListener('resize', schedule)
    return () => {
      unsubscribeGraph()
      unsubscribeViewport()
      window.removeEventListener('resize', schedule)
      observer?.disconnect()
      surfaceObserver?.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [store])

  return null
}
