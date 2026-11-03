const DEFAULT_ATTEMPTS = 3
const DEFAULT_DELAYS_MS = [250, 500] as const

export interface AgentMessageMigrationRetryOptions {
  attempts?: number
  delaysMs?: readonly number[]
  sleep?: (ms: number) => Promise<void>
}

/**
 * 桌面壳启动时共享存储可能稍晚就绪。迁移只做有上限的短重试，
 * 最终失败仍原样抛出，由调用方如实记录，不能把存储故障吞成成功。
 */
export async function retryAgentMessageMigration(
  migrate: () => Promise<void>,
  options: AgentMessageMigrationRetryOptions = {},
): Promise<void> {
  const attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS)
  const delays = options.delaysMs ?? DEFAULT_DELAYS_MS
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  let lastError: unknown

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await migrate()
      return
    } catch (error) {
      lastError = error
      if (attempt >= attempts - 1) break
      await sleep(delays[Math.min(attempt, delays.length - 1)] ?? 0)
    }
  }

  throw lastError
}
