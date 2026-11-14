import {
  GRAPH_NODE_H,
  GRAPH_NODE_W,
  type WorkflowGraph,
  type WorkflowGraphLayout,
} from '../../domain/project/workflowGraph'
import styles from './WorkflowGraphView.module.css'

/**
 * 节点图的**连线层**（一条条三次贝塞尔）。
 *
 * 为什么这里手写 `<svg>`：它是**数据可视化**（每条线对应上游 JSON 里的一条 `inputs` 连线），
 * 不是图标 —— 与 `workbenches/canvas/flow/FlowChildEdgeLayer` 同一类，按图标方案 §6 保留，
 * 在 `eslint.config.js` 的 `ICON_KEEP` 里登记。
 */
export function WorkflowGraphEdges({
  graph,
  layout,
  vertical,
}: {
  graph: WorkflowGraph
  layout: WorkflowGraphLayout
  vertical: boolean
}) {
  return (
    <svg className={styles.edges} width={layout.width} height={layout.height} aria-hidden="true">
      {graph.edges.map((edge) => {
        const from = layout.nodes.find((node) => node.id === edge.from)
        const to = layout.nodes.find((node) => node.id === edge.to)
        if (!from || !to) return null
        const path = vertical
          ? (() => {
              const x1 = from.x + GRAPH_NODE_W / 2
              const y1 = from.y + GRAPH_NODE_H
              const x2 = to.x + GRAPH_NODE_W / 2
              const y2 = to.y
              const mid = (y1 + y2) / 2
              return `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`
            })()
          : (() => {
              const x1 = from.x + GRAPH_NODE_W
              const y1 = from.y + GRAPH_NODE_H / 2
              const x2 = to.x
              const y2 = to.y + GRAPH_NODE_H / 2
              const mid = (x1 + x2) / 2
              return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`
            })()
        return <path key={`${edge.from}->${edge.to}`} d={path} className={styles.edge} />
      })}
    </svg>
  )
}
