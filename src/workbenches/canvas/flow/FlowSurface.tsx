import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
  useViewport,
  useUpdateNodeInternals,
  type Edge as RFEdge,
  type EdgeChange,
  type Node as RFNode,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import styles from './FlowSurface.module.css'
import {
  useCanvasStore,
  useEdgeSelection,
  useGraph,
  useSelection,
  useViewportState,
} from '../storeContext'
import { useCanvasExecution } from '../execution/CanvasExecutionProvider'
import { useCanvasPageEvents } from '../../../features/canvas/useCanvasPageEvents'
import {
  FlowChildFrame,
  FlowCoarseNode,
  FlowFlowNode,
  type FlowNodeData,
} from './FlowNode'
import {
  childrenByParent,
  type MarqueeRect,
} from './flowGraph'
import type { NodeSnapshot } from '../../../domain/canvas/model/node'
import type { NodeViewEvent } from '../nodes/registry'
import { useNodeDerivedMaps } from '../useNodeDerivedMaps'
import { QhCoarseEdge, QhEdge } from './FlowEdge'
import { FlowChildEdgeLayer } from './FlowChildEdgeLayer'
import { FlowCoarseEdgeLayer } from './FlowCoarseEdgeLayer'
import { FlowGroupBoardLayer } from './FlowGroupBoardLayer'
import { FlowPortLayer } from './FlowPortLayer'
import { FlowDraftLayer } from './FlowDraftLayer'
import { FlowSnapLayer } from './FlowSnapLayer'
import { EmptyCanvasGuide } from '../surface/EmptyCanvasGuide'
import { MultiSelectBar } from '../toolbar/MultiSelectBar'
import {
  flowViewportToStore,
  storeViewportToFlow,
  type FlowViewport,
} from './viewportBridge'
import { usePlatform } from '../../../app/providers/PlatformProvider'
import { useCanvasStyle } from '../../../app/providers/CanvasStyleProvider'
import { useTheme } from '../../../app/ThemeProvider'
import { canvasTonePair } from '../../../domain/project/canvasStyle'
import { useFonts } from '../../../app/providers/FontProvider'
import { screenToWorld } from '../../../domain/canvas/geometry/coords'
import { useEdgeDrag } from '../../../features/canvas/useEdgeDrag'
import { useSpaceHeld } from '../../../features/canvas/useSpaceHeld'
import { useViewport as useCanvasViewport } from '../../../features/canvas/useViewport'
import { useNodeDownload } from '../../../features/canvas/useNodeDownload'
import {
  clipboardMediaFiles,
  draggedFiles,
  hasDraggedFiles,
  importDroppedFiles,
} from '../../../features/canvas/dropImport'
import { batchSlotOf } from '../../../features/canvas/dropReparent'
import { useNodeDrag } from '../../../features/canvas/useNodeDrag'
import {
  useClipboardHotkeys,
  rememberPointer,
  pastePoint,
} from '../../../features/canvas/useClipboard'
import { isTextEntryElement } from '../../../features/shared/textTarget'
import { useCanvasKeyboard } from '../useCanvasKeyboard'
import { IMPORT_ACCEPT } from '../../../features/canvas/importAsset'
import type { CanvasStore } from '../../../state/workbenches/canvas/store'
import type { Point } from '../../../domain/canvas/geometry/rect'
import { PanelLayer } from '../panels/PanelLayer'
import { NodeFollowBar } from '../toolbar/NodeFollowBar'
import { ContextMenu } from '../menu/ContextMenu'
import { LinkMenu } from '../menu/LinkMenu'
import { CanvasNotice } from '../surface/CanvasNotice'
import { Minimap } from '../surface/Minimap'
import { UndoBar } from '../surface/UndoBar'
import { useCanvasDetailMode } from './useCanvasDetailMode'
import { sameFlowViewport, VIEWPORT_EPSILON } from './flowSurfaceViewport'
import {
  FLOATING_SELECTORS,
  marqueeBetween,
  pointerWorldPoint as pointerWorldPointPure,
} from './flowSurfacePointer'
import { shouldPasteMediaFiles } from './flowSurfaceImport'
import { installCanvasDomAnchors } from './flowSurfaceDomAnchors'
import {
  deleteFlowEdgeIds,
  deleteFlowNodeIds,
  type FlowDragAnchor,
} from './flowSurfaceChangeCoordinator'
import {
  importSurfaceFiles,
  planChildPointerDown,
  planSurfaceClick,
  planSurfaceContextMenu,
  planSurfacePointerDown,
} from './flowSurfaceInteractionCoordinator'
import {
  applyFlowDeleteKey,
  applyFlowEdgeChanges,
  applyFlowNodeChanges,
  beginFlowNodeDrag,
  beginSelectionMarquee,
  finishFlowNodeDrag,
  flowEdgeIdsOf,
  flowNodeIdsOf,
  routeFlowNodeEvent,
  scheduleFlowNodeMeasurement,
  selectionFromMarquee,
} from './flowSurfaceFlowActionCoordinator'
import {
  derivedPropsFor,
  flowEdgesFor,
  flowMeasurementKey,
  flowNodesFor,
  flowRunPresentationOf,
} from './flowSurfaceRenderModel'

