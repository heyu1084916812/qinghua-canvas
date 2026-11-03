import { describe, expect, it, vi } from 'vitest'
import { retryAgentMessageMigration } from './agentMessageMigration'

describe('retryAgentMessageMigration', () => {
  it('共享库短暂未就绪时重试后成功', async () => {
    const migrate = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(undefined)
    const sleep = vi.fn(async () => undefined)

    await expect(
      retryAgentMessageMigration(migrate, { sleep }),
    ).resolves.toBeUndefined()

    expect(migrate).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls).toEqual([[250], [500]])
  })

  it('连续失败仍有上限并保留最后一次错误', async () => {
    const finalError = new Error('storage still unavailable')
    const migrate = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('first'))
      .mockRejectedValueOnce(new Error('second'))
      .mockRejectedValueOnce(finalError)
    const sleep = vi.fn(async () => undefined)

    await expect(
      retryAgentMessageMigration(migrate, { sleep }),
    ).rejects.toBe(finalError)
    expect(migrate).toHaveBeenCalledTimes(3)
  })
})
