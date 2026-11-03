import {
  createRunRegistry,
  type RunRegistry,
} from './runRegistry'
import {
  createTaskLifecycle,
  type TaskLifecycle,
} from '../lifecycle/taskLifecycle'

/**
 * 一个项目的执行生命周期真相。
 *
 * Controller、运行中的 plan 与订阅必须比 React Provider 活得更久；否则画布
 * 路由卸载后，重新进入页面既取消不了旧任务，也看不到它仍在运行。
 */
export interface ExecutionRuntime {
  readonly controllers: RunRegistry<AbortController>
  readonly closing: boolean
  begin(planId: string, controller: AbortController): void
  track<T>(work: () => Promise<T>): Promise<T>
  finish(planId: string): void
  cancel(planId: string): void
  getRunningPlanIds(): readonly string[]
  isRunning(): boolean
  subscribe(listener: () => void): () => void
  beginClose(): void
  waitForIdle(timeoutMs?: number): Promise<void>
  finalizeClose(): void
  dispose(timeoutMs?: number): Promise<void>
}

export function createExecutionRuntime(): ExecutionRuntime {
  const controllers = createRunRegistry<AbortController>()
  const lifecycle: TaskLifecycle = createTaskLifecycle()
  const listeners = new Set<() => void>()
  let runningPlanIds: readonly string[] = []

  const publish = () => {
    runningPlanIds = controllers.ids()
    for (const listener of listeners) listener()
  }
  const beginClose = () => {
    lifecycle.beginClose()
    for (const controller of controllers.ids().map((id) => controllers.get(id))) {
      controller?.abort()
    }
  }
  const finalizeClose = () => {
    for (const id of controllers.ids()) controllers.remove(id)
    publish()
    listeners.clear()
  }

  return {
    controllers,
    get closing() {
      return lifecycle.closing
    },
    begin(planId, controller) {
      lifecycle.assertOpen()
      controllers.add(planId, controller)
      publish()
    },
    track: lifecycle.track,
    finish(planId) {
      if (!controllers.has(planId)) return
      controllers.remove(planId)
      publish()
    },
    cancel(planId) {
      controllers.get(planId)?.abort()
    },
    getRunningPlanIds: () => runningPlanIds,
    isRunning: () => runningPlanIds.length > 0,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    beginClose,
    waitForIdle: lifecycle.waitForIdle,
    finalizeClose,
    async dispose(timeoutMs) {
      beginClose()
      await lifecycle.waitForIdle(timeoutMs)
      finalizeClose()
    },
  }
}
