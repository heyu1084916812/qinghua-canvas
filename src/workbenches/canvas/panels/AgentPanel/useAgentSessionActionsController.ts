import {
  useCallback,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { TaskLifecycle } from '../../../../features/shared/lifecycle/taskLifecycle'

interface AgentSessionCreateInput {
  projectId: string
  channelId: string
  model: string
  imageModel: string
  videoModel: string
}

export interface AgentSessionActionsControllerInput {
  current: AgentSession | null
  projectId: string
  chatModelOptions: readonly string[]
  imageModelOptions: readonly string[]
  videoModelOptions: readonly string[]
  trackRun: TaskLifecycle['track']
  createSession: (input: AgentSessionCreateInput) => Promise<AgentSession>
  loadAgentDefault: () => Promise<{ model?: string } | null>
  logicalModelOf: (model: string) => string
  defaultModelFor: (
    options: readonly string[],
    saved?: string,
  ) => string
  selectedModelOf: (kind: 'image' | 'video') => string
  refresh: () => Promise<readonly AgentSession[]>
  switchTo: (session: AgentSession) => Promise<void>
  setCurrent: Dispatch<SetStateAction<AgentSession | null>>
  renameSession: (sessionId: string, title: string) => Promise<void>
  removeSession: (sessionId: string) => Promise<void>
  clearDraftForSession: (sessionId: string) => void
  clearSessionRuntime: (sessionId: string) => void
  isDeleteBlocked: (sessionId: string) => boolean
  notify: (message: string, tone?: 'info' | 'error') => void
}

export interface AgentSessionActionsController {
  renaming: boolean
  titleDraft: string
  confirmDelete: boolean
  setTitleDraft: Dispatch<SetStateAction<string>>
  cancelRename: () => void
  startRename: () => void
  commitRename: () => Promise<void>
  deleteSession: () => Promise<void>
  newSession: () => Promise<void>
  resetForSessionSwitch: () => void
}

/**
 * Agent 会话管理动作：新建、改名、两步删除及对应本地编辑态。
 * SessionStore 仍是会话真相；每次新建或删除后的切换必须走 lifecycle 的 switchTo。
 */
export function useAgentSessionActionsController(
  input: AgentSessionActionsControllerInput,
): AgentSessionActionsController {
  const [renaming, setRenaming] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const resetForSessionSwitch = useCallback(() => {
    setRenaming(false)
    setConfirmDelete(false)
  }, [])

  const newSession = useCallback(
    () =>
      input.trackRun(async () => {
        const saved = await input.loadAgentDefault()
        const savedModel = input.logicalModelOf(saved?.model ?? '')
        const created = await input.createSession({
          projectId: input.projectId,
          channelId: '',
          model: input.defaultModelFor(
            input.chatModelOptions,
            savedModel,
          ),
          imageModel:
            input.selectedModelOf('image') ||
            input.imageModelOptions[0] ||
            '',
          videoModel:
            input.selectedModelOf('video') ||
            input.videoModelOptions[0] ||
            '',
        })
        await input.refresh()
        await input.switchTo(created)
      }),
    [
      input.chatModelOptions,
      input.createSession,
      input.defaultModelFor,
      input.imageModelOptions,
      input.loadAgentDefault,
      input.logicalModelOf,
      input.projectId,
      input.refresh,
      input.selectedModelOf,
      input.switchTo,
      input.trackRun,
      input.videoModelOptions,
    ],
  )

  const startRename = useCallback(() => {
    if (!input.current) return
    setTitleDraft(input.current.title)
    setRenaming(true)
    setConfirmDelete(false)
  }, [input.current])

  const cancelRename = useCallback(() => {
    setRenaming(false)
  }, [])

  const commitRename = useCallback(
    () =>
      input.trackRun(async () => {
        const target = input.current
        if (!target) return
        const title = titleDraft.trim()
        setRenaming(false)
        if (!title || title === target.title) return
        await input.renameSession(target.id, title)
        const rows = await input.refresh()
        const hit = rows.find((session) => session.id === target.id)
        if (!hit) return
        input.setCurrent((previous) =>
          previous?.id === hit.id
            ? { ...previous, ...hit, messages: previous.messages }
            : previous,
        )
      }),
    [
      input.current,
      input.refresh,
      input.renameSession,
      input.setCurrent,
      input.trackRun,
      titleDraft,
    ],
  )

  const deleteSession = useCallback(
    () =>
      input.trackRun(async () => {
        const target = input.current
        if (!target) return
        if (!confirmDelete) {
          setConfirmDelete(true)
          return
        }
        if (input.isDeleteBlocked(target.id)) {
          setConfirmDelete(false)
          input.notify(
            '当前会话还有任务在运行，请先停止后再删除',
            'error',
          )
          return
        }
        setConfirmDelete(false)
        input.clearDraftForSession(target.id)
        input.clearSessionRuntime(target.id)
        await input.removeSession(target.id)
        const rows = await input.refresh()
        if (rows.length > 0) await input.switchTo(rows[0]!)
        else await newSession()
      }),
    [
      confirmDelete,
      input.clearDraftForSession,
      input.clearSessionRuntime,
      input.current,
      input.isDeleteBlocked,
      input.notify,
      input.refresh,
      input.removeSession,
      input.switchTo,
      input.trackRun,
      newSession,
    ],
  )

  return {
    renaming,
    titleDraft,
    confirmDelete,
    setTitleDraft,
    cancelRename,
    startRename,
    commitRename,
    deleteSession,
    newSession,
    resetForSessionSwitch,
  }
}
