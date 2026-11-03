export const DEFAULT_TASK_SHUTDOWN_TIMEOUT_MS = 5_000

export class TaskLifecycleClosedError extends Error {
  constructor() {
    super('任务生命周期已关闭，不再接受新工作')
    this.name = 'TaskLifecycleClosedError'
  }
}

export class TaskLifecycleTimeoutError extends Error {
  readonly pending: number
  readonly timeoutMs: number

  constructor(pending: number, timeoutMs: number) {
    super(`等待在途任务结束超时（${pending} 个，${timeoutMs}ms）`)
    this.name = 'TaskLifecycleTimeoutError'
    this.pending = pending
    this.timeoutMs = timeoutMs
  }
}

export interface TaskLifecycle {
  readonly closing: boolean
  assertOpen(): void
  track<T>(work: () => Promise<T>): Promise<T>
  beginClose(): void
  waitForIdle(timeoutMs?: number): Promise<void>
}

/**
 * 关闭一次项目运行时要等完整 Promise，而不只是 abort controller。
 *
 * abort 只负责发出取消信号；取消后的结算、flush 与记录写入仍可能继续。
 * 关闭标记必须先于 abort 设置，之后任何新入口都同步失败。
 */
export function createTaskLifecycle(): TaskLifecycle {
  const inFlight = new Set<Promise<unknown>>()
  let closing = false

  const assertOpen = () => {
    if (closing) throw new TaskLifecycleClosedError()
  }

  return {
    get closing() {
      return closing
    },
    assertOpen,
    track<T>(work: () => Promise<T>): Promise<T> {
      try {
        assertOpen()
      } catch (error) {
        return Promise.reject(error)
      }
      let tracked: Promise<T>
      try {
        tracked = work()
      } catch (error) {
        return Promise.reject(error)
      }
      inFlight.add(tracked)
      const remove = () => {
        inFlight.delete(tracked)
      }
      void tracked.then(remove, remove)
      return tracked
    },
    beginClose() {
      closing = true
    },
    async waitForIdle(timeoutMs = DEFAULT_TASK_SHUTDOWN_TIMEOUT_MS) {
      if (inFlight.size === 0) return
      const pending = [...inFlight]
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new TaskLifecycleTimeoutError(inFlight.size, timeoutMs))
        }, timeoutMs)
      })
      try {
        await Promise.race([
          Promise.allSettled(pending),
          timeout,
        ])
      } finally {
        if (timer !== undefined) clearTimeout(timer)
      }
      if (inFlight.size > 0) {
        throw new TaskLifecycleTimeoutError(inFlight.size, timeoutMs)
      }
    },
  }
}