/** React Flow 只渲染真实图；store 是位置、连线与选中的唯一真相。 */
export function FlowSurface({
  projectId,
  onOpenSettings,
  onOpenSkills,
}: {
  projectId: string
  onOpenSettings?: () => void
  onOpenSkills?: () => void
}) {
  return (
    <ReactFlowProvider>
      <FlowSurfaceInner projectId={projectId} onOpenSettings={onOpenSettings} onOpenSkills={onOpenSkills} />
    </ReactFlowProvider>
  )
}

const NODE_TYPES = { qh: FlowFlowNode, coarse: FlowCoarseNode }
const EDGE_TYPES = { qh: QhEdge, coarse: QhCoarseEdge }
const EDGE_OPTIONS = { type: 'default' } as const
function FlowViewportController() {
  const viewport = useViewportState()
  const flow = useReactFlow()

  useEffect(() => {
    const target = storeViewportToFlow(viewport)
    if (sameFlowViewport(flow.getViewport(), target)) return
    // 缩放手势期间 RF 自己就在改 transform；这里只跟随外部逻辑视口变化，
    // 避免 onViewportChange → setViewport → setViewport 的回写循环。
    if (Math.abs(flow.getViewport().zoom - target.zoom) < VIEWPORT_EPSILON) return
    void flow.setViewport(target)
  }, [flow, viewport])

  return null
}

/** RF 的 d3-drag 只认原生 `nodrag`；React 提交会重写 className，所以松手前要持续补回。 */
function blockNativeNodeDrag(target: EventTarget | null): void {
  const frame = target instanceof Element ? target.closest<HTMLElement>('[data-node-id]') : null
  if (!frame) return
  const ensure = () => {
    if (!frame.classList.contains('nodrag')) frame.classList.add('nodrag')
  }
  ensure()
  const observer = new MutationObserver(ensure)
  observer.observe(frame, { attributes: true, attributeFilter: ['class'] })
  const cleanup = () => {
    observer.disconnect()
    frame.classList.remove('nodrag')
    window.removeEventListener('pointerup', cleanup)
    window.removeEventListener('pointercancel', cleanup)
  }
  window.addEventListener('pointerup', cleanup)
  window.addEventListener('pointercancel', cleanup)
}

/** 指针屏幕坐标 → 世界坐标；缺事件或 surface 时返回 null，不猜落点。 */
function pointerWorldPointDom(
  ev: MouseEvent | TouchEvent | ReactPointerEvent | null | undefined,
  store: CanvasStore,
): Point | null {
  const el = document.querySelector<HTMLElement>('[data-canvas-surface]')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return pointerWorldPointPure(ev, store.getViewport(), {
    x: r.left,
    y: r.top,
    w: r.width,
    h: r.height,
  })
}

