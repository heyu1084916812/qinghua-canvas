import {
  createRunRegistry,
  type RunRegistry,
} from './runRegistry'

/**
 * 一个项目的执行生命周期真相。
 *
 * Controller、运行中的 plan 与订阅必须比 React Provider 活得更久；否则画布
 * 路由卸载后，重新进入页面既取消不了旧任务，也看不到它仍在运行。
 */
export interface ExecutionRuntime {
  readonly controllers: RunRegistry<AbortController>
  begin(planId: string, controller: AbortController): void
  finish(planId: string): void
  cancel(planId: string): void
  getRunningPlanIds(): readonly string[]
  isRunning(): boolean
  subscribe(listener: () => void): () => void
  dispose(): void
}

export function createExecutionRuntime(): ExecutionRuntime {
  const controllers = createRunRegistry<AbortController>()
  const listeners = new Set<() => void>()
  let runningPlanIds: readonly string[] = []

  const publish = () => {
    runningPlanIds = controllers.ids()
    for (const listener of listeners) listener()
  }

  return {
    controllers,
    begin(planId, controller) {
      controllers.add(planId, controller)
      publish()
    },
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
    dispose() {
      for (const controller of controllers.ids().map((id) => controllers.get(id))) {
        controller?.abort()
      }
      for (const id of controllers.ids()) controllers.remove(id)
      publish()
      listeners.clear()
    },
  }
}
