import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { usePlatform } from '../../../app/providers/PlatformProvider'
import {
  CLIPPER_UNCATEGORIZED,
  type ClipperItem,
} from '../../../domain/inspiration/clipper'
import { sendReferenceToAgent } from '../../../features/canvas/agentHandoff'
import { createClipperCollectionRepository } from '../../../state/shared/clipperCollectionRepository'
import { createReferenceLedgerRepository } from '../../../state/project/referenceLedgerRepository'
import type { CanvasStore } from '../../../state/workbenches/canvas/store'
import { ClipperItemCard } from './ClipperItemCard'
import { ClipperSelectionBar } from './ClipperSelectionBar'
import {
  ClipperToolbar,
  clipperFilterCategory,
  type ClipperFilter,
} from './ClipperToolbar'
import { capturePendingClipperQueue } from './clipperCapture'
import { addClipperReference, sendClipperToCanvas } from './clipperActions'
import styles from './ClipperPanel.module.css'

interface ClipperReceiverInfo {
  running: boolean
  endpoint: string
  token: string
  error?: string
}

interface PendingClip {
  id: string
  url: string
  title?: string
  imageUrl?: string
  receivedAt: number
}

export function ClipperPanel({
  projectId,
  store,
}: {
  projectId: string
  store: CanvasStore
}) {
  const platform = usePlatform()
  const collection = useMemo(
    () => createClipperCollectionRepository(platform.storage),
    [platform.storage],
  )
  const referenceLedger = useMemo(
    () => createReferenceLedgerRepository(platform.storage),
    [platform.storage],
  )
  const [items, setItems] = useState<ClipperItem[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [filter, setFilter] = useState<ClipperFilter>('all')
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [busy, setBusy] = useState('')
  const [status, setStatus] = useState('')
  const controllerRef = useRef<AbortController | null>(null)
  const busyRef = useRef(false)
  const receivingRef = useRef(false)
  const activeCategory = clipperFilterCategory(filter)
  const visible = activeCategory
    ? items.filter((item) => item.category === activeCategory)
    : items
  const selectedSet = new Set(selectedIds)

  useEffect(() => {
    let active = true
    void collection.loadState().then((state) => {
      if (active) applyCollectionState(state)
    }).catch((error) => {
      if (active) setStatus(`读取图片收藏失败：${errorText(error)}`)
    })
    return () => {
      active = false
      controllerRef.current?.abort()
    }
  }, [collection])

  const syncReceiver = useCallback(async () => {
    if (!isTauri() || receivingRef.current) return
    receivingRef.current = true
    try {
      const info = await invoke<ClipperReceiverInfo>('clipper_receiver_info')
      if (!info.running) {
        setStatus(info.error ? `本机接收端未启动：${info.error}` : '本机接收端未启动。')
        return
      }
      setStatus((current) => current.startsWith('本机接收端') ? '' : current)
      const pending = await invoke<PendingClip[]>('clipper_take_pending')
      if (pending.length === 0) return
      const result = await capturePendingClipperQueue({
        clips: pending,
        network: platform.network,
        collection,
        signal: newController().signal,
      })
      setItems(result.collection)
      if (result.imported > 0) {
        setStatus(`已从浏览器接收 ${result.imported} 张图片。`)
      }
    } catch (error) {
      setStatus(`本机接收端未启动：${errorText(error)}`)
    } finally {
      receivingRef.current = false
    }
  }, [collection, platform.network])

  useEffect(() => {
    if (!isTauri()) return
    void syncReceiver()
    const timer = window.setInterval(() => void syncReceiver(), 3_000)
    return () => window.clearInterval(timer)
  }, [syncReceiver])

  const addToReference = async (item: ClipperItem, toAgent: boolean) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(`${item.id}:${toAgent ? 'agent' : 'reference'}`)
    setStatus('正在保存图片收藏…')
    try {
      const controller = newController()
      const id = await addClipperReference({
        platform,
        ledger: referenceLedger,
        projectId,
        item,
        signal: controller.signal,
      })
      if (toAgent) {
        sendReferenceToAgent(projectId, [{ id, label: item.title }])
        setStatus('已加入 Agent 对话。')
      } else {
        store.notify('已加入当前项目的参考')
        setStatus('已加入当前项目的参考。')
      }
    } catch (error) {
      setStatus(`加入参考失败：${errorText(error)}`)
    } finally {
      busyRef.current = false
      setBusy('')
    }
  }

  const addToCanvas = async (item: ClipperItem) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(`${item.id}:canvas`)
    setStatus('正在放到画布…')
    try {
      const controller = newController()
      await sendClipperToCanvas(platform, item, controller.signal)
      setStatus('已放到当前画布。')
    } catch (error) {
      setStatus(`放到画布失败：${errorText(error)}`)
    } finally {
      busyRef.current = false
      setBusy('')
    }
  }

  const remove = async (item: ClipperItem) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(`${item.id}:remove`)
    try {
      setItems(await collection.remove(item.id))
      setStatus('已从图片收藏移除。')
    } catch (error) {
      setStatus(`移除失败：${errorText(error)}`)
    } finally {
      busyRef.current = false
      setBusy('')
    }
  }

  const removeSelected = async () => {
    if (busyRef.current || selectedIds.length === 0) return
    busyRef.current = true
    setBusy('selection:delete')
    try {
      applyCollectionState(await collection.removeMany(selectedIds))
      setStatus(`已删除 ${selectedIds.length} 项。`)
      exitSelection()
    } catch (error) {
      setStatus(`删除失败：${errorText(error)}`)
    } finally {
      busyRef.current = false
      setBusy('')
    }
  }

  const moveSelected = async (category: string) => {
    if (busyRef.current || selectedIds.length === 0) return
    busyRef.current = true
    setBusy('selection:move')
    try {
      applyCollectionState(await collection.moveMany(selectedIds, category))
      setStatus(`已移动 ${selectedIds.length} 项到“${category}”。`)
      exitSelection()
    } catch (error) {
      setStatus(`移动失败：${errorText(error)}`)
    } finally {
      busyRef.current = false
      setBusy('')
    }
  }

  const createCategory = async (name: string) => {
    const state = await collection.createCategory(name)
    applyCollectionState(state)
    setStatus(`已创建分类“${name.trim()}”。`)
  }

  const toggleSelect = (itemId: string) => {
    setSelectedIds((current) => current.includes(itemId)
      ? current.filter((id) => id !== itemId)
      : [...current, itemId])
  }

  const toggleSelectionMode = () => {
    if (selectionMode) {
      exitSelection()
      return
    }
    setSelectionMode(true)
    setSelectedIds([])
  }

  const exitSelection = () => {
    setSelectionMode(false)
    setSelectedIds([])
  }

  const applyCollectionState = (state: {
    items: ClipperItem[]
    categories: string[]
  }) => {
    setItems(state.items)
    setCategories(state.categories)
  }

  return (
    <div className={styles.panel} data-clipper-panel>
      <ClipperToolbar
        categories={categories}
        filter={filter}
        selectionMode={selectionMode}
        onFilter={setFilter}
        onToggleSelection={toggleSelectionMode}
        onCreateCategory={createCategory}
      />

      {visible.length > 0 ? (
        <div className={styles.grid} data-clipper-items>
          {visible.map((item) => (
            <ClipperItemCard
              key={item.id}
              item={item}
              busy={Boolean(busy)}
              selectable={selectionMode}
              selected={selectedSet.has(item.id)}
              onToggleSelect={() => toggleSelect(item.id)}
              onAgent={() => void addToReference(item, true)}
              onReference={() => void addToReference(item, false)}
              onCanvas={() => void addToCanvas(item)}
              onRemove={() => void remove(item)}
            />
          ))}
        </div>
      ) : (
        <div className={styles.empty} data-clipper-empty>
          <strong>{emptyTitle(activeCategory)}</strong>
          <p>{emptyDescription(activeCategory)}</p>
        </div>
      )}

      {status ? (
        <p className={styles.status} role="status" aria-live="polite">
          {status}
        </p>
      ) : null}

      {selectionMode ? (
        <ClipperSelectionBar
          selectedCount={selectedIds.length}
          categories={categories}
          onCancel={exitSelection}
          onDelete={() => void removeSelected()}
          onMove={(category) => void moveSelected(category)}
        />
      ) : null}
    </div>
  )

  function newController() {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    return controller
  }
}

function emptyTitle(category: string | null): string {
  if (category === CLIPPER_UNCATEGORIZED) return '没有未分类的图片'
  if (category) return `“${category}”还没有图片`
  return '开始收集灵感吧'
}

function emptyDescription(category: string | null): string {
  if (category === CLIPPER_UNCATEGORIZED) return '切换到“全部”查看已收藏的网页图片'
  if (category) return '选中图片后可以批量转到这个分类'
  return '在任意网页把图片拖到页面中央，松手后会自动收藏到这里'
}
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
