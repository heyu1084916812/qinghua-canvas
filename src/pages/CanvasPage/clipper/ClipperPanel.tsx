import { useMemo, useRef, useState } from 'react'
import { usePlatform } from '../../../app/providers/PlatformProvider'
import {
  type ClipperItem,
} from '../../../domain/inspiration/clipper'
import { sendReferenceToAgent } from '../../../features/canvas/agentHandoff'
import { createClipperCollectionRepository } from '../../../state/shared/clipperCollectionRepository'
import { createReferenceLedgerRepository } from '../../../state/project/referenceLedgerRepository'
import type { CanvasStore } from '../../../state/workbenches/canvas/store'
import { ClipperExtensionUpdateNotice } from './ClipperExtensionUpdateNotice'
import { ClipperItemCard } from './ClipperItemCard'
import { ClipperSelectionBar } from './ClipperSelectionBar'
import {
  ClipperToolbar,
  clipperFilterCategory,
  type ClipperFilter,
} from './ClipperToolbar'
import { addClipperReference, sendClipperToCanvas } from './clipperActions'
import { clipperEmptyDescription, clipperEmptyTitle } from './clipperEmptyCopy'
import { useClipperExtensionUpdate } from './useClipperExtensionUpdate'
import { useClipperLiveCollection } from './useClipperLiveCollection'
import styles from './ClipperPanel.module.css'

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
  const [filter, setFilter] = useState<ClipperFilter>('all')
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [busy, setBusy] = useState('')
  const extensionUpdate = useClipperExtensionUpdate()
  const live = useClipperLiveCollection({
    collection,
    network: platform.network,
    onExtensionInfo: extensionUpdate.accept,
  })
  const { items, categories, status, setItems, setStatus, applyState } = live
  const controllerRef = useRef<AbortController | null>(null)
  const busyRef = useRef(false)
  const activeCategory = clipperFilterCategory(filter)
  const visible = activeCategory
    ? items.filter((item) => item.category === activeCategory)
    : items
  const selectedSet = new Set(selectedIds)

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
      applyState(await collection.removeMany(selectedIds))
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
      applyState(await collection.moveMany(selectedIds, category))
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
    applyState(state)
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

  return (
    <div className={styles.panel} data-clipper-panel>
      <ClipperExtensionUpdateNotice
        status={extensionUpdate.status}
        updating={extensionUpdate.updating}
        message={extensionUpdate.message}
        onUpdate={extensionUpdate.update}
      />
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
          <strong>{clipperEmptyTitle(activeCategory)}</strong>
          <p>{clipperEmptyDescription(activeCategory)}</p>
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

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
