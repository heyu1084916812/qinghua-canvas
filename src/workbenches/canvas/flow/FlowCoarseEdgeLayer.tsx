import { memo, useMemo, type MouseEvent as ReactMouseEvent } from 'react'
import {
  useCanvasStore,
  useEdgeSelection,
  useGraph,
  useSelection,
  useViewportState,
} from '../storeContext'
import { coarseEdgePaths, type CoarseEdgePath } from './coarseEdges'
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

function edgeIdFromEvent(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null
  return target.closest<SVGElement>('[data-coarse-edge-hit]')?.dataset.coarseEdgeHit ?? null
}
