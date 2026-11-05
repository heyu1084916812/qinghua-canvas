import { useCallback, useRef } from 'react'
import {
  TaskLifecycleClosedError,
  createTaskLifecycle,
  type TaskLifecycle,
} from '../../../../features/shared/lifecycle/taskLifecycle'
import type { CanvasStore } from '../../../../state/workbenches/canvas/store'
import { errText } from '../../agent/agentLoop'

export interface AgentPanelRunLifecycle {
  lifecycle: TaskLifecycle
  trackRun: TaskLifecycle['track']
  runPromiseDetached: (
    work: Promise<unknown>,
    failureMessage: string,
  ) => void
  runTrackedDetached: (
    work: () => Promise<unknown>,
    failureMessage: string,
  ) => void
  runSync: <T>(work: () => T) => T
}

export function useAgentPanelRunLifecycle(
  store: Pick<CanvasStore, 'notify'>,
): AgentPanelRunLifecycle {
  const lifecycleRef = useRef<TaskLifecycle | null>(null)
  if (!lifecycleRef.current) {
    lifecycleRef.current = createTaskLifecycle()
  }
  const lifecycle = lifecycleRef.current
  const trackRun = useCallback<TaskLifecycle['track']>(
    (work) => lifecycle.track(work),
    [lifecycle],
  )
  const runPromiseDetached = useCallback(
    (work: Promise<unknown>, failureMessage: string) => {
      void work.catch((error) => {
        if (error instanceof TaskLifecycleClosedError) return
        store.notify(`${failureMessage}：${errText(error)}`, 'error')
      })
    },
    [store],
  )
  const runTrackedDetached = useCallback(
    (work: () => Promise<unknown>, failureMessage: string) => {
      runPromiseDetached(trackRun(work), failureMessage)
    },
    [runPromiseDetached, trackRun],
  )
  const runSync = useCallback(
    <T,>(work: () => T) => lifecycle.runSync(work),
    [lifecycle],
  )

  return {
    lifecycle,
    trackRun,
    runPromiseDetached,
    runTrackedDetached,
    runSync,
  }
}
