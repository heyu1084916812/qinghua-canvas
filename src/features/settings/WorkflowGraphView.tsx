import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { WorkflowParamField } from '../../domain/project/workflowParams'
import {
  GRAPH_NODE_H,
  GRAPH_NODE_W,
  layoutWorkflowGraph,
  workflowOutputNodeIds,
  type WorkflowGraph,
  type WorkflowGraphLayout,
} from '../../domain/project/workflowGraph'
import { WorkflowFieldRow } from './WorkflowFieldRow'
import { WorkflowGraphEdges } from './WorkflowGraphEdges'
import styles from './WorkflowGraphView.module.css'

/** 视口内边距（设计像素）：留出来给描边与「适应」按钮 */
const PAD = 16
const MIN_SCALE = 0.3

/**
 * 工作流**节点图**（对账 #1116 ②）：按连线自动排布，点节点在它旁边弹出该节点的参数。
 *
 * 交互与观感一律沿用项目自身那套（用户 2026-11-14：「点击怎么点、下拉菜单怎么选、
 * 描边有没有、悬停怎么做，用我项目本身的 design」）：
 *
 * - **描边**：节点 1px `--stroke`、圆角 `--radius-control`、**不用投影**（与画布节点 / 浮层同一条规范）；
 * - **悬停**：`--bg-hover` 铺一层底色（不是加边框、不是放大）；
 * - **点选**：整块节点是一个按钮，点哪儿都算；再点一下取消；点空白也取消；
 * - **点外关闭**：document 捕获阶段听 `pointerdown`（与 `ParamPicker` 同一条做法）；
 * - **浮层**：1px 描边 + `--bg-surface` + 无投影，贴着节点右侧，放不下就翻到左边；
 * - **平移**：在空白处按住拖动（与画布同一手感）；不绑滚轮 —— 这是设置页，滚轮该翻页。
 *
 * 方向自适应：横排（`lr`，ComfyUI 原味）与竖排（`tb`）各算一遍，
 * **取缩放更大的那一种** —— 设置页那块地方竖着比横着富裕，链式图因此常常能 1:1 显示。
 */
