import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { usePlatform } from '../../../app/providers/PlatformProvider'
import type { ClipperItem } from '../../../domain/inspiration/clipper'
import { sendReferenceToAgent } from '../../../features/canvas/agentHandoff'
import { createClipperCollectionRepository } from '../../../state/shared/clipperCollectionRepository'
import { createReferenceLedgerRepository } from '../../../state/project/referenceLedgerRepository'
import type { CanvasStore } from '../../../state/workbenches/canvas/store'
import { IconLink } from '../../../workbenches/canvas/toolbar/icons'
import { ClipperItemCard } from './ClipperItemCard'
import { capturePendingClipperQueue } from './clipperCapture'
import { addClipperReference, sendClipperToCanvas } from './clipperActions'
import styles from './ClipperPanel.module.css'

type Filter = 'all' | 'uncategorized'

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
  const [filter, setFilter] = useState<Filter>('all')
  const [busy, setBusy] = useState('')
  const [status, setStatus] = useState('')
  const controllerRef = useRef<AbortController | null>(null)
  const busyRef = useRef(false)
  const receivingRef = useRef(false)
  const visible = filter === 'uncategorized'
    ? items.filter((item) => item.category === '未分类')
    : items

  useEffect(() => {
    let active = true
    void collection.load().then((rows) => {
      if (active) setItems(rows)
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

  return (
    <div className={styles.panel} data-clipper-panel>
      <div className={styles.subhead}>
        <div className={styles.filters} role="tablist" aria-label="图片收藏筛选">
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'all'}
            className={filter === 'all' ? styles.tabOn : styles.tab}
            data-clipper-filter="all"
            onClick={() => setFilter('all')}
          >
            全部
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'uncategorized'}
            className={filter === 'uncategorized' ? styles.tabOn : styles.tab}
            data-clipper-filter="uncategorized"
            onClick={() => setFilter('uncategorized')}
          >
            未分类
          </button>
        </div>
        <span className={styles.scope}>
          <IconLink size={13} />
          所有网页
        </span>
      </div>

      {visible.length > 0 ? (
        <div className={styles.grid} data-clipper-items>
          {visible.map((item) => (
            <ClipperItemCard
              key={item.id}
              item={item}
              busy={Boolean(busy)}
              onAgent={() => void addToReference(item, true)}
              onReference={() => void addToReference(item, false)}
              onCanvas={() => void addToCanvas(item)}
              onRemove={() => void remove(item)}
            />
          ))}
        </div>
      ) : (
        <div className={styles.empty} data-clipper-empty>
          <strong>
            {filter === 'uncategorized' ? '没有未分类的图片' : '开始收集灵感吧'}
          </strong>
          <p>
            {filter === 'uncategorized'
              ? '切换到“全部”查看已收藏的网页图片'
              : '在任意网页把图片拖到页面中央，松手后会自动收藏到这里'}
          </p>
        </div>
      )}

      {status ? (
        <p className={styles.status} role="status" aria-live="polite">
          {status}
        </p>
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
