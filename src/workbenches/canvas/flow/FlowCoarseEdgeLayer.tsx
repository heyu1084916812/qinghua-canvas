import {
  memo,
  useEffect,
  useMemo,
  useRef,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import {
  useCanvasStore,
  useEdgeSelection,
  useGraph,
  useSelection,
  useViewportState,
} from '../storeContext'
import {
  coarseEdgePaths,
  viewportEdgePaths,
  type CoarseEdgePath,
} from './coarseEdges'
import styles from './FlowCoarseEdgeLayer.module.css'

export function FlowCoarseEdgeLayer() {
  const graph = useGraph()
  const selection = useSelection()
  const edgeSelection = useEdgeSelection()
  const paths = useMemo(
    () => coarseEdgePaths(graph, selection, edgeSelection),
    [edgeSelection, graph, selection],
  )
  if (paths.length === 0) return null
  return <CoarseEdgeViewport paths={paths} />
}

function CoarseEdgeViewport({ paths }: { paths: CoarseEdgePath[] }) {
  const viewport = useViewportState()
  const store = useCanvasStore()
  const zoom = viewport.zoom || 1

  const onEdgeClick = (event: ReactMouseEvent<SVGSVGElement>) => {
    const edgeId = edgeIdFromEvent(event.target)
    if (edgeId) store.setEdgeSelection([edgeId])
  }
  const onEdgeDoubleClick = (event: ReactMouseEvent<SVGSVGElement>) => {
    const edgeId = edgeIdFromEvent(event.target)
    if (edgeId) store.dispatch({ kind: 'edge.remove', id: edgeId })
  }

  return (
    <svg
      className={styles.svg}
      onClick={onEdgeClick}
      onDoubleClick={onEdgeDoubleClick}
    >
      <g transform={`translate(${-viewport.x * zoom} ${-viewport.y * zoom}) scale(${zoom})`}>
        <CoarseEdgePaths paths={paths} />
      </g>
    </svg>
  )
}

const CoarseEdgePaths = memo(function CoarseEdgePaths({
  paths,
}: {
  paths: CoarseEdgePath[]
}) {
  return (
    <>
      {paths.map((path) => (
        <g key={path.id}>
          <path
            className={
              path.related || path.selected
                ? `${styles.edge} ${styles.edgeActive}`
                : styles.edge
            }
            d={path.d}
            vectorEffect="non-scaling-stroke"
            data-edge={path.id}
            data-edge-source={path.source}
            data-edge-target={path.target}
            data-edge-source-port={path.sourcePort}
            data-edge-target-port={path.targetPort}
            data-coarse-edge
          />
          <path
            className={styles.hit}
            d={path.d}
            vectorEffect="non-scaling-stroke"
            data-coarse-edge-hit={path.id}
          />
        </g>
      ))}
    </>
  )
})

/**
 * Gesture-only edge layer. The normal React Flow edge components are removed
 * from the active tree while the viewport moves; this layer paints the same
 * graph as one combined path plus the few highlighted edges. It never receives
 * pointer events, so the expensive per-edge hit targets stay out of the
 * gesture path.
 */
export const FlowViewportEdgeLayer = memo(function FlowViewportEdgeLayer() {
  const graph = useGraph()
  const selection = useSelection()
  const edgeSelection = useEdgeSelection()
  const store = useCanvasStore()
  const groupRef = useRef<SVGGElement>(null)
  const paths = useMemo(
    () => viewportEdgePaths(coarseEdgePaths(graph, selection, edgeSelection)),
    [edgeSelection, graph, selection],
  )

  useEffect(() => {
    const applyTransform = () => {
      const viewport = store.getViewport()
      const zoom = viewport.zoom || 1
      groupRef.current?.setAttribute(
        'transform',
        `translate(${-viewport.x * zoom} ${-viewport.y * zoom}) scale(${zoom})`,
      )
    }
    applyTransform()
    return store.subscribeViewport(applyTransform)
  }, [store])

  return (
    <svg
      className={styles.svg}
      aria-hidden
      data-flow-viewport-edge-layer
    >
      <g ref={groupRef}>
        {paths.base ? (
          <path
            className={styles.edge}
            d={paths.base}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {paths.active.map((path) => (
          <path
            key={path.id}
            className={`${styles.edge} ${styles.edgeActive}`}
            d={path.d}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>
    </svg>
  )
})

function edgeIdFromEvent(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null
  return target.closest<SVGElement>('[data-coarse-edge-hit]')?.dataset.coarseEdgeHit ?? null
}
