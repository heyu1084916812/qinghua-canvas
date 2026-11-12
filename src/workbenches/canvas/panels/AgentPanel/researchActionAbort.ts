export const RESEARCH_IMAGE_SAVE_TIMEOUT_MS = 12_000

export interface ResearchActionSignal {
  signal: AbortSignal
  timedOut: () => boolean
  /** 动作结束（成功或失败）后必须调用：清掉总时限定时器和挂在 parent 上的监听（B6）。 */
  dispose: () => void
}

export function researchActionSignal(parent?: AbortSignal): ResearchActionSignal {
  const controller = new AbortController()
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const dispose = () => {
    clearTimeout(timer)
    parent?.removeEventListener('abort', abort)
  }
  const abort = () => (controller.abort(parent?.reason), dispose())
  if (parent?.aborted) return { signal: (abort(), controller.signal), timedOut: () => false, dispose }
  parent?.addEventListener('abort', abort, { once: true })
  timer = setTimeout(() => {
    timedOut = true
    controller.abort()
    dispose()
  }, RESEARCH_IMAGE_SAVE_TIMEOUT_MS)
  return { signal: controller.signal, timedOut: () => timedOut, dispose }
}

export function raceWithResearchAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    if (signal.aborted) return abort()
    signal.addEventListener('abort', abort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort)
        reject(error)
      },
    )
  })
}

export function researchActionFailure(
  result: ResearchActionSignal,
  parent: AbortSignal | undefined,
  error: unknown,
  prefix: string,
): string {
  if (result.timedOut()) return `${prefix}：操作超时，请稍后重试`
  if (parent?.aborted) return `${prefix}：已取消`
  return error instanceof Error && error.message ? `${prefix}：${error.message}` : prefix
}

/** 调研动作外壳：总时限 + 取消、成功 / 失败提示（取消后不提示），结束时释放定时器与监听。 */
export async function runResearchAction<T extends { ok: boolean; message: string }>(
  parent: AbortSignal | undefined,
  failurePrefix: string,
  notify: (message: string, tone: 'info' | 'error') => void,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T | { ok: false; message: string }> {
  const action = researchActionSignal(parent)
  try {
    const result = await run(action.signal)
    if (!parent?.aborted) notify(result.message, result.ok ? 'info' : 'error')
    return result
  } catch (error) {
    const message = researchActionFailure(action, parent, error, failurePrefix)
    if (!parent?.aborted) notify(message, 'error')
    return { ok: false, message }
  } finally {
    action.dispose()
  }
}
