import { useEffect, type MutableRefObject } from 'react'
import type { ChatMessage } from '../../../../domain/shared/execution/types'
import type { Channel } from '../../../../domain/project/channel'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import {
  TaskLifecycleClosedError,
  type TaskLifecycle,
} from '../../../../features/shared/lifecycle/taskLifecycle'
import { errText } from '../../agent/agentLoop'
import { runAgentInitialLoad } from './agentInitialLoad'
import type { AgentSessionRefreshResult } from './useAgentSessionLifecycle'

export interface AgentInitialLoadControllerInput {
  projectId: string
  trackRun: TaskLifecycle['track']
  /**
   * 渠道单例的幂等 load。
   *
   * 新建画布页可能**先于**应用级 load 就读 `enabledChannels`：那一刻列表是空的，
   * 建出来的会话会带空渠道，用户第一句话就报「还没选模型」。这里补一次 await 把缝上。
   */
  loadChannels: () => Promise<unknown>
  /**
   * 建会话那一刻的**实时**渠道快照。
   *
   * 必须现取（`channels.getState().channels`），不能用渲染闭包里的 `enabled`：
   * 闭包是上一次渲染的，跨画布页时可能是空数组。
   */
  liveChannels: () => readonly Channel[]
  currentIdRef: MutableRefObject<string | null>
  selectionVersionRef: MutableRefObject<number>
  refresh: () => Promise<AgentSessionRefreshResult>
  presets: {
    loadAgentReviewModel: () => Promise<string | null>
    loadAgentCanvasReview: () => Promise<boolean>
    loadAgentDefault: () => Promise<{ model?: string } | null>
  }
  setReviewModel: (model: string) => void
  setCanvasReview: (enabled: boolean) => void
  getSession: (sessionId: string) => Promise<AgentSession | null>
  createSession: (input: {
    projectId: string
    channelId: string
    model: string
    imageModel: string
    videoModel: string
  }) => Promise<AgentSession>
  fallbackModelOptions: (channels: readonly Channel[]) => {
    image: string[]
    video: string[]
    chat: string[]
  }
  logicalModelOf: (model: string, channels?: readonly Channel[]) => string
  defaultModelFor: (
    options: readonly string[],
    preferred?: string,
    channels?: readonly Channel[],
  ) => string
  removeSession: (sessionId: string) => Promise<void>
  setList: (sessions: AgentSession[]) => void
  setCurrent: (session: AgentSession) => void
  setMessages: (messages: ChatMessage[]) => void
  notify: (message: string, tone?: 'info' | 'error') => void
  logWarning: (message: string, detail: Record<string, unknown>) => void
  /** 孤儿清理重试间隔（测试注入立即返回的实现，避免真等）。 */
  wait?: (ms: number) => Promise<void>
}

/**
 * 面板启动时的会话恢复。
 *
 * 只有一条硬约束：**项目变了才重跑**。把 `refresh` / `sessions` 之类的端口列进依赖，
 * 会让它在每次保存后重跑，把正在进行的对话打断。
 */
export function useAgentInitialLoadController(
  input: AgentInitialLoadControllerInput,
): void {
  useEffect(() => {
    let alive = true
    void input
      .trackRun(async () => {
        const versionBeforeLoad = input.selectionVersionRef.current
        await input.loadChannels()
        /**
         * load 之后必须**重新**检查三重守卫：等待期间用户可能已经接手、
         * 或者面板已经卸载 —— 任何一条成立都不许再往下建会话。
         */
        if (
          !alive ||
          input.currentIdRef.current !== null ||
          input.selectionVersionRef.current !== versionBeforeLoad
        ) {
          return
        }
        await runAgentInitialLoad({
          isAlive: () => alive,
          currentIdRef: input.currentIdRef,
          selectionVersionRef: input.selectionVersionRef,
          refresh: input.refresh,
          /** 读偏好失败不能拦住启动：两条各自兜底成「没有偏好 / 默认关闭」。 */
          loadReviewModel: () => input.presets.loadAgentReviewModel().catch(() => null),
          loadCanvasReview: () => input.presets.loadAgentCanvasReview().catch(() => false),
          setReviewModel: input.setReviewModel,
          setCanvasReview: input.setCanvasReview,
          getSession: input.getSession,
          createSession: async (canCommit) => {
            const liveChannels = input.liveChannels()
            const liveOptions = input.fallbackModelOptions(liveChannels)
            const saved = await input.presets.loadAgentDefault()
            if (!canCommit()) return null
            const savedModel = input.logicalModelOf(
              saved?.model ?? '',
              liveChannels,
            )
            return input.createSession({
              projectId: input.projectId,
              channelId: '',
              model: input.defaultModelFor(liveOptions.chat, savedModel, liveChannels),
              imageModel: liveOptions.image[0] ?? '',
              videoModel: liveOptions.video[0] ?? '',
            })
          },
          removeSession: input.removeSession,
          setList: input.setList,
          setCurrent: input.setCurrent,
          setMessages: input.setMessages,
          /** 孤儿会话清理失败：提示一次（模块里已做有界重试），并记一条带 sessionId 的日志。 */
          notifyCleanupFailure: (message) => input.notify(message, 'error'),
          logCleanupFailure: ({ sessionId, attempts, error }) =>
            input.logWarning('[agent] initial session cleanup failed', {
              sessionId,
              attempts,
              error: errText(error),
            }),
          wait: input.wait,
        })
      })
      .catch((error) => {
        if (alive && !(error instanceof TaskLifecycleClosedError)) {
          input.notify(`Agent 会话读取失败：${errText(error)}`, 'error')
        }
      })
    return () => {
      alive = false
    }
    // 依赖只列 projectId / trackRun：见上面的注释，多列会把对话打断
  }, [input.projectId, input.trackRun])
}
