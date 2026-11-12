import { useCallback, useEffect, useRef, useState } from 'react'
import type { NoticeTone } from '../../../../domain/ui/notice'
import type { ConversationResearchItem } from './conversation'

interface ActionResult {
  ok: boolean
  message: string
}

export type ResearchGalleryAction = 'add' | 'download' | 'send'

export interface ResearchGalleryBusy {
  id: string
  action: ResearchGalleryAction
}

type ActionCallback = (
  item: ConversationResearchItem,
  signal?: AbortSignal,
) => Promise<ActionResult>

export function useResearchGalleryActions() {
  const [busy, setBusy] = useState<ResearchGalleryBusy | null>(null)
  const [status, setStatus] = useState('')
  const [statusTone, setStatusTone] = useState<NoticeTone>('info')
  const busyRef = useRef<ResearchGalleryBusy | null>(null)
  const actionAbortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      busyRef.current = null
      actionAbortRef.current?.abort()
      actionAbortRef.current = null
    }
  }, [])

  const abort = useCallback(() => {
    if (!busyRef.current) return false
    busyRef.current = null
    actionAbortRef.current?.abort()
    actionAbortRef.current = null
    setBusy(null)
    return true
  }, [])

  const run = useCallback(async (
    item: ConversationResearchItem,
    action: ResearchGalleryAction,
    callback: ActionCallback | undefined,
    onResult?: (result: ActionResult, item: ConversationResearchItem) => void,
    onSettled?: () => void,
    failurePrefix = '操作失败',
  ) => {
    if (!callback || busyRef.current) return
    const controller = new AbortController()
    actionAbortRef.current = controller
    busyRef.current = { id: item.id, action }
    setStatus('')
    setBusy({ id: item.id, action })
    try {
      const result = await callback(item, controller.signal)
      if (!mountedRef.current) return
      setStatusTone(result.ok ? 'info' : 'error')
      setStatus(result.message)
      onResult?.(result, item)
    } catch (error) {
      if (!mountedRef.current) return
      setStatusTone('error')
      setStatus(error instanceof Error ? `${failurePrefix}：${error.message}` : failurePrefix)
    } finally {
      if (actionAbortRef.current === controller) actionAbortRef.current = null
      if (mountedRef.current) {
        busyRef.current = null
        setBusy(null)
        onSettled?.()
      }
    }
  }, [])

  return { abort, busy, run, status, statusTone }
}
