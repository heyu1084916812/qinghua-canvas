import {
  TaskLifecycleTimeoutError,
  type TaskLifecycle,
  type TaskShutdownControl,
} from '../../../../features/shared/lifecycle/taskLifecycle'

export interface AgentPanelShutdownOptions {
  lifecycle: TaskLifecycle
  flush: () => Promise<void>
  timeoutMs: number
  onFinalize?: () => void
}

function waitWithTimeout(
  barrier: Promise<void>,
  timeoutMs: number,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new TaskLifecycleTimeoutError(1, timeoutMs))
    }, timeoutMs)
  })
  return Promise.race([barrier, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}

/**
 * AgentPanel 的关闭屏障同时包含在途 Promise 与最终 flush。
 *
 * timeout 只结束本次等待，不会取消 flush；因此 flush 尚未落地时不能
 * reopen / finalize，项目级锁也必须继续持有到屏障真正结算。
 */
export function createAgentPanelShutdownControl({
  lifecycle,
  flush,
  timeoutMs,
  onFinalize,
}: AgentPanelShutdownOptions): TaskShutdownControl {
  const attempt = lifecycle.beginClose()
  let barrierSettled = false
  const barrier = (async () => {
    try {
      await lifecycle.whenIdle()
      await flush()
    } finally {
      barrierSettled = true
    }
  })()
  void barrier.catch(() => undefined)

  return {
    waitForIdle: () => waitWithTimeout(barrier, timeoutMs),
    whenIdle: () => barrier,
    canReopen: () =>
      barrierSettled && lifecycle.canReopen(attempt),
    reopenIfIdle: () =>
      barrierSettled && lifecycle.reopenIfIdle(attempt),
    canFinalize: () =>
      barrierSettled && lifecycle.canFinalize(attempt),
    finalize() {
      if (!barrierSettled || !lifecycle.finalizeClose(attempt)) {
        return false
      }
      onFinalize?.()
      return true
    },
  }
}
