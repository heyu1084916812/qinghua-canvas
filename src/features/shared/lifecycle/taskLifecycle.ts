export const DEFAULT_TASK_SHUTDOWN_TIMEOUT_MS = 5_000

export type TaskLifecycleState = 'open' | 'draining' | 'closed'

export interface TaskLifecycleCloseAttempt {
  readonly id: number
}

export interface TaskShutdownControl {
  waitForIdle(): Promise<void>
  whenIdle(): Promise<void>
  canReopen(): boolean
  reopenIfIdle(): boolean
  canFinalize(): boolean
  finalize(): boolean
}

export function combineTaskShutdownControls(
  controls: readonly (TaskShutdownControl | null | undefined)[],
): TaskShutdownControl {
  const active = controls.filter(
    (control): control is TaskShutdownControl => !!control,
  )
  return {
    async waitForIdle() {
      await Promise.all(active.map((control) => control.waitForIdle()))
    },
    async whenIdle() {
      await Promise.all(active.map((control) => control.whenIdle()))
    },
    canReopen: () => active.every((control) => control.canReopen()),
    reopenIfIdle() {
      if (!active.every((control) => control.canReopen())) return false
      return active.every((control) => control.reopenIfIdle())
    },
    canFinalize: () => active.every((control) => control.canFinalize()),
    finalize() {
      if (!active.every((control) => control.canFinalize())) return false
      return active.every((control) => control.finalize())
    },
  }
}

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
  readonly state: TaskLifecycleState
  readonly closing: boolean
  assertOpen(): void
  runSync<T>(work: () => T): T
  track<T>(work: () => Promise<T>): Promise<T>
  beginClose(): TaskLifecycleCloseAttempt
  waitForIdle(timeoutMs?: number): Promise<void>
  whenIdle(): Promise<void>
  canReopen(attempt: TaskLifecycleCloseAttempt): boolean
  reopenIfIdle(attempt: TaskLifecycleCloseAttempt): boolean
  reopenWhenIdle(attempt: TaskLifecycleCloseAttempt): Promise<boolean>
  canFinalize(attempt: TaskLifecycleCloseAttempt): boolean
  finalizeClose(attempt: TaskLifecycleCloseAttempt): boolean
}

/**
 * 关闭一次项目运行时要等完整 Promise，而不只是 abort controller。
 *
 * abort 只负责发出取消信号；取消后的结算、flush 与记录写入仍可能继续。
 * 关闭标记必须先于 abort 设置，之后任何新入口都同步失败。
 */
export function createTaskLifecycle(): TaskLifecycle {
  const inFlight = new Set<Promise<unknown>>()
  let state: TaskLifecycleState = 'open'
  let currentAttempt: TaskLifecycleCloseAttempt | null = null
  let nextAttemptId = 1

  const assertOpen = () => {
    if (state !== 'open') throw new TaskLifecycleClosedError()
  }
  const whenIdle = async () => {
    while (inFlight.size > 0) {
      await Promise.allSettled([...inFlight])
    }
  }
  const matchesIdleAttempt = (attempt: TaskLifecycleCloseAttempt) =>
    state === 'draining' &&
    currentAttempt?.id === attempt.id &&
    inFlight.size === 0
  const reopenIfIdle = (attempt: TaskLifecycleCloseAttempt) => {
    if (!matchesIdleAttempt(attempt)) return false
    state = 'open'
    currentAttempt = null
    return true
  }
  const finalizeClose = (attempt: TaskLifecycleCloseAttempt) => {
    if (!matchesIdleAttempt(attempt)) return false
    state = 'closed'
    currentAttempt = null
    return true
  }

  return {
    get state() {
      return state
    },
    get closing() {
      return state !== 'open'
    },
    assertOpen,
    runSync<T>(work: () => T): T {
      assertOpen()
      return work()
    },
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
      if (state === 'closed') throw new TaskLifecycleClosedError()
      state = 'draining'
      currentAttempt = { id: nextAttemptId++ }
      return currentAttempt
    },
    async waitForIdle(timeoutMs = DEFAULT_TASK_SHUTDOWN_TIMEOUT_MS) {
      if (inFlight.size === 0) return
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new TaskLifecycleTimeoutError(inFlight.size, timeoutMs))
        }, timeoutMs)
      })
      try {
        await Promise.race([
          whenIdle(),
          timeout,
        ])
      } finally {
        if (timer !== undefined) clearTimeout(timer)
      }
      if (inFlight.size > 0) {
        throw new TaskLifecycleTimeoutError(inFlight.size, timeoutMs)
      }
    },
    whenIdle,
    canReopen: matchesIdleAttempt,
    reopenIfIdle,
    async reopenWhenIdle(attempt) {
      await whenIdle()
      return reopenIfIdle(attempt)
    },
    canFinalize: matchesIdleAttempt,
    finalizeClose,
  }
}
