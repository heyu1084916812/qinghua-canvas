export const RESEARCH_IMAGE_SAVE_TIMEOUT_MS = 12_000

export interface ResearchActionSignal {
  signal: AbortSignal
  timedOut: () => boolean
}

export function researchActionSignal(parent?: AbortSignal): ResearchActionSignal {
  const controller = new AbortController()
  let timedOut = false
  const abort = () => controller.abort(parent?.reason)
  if (parent?.aborted) abort()
  else parent?.addEventListener('abort', abort, { once: true })
  setTimeout(() => {
    timedOut = true
    controller.abort()
  }, RESEARCH_IMAGE_SAVE_TIMEOUT_MS)
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
  }
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
