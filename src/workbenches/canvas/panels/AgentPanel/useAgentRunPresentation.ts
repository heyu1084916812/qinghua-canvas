import { useCallback, useState } from 'react'
import type { AgentLoopActivity } from '../../agent/agentLoop'
import {
  IDLE_STATUS,
  type AgentPanelStatus,
} from './AgentActivityViews'
import type { AgentRunTask } from './agentRunTasks'

export function mergeAgentActivityHistory(
  current: readonly AgentLoopActivity[],
  activity: AgentLoopActivity,
): AgentLoopActivity[] {
  const retained =
    activity.phase === 'thinking'
      ? current.filter((item) => item.phase !== 'thinking')
      : current.filter((item) => item.id !== activity.id)
  return [...retained, activity].slice(-8)
}

/**
 * Agent 的可视运行态，全部按 sessionId 分桶。
 *
 * 这个 hook 不拥有任务真相，只保存“当前应该显示什么”；Job、消息和工具结果
 * 仍由 AgentController / session store 负责。
 */
export function useAgentRunPresentation() {
  const [statusBySession, setStatusBySession] = useState<
    Record<string, AgentPanelStatus>
  >({})
  const [runTasksBySession, setRunTasksBySession] = useState<
    Record<string, AgentRunTask[]>
  >({})
  const [liveActivitiesBySession, setLiveActivitiesBySession] = useState<
    Record<string, AgentLoopActivity[]>
  >({})
  const [liveProcessBySession, setLiveProcessBySession] = useState<
    Record<string, string>
  >({})

  const setStatusFor = useCallback(
    (sessionId: string, next: AgentPanelStatus) => {
      setStatusBySession((previous) => ({
        ...previous,
        [sessionId]: next,
      }))
    },
    [],
  )

  const setRunTasksFor = useCallback(
    (
      sessionId: string,
      update:
        | AgentRunTask[]
        | ((current: AgentRunTask[]) => AgentRunTask[]),
    ) => {
      setRunTasksBySession((previous) => {
        const current = previous[sessionId] ?? []
        const next = typeof update === 'function' ? update(current) : update
        return { ...previous, [sessionId]: next }
      })
    },
    [],
  )

  const clearRunTasksFor = useCallback((sessionId: string) => {
    setRunTasksBySession((previous) => {
      if (!(sessionId in previous)) return previous
      const next = { ...previous }
      delete next[sessionId]
      return next
    })
  }, [])

  const setLiveActivityFor = useCallback(
    (sessionId: string, activity: AgentLoopActivity) => {
      setLiveActivitiesBySession((previous) => {
        const current = previous[sessionId] ?? []
        return {
          ...previous,
          [sessionId]: mergeAgentActivityHistory(current, activity),
        }
      })
    },
    [],
  )

  const clearLiveActivitiesFor = useCallback((sessionId: string) => {
    setLiveActivitiesBySession((previous) => {
      if (!(sessionId in previous)) return previous
      const next = { ...previous }
      delete next[sessionId]
      return next
    })
  }, [])

  const appendLiveProcessFor = useCallback(
    (sessionId: string, delta: string) => {
      if (!delta) return
      setLiveProcessBySession((previous) => ({
        ...previous,
        [sessionId]: `${previous[sessionId] ?? ''}${delta}`,
      }))
    },
    [],
  )

  const clearLiveProcessFor = useCallback((sessionId: string) => {
    setLiveProcessBySession((previous) => {
      if (!(sessionId in previous)) return previous
      const next = { ...previous }
      delete next[sessionId]
      return next
    })
  }, [])

  return {
    statusFor: (sessionId: string): AgentPanelStatus =>
      statusBySession[sessionId] ?? IDLE_STATUS,
    runTasksFor: (sessionId: string): AgentRunTask[] | undefined =>
      runTasksBySession[sessionId],
    liveActivitiesFor: (sessionId: string): AgentLoopActivity[] =>
      liveActivitiesBySession[sessionId] ?? [],
    liveProcessFor: (sessionId: string): string =>
      liveProcessBySession[sessionId] ?? '',
    setStatusFor,
    setRunTasksFor,
    clearRunTasksFor,
    setLiveActivityFor,
    clearLiveActivitiesFor,
    appendLiveProcessFor,
    clearLiveProcessFor,
  }
}
