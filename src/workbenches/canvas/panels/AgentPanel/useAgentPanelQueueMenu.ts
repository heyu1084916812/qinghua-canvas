import {
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import type { AgentQueueMenuPosition } from './AgentQueuePanel'

export interface AgentPanelQueueMenu {
  queueMenuId: string | null
  queueMenuPosition: AgentQueueMenuPosition | null
  setQueueMenuId: Dispatch<SetStateAction<string | null>>
  setQueueMenuPosition: Dispatch<
    SetStateAction<AgentQueueMenuPosition | null>
  >
}

type QueueMenuEventTarget = Pick<
  EventTarget,
  'addEventListener' | 'removeEventListener'
>

export interface AgentPanelQueueMenuEnvironment {
  document: QueueMenuEventTarget
  window: QueueMenuEventTarget
}

export function useAgentPanelQueueMenu(
  sessionId: string | null,
  environment?: AgentPanelQueueMenuEnvironment,
): AgentPanelQueueMenu {
  const [queueMenuId, setQueueMenuId] = useState<string | null>(null)
  const [queueMenuPosition, setQueueMenuPosition] =
    useState<AgentQueueMenuPosition | null>(null)

  useEffect(() => {
    setQueueMenuId(null)
    setQueueMenuPosition(null)
  }, [sessionId])

  useEffect(() => {
    if (!queueMenuId) return
    const documentTarget = environment?.document ?? document
    const windowTarget = environment?.window ?? window
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as { closest?: (selector: string) => unknown }
      if (typeof target?.closest !== 'function') return
      if (
        target.closest(`[data-agent-queue-more="${queueMenuId}"]`) ||
        target.closest(`[data-agent-queue-menu="${queueMenuId}"]`)
      ) {
        return
      }
      setQueueMenuId(null)
      setQueueMenuPosition(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setQueueMenuId(null)
        setQueueMenuPosition(null)
      }
    }
    const closeOnViewportChange = () => {
      setQueueMenuId(null)
      setQueueMenuPosition(null)
    }
    documentTarget.addEventListener('pointerdown', closeOutside as EventListener, true)
    documentTarget.addEventListener('scroll', closeOnViewportChange, true)
    windowTarget.addEventListener('keydown', closeOnEscape as EventListener)
    windowTarget.addEventListener('resize', closeOnViewportChange)
    return () => {
      documentTarget.removeEventListener('pointerdown', closeOutside as EventListener, true)
      documentTarget.removeEventListener('scroll', closeOnViewportChange, true)
      windowTarget.removeEventListener('keydown', closeOnEscape as EventListener)
      windowTarget.removeEventListener('resize', closeOnViewportChange)
    }
  }, [environment, queueMenuId])

  return {
    queueMenuId,
    queueMenuPosition,
    setQueueMenuId,
    setQueueMenuPosition,
  }
}
