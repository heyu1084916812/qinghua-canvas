import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import type { ClipperItem } from '../../../domain/inspiration/clipper'
import type { NetworkPort } from '../../../platform/ports'
import type { ClipperCollectionRepository } from '../../../state/shared/clipperCollectionRepository'
import { capturePendingClipperQueue } from './clipperQueueCapture'
import { readClipperPendingQueue } from './clipperQueueClient'
import type { ClipperExtensionStatus } from './useClipperExtensionUpdate'

export function useClipperLiveCollection(input: {
  collection: ClipperCollectionRepository
  network: NetworkPort
  onExtensionInfo: (status: ClipperExtensionStatus | null) => void
}) {
  const [items, setItems] = useState<ClipperItem[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [status, setStatus] = useState('')
  const [ready, setReady] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)
  const receivingRef = useRef(false)

  const applyState = useCallback((state: {
    items: ClipperItem[]
    categories: string[]
  }) => {
    setItems(state.items)
    setCategories(state.categories)
  }, [])

  useEffect(() => {
    let active = true
    setReady(false)
    void input.collection.loadState().then((state) => {
      if (active) applyState(state)
    }).catch((error) => {
      if (active) setStatus(`读取图片收藏失败：${errorText(error)}`)
    }).finally(() => {
      if (active) setReady(true)
    })
    return () => {
      active = false
      controllerRef.current?.abort()
    }
  }, [applyState, input.collection])

  const syncReceiver = useCallback(async () => {
    if (!isTauri() || receivingRef.current) return
    receivingRef.current = true
    try {
      const info = await invoke<{
        running: boolean
        error?: string
        extension: ClipperExtensionStatus
      }>('clipper_receiver_info')
      input.onExtensionInfo(info.extension ?? null)
      if (!info.running) {
        setStatus(info.error ? `本机接收端未启动：${info.error}` : '本机接收端未启动。')
        return
      }
      setStatus((current) => current.startsWith('本机接收端') ? '' : current)
      const queue = await readClipperPendingQueue()
      if (queue.clips.length === 0) return
      const result = await capturePendingClipperQueue({
        clips: queue.clips,
        network: input.network,
        collection: input.collection,
        signal: newController().signal,
      })
      setItems(result.collection)
      if (!queue.legacy && result.importedIds.length > 0) {
        try {
          await invoke('clipper_ack_pending', { ids: result.importedIds })
        } catch {
          setStatus('图片已接收，但待收队列确认失败，将在下一轮自动去重重试。')
          return
        }
      }
      setStatus(importStatus(result, queue.legacy))
    } catch (error) {
      setStatus(`处理浏览器收藏失败：${errorText(error)}`)
    } finally {
      receivingRef.current = false
    }
  }, [input.collection, input.network, input.onExtensionInfo])

  useEffect(() => {
    if (!ready || !isTauri()) return
    void syncReceiver()
    const timer = window.setInterval(() => void syncReceiver(), 3_000)
    return () => window.clearInterval(timer)
  }, [ready, syncReceiver])

  return {
    items,
    categories,
    status,
    setItems,
    setStatus,
    applyState,
  }

  function newController() {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    return controller
  }
}

function importStatus(
  result: Awaited<ReturnType<typeof capturePendingClipperQueue>>,
  legacy: boolean,
) {
  if (result.imported > 0 && result.failed.length > 0) {
    const suffix = legacy ? '；重启桌面版后启用可靠重试' : '，将自动重试'
    return `已接收 ${result.imported} 张图片，${result.failed.length} 张暂未完成${suffix}。`
  }
  if (result.imported > 0) {
    return legacy
      ? `已从浏览器接收 ${result.imported} 张图片；重启桌面版后启用可靠队列。`
      : `已从浏览器接收 ${result.imported} 张图片。`
  }
  return `浏览器收藏暂未导入：${result.failed[0]?.message || '素材读取失败'}，将自动重试。`
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