export function WorkflowGraphView({
  graph,
  fields,
  selectedId,
  onSelect,
  onPatch,
}: {
  graph: WorkflowGraph
  /** 当前草稿里的字段（数量与暴露状态就靠它，不能只看图快照） */
  fields: WorkflowParamField[]
  selectedId: string | null
  onSelect: (nodeId: string | null) => void
  onPatch: (id: string, changes: Partial<WorkflowParamField>) => void
}) {
  const lr = useMemo(() => layoutWorkflowGraph(graph, 'lr'), [graph])
  const tb = useMemo(() => layoutWorkflowGraph(graph, 'tb'), [graph])
  const outputIds = useMemo(() => new Set(workflowOutputNodeIds(graph)), [graph])
  const byId = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph])
  const fieldById = useMemo(() => new Map(fields.map((field) => [field.id, field])), [fields])

  const viewportRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState({ width: 0, height: 0 })
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 })
  const dragRef = useRef<{ id: number; x: number; y: number; viewX: number; viewY: number } | null>(null)

  const scoreOf = (layout: WorkflowGraphLayout) =>
    Math.min(
      (dims.width - PAD * 2) / Math.max(1, layout.width),
      (dims.height - PAD * 2) / Math.max(1, layout.height),
    )
  const layout = scoreOf(tb) > scoreOf(lr) ? tb : lr
  const vertical = layout === tb

  /** 自适应：整张图塞进视口（最多 1:1，再大就缩） */
  const fit = (target: WorkflowGraphLayout = layout) => {
    const el = viewportRef.current
    if (!el || target.width === 0) return
    const raw = Math.min(
      (el.clientWidth - PAD * 2) / target.width,
      (el.clientHeight - PAD * 2) / target.height,
    )
    const scale = Math.max(MIN_SCALE, Math.min(1, Number.isFinite(raw) ? raw : 1))
    setView({
      scale,
      x: (el.clientWidth - target.width * scale) / 2,
      y: Math.max(PAD, (el.clientHeight - target.height * scale) / 2),
    })
  }

  /** 量视口：方向选择与自适应都要宽度/高度先说得出话 */
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const measure = () => setDims({ width: el.clientWidth, height: el.clientHeight })
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useLayoutEffect(() => {
    fit(layout)
  }, [layout.width, layout.height, dims.width, dims.height])

  /** 点外关闭（捕获阶段：面板自己的 stopPropagation 挡不住它） */
  useEffect(() => {
    if (!selectedId) return
    const onDown = (event: PointerEvent) => {
      if (viewportRef.current?.contains(event.target as Node)) return
      onSelect(null)
    }
    /**
     * Esc 关弹层。
     *
     * 必须 `preventDefault()` 声明「这次 Esc 被我消费了」—— 设置弹窗也在听 Esc
     * （它一收到就把整个全局设置关掉）。与创作面板那条协议同一套做法。
     */
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onSelect(null)
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [selectedId, onSelect])

  if (graph.nodes.length === 0) return null

  const selectedNode = selectedId ? byId.get(selectedId) : undefined
  const selectedFields = (selectedNode?.fieldIds ?? [])
    .map((id) => fieldById.get(id))
    .filter((field): field is WorkflowParamField => Boolean(field))

  /**
   * 弹层位置**在渲染里算**（不量 DOM）：视图的平移/缩放是我们自己给的，
   * 节点屏幕坐标 = `view + 节点坐标 × scale`，比 `getBoundingClientRect` 少一次重排，
   * 也让这段能在服务端静态渲染里被断言（设置页的 UI 门禁就是静态渲染）。
   */
  const selectedPlaced = selectedId ? layout.nodes.find((node) => node.id === selectedId) : undefined
  const popup = selectedPlaced
    ? (() => {
        const left = view.x + (selectedPlaced.x + GRAPH_NODE_W) * view.scale + 10
        const top = view.y + selectedPlaced.y * view.scale
        const width = Math.min(340, Math.max(200, dims.width - 16))
        const flip = dims.width > 0 && left + width > dims.width - 8
        const leftClamped = flip
          ? Math.max(8, view.x + selectedPlaced.x * view.scale - width - 10)
          : Math.max(8, Math.min(left, Math.max(8, dims.width - width - 8)))
        const topClamped = Math.min(Math.max(8, top), Math.max(8, dims.height - 120))
        /** 弹层住在 `overflow:hidden` 的视口里：高度上限必须跟着视口算，否则被裁半截 */
        return { left: leftClamped, top: topClamped, maxHeight: Math.max(120, dims.height - topClamped - 8) }
      })()
    : null

  return (
    <div
      className={styles.viewport}
      ref={viewportRef}
      data-workflow-graph
      data-graph-direction={vertical ? 'tb' : 'lr'}
      onPointerDown={(event) => {
        if (event.button !== 0 || (event.target as HTMLElement).closest('[data-wf-node]')) return
        dragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, viewX: view.x, viewY: view.y }
        ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
        onSelect(null)
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current
        if (!drag || drag.id !== event.pointerId) return
        setView((current) => ({
          ...current,
          x: drag.viewX + (event.clientX - drag.x),
          y: drag.viewY + (event.clientY - drag.y),
        }))
      }}
      onPointerUp={() => {
        dragRef.current = null
      }}
    >
      <div
        className={styles.canvas}
        style={{
          width: layout.width,
          height: layout.height,
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
        }}
      >
        <WorkflowGraphEdges graph={graph} layout={layout} vertical={vertical} />
        {layout.nodes.map((placed) => {
          const node = byId.get(placed.id)
          if (!node) return null
          const own = node.fieldIds
            .map((id) => fieldById.get(id))
            .filter((field): field is WorkflowParamField => Boolean(field))
          const exposed = own.filter((field) => field.enabled).length
          return (
            <button
              key={node.id}
              type="button"
              className={placed.id === selectedId ? `${styles.node} ${styles.nodeOn}` : styles.node}
              style={{ left: placed.x, top: placed.y, width: GRAPH_NODE_W, height: GRAPH_NODE_H }}
              data-wf-node={node.id}
              aria-label={`${node.title}（${own.length} 个参数，已暴露 ${exposed}）`}
              onClick={() => onSelect(placed.id === selectedId ? null : placed.id)}
            >
              <span className={styles.nodeTitle}>{node.title}</span>
              <span className={styles.nodeMeta}>
                {own.length === 0 ? '无参数' : `${own.length} 参数`}
                {exposed > 0 ? ` · 暴露 ${exposed}` : ''}
                {outputIds.has(node.id) ? ' · 输出' : ''}
              </span>
            </button>
          )
        })}
      </div>

      <button type="button" className={styles.fit} onClick={() => fit()} title="把整张图放回视野">
        适应
      </button>

      {popup && selectedNode ? (
        <div
          className={styles.popup}
          style={{ left: popup.left, top: popup.top, maxHeight: popup.maxHeight }}
          data-workflow-graph-panel={selectedNode.id}
        >
          <div className={styles.popupHead}>
            <span className={styles.popupTitle}>{selectedNode.title}</span>
            {selectedNode.classType ? <span className={styles.popupSub}>{selectedNode.classType}</span> : null}
            <button type="button" className={styles.popupClose} onClick={() => onSelect(null)} title="关闭">
              ×
            </button>
          </div>
          {selectedFields.length === 0 ? (
            <p className={styles.empty}>这个节点没有可改参数（输入全是连线）</p>
          ) : (
            <div className={styles.popupBody}>
              {selectedFields.map((field) => (
                <WorkflowFieldRow key={field.id} field={field} onPatch={onPatch} />
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
