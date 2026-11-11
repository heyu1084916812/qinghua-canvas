import {
  useCallback,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { TaskLifecycle } from '../../../../features/shared/lifecycle/taskLifecycle'
import type { AgentSessionRefreshResult } from './useAgentSessionLifecycle'

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
    preferred?: string | readonly string[],
  ) => string
  selectedModelOf: (kind: 'image' | 'video') => string
  refresh: () => Promise<AgentSessionRefreshResult>
  switchTo: (session: AgentSession) => Promise<void>
  setCurrent: Dispatch<SetStateAction<AgentSession | null>>
  clearInvalidCurrent: (sessionId: string) => void
  renameSession: (sessionId: string, title: string) => Promise<void>
  removeSession: (sessionId: string) => Promise<void>
  clearDraftForSession: (sessionId: string) => void
  clearSessionRuntime: (sessionId: string) => void
  isCurrentSession: (sessionId: string) => boolean
  isDeleteBlocked: (sessionId: string) => boolean
  describeError: (error: unknown) => string
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
          /*
           * 新会话沿用**当前会话**已选的对话模型，其次才是保存的默认；
           * defaultModelFor 只认启用渠道能提供的，绝不回落到停用渠道（A4）。
           */
          model: input.defaultModelFor(input.chatModelOptions, [
            input.logicalModelOf(input.current?.model ?? ''),
            savedModel,
          ]),
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
      input.current?.model,
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
        const refreshed = await input.refresh()
        if (!refreshed.applied) return
        if (!input.isCurrentSession(target.id)) return
        const hit = refreshed.rows.find(
          (session) => session.id === target.id,
        )
        if (!hit) return
        input.setCurrent((previous) =>
          previous?.id === hit.id
            ? { ...previous, ...hit, messages: previous.messages }
            : previous,
        )
      }),
    [
      input.current,
      input.isCurrentSession,
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
        await input.removeSession(target.id)
        input.clearDraftForSession(target.id)
        input.clearSessionRuntime(target.id)
        const failAfterDelete = (message: string, error: unknown) => {
          input.clearInvalidCurrent(target.id)
          input.notify(
            `${message}：${input.describeError(error)}`,
            'error',
          )
        }
        let refreshed: AgentSessionRefreshResult
        try {
          refreshed = await input.refresh()
        } catch (error) {
          failAfterDelete('会话已删除，但刷新会话列表失败', error)
          return
        }
        if (!refreshed.applied) {
          input.clearInvalidCurrent(target.id)
          return
        }
        if (!input.isCurrentSession(target.id)) return
        const rows = refreshed.rows
        if (rows.length > 0) {
          try {
            await input.switchTo(rows[0]!)
          } catch (error) {
            failAfterDelete(
              '会话已删除，但自动切换会话失败，请手动选择会话',
              error,
            )
          }
          return
        }
        input.clearInvalidCurrent(target.id)
        try {
          await newSession()
        } catch (error) {
          input.notify(
            `会话已删除，但自动新建会话失败，请手动新建会话：${input.describeError(error)}`,
            'error',
          )
        }
      }),
    [
      confirmDelete,
      input.clearDraftForSession,
      input.clearInvalidCurrent,
      input.clearSessionRuntime,
      input.current,
      input.describeError,
      input.isCurrentSession,
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
