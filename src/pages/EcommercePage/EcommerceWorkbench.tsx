import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { EcommerceCanvasItem } from '../../domain/ecommerce/canvasItem'
import type {
  EcommerceDisplayResultStatus,
  EcommerceResultRecord,
} from '../../domain/ecommerce/tasks'
import styles from './EcommerceWorkbench.module.css'
import { pixelSummaryOf, routeAttemptSummaryOf } from '../../domain/shared/execution/runRecord'
import { projectWorkbenchResults } from './workbenchResultProjection'
import {
  clamp,
  createWorkbenchTextItem,
  createWorkbenchUploadedItem,
  fitWorkbenchItemsViewport,
  marqueeSelectionIds,
  MIN_ITEM_SIZE,
  movedWorkbenchItems,
  nextWorkbenchObjectPosition,
  panWorkbenchViewport,
  resizedWorkbenchItems,
  rotatedWorkbenchItems,
  selectedWorkbenchActions,
  wheelWorkbenchViewport,
  workbenchBlankInteraction,
  workbenchMarqueeSelection,
  workbenchMoveInteraction,
  workbenchPointerBox,
  workbenchResizeInteraction,
  workbenchRotateInteraction,
  workbenchUploadedSize,
  workbenchViewportFromMinimapPointer,
  type WorkbenchAction,
  type WorkbenchInteraction,
  type EcommerceWorkbenchProps,
  type Point,
  type ResizeHandle,
  type Viewport,
  type WorkbenchTool,
} from './workbench/workbenchContracts'
import { workbenchDisplayStatusOf } from './ecommercePage/pageResultProjection'
import {
  ToolIcon,
  WorkbenchMedia,
  WorkbenchResultPlaceholder,
  elapsedLabel,
} from './EcommerceWorkbenchViews'
import {
  itemScreenRect,
  workbenchMinimapModel,
} from './workbenchGeometry'
export type EcommerceWorkbenchAction = WorkbenchAction
export function EcommerceWorkbench({
  projectId,
  items,
  results,
  tasks,
  runs = [],
  activeResults = [],
  running = false,
  availableActions = ['download', 'save'],
  onItemsChange,
  onCanvasUpload,
  onAction,
  onRemoveFailed,
  channelLabelOf,
}: EcommerceWorkbenchProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const actionPanelRef = useRef<HTMLElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const interactionRef = useRef<WorkbenchInteraction | null>(null)
  const undoRef = useRef<EcommerceCanvasItem[][]>([])
  const redoRef = useRef<EcommerceCanvasItem[][]>([])
  const textEditHistoryRef = useRef(new Set<string>())
  const [localItems, setLocalItems] = useState<EcommerceCanvasItem[]>([...items])
  const localItemsRef = useRef<EcommerceCanvasItem[]>([...items])
  const [viewport, setViewport] = useState<Viewport>({ x: 48, y: 48, scale: 0.72 })
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [tool, setTool] = useState<WorkbenchTool>('select')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [selectionBox, setSelectionBox] = useState<{
    left: number
    top: number
    width: number
    height: number
  } | null>(null)
  const selectionBoxRef = useRef<{
    left: number
    top: number
    width: number
    height: number
  } | null>(null)
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({
    x: null,
    y: null,
  })
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const [editingTextId, setEditingTextId] = useState<string | null>(null)
  const [actionPanelHeight, setActionPanelHeight] = useState(420)
  const [historyVersion, setHistoryVersion] = useState(0)
  const lastItemIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (interactionRef.current) return
    localItemsRef.current = [...items]
    setLocalItems([...items])
  }, [items])

  const updateLocalItems = useCallback(
    (
      updater:
        | EcommerceCanvasItem[]
        | ((current: EcommerceCanvasItem[]) => EcommerceCanvasItem[]),
    ) => {
      const next =
        typeof updater === 'function'
          ? updater(localItemsRef.current)
          : updater
      localItemsRef.current = next
      setLocalItems(next)
      return next
    },
    [],
  )

  useEffect(() => {
    const node = viewportRef.current
    if (!node) return
    const measure = () => {
      const rect = node.getBoundingClientRect()
      setSize({ width: rect.width, height: rect.height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const node = viewportRef.current
    if (!node) return
    const onWheel = (event: WheelEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('[data-ecommerce-action-panel], [data-ecommerce-workbench-log]')) {
        return
      }
      event.preventDefault()
      const rect = node.getBoundingClientRect()
      setViewport((current) => wheelWorkbenchViewport(current, event, rect))
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [])

  const projection = useMemo(
    () => projectWorkbenchResults(results, activeResults, tasks, runs),
    [activeResults, results, runs, tasks],
  )
  const { latestResultById, taskById, latestRunByNode } = projection
  const selectedItems = localItems.filter((item) => selectedIds.has(item.id))
  const selected = selectedItems.length === 1 ? selectedItems[0]! : null
  const selectedResult = selected?.resultId
    ? latestResultById.get(selected.resultId) ?? null
    : null

  const displayStatusOf = useCallback(
    (result: EcommerceResultRecord): EcommerceDisplayResultStatus => {
      return workbenchDisplayStatusOf(result, {
        ...(latestRunByNode.get(result.nodeId)
          ? { run: latestRunByNode.get(result.nodeId) }
          : {}),
        ...(taskById.get(result.taskId) ? { task: taskById.get(result.taskId) } : {}),
      })
    },
    [latestRunByNode, taskById],
  )

  const fitAll = useCallback(() => {
    if (!viewportRef.current) return
    setViewport(fitWorkbenchItemsViewport(
      localItems,
      viewportRef.current.getBoundingClientRect(),
      72,
    ))
  }, [localItems])

  /** 新批次落位后把视口带到新对象，而不是把用户留在旧结果的位置。 */
  const focusItems = useCallback((targets: readonly EcommerceCanvasItem[]) => {
    if (!viewportRef.current || targets.length === 0) return
    setViewport(fitWorkbenchItemsViewport(
      targets,
      viewportRef.current.getBoundingClientRect(),
      96,
    ))
  }, [])

  useEffect(() => {
    const previousIds = lastItemIdsRef.current
    const fresh = localItems.filter((item) => !previousIds.has(item.id))
    if (fresh.length > 0) focusItems(fresh)
    lastItemIdsRef.current = new Set(localItems.map((item) => item.id))
  }, [focusItems, localItems])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      const key = event.key.toLowerCase()
      const command = event.ctrlKey || event.metaKey
      if (event.code === 'Space') {
        event.preventDefault()
        setSpaceHeld(true)
      }
      if (command && key === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }
      if (key === 'v') setTool('select')
      if (key === 'h') setTool('hand')
      if (key === '0' || (!command && key === 'z')) {
        event.preventDefault()
        fitAll()
      }
      if (event.key === 'Escape') {
        setSelectedIds(new Set())
        setEditingTextId(null)
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedIds.size > 0) {
        event.preventDefault()
        commitItems(localItems.filter((item) => !selectedIds.has(item.id)))
        setSelectedIds(new Set())
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpaceHeld(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  })

  const commitItems = useCallback(
    (next: EcommerceCanvasItem[], remember = true) => {
      if (remember) {
        undoRef.current.push([...localItemsRef.current])
        if (undoRef.current.length > 80) undoRef.current.shift()
        redoRef.current = []
        setHistoryVersion((value) => value + 1)
      }
      localItemsRef.current = next
      setLocalItems(next)
      onItemsChange(next)
    },
    [onItemsChange],
  )

  const undo = () => {
    const previous = undoRef.current.pop()
    if (!previous) return
    redoRef.current.push([...localItemsRef.current])
    localItemsRef.current = previous
    setLocalItems(previous)
    onItemsChange(previous)
    setHistoryVersion((value) => value + 1)
  }

  const redo = () => {
    const next = redoRef.current.pop()
    if (!next) return
    undoRef.current.push([...localItemsRef.current])
    localItemsRef.current = next
    setLocalItems(next)
    onItemsChange(next)
    setHistoryVersion((value) => value + 1)
  }

  const beginMove = (event: ReactPointerEvent, item: EcommerceCanvasItem) => {
    if (event.button !== 0 || tool === 'hand' || spaceHeld) return
    if ((event.target as HTMLElement).closest('textarea, input, select, [contenteditable="true"]')) {
      return
    }
    event.stopPropagation()
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    const move = workbenchMoveInteraction({
      event,
      item,
      selectedIds,
      additive: event.shiftKey,
      items: localItemsRef.current,
      viewport,
      rect,
    })
    const nextSelection = move.selection
    setSelectedIds(nextSelection)
    if (!nextSelection.has(item.id)) return
    interactionRef.current = move.interaction
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const beginResize = (
    event: ReactPointerEvent,
    item: EcommerceCanvasItem,
    handle: ResizeHandle,
  ) => {
    event.stopPropagation()
    setSelectedIds(new Set([item.id]))
    /* resize 永不参与吸附；开始缩放时先清掉 move 留下的辅助线。 */
    setGuides({ x: null, y: null })
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    interactionRef.current = workbenchResizeInteraction({ event, item, handle, viewport, rect })
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const beginRotate = (event: ReactPointerEvent, item: EcommerceCanvasItem) => {
    event.stopPropagation()
    setSelectedIds(new Set([item.id]))
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    interactionRef.current = workbenchRotateInteraction({ event, item, viewport, rect })
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const beginPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    const isBlank = !target.closest(
      '[data-ecommerce-workbench-item], [data-ecommerce-action-panel], [data-ecommerce-workbench-toolbar], [data-ecommerce-workbench-log], [data-ecommerce-workbench-zoom], [data-ecommerce-workbench-minimap], button',
    )
    if (!isBlank || !viewportRef.current) return
    const blank = workbenchBlankInteraction({
      event,
      tool,
      spaceHeld,
      viewport,
      rect: viewportRef.current.getBoundingClientRect(),
    })
    if (!blank) return
    event.preventDefault()
    setEditingTextId(null)
    if (blank.selectionBox) {
      selectionBoxRef.current = blank.selectionBox
      setSelectionBox(blank.selectionBox)
      interactionRef.current = blank.interaction
      event.currentTarget.setPointerCapture?.(event.pointerId)
      return
    }
    interactionRef.current = blank.interaction
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const finishInteraction = useCallback(() => {
    const interaction = interactionRef.current
    if (!interaction) return
    interactionRef.current = null
    setGuides({ x: null, y: null })
    if (interaction.kind === 'marquee') {
      const box = selectionBoxRef.current
      const next = marqueeSelectionIds(
        localItemsRef.current,
        interaction.startViewport,
        box,
        interaction.moved,
      )
      setSelectedIds((current) =>
        workbenchMarqueeSelection(current, next, interaction.additive === true),
      )
      setSelectionBox(null)
      selectionBoxRef.current = null
      return
    }
    if (interaction.kind === 'pan') {
      if (!interaction.moved && interaction.button === 0) setSelectedIds(new Set())
      return
    }
    if (interaction.moved) {
      undoRef.current.push([...items])
      redoRef.current = []
      setHistoryVersion((value) => value + 1)
      onItemsChange(localItemsRef.current)
    }
  }, [items, onItemsChange])

  const rotateWithPointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const interaction = interactionRef.current
    const rect = viewportRef.current?.getBoundingClientRect()
    if (
      !interaction ||
      interaction.kind !== 'rotate' ||
      !interaction.center ||
      !interaction.startItem ||
      !rect
    ) {
      return
    }
    interaction.moved = true
    updateLocalItems((current) => rotatedWorkbenchItems(interaction, current, event, rect))
  }

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const interaction = interactionRef.current
      if (!interaction) return
      const dx = event.clientX - interaction.startClient.x
      const dy = event.clientY - interaction.startClient.y
      if (Math.abs(dx) + Math.abs(dy) > 2) interaction.moved = true
      if (interaction.kind === 'pan') {
        setViewport(panWorkbenchViewport(interaction.startViewport, dx, dy))
        return
      }
      const rect = viewportRef.current?.getBoundingClientRect()
      if (interaction.kind === 'marquee') {
        if (!rect) return
        const box = workbenchPointerBox(interaction, event, rect)
        selectionBoxRef.current = box
        setSelectionBox(box)
        return
      }
      if (!rect || !interaction.startItem || !interaction.itemId) return
      if (interaction.kind === 'move') {
        updateLocalItems((current) => {
          const next = movedWorkbenchItems(interaction, current, event, rect)
          setGuides(next.guides)
          return next.items
        })
        return
      }
      if (interaction.kind === 'rotate' && interaction.center) {
        updateLocalItems((current) => rotatedWorkbenchItems(interaction, current, event, rect))
        return
      }
      if (interaction.kind === 'resize' && interaction.handle) {
        updateLocalItems((current) =>
          resizedWorkbenchItems(interaction, current, event, rect, MIN_ITEM_SIZE),
        )
      }
    }
    const up = () => {
      finishInteraction()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  })

  const nextObjectPosition = (width: number, height: number): Point => {
    return nextWorkbenchObjectPosition(
      localItemsRef.current,
      width,
      height,
      viewport,
      viewportRef.current?.getBoundingClientRect() ?? null,
    )
  }

  const addText = () => {
    const position = nextObjectPosition(280, 84)
    const item = createWorkbenchTextItem({ projectId, position, items: localItems })
    commitItems([...localItems, item])
    setSelectedIds(new Set([item.id]))
    setEditingTextId(item.id)
  }

  const upload = async (file: File | undefined) => {
    if (!file || !onCanvasUpload) return
    const uploaded = await onCanvasUpload(file)
    if (!uploaded) return
    const size = workbenchUploadedSize(uploaded)
    const { width, height } = size
    const position = nextObjectPosition(width, height)
    const item = createWorkbenchUploadedItem({ projectId, uploaded, position, size, items: localItems })
    commitItems([...localItems, item])
    setSelectedIds(new Set([item.id]))
  }

  const panel = useMemo(() => {
    if (!selected) return null
    const screen = itemScreenRect(selected, viewport)
    const width = 220
    const left =
      screen.left + screen.width + 16 + width <= size.width
        ? screen.left + screen.width + 16
        : screen.left - width - 16
    const height = Math.min(actionPanelHeight, Math.max(120, size.height - 24))
    return {
      left: clamp(left, 12, Math.max(12, size.width - width - 12)),
      top: clamp(screen.top, 12, Math.max(12, size.height - height - 12)),
    }
  }, [actionPanelHeight, selected, size.height, size.width, viewport])

  useLayoutEffect(() => {
    if (!actionPanelRef.current) return
    const height = actionPanelRef.current.offsetHeight
    setActionPanelHeight((current) => (Math.abs(current - height) > 1 ? height : current))
  }, [selected?.id, selectedResult?.id, localItems.length])

  const selectedAssetHash = selected?.assetHash ?? selectedResult?.assetHash
  const selectedResultStatus = selectedResult ? displayStatusOf(selectedResult) : null
  const selectedActions = selectedWorkbenchActions(
    selectedResultStatus,
    selectedAssetHash,
    selectedResult,
  )

  const minimap = useMemo(() => workbenchMinimapModel(localItems, selectedIds, size, viewport), [localItems, selectedIds, size.height, size.width, viewport])

  const moveViewportFromMinimap = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!minimap) return
    const rect = event.currentTarget.getBoundingClientRect()
    setViewport(workbenchViewportFromMinimapPointer({
      minimap,
      event,
      rect,
      size,
      scale: viewport.scale,
    }))
  }

  return (
    <div
      ref={viewportRef}
      className={styles.workbench}
      data-ecommerce-workbench
      data-tool={tool}
      data-zoom={Math.round(viewport.scale * 100)}
      data-viewport-x={Math.round(viewport.x)}
      data-viewport-y={Math.round(viewport.y)}
      onPointerDown={beginPan}
      onDoubleClick={(event) => {
        if (event.target === event.currentTarget) fitAll()
      }}
    >
      <div
        className={styles.canvasGlow}
        aria-hidden
        style={{
          backgroundSize: `${18 * viewport.scale}px ${18 * viewport.scale}px`,
          backgroundPosition: `${viewport.x}px ${viewport.y}px`,
        }}
      />
      <div
        className={styles.world}
        data-ecommerce-workbench-world
        style={
          {
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
            '--wb-inv-scale': 1 / viewport.scale,
          } as CSSProperties
        }
      >
        {localItems.map((item) => {
          const activeResult = item.resultId
            ? latestResultById.get(item.resultId) ?? null
            : null
          const status = activeResult ? displayStatusOf(activeResult) : null
          const task = activeResult ? taskById.get(activeResult.taskId) : null
          const run = activeResult ? latestRunByNode.get(activeResult.nodeId) : null
          const errorText =
            run?.errorText ??
            activeResult?.errorText ??
            task?.errorText ??
            '任务已结束，但没有返回可展示的结果'
          const selectedItem = selectedIds.has(item.id)
          return (
            <div
              key={item.id}
              className={[
                styles.item,
                selectedItem ? styles.itemSelected : '',
                item.kind === 'text' ? styles.textItem : '',
              ].filter(Boolean).join(' ')}
              style={{
                left: item.x,
                top: item.y,
                width: item.width,
                height: item.height,
                zIndex: selectedItem ? item.zIndex + 10000 : item.zIndex,
                transform: `rotate(${item.rotation}deg)`,
              }}
              data-ecommerce-workbench-item={item.id}
              data-ecommerce-result={activeResult ? true : undefined}
              data-ecommerce-result-id={activeResult?.nodeId ?? item.resultId ?? item.id}
              data-ecommerce-result-record-id={item.resultId}
              data-status={status ?? undefined}
              data-item-x={Math.round(item.x)}
              data-item-y={Math.round(item.y)}
              data-item-width={Math.round(item.width)}
              data-item-height={Math.round(item.height)}
              data-item-rotation={Math.round(item.rotation)}
              data-item-kind={item.kind}
              onPointerDown={(event) => beginMove(event, item)}
              onDoubleClick={(event) => {
                event.stopPropagation()
                if (item.kind === 'text') setEditingTextId(item.id)
                else setSelectedIds(new Set([item.id]))
              }}
            >
              {activeResult && status && status !== 'done' ? (
                <WorkbenchResultPlaceholder
                  result={activeResult}
                  status={status}
                  errorText={errorText}
                  onRetry={
                    status === 'failed' && activeResult
                      ? () => onAction?.(item, 'retry')
                      : undefined
                  }
                  onRemove={
                    status === 'failed' && activeResult
                      ? () => onRemoveFailed?.(activeResult.id)
                      : undefined
                  }
                />
              ) : item.kind === 'text' ? (
                editingTextId === item.id ? (
                  <textarea
                    className={styles.textEditor}
                    autoFocus
                    value={item.text ?? ''}
                    onChange={(event) => {
                      const text = event.target.value
                      if (!textEditHistoryRef.current.has(item.id)) {
                        undoRef.current.push([...localItemsRef.current])
                        if (undoRef.current.length > 80) undoRef.current.shift()
                        redoRef.current = []
                        textEditHistoryRef.current.add(item.id)
                        setHistoryVersion((value) => value + 1)
                      }
                      updateLocalItems((current) =>
                        current.map((candidate) =>
                          candidate.id === item.id ? { ...candidate, text } : candidate,
                        ),
                      )
                    }}
                    onBlur={() => {
                      textEditHistoryRef.current.delete(item.id)
                      setEditingTextId(null)
                      onItemsChange(localItemsRef.current)
                    }}
                  />
                ) : (
                  <div className={styles.textContent}>{item.text}</div>
                )
              ) : (
                <WorkbenchMedia
                  item={item}
                  original={selectedItem || !item.resultId}
                />
              )}
              {selectedItem && selectedIds.size === 1 && (
                <>
                  <span className={styles.sizeLabel} data-ecommerce-item-size>
                    {Math.round(item.width)} × {Math.round(item.height)}
                  </span>
                  {(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as ResizeHandle[]).map(
                    (handle) => (
                      <button
                        key={handle}
                        type="button"
                        className={`${styles.resizeHandle} ${styles[`handle_${handle}`]}`}
                        data-ecommerce-resize-handle={handle}
                        aria-label={`缩放 ${handle}`}
                        onPointerDown={(event) => beginResize(event, item, handle)}
                      />
                    ),
                  )}
                  <button
                    type="button"
                    className={styles.rotateHandle}
                    data-ecommerce-rotate-handle
                    aria-label="旋转图片"
                    title="拖动旋转"
                    onPointerDown={(event) => beginRotate(event, item)}
                    onPointerMove={rotateWithPointer}
                    onPointerUp={(event) => {
                      event.stopPropagation()
                      finishInteraction()
                    }}
                  >
                    <ToolIcon name="rotate" />
                  </button>
                </>
              )}
            </div>
          )
        })}
        {guides.x !== null && (
          <div
            className={styles.guideX}
            style={{ left: guides.x }}
            data-ecommerce-guide="x"
            aria-hidden
          />
        )}
        {guides.y !== null && (
          <div
            className={styles.guideY}
            style={{ top: guides.y }}
            data-ecommerce-guide="y"
            aria-hidden
          />
        )}
      </div>

      {selectionBox ? (
        <div
          className={styles.selectionMarquee}
          data-ecommerce-selection-marquee
          aria-hidden="true"
          style={selectionBox}
        />
      ) : null}

      {selected && panel && (
        <aside
          ref={actionPanelRef}
          className={styles.actionPanel}
          style={{ left: panel.left, top: panel.top }}
          data-ecommerce-action-panel
          onPointerDown={(event) => event.stopPropagation()}
        >
          <header className={styles.panelHead}>
            <strong>
              {selected.kind === 'text'
                ? '文字对象'
                : selected.kind === 'video'
                  ? '视频结果'
                  : selected.resultId
                    ? `图片结果${selectedResult?.shotTitle ? ` · ${selectedResult.shotTitle}` : ''}`
                    : '图片对象'}
            </strong>
            <span>{Math.round(selected.rotation)}°</span>
          </header>
          {selectedResult ? (
            <dl className={styles.panelMeta}>
              <div><dt>模型</dt><dd>{selectedResult.model || '—'}</dd></div>
              <div><dt>比例</dt><dd>{selectedResult.ratio || '—'}</dd></div>
              <div><dt>像素</dt><dd>{selectedResult.width ?? '?'} × {selectedResult.height ?? '?'}</dd></div>
            </dl>
          ) : null}
          <div className={styles.panelActions}>
            {selectedActions.map(([action, label]) => {
              const active = availableActions.includes(action) && !!onAction
              return (
              <button
                key={action}
                type="button"
                data-ecommerce-workbench-action={action}
                disabled={!active}
                title={active ? label : `${label}：待接入`}
                onClick={() => onAction?.(selected, action)}
              >
                <ToolIcon name={action} />
                <span>{label}</span>
              </button>
              )
            })}
            {selected.kind === 'text' ? (
              <button
                type="button"
                onClick={() => setEditingTextId(selected.id)}
              >
                <ToolIcon name="text" />
                <span>编辑文字</span>
              </button>
            ) : null}
          </div>
        </aside>
      )}

      {minimap ? (
        <div
          className={styles.minimap}
          data-ecommerce-workbench-minimap
          role="button"
          tabIndex={0}
          aria-label="工作台小地图，点击定位视口"
          title="小地图：点击定位"
          onPointerDown={(event) => {
            event.stopPropagation()
            moveViewportFromMinimap(event)
          }}
        >
          {minimap.items.map((item) => (
            <span
              key={item.id}
              className={styles.minimapItem}
              data-selected={item.selected ? 'true' : undefined}
              style={{
                left: item.left,
                top: item.top,
                width: item.width,
                height: item.height,
              }}
            />
          ))}
          <span
            className={styles.minimapViewport}
            style={{
              left: minimap.viewportRect.left,
              top: minimap.viewportRect.top,
              width: minimap.viewportRect.width,
              height: minimap.viewportRect.height,
            }}
          />
        </div>
      ) : null}

      <div className={styles.toolbar} data-ecommerce-workbench-toolbar>
        <button type="button" data-tool-active={tool === 'select'} title="选择 (V)" onClick={() => setTool('select')}>
          <ToolIcon name="select" />
        </button>
        <button type="button" data-tool-active={tool === 'hand'} title="抓手 (H)" onClick={() => setTool('hand')}>
          <ToolIcon name="hand" />
        </button>
        <span className={styles.toolDivider} />
        <button type="button" title="上传图片" onClick={() => fileRef.current?.click()}>
          <ToolIcon name="upload" />
        </button>
        <button type="button" title="添加文字" onClick={addText}>
          <ToolIcon name="text" />
        </button>
        <span className={styles.toolDivider} />
        <button type="button" title="上一步 (Ctrl+Z)" disabled={undoRef.current.length === 0} onClick={undo} data-history-version={historyVersion}>
          <ToolIcon name="undo" />
        </button>
        <button type="button" title="下一步 (Ctrl+Shift+Z)" disabled={redoRef.current.length === 0} onClick={redo} data-history-version={historyVersion}>
          <ToolIcon name="redo" />
        </button>
      </div>

      <div className={styles.zoomReadout} data-ecommerce-workbench-zoom>
        {Math.round(viewport.scale * 100)}%
        {selectedIds.size > 1 ? (
          <span data-ecommerce-selection-count>已选 {selectedIds.size} 项</span>
        ) : null}
        <button
          type="button"
          title="显示全部素材 (Z / 0)"
          data-ecommerce-workbench-fit
          onClick={fitAll}
        >
          适配全部
        </button>
      </div>

      <button
        type="button"
        className={styles.logButton}
        data-ecommerce-workbench-log-toggle
        aria-expanded={logOpen}
        onClick={() => setLogOpen((value) => !value)}
      >
        <ToolIcon name="log" />
        日志
      </button>

      {logOpen && (
        <aside className={styles.logPanel} data-ecommerce-workbench-log>
          <header>
            <strong>电商日志</strong>
            <button type="button" aria-label="关闭日志" onClick={() => setLogOpen(false)}>
              <ToolIcon name="close" />
            </button>
          </header>
          <div className={styles.logRows}>
            {runs.length > 0 ? (
              [...runs]
                .sort((a, b) => b.createdAt - a.createdAt)
                .map((run) => {
                  const task = tasks.find((item) => item.nodeIds.includes(run.nodeId))
                  const result = results.find((item) => item.nodeId === run.nodeId)
                  const params = (run.params ?? {}) as { model?: unknown }
                  const model =
                    run.sentModel ??
                    (typeof params.model === 'string' ? params.model : undefined) ??
                    result?.model ??
                    '—'
                  const channelId = run.sentChannelId
                  const channel = channelId ? channelLabelOf?.(channelId) ?? channelId : ''
                  const pixels = pixelSummaryOf(run)
                  const routeAttempts = routeAttemptSummaryOf(run.routeAttempts)
                  return (
                    <article
                      key={run.id}
                      data-ecommerce-run-record={run.id}
                      data-status={run.status}
                    >
                      <span data-status={run.status}>
                        {run.status === 'succeeded'
                          ? '成功'
                          : run.status === 'canceled'
                            ? '取消'
                            : '失败'}
                      </span>
                      <p>
                        {task?.request.modeLabel || task?.request.usage || '电商生成'}
                        {typeof result?.position === 'number'
                          ? ` · 第 ${result.position + 1} 张`
                          : ''}
                      </p>
                      <small>
                        {model}
                        {channel ? ` · ${channel}` : ''} ·{' '}
                        {run.durationMs > 0 ? `${(run.durationMs / 1000).toFixed(1)}s` : '<1s'} ·{' '}
                        {new Date(run.createdAt).toLocaleTimeString('zh-CN')}
                        {routeAttempts
                          ? ` · 路由 ${routeAttempts.count} 次`
                          : ''}
                      </small>
                      {routeAttempts ? (
                        <small title={routeAttempts.title} data-ecommerce-route-attempts={routeAttempts.count}>
                          {routeAttempts.title.replace(/\n/g, ' · ')}
                        </small>
                      ) : null}
                      {pixels ? <small>{pixels}</small> : null}
                      {run.errorText ? <p className={styles.logError}>{run.errorText}</p> : null}
                    </article>
                  )
                })
            ) : tasks.length === 0 ? (
              <p>还没有电商任务。</p>
            ) : (
              [...tasks]
                .sort((a, b) => b.createdAt - a.createdAt)
                .map((task) => {
                  const rows = results.filter((result) => result.taskId === task.id)
                  const failed = rows.filter((result) => result.status === 'failed').length
                  const error = rows.find((result) => result.errorText)?.errorText
                  const model =
                    rows.find((result) => result.model)?.model ??
                    task.request.resolvedModel ??
                    task.request.model ??
                    '—'
                  const channelId = task.request.resolvedChannelId
                  const channel = channelId ? channelLabelOf?.(channelId) ?? channelId : ''
                  return (
                    <article key={task.id}>
                      <span data-status={task.status}>{running && task.status === 'running' ? '生成中' : task.status === 'done' ? '完成' : task.status === 'partial' ? '部分完成' : task.status === 'canceled' ? '取消' : '失败'}</span>
                      <p>{task.request.modeLabel || task.request.usage} · {rows.length} 个结果{failed ? ` · ${failed} 失败` : ''}</p>
                      <small>{model}{channel ? ` · ${channel}` : ''} · {elapsedLabel(task)} · {new Date(task.createdAt).toLocaleTimeString('zh-CN')}</small>
                      {error ? <p className={styles.logError}>{error}</p> : null}
                    </article>
                  )
                })
            )}
          </div>
        </aside>
      )}

      {localItems.length === 0 ? (
        <div className={styles.empty} data-ecommerce-workbench-empty>
          <span>生成结果会按任务顺序出现在这里</span>
          <small>滚轮缩放 · 左键拖空白平移 · Ctrl+拖动框选</small>
        </div>
      ) : null}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          void upload(event.target.files?.[0])
          event.target.value = ''
        }}
      />
    </div>
  )
}
