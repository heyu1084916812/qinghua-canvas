import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { CanvasStore } from '../../../state/workbenches/canvas/store'
import type { FlowDragAnchor } from './flowSurfaceChangeCoordinator'
import {
  captureFlowDragEdgePaths,
  captureFlowDragFollowers,
  clearFlowDragFollowers,
  writeFlowNodeDragDomPositions,
  writeFlowDragEdgePaths,
  writeFlowDragFollowers,
  type FlowDragEdgePathSnapshot,
  type FlowDragFollowers,
} from './flowDragDomFollower'

interface DirectDragState {
  anchor: FlowDragAnchor
  movingIds: Set<string>
  /** moving nodes plus their container descendants (their labels / ports / child edges follow too) */
  affectedIds: Set<string>
  edges: FlowDragEdgePathSnapshot[]
  followers: FlowDragFollowers
  released: boolean
  settled: boolean
  lastClientX: number
  lastClientY: number
  moved: boolean
  frame: number | null
}

/**
 * Keeps pointer-followed node transforms and connected edge paths ahead of
 * React Flow's controlled-store commit. The store settles once on drag end.
 */
export function useFlowNodeDragDomFollow({
  store,
  surfaceRef,
}: {
  store: CanvasStore
  surfaceRef: RefObject<HTMLDivElement | null>
}) {
  const stateRef = useRef<DirectDragState | null>(null)

  const captureEdges = useCallback(
    (movingIds: Set<string>) => {
      const graph = store.getSnapshot()
      const edgeIds = new Set(
        graph.edges
          .filter(
            (edge) => movingIds.has(edge.source) || movingIds.has(edge.target),
          )
          .map((edge) => edge.id),
      )
      return captureFlowDragEdgePaths(document, movingIds, edgeIds)
    },
    [store],
  )

  const begin = useCallback(
    (
      anchor: FlowDragAnchor,
      clientX: number,
      clientY: number,
      moved = false,
    ) => {
      const movingIds = new Set(anchor.nodes.keys())
      const affectedIds = withDescendants(store.getSnapshot().nodes, movingIds)
      stateRef.current = {
        anchor,
        movingIds,
        affectedIds,
        edges: captureEdges(movingIds),
        followers: captureFlowDragFollowers(document, affectedIds, anchor.zoom || 1),
        released: false,
        settled: false,
        lastClientX: clientX,
        lastClientY: clientY,
        moved,
        frame: null,
      }
      surfaceRef.current?.setAttribute('data-direct-drag', 'true')
    },
    [captureEdges, store, surfaceRef],
  )

  const move = useCallback((clientX: number, clientY: number) => {
    const state = stateRef.current
    if (!state) return
    const screenDx = clientX - state.anchor.clientX
    const screenDy = clientY - state.anchor.clientY
    state.lastClientX = clientX
    state.lastClientY = clientY
    if (!state.moved && Math.hypot(screenDx, screenDy) < 2) return
    state.moved = true
    const dx = screenDx / (state.anchor.zoom || 1)
    const dy = screenDy / (state.anchor.zoom || 1)
    const starts = [...state.anchor.nodes].map(([id, position]) => ({
      id,
      x: position.x,
      y: position.y,
    }))
    const write = () => {
      if (state.settled) return
      writeFlowNodeDragDomPositions(document, starts, dx, dy)
      writeFlowDragEdgePaths(state.edges, state.movingIds, dx, dy)
      writeFlowDragFollowers(
        state.followers,
        state.affectedIds,
        dx,
        dy,
        screenDx,
        screenDy,
      )
    }
    write()
    if (state.frame) cancelAnimationFrame(state.frame)
    state.frame = requestAnimationFrame(() => {
      if (stateRef.current !== state) return
      state.frame = null
      write()
    })
  }, [])

  /**
   * Called from the surface's layout effect when a new graph commits: the
   * committed positions are in the DOM this frame, so the drag offsets go now
   * (before paint) — no double offset, no jump back.
   */
  const settle = useCallback(() => {
    const state = stateRef.current
    if (!state?.released || !state.moved || state.settled) return
    if (state.frame) cancelAnimationFrame(state.frame)
    state.frame = null
    clearFlowDragFollowers(state.followers, state.edges, false)
    state.settled = true
  }, [])

  const isActive = useCallback(() => stateRef.current !== null, [])
  const moved = useCallback(() => stateRef.current?.moved === true, [])
  const lastPointer = useCallback(() => {
    const state = stateRef.current
    return state
      ? { clientX: state.lastClientX, clientY: state.lastClientY }
      : null
  }, [])

  useEffect(() => {
    let clearTimer: number | null = null
    const clear = () => {
      const state = stateRef.current
      if (state?.frame) cancelAnimationFrame(state.frame)
      // No graph commit settled it (no move, rejected drop): restore what we wrote.
      if (state && !state.settled) {
        clearFlowDragFollowers(state.followers, state.edges, state.moved)
        if (state.moved) writeFlowNodeDragDomPositions(document, [...state.anchor.nodes].map(([id, p]) => ({ id, ...p })), 0, 0)
      }
      stateRef.current = null
      surfaceRef.current?.removeAttribute('data-direct-drag')
    }
    const clearAfterDragEnd = () => {
      if (clearTimer !== null) window.clearTimeout(clearTimer)
      clearTimer = window.setTimeout(() => {
        clearTimer = null
        clear()
      }, 0)
    }
    const onMove = (event: PointerEvent) => {
      move(event.clientX, event.clientY)
    }
    const onUp = (event: PointerEvent) => {
      move(event.clientX, event.clientY)
      if (stateRef.current) stateRef.current.released = true
      clearAfterDragEnd()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', clearAfterDragEnd)
    window.addEventListener('blur', clear)
    return () => {
      if (clearTimer !== null) window.clearTimeout(clearTimer)
      clear()
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', clearAfterDragEnd)
      window.removeEventListener('blur', clear)
    }
  }, [move, surfaceRef])

  return { begin, move, settle, isActive, moved, lastPointer }
}

function withDescendants(
  nodes: readonly { id: string; parentId?: string | null }[],
  roots: ReadonlySet<string>,
): Set<string> {
  const out = new Set(roots)
  let grew = true
  while (grew) {
    grew = false
    for (const node of nodes) {
      if (node.parentId && out.has(node.parentId) && !out.has(node.id)) {
        out.add(node.id)
        grew = true
      }
    }
  }
  return out
}