function FlowSurfaceInner({
  projectId,
  onOpenSettings,
  onOpenSkills,
}: {
  projectId: string
  onOpenSettings?: () => void
  onOpenSkills?: () => void
}) {
  const store = useCanvasStore()
  const detailMode = useCanvasDetailMode(store)
  const graph = useGraph()
  const selection = useSelection()
  const edgeSelection = useEdgeSelection()
  const initialFlowViewport = useRef(storeViewportToFlow(store.getViewport())).current
  const handleViewportChange = useCallback(
    (next: FlowViewport) => {
      const nextStore = flowViewportToStore(next)
      const current = store.getViewport()
      if (
        Math.abs(current.x - nextStore.x) < VIEWPORT_EPSILON &&
        Math.abs(current.y - nextStore.y) < VIEWPORT_EPSILON &&
        Math.abs(current.zoom - nextStore.zoom) < VIEWPORT_EPSILON
      ) {
        return
      }
      store.setViewport(nextStore)
    },
    [store],
  )
  /** 两套视口语义不同，必须显式换算（见 viewportBridge.ts；1:1 同步会让新节点落到视野外） */
  const exec = useCanvasExecution()
  const { emitNodeEvent } = useCanvasPageEvents(store, onOpenSettings)
  const platform = usePlatform()
  const { style: canvasStyle } = useCanvasStyle()
  const { resolved: theme } = useTheme()
  const customCanvasColors = canvasStyle.customCanvas[theme]
  const customCanvasColor = customCanvasColors.background
  const customDotColor = customCanvasColors.dot
  const customNodeColor = canvasStyle.customNode[theme]
  const { appearance } = useFonts()
  const handleDownload = useNodeDownload(platform, store)
  // Ctrl/Cmd + C/V（§4.2）：剪贴板是模块级单例、不订阅，故不参与本组件重渲染
  useClipboardHotkeys(store)
  useCanvasKeyboard(store)
  const spaceHeld = useSpaceHeld()
  const { beginPan } = useCanvasViewport(store)
  const [importHover, setImportHover] = useState(false)
  const dragMovedRef = useRef(false)
  /** 锚点必须在 pointerdown 记录；RF 的 dragStart 已晚一步，会导致终点对齐偏移。 */
  const dragAnchorRef = useRef<FlowDragAnchor | null>(null)
  const pressAtRef = useRef<{ x: number; y: number } | null>(null)
  const nodeSelectStampRef = useRef(false)
  /** 框选矩形（世界坐标）；结束时用 store 真实矩形兜底裁剪。 */
  const selectionMarqueeRef = useRef<MarqueeRect | null>(null)
  const selectionStartRef = useRef<Point | null>(null)
  const selectionBaselineRef = useRef<string[]>([])
  const actionPorts = useMemo(
    () => ({
      setSelection: (ids: string[]) => store.setSelection(ids),
      stampNodeSelection: () => {
        nodeSelectStampRef.current = true
        queueMicrotask(() => {
          nodeSelectStampRef.current = false
        })
      },
      setSnapHints: (hints: Parameters<typeof store.setSnapHints>[0]) => store.setSnapHints(hints),
      markDragMoved: (moved: boolean) => { dragMovedRef.current = moved },
      moveNodes: (ids: string[], dx: number, dy: number, phase: 'begin' | 'move' | 'end') => {
        store.dispatch({ kind: 'node.move', ids, dx, dy, phase })
      },
      setDragging: (active: boolean, nodeId: string | null = null) => store.setDragging(active, nodeId),
      getSnapshot: () => store.getSnapshot(),
      resetDragTracking: () => {
        dragMovedRef.current = false
        dragAnchorRef.current = null
      },
      setPanelDismissed: (dismissed: boolean) => store.setPanelDismissed(dismissed),
      notify: (message: string, tone: 'error') => store.notify(message, tone),
      reparent: (id: string, parentId: string | null, at?: Point) =>
        store.dispatch({ kind: 'node.reparent', id, toParent: parentId, at }),
      getEdgeSelection: () => store.getEdgeSelection(),
      setEdgeSelection: (ids: string[]) => store.setEdgeSelection(ids),
    }),
    [store],
  )

  const surfaceEl = useCallback(
    () => document.querySelector<HTMLElement>('[data-canvas-surface]'),
    [],
  )
  const drag = useNodeDrag(store, surfaceEl)
  const edgeDrag = useEdgeDrag(store)
  const edgeDragBegin = edgeDrag.begin
  const beginEdgeDrag = useCallback(
    (e: ReactPointerEvent, nodeId: string, portId: string, also?: readonly string[]) => {
      const surface = surfaceEl()
      if (!surface) return
      edgeDragBegin(e, nodeId, portId, surface, also)
    },
    [edgeDragBegin, surfaceEl],
  )

  const onChildPointerDown = useCallback(
    (e: ReactPointerEvent, childId: string) => {
      const plan = planChildPointerDown({
        selection: store.getSelection(),
        childId,
        shiftKey: e.shiftKey,
        batchSlot: batchSlotOf(childId, store.getSnapshot()),
      })
      if (plan.selection) store.setSelection(plan.selection)
      if (plan.reparent) {
        store.dispatch(
          {
            kind: 'node.reparent',
            id: childId,
            toParent: plan.reparent.parentId,
            at: plan.reparent.at,
          },
          { mode: 'coalesce', groupId: `move:${childId}`, label: '移动节点' },
        )
      }
      if (plan.beginDrag) drag.begin(e, childId)
    },
    [store, drag],
  )

  /** RF 会先把容器选上；surface 的 click 最后按子节点规则改回，并摘掉父容器。 */
  const onSurfaceClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement
      const nodeId = target.closest('[data-node-id]')?.getAttribute('data-node-id') ?? null
      const node = nodeId ? store.getSnapshot().nodes.find((item) => item.id === nodeId) : null
      const plan = planSurfaceClick({
        press: pressAtRef.current,
        release: { x: e.clientX, y: e.clientY },
        nodeId,
        parentId: node?.parentId ?? null,
        floatingTarget: !!target.closest(FLOATING_SELECTORS),
        selection: store.getSelection(),
        shiftKey: e.shiftKey,
      })
      if (plan.kind !== 'none') store.setSelection(plan.selection)
    },
    [store],
  )

  /** 捕获 pointerdown：处理空格平移 / Alt 复制，记录显式选中与终点对齐锚。 */
  const onSurfacePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      pressAtRef.current = { x: e.clientX, y: e.clientY }
      const nodeId =
        (e.target as HTMLElement)
          .closest('[data-node-id]')
          ?.getAttribute('data-node-id') ?? null
      const vp = store.getViewport()
      const surface = e.currentTarget.getBoundingClientRect()
      const selection = store.getSelection()
      const plan = planSurfacePointerDown({
        button: e.button,
        spaceHeld,
        altKey: e.altKey,
        nodeId,
        selection,
        graph: store.getSnapshot(),
        viewport: vp,
        surface: {
          left: surface.left,
          top: surface.top,
          width: surface.width,
          height: surface.height,
        },
        nodeRects: () => {
          const rects = new Map<string, Point>()
          const ids = new Set(selection)
          if (nodeId) ids.add(nodeId)
          for (const id of ids) {
            const nodeEl = document.querySelector<HTMLElement>(`[data-node-id="${id}"]`)
            if (!nodeEl) continue
            const rect = nodeEl.getBoundingClientRect()
            rects.set(id, { x: rect.left, y: rect.top })
          }
          return rects
        },
        clientX: e.clientX,
        clientY: e.clientY,
      })
      if (plan.kind === 'pan') {
        e.preventDefault()
        e.stopPropagation()
        blockNativeNodeDrag(e.target)
        beginPan(e)
        return
      }
      if (plan.dismissPanel && store.isPanelDismissed()) store.setPanelDismissed(false)
      if (plan.kind === 'duplicate') {
        e.preventDefault()
        blockNativeNodeDrag(e.target)
        drag.begin(e, plan.nodeId)
      } else if (plan.kind === 'anchor') {
        dragAnchorRef.current = plan.anchor
      }
    },
    [store, spaceHeld, beginPan],
  )

  const importFiles = useCallback(
    async (files: readonly File[], world: Point): Promise<void> => {
      await importSurfaceFiles(files, world, {
        importFiles: (nextFiles, point) =>
          importDroppedFiles({ platform, store, projectId }, nextFiles, point),
        select: (ids) => store.setSelection(ids),
        notify: (message, tone) => store.notify(message, tone),
        showUndoBar: (message) => store.showUndoBar(message),
      })
    },
    [platform, store, projectId],
  )

  const onDropFiles = async (e: ReactDragEvent<HTMLDivElement>) => {
    const files = draggedFiles(e)
    if (files.length === 0) return
    e.preventDefault()
    setImportHover(false)
    const r = e.currentTarget.getBoundingClientRect()
    const world = screenToWorld(
      { x: e.clientX, y: e.clientY },
      store.getViewport(),
      { x: r.left, y: r.top, w: r.width, h: r.height },
    )
    await importFiles(files, world)
  }

  /** 系统媒体粘贴：文本输入目标和非媒体剪贴板一律放行。 */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      const target = e.target as { tagName?: string; isContentEditable?: boolean } | null
      const files = clipboardMediaFiles(e.clipboardData)
      if (!shouldPasteMediaFiles({ files, editableTarget: isTextEntryElement(target) })) return
      const at = pastePoint(store)
      if (!at) return
      e.preventDefault()
      void importFiles(files, at)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [store, importFiles])

  const onContextMenu = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      e.preventDefault()
      const r = e.currentTarget.getBoundingClientRect()
      const nodeId = (e.target as HTMLElement)
        .closest('[data-node-id]')
        ?.getAttribute('data-node-id') ?? null
      const plan = planSurfaceContextMenu({
        clientX: e.clientX,
        clientY: e.clientY,
        surface: { left: r.left, top: r.top },
        nodeId,
        selection: store.getSelection(),
      })
      if (plan.selection) store.setSelection(plan.selection)
      store.setMenu(plan.menu.x, plan.menu.y, plan.menu.target)
    },
    [store],
  )

  /** 视口受控同步 store；刻意不 fitView，保留项目存储的打开取景。 */

  const makeEmit = useCallback(
    (nodeId: string) => (event: NodeViewEvent) =>
      routeFlowNodeEvent(nodeId, event, {
        run: (id) => void exec.runNode(id),
        cancel: exec.cancel,
        emit: emitNodeEvent,
      }),
    [exec, emitNodeEvent],
  )

  const childIndex = useMemo(() => childrenByParent(graph), [graph])

  const derived = useNodeDerivedMaps(graph)
  const derivedFor = useCallback(
    (id: string) => derivedPropsFor(derived, id),
    [derived],
  )

  const renderFlowChild = useCallback(
    (child: NodeSnapshot) => {
      const run = flowRunPresentationOf(exec.nodeStateOf(child.id))
      return (
        <FlowChildFrame
          key={child.id}
          child={child}
          selected={selection.includes(child.id)}
          running={run.running}
          error={run.error}
          runMode={run.runMode}
          emit={makeEmit(child.id)}
          resize={(rect, phase) => store.dispatch({ kind: 'node.resize', id: child.id, rect, phase })}
          onFramePointerDown={(e) => onChildPointerDown(e, child.id)}
          derived={derivedFor(child.id)}
        />
      )
    },
    [exec, selection, makeEmit, derivedFor, store, onChildPointerDown],
  )

  const nodeStateOf = useCallback((id: string) => exec.nodeStateOf(id), [exec])
  const nodes = useMemo<RFNode<FlowNodeData>[]>(
    () =>
      flowNodesFor({
        graph,
        selection,
        detailMode,
        derived,
        childIndex,
        nodeStateOf,
        emitFor: makeEmit,
        resize: (id, rect, phase) => store.dispatch({ kind: 'node.resize', id, rect, phase }),
        renderChild: renderFlowChild,
      }),
    [graph, selection, nodeStateOf, makeEmit, childIndex, renderFlowChild, derived, store, detailMode],
  )

  const edges = useMemo(
    () =>
      flowEdgesFor({
        graph,
        selection,
        edgeSelection,
        detailMode,
        removeEdge: (id) => store.dispatch({ kind: 'edge.remove', id }),
      }),
    [graph, selection, edgeSelection, store, detailMode],
  )

  /** RF 首帧可能漏测节点导致边不显示；双 rAF 后补一次 updateNodeInternals。 */
  const updateNodeInternals = useUpdateNodeInternals()
  const measurementKey = flowMeasurementKey(graph)
  useEffect(() => {
    return scheduleFlowNodeMeasurement(graph, {
      requestFrame: (callback) => requestAnimationFrame(callback),
      cancelFrame: (id) => cancelAnimationFrame(id),
      schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
      cancelSchedule: (id) => window.clearTimeout(id),
      updateNodeInternals,
    })
  }, [measurementKey, updateNodeInternals])

  const updateSelectionMarquee = useCallback(
    (event: MouseEvent | ReactPointerEvent<HTMLDivElement>) => {
      if (!selectionStartRef.current) return
      const point = pointerWorldPointDom(event, store)
      if (!point) return
      const start = selectionStartRef.current
      selectionMarqueeRef.current = marqueeBetween(start, point)
    },
    [store],
  )

  const onSelectionStart = useCallback(
    (event: ReactMouseEvent) => {
      const point = pointerWorldPointDom(event.nativeEvent, store)
      if (!point) return
      const session = beginSelectionMarquee({
        point,
        selection: store.getSelection(),
        shiftKey: event.shiftKey,
      })
      selectionStartRef.current = session.start
      selectionBaselineRef.current = session.baseline
      selectionMarqueeRef.current = session.marquee
    },
    [store],
  )

  const onSelectionEnd = useCallback(
    (event: ReactMouseEvent) => {
      updateSelectionMarquee(event.nativeEvent)
      const marquee = selectionMarqueeRef.current
      const baseline = selectionBaselineRef.current
      selectionStartRef.current = null
      if (!marquee) return
      /** 等 RF 的 select change 落完，再按 store 几何裁掉框外节点。 */
      window.requestAnimationFrame(() => {
        store.setSelection(
          selectionFromMarquee({ graph: store.getSnapshot(), marquee, baseline }),
        )
        selectionMarqueeRef.current = null
        selectionBaselineRef.current = []
      })
    },
    [store, updateSelectionMarquee],
  )

  const onNodesChange = useCallback(
    (changes: NodeChange<RFNode<FlowNodeData>>[]) => {
      applyFlowNodeChanges(
        {
          graph: store.getSnapshot(),
          selection: store.getSelection(),
          changes,
          marquee: selectionMarqueeRef.current,
          baseline: selectionBaselineRef.current,
          anchor: dragAnchorRef.current,
        },
        actionPorts,
      )
    },
    [store, actionPorts],
  )

  const onNodeDragStart = useCallback(
    (_e: MouseEvent | TouchEvent, _n: RFNode, dragged: RFNode[]) => {
      beginFlowNodeDrag(
        { mainId: _n.id, draggedIds: dragged.map((node) => node.id) },
        actionPorts,
      )
    },
    [actionPorts],
  )

  const onNodeDragStop = useCallback(
    (e: MouseEvent | TouchEvent, _n: RFNode, dragged: RFNode[]) => {
      finishFlowNodeDrag(
        {
          mainId: _n.id,
          draggedIds: dragged.map((node) => node.id),
          moved: dragMovedRef.current,
          anchor: dragAnchorRef.current,
          pointer:
            'clientX' in e
              ? { clientX: e.clientX, clientY: e.clientY }
              : null,
          pointerWorld: () => pointerWorldPointDom(e, store),
        },
        actionPorts,
      )
    },
    [store, actionPorts],
  )

  /** 不用 RF 的连接手势；命中、语义、草稿统一走 FlowPortLayer + useEdgeDrag。 */

  const deletionPorts = useMemo(
    () => ({
      removeEdge: (id: string) => store.dispatch({ kind: 'edge.remove' as const, id }),
      deleteNodes: (ids: readonly string[]) =>
        store.dispatch({ kind: 'node.delete' as const, ids: [...ids] }),
      clearSelection: () => store.setSelection([]),
      showUndoBar: (message: string) => store.showUndoBar(message),
    }),
    [store],
  )

  const onNodesDelete = useCallback(
    (deleted: RFNode[]) => {
      // 与右键菜单 / 跟随栏的删除同一句（老表面的键盘删除也会弹撤销条）
      deleteFlowNodeIds(flowNodeIdsOf(deleted), deletionPorts)
    },
    [deletionPorts],
  )

  useEffect(() => installCanvasDomAnchors(), [])

  const onEdgesDelete = useCallback(
    (deleted: { id: string }[]) => {
      deleteFlowEdgeIds(flowEdgeIdsOf(deleted), deletionPorts)
    },
    [deletionPorts],
  )

  /** Del / Backspace 的按键守卫与删除顺序归 flowSurfaceChangeCoordinator。 */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const handled = applyFlowDeleteKey(
        {
          key: e.key,
          target: e.target as HTMLElement | null,
          nodeIds: store.getSelection(),
          edgeIds: store.getEdgeSelection(),
        },
        deletionPorts,
      )
      if (handled) e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [store, deletionPorts])

  const onEdgesChange = useCallback(
    (changes: EdgeChange<RFEdge>[]) => {
      applyFlowEdgeChanges(
        { changes, nodeSelectStamp: nodeSelectStampRef.current },
        actionPorts,
      )
    },
    [actionPorts],
  )

  const onEdgeDoubleClick = useCallback(
    (_e: ReactMouseEvent, edge: RFEdge) => {
      deleteFlowEdgeIds([edge.id], deletionPorts)
    },
    [deletionPorts],
  )

  return (
    <div
      className={spaceHeld ? `${styles.surface} ${styles.spaceMode}` : styles.surface}
      data-canvas-surface
      data-canvas-engine="rf"
      /* 背景样式与色调：CSS 只认这两个属性（见 FlowSurface.module.css 里的六条映射），
         组件里不出现任何色值 —— 主题守卫会拦字面量颜色。 */
      data-canvas-background={canvasStyle.background}
      data-canvas-tone={customCanvasColor ? 'custom' : canvasStyle.tone}
      data-canvas-custom-hex={customCanvasColor ?? undefined}
      data-canvas-custom-dot-hex={customDotColor ?? undefined}
      data-canvas-node-hex={customNodeColor ?? undefined}
      /* 节点内容字号：挂在**画布根**上，节点自己的 CSS 用 var(..., 兜底) 取。
         兜底值让单测 / SSR 这些"没有画布根"的场景仍然拿得到原来的字号。 */
      style={
        {
          ...(customCanvasColor
            ? {
                '--canvas-bg': customCanvasColor,
                ...(customDotColor
                  ? {}
                  : {
                      '--canvas-grid-line': canvasTonePair(
                        canvasStyle.tone,
                        theme,
                      ).dot,
                    }),
              }
            : {}),
          ...(customDotColor ? { '--canvas-grid-line': customDotColor } : {}),
          ...(customNodeColor
            ? {
                '--node-fill': customNodeColor,
                '--node-inset': customNodeColor,
              }
            : {}),
          '--node-title-size': `${canvasStyle.titleSize}px`,
          '--node-body-size': `${canvasStyle.bodySize}px`,
        } as CSSProperties
      }
      // 拖入素材：dragover 必须 preventDefault，否则浏览器按「不可放置」处理、根本不派发 drop
      onDragOver={(e) => {
        /*
         * ⚠️ 判据必须是 `types` 而不是 `files`：dragover 阶段浏览器**不给**文件列表
         * （安全限制，`dataTransfer.files` 恒为空）。用 files 判断会让这一支直接 return、
         * 不 preventDefault ⇒ 浏览器认定这里不接收 ⇒ **drop 永远不来**（对账 #551）。
         */
        if (!hasDraggedFiles(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setImportHover(true)
      }}
      onDragLeave={() => setImportHover(false)}
      onDrop={(e) => void onDropFiles(e)}
      data-import-hover={importHover ? 'true' : 'false'}
      data-import-accept={IMPORT_ACCEPT}
      /*
       * 点容器里的子节点：把选中判给**子节点**（见 `onSurfaceClick`）。
       * 必须挂在 surface 上 —— React 的合成事件从内往外派发，容器节点比这层更深、先跑，
       * 所以这里是"最后一个说话的人"，能把 RF 刚选上的容器改回来。
       */
      onClick={onSurfaceClick}
      // 只记坐标、不 setState：粘贴落点要用「当前鼠标位置」（§4.2）
      onPointerMove={(e) => rememberPointer({ x: e.clientX, y: e.clientY })}
      onPointerMoveCapture={updateSelectionMarquee}
      // 按下阶段：清「拖动后不弹面板」标记 + 记拖动起点锚（见 onSurfacePointerDown）
      onPointerDownCapture={onSurfacePointerDown}
      onContextMenu={onContextMenu}
    >
      {/* 拖线草稿（§6.14）：画在节点层**下面**（与老表面 EdgeLayer 同序），层本身不吃指针 */}
      {/*
        分组背景板（第 14 批第 1 条）：**最早渲染 = 最底层** ⇒ 分组底色在连线之下。
        分组节点自己是透明的，见 `FlowGroupBoardLayer` 里的说明。
      */}
      <FlowGroupBoardLayer />
      <FlowViewportController />
      {/*
        牵涉容器子节点的边（视觉层）：与 RF 自带边同一层序（节点之下），
        命中区在下面单独再画一层（`hitOnly`）。
      */}
      <FlowChildEdgeLayer />
      {detailMode === 'coarse' ? <FlowCoarseEdgeLayer /> : null}
      <FlowDraftLayer draft={edgeDrag.draft} />
      {/* 吸附提示（对账 #257）：参考线 + 间距数字。屏幕空间、不吃指针，拖动结束即消失 */}
      <FlowSnapLayer />
      <ReactFlow
        className={styles.flow}
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        defaultEdgeOptions={EDGE_OPTIONS}
        minZoom={0.1}
        maxZoom={5}
        /*
         * 手势对齐产品文档 §6.3（**不改现有习惯**）：
         * - 空白处左键拖 = 平移（React Flow 的 `panOnDrag` 默认行为）
         * - Ctrl / ⌘ + 拖 = 框选（默认是 Shift，这里改掉）
         * - Shift = 增/减选中（默认是 ⌘/Ctrl，这里改掉）
         */
        selectionKeyCode={['Control', 'Meta']}
        multiSelectionKeyCode={['Shift']}
        /*
         * 框选「碰到就选中」（用户 2026-10-06 第 13 批第 10 条：「多选功能不需要把节点全部选中，
         * 只需要触碰到就能多选」）。
         *
         * React Flow 默认是 `'full'`：矩形必须**完全包住**节点才算选中 —— 于是"拖一个框划过去"
         * 经常一个都选不上，用户读到的是"框选坏了"（第 3 条报的"两个上游选不上"大概率就是这一条：
         * 包不严 = 没选中，与"有没有下游连线"无关）。
         */
        selectionMode={SelectionMode.Partial}
        /* §6.3：中键拖拽也平移（左键拖拽是默认行为，空格 + 拖拽由 React Flow 自带） */
        panOnDrag={[0, 1]}
        /*
         * **关掉 RF 的三处自动平移**（拖线 / 拖节点 / 框选时指针贴边就自己滚画布）。
         * 老表面没有这个行为，而它会以两种方式咬人：
         * ① 落点判定失真 —— 用户明明"松在空白处"，画布已经在拖拽期间滚过，
         *    于是松手点下面滑来了一个节点 ⇒ 变成"连到那个节点上"或"被拒"，§6.14 的
         *    空白松手菜单永远不弹（G13 实测：菜单=0，而它上面一条"空白处松手不建边"照样绿）；
         * ② 换引擎不该顺手给用户加一套新动效 —— 要加，另开一轮单独定规则。
         *
         * 拖线相关的自动平移如今已无对象（RF 不再接管连线手势，见上面那段注释），
         * 但拖节点 / 框选这两条仍然要关 —— 留住整条配置，免得日后有人只删一半。
         */
        autoPanOnConnect={false}
        autoPanOnNodeDrag={false}
        autoPanOnSelection={false}
        onSelectionStart={onSelectionStart}
        onSelectionEnd={onSelectionEnd}
        defaultViewport={initialFlowViewport}
        onViewportChange={handleViewportChange}
        onNodesChange={onNodesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        /*
         * 不自己接 `onPaneClick` 清选中：React Flow **默认就会**在点空白时清（且能区分"拖过不算点"）。
         * 我一度自己加了一条无条件清空 —— 结果**点节点也会被它清掉**（选中立刻变 0，创作面板打不开）。
         * 教训：默认行为已经对时，多余的"显式"实现只会引入偏差。
         *
         * ⚠️ `onlyRenderVisibleElements` **暂不开**：开着时"生成 4 张"这类**刚创建、落在视口外**的节点
         * 不进 DOM，G9 实测当场只画 2 个（数据是对的、刷新后 4 个都在）。老表面的裁剪带 280px 预热，
         * 语义上更接近"都挂上"。等 P5 收口、冒烟全部按 RF 面改写之后再作为规模优化单独评估。
         */
        /**
         * ⚠️ 这一键**不再交给 RF**（`deleteKeyCode={null}`）：RF 只认它自己的节点，
         * 而容器里的子节点不是 RF 节点 ⇒ 选中子节点按 Del 会"什么都不发生"
         *（用户第 16 批 #6）。改成 surface 自己听键盘（见 `onKeyDown` 那段 effect）。
         */
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        onEdgesChange={onEdgesChange}
        onEdgeDoubleClick={onEdgeDoubleClick}
        deleteKeyCode={null}
        /*
         * **关掉 React Flow 的署名水印**（用户 2026-10-06 第 13 条：「水印关掉，关掉后记得把小地图改好位置」）。
         *
         * 它默认画在画布右下角，而这一款是**自用工具**、不是对外分发的产品；
         * xyflow 是 MIT 许可、技术上允许移除（官方只是请求保留署名）。写在这里，是为了下一个人
         * 知道"这不是漏了，是刻意关的"——想恢复就把这一行删掉。
         */
        proOptions={{ hideAttribution: true }}
        /*
         * ⚠️ **关掉 React Flow 自带的键盘无障碍**（2026-10-12，对账 #449 实测）。
         *
         * RF 在"有选中节点"时会渲染一个 NodesSelection 框并**自动 focus 它**，那个框的
         * `onKeyDown` 里有它自己的一套"方向键移动选中节点"：速度写死 **5px**
         * （`useMoveSelectedNodes`：`const xVelo = snapToGrid ? snapGrid[0] : 5`），
         * `Shift` 再 **×4 = 20px**，而且**完全不看 Alt / Ctrl**。
         *
         * 后果不是"多点一下"，是**数据被悄悄改**（探针 `.playwright-verify/probe-rf-arrow-move.mjs`
         * 读的是库里持久化的 x/y，不是屏幕坐标 —— 屏幕坐标会被视口平移污染）：
         * - 按一下**普通** `→`（产品口径是"按邻近关系切换选中"，§6.3）：选中换人 **+ 节点 x +5px**；
         * - `Alt + →`（§6.20 微移 1px）：实测 **+6px**（我们的 1px + RF 的 5px）；
         * - `Ctrl + Alt + →`（改尺寸）：宽度确实只 +1，但**位置被顺手挪了 5px**。
         *
         * 为什么现在才关：本项目的键盘模型**一直是自己那一套**（窗口级监听 +
         * 选中集合充当 roving focus + `CanvasNotice` / 页面状态行自己做 aria-live，
         * 见 §4.5 / §6.3 / §6.20），从来没请 RF 管键盘。它那套是**第二份实现**，
         * 少了这一行就会与我们的键位互相叠加（同一个按键触发两件事，且其中一件没人知道）。
         * 关掉它**只去掉竞争**：节点仍可选、可拖、可连线，键盘全部走我们自己的链路。
         */
        disableKeyboardA11y
      >
        {/* 细网格 / 点阵 / 纯色（项目偏好）：纯色档**不渲染背景层** ——
            画一块纯色再用同色网格去盖，等于白画一层。 */}
        {canvasStyle.background === 'solid' ? null : (
          <Background
            variant={canvasStyle.background === 'grid' ? BackgroundVariant.Lines : BackgroundVariant.Dots}
            gap={22}
            size={1.4}
            color="var(--canvas-grid-line)"
          />
        )}
      </ReactFlow>
      <Hud count={graph.nodes.length} ids={nodes.map((n) => n.id)} />
      {/* 空画布 + 还没看过新手引导时，给三个模板直达（对账 #388 / E7） */}
      <EmptyCanvasGuide />
      {/*
       * 工作区浮层：**直接复用老表面那一套**（它们都自成一体、只读 store），
       * 换引擎不该把创作面板、跟随栏、右键菜单、提示与撤销条重写一遍。
       * 仍未接的：标注/旋转/宫格（挂在跟随栏里，见 P4）。
       */}
      <PanelLayer onOpenSettings={onOpenSettings} onOpenSkills={onOpenSkills} />
      <NodeFollowBar onOpenSettings={onOpenSettings} onDownload={handleDownload} />
      {/* 多选浮层（虚线框 + 六键栏 + 左右共有端点）：与老表面同一份实现，
          `onStartLink` 接的就是上面那个「老表面拖线控制器」 */}
      <MultiSelectBar onDownload={handleDownload} onStartLink={beginEdgeDrag} />
      <ContextMenu />
      <LinkMenu />
      <CanvasNotice />
      <UndoBar />
      {/* 小地图（§6.4）：复用老表面那份（自成一体、只读 store），最后渲染以免被别的浮层压住 */}
      {/* 小地图显示开关（本机偏好）：关掉只是少一个导航控件，画布本身不受影响 */}
      {appearance.showMinimap ? <Minimap /> : null}
      {/* 端点命中层：在所有节点之上收拖线手势（见 FlowPortLayer 里的长注释） */}
      <FlowPortLayer onPortDown={beginEdgeDrag} coarse={detailMode === 'coarse'} />
      {/* 子节点连线的**命中区**（双击删线）：必须在最上层才收得到指针，视觉是透明的 */}
      <FlowChildEdgeLayer hitOnly />
    </div>
  )
}

function Hud({ count, ids }: { count: number; ids: string[] }) {
  const { x, y, zoom } = useViewport()
  const storeVp = useViewportState()

  /**
   * ⚠️ 这里**只留节点数与缩放**（用户 2026-10-06 第 13 条：「只保留节点和缩放」）。
   *
   * 去掉的两样与它们的去向：
   *  · 「引擎 React Flow（P1）」—— 开发期标签（引擎名 + 阶段），给用户看没有意义；
   *  · 「素材：内置库 / 从文件夹加载 / 导出素材到文件夹」—— 它们是**功能入口**，不是状态读数：
   *    前两个（选文件夹 / 导出）搬去了「全局设置 → 存储」（`useAssetFolderActions`），
   *    「从文件夹加载」留在画布但降级为**空白处右键菜单**里的一项（那是"往当前画布加节点"的动作，
   *    设置浮层里没有 canvas store 可用）。
   */
  return (
    <div
      className={styles.hud}
      data-flow-hud
      data-flow-store-vp={`${Math.round(storeVp.x)},${Math.round(storeVp.y)}@${storeVp.zoom.toFixed(2)}`}
      data-flow-rf-vp={`${Math.round(x)},${Math.round(y)}@${zoom.toFixed(2)}`}
      data-flow-rf-nodes={ids.join(',')}
    >
      <span>节点 {count}</span>
      {/*
       * ⚠️ **不要再挂 `data-canvas-zoom`**：那是 §6.2 定的「小地图附近的缩放读数」，
       * 而小地图自带该锚点。挂两处会让冒烟 `page.locator('[data-canvas-zoom]')`
       * 变成 strict-mode violation（解析到 2 个元素直接抛）—— G46 实测崩过一次。
       * 这里的 `data-flow-zoom` 只给探针读，不冒充产品锚点。
       */}
      <span data-flow-zoom>{Math.round(zoom * 100)}%</span>
    </div>
  )
}
