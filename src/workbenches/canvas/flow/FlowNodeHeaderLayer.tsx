import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { useStore } from '@xyflow/react'
import { useCanvasStore, useGraph } from '../storeContext'
import {
  NODE_HEADER_GAP,
  NODE_HEADER_HEIGHT,
  NODE_HEADER_SIDE_INSET,
  nodeHeaderLabels,
  nodeHeadersInView,
  sameHeaderLabels,
  type NodeHeaderLabel,
} from './nodeHeaders'
import styles from './FlowNodeHeaderLayer.module.css'

export function FlowNodeHeaderLayer({ coarse = false }: { coarse?: boolean }) {
  const graph = useGraph()
  const labels = useMemo(() => nodeHeaderLabels(graph.nodes), [graph])
  if (coarse) return null
  return <HeaderViewport labels={labels} />
}

const HeaderViewport = memo(function HeaderViewport({
  labels,
}: {
  labels: readonly NodeHeaderLabel[]
}) {
  const store = useCanvasStore()
  const surfaceW = useStore((state) => state.width)
  const surfaceH = useStore((state) => state.height)
  const layerRef = useRef<HTMLDivElement>(null)
  const source = useRef(labels)
  const visibleCache = useRef(
    nodeHeadersInView(labels, store.getViewport(), { w: surfaceW, h: surfaceH }),
  )

  const applyTransform = useCallback(() => {
    const viewport = store.getViewport()
    const zoom = viewport.zoom || 1
    if (!layerRef.current) return
    layerRef.current.style.transform =
      `translate(${-viewport.x * zoom}px, ${-viewport.y * zoom}px) scale(${zoom})`
  }, [store])

  useEffect(() => {
    applyTransform()
    return store.subscribeViewport(applyTransform)
  }, [applyTransform, store])

  const visibleStore = useMemo(
    () => ({
      subscribe(listener: () => void) {
        return store.subscribeViewport(listener)
      },
      getSnapshot() {
        const next = nodeHeadersInView(labels, store.getViewport(), {
          w: surfaceW,
          h: surfaceH,
        })
        if (source.current !== labels || !sameHeaderLabels(visibleCache.current, next)) {
          source.current = labels
          visibleCache.current = next
        }
        return visibleCache.current
      },
    }),
    [labels, store, surfaceH, surfaceW],
  )
  const visible = useSyncExternalStore(
    visibleStore.subscribe,
    visibleStore.getSnapshot,
    visibleStore.getSnapshot,
  )
  const renamingId = useSyncExternalStore(
    store.subscribe,
    store.getRenamingId,
    store.getRenamingId,
  )
  const viewport = store.getViewport()
  const zoom = viewport.zoom || 1

  return (
    <div className={styles.clip} data-flow-node-header-layer>
      <div
        ref={layerRef}
        className={styles.layer}
        style={{
          transform: `translate(${-viewport.x * zoom}px, ${-viewport.y * zoom}px) scale(${zoom})`,
        } as CSSProperties}
      >
        {visible.map((label) => (
          <HeaderLabel
            key={label.id}
            label={label}
            editing={renamingId === label.id}
          />
        ))}
      </div>
    </div>
  )
})

const HeaderLabel = memo(function HeaderLabel({
  label,
  editing,
}: {
  label: NodeHeaderLabel
  editing: boolean
}) {
  const store = useCanvasStore()
  const [draft, setDraft] = useState(label.title)
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelled = useRef(false)

  useEffect(() => setDraft(label.title), [label.title])
  useEffect(() => {
    if (!editing) return
    cancelled.current = false
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])

  const select = (event: ReactPointerEvent<HTMLElement>) => {
    event.stopPropagation()
    const selection = store.getSelection()
    const additive = event.shiftKey || event.ctrlKey || event.metaKey
    store.setSelection(
      additive
        ? selection.includes(label.id)
          ? selection.filter((id) => id !== label.id)
          : [...selection, label.id]
        : [label.id],
    )
  }

  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false
      return
    }
    const title = draft.trim() || label.title
    if (title !== label.title) store.dispatch({ kind: 'node.rename', id: label.id, title })
    store.endRename()
  }

  const cancel = () => {
    cancelled.current = true
    setDraft(label.title)
    store.endRename()
  }

  return (
    <div
      className={styles.header}
      style={{
        left: label.x - NODE_HEADER_SIDE_INSET,
        top: label.y - NODE_HEADER_HEIGHT - NODE_HEADER_GAP,
        width: label.w + NODE_HEADER_SIDE_INSET * 2,
      }}
      data-flow-node-header={label.id}
    >
      {editing ? (
        <input
          ref={inputRef}
          className={styles.titleInput}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit()
            else if (event.key === 'Escape') cancel()
          }}
          aria-label="节点名称"
        />
      ) : (
        <span
          className={styles.title}
          data-node-title
          onPointerDown={select}
          onDoubleClick={(event) => {
            event.stopPropagation()
            store.beginRename(label.id)
          }}
        >
          {label.title}
        </span>
      )}
      {label.pixels ? (
        <span className={styles.pixels} data-node-pixels>
          {label.pixels}
        </span>
      ) : null}
    </div>
  )
})
