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
    /**
     * B6：abort() 后可以立刻开始新动作；旧动作晚到的结果、状态文案和 finally
     * 都只在它仍是“当前动作”时生效，否则会清掉新动作的 busy、覆盖新文案。
     */
    const isCurrent = () => mountedRef.current && actionAbortRef.current === controller
    try {
      const result = await callback(item, controller.signal)
      if (!isCurrent()) return
      setStatusTone(result.ok ? 'info' : 'error')
      setStatus(result.message)
      onResult?.(result, item)
    } catch (error) {
      if (!isCurrent()) return
      setStatusTone('error')
      setStatus(error instanceof Error ? `${failurePrefix}：${error.message}` : failurePrefix)
    } finally {
      if (isCurrent()) {
        actionAbortRef.current = null
        busyRef.current = null
        setBusy(null)
        onSettled?.()
      }
    }
  }, [])

  return { abort, busy, run, status, statusTone }
}
