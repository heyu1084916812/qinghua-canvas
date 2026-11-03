import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createTaskLifecycle,
  type TaskShutdownControl,
} from '../features/shared/lifecycle/taskLifecycle'
import { createMemoryPlatform } from '../platform/memory'
import { createAgentSessionStore } from '../state/agent/sessionStore'
import {
  ProjectRuntimeRecoveryError,
  registerProjectRuntime,
  resetProjectRuntimesForTests,
  withPreparedProjectRuntimes,
} from './ProjectRuntimeRegistry'

afterEach(() => {
  resetProjectRuntimesForTests()
})

function controlFor(
  lifecycle: ReturnType<typeof createTaskLifecycle>,
  storeFlush: () => Promise<void>,
): TaskShutdownControl {
  const attempt = lifecycle.beginClose()
  return {
    waitForIdle: async () => {
      await lifecycle.waitForIdle(5)
      await storeFlush()
    },
    whenIdle: lifecycle.whenIdle,
    canReopen: () => lifecycle.canReopen(attempt),
    reopenIfIdle: () => lifecycle.reopenIfIdle(attempt),
    canFinalize: () => lifecycle.canFinalize(attempt),
    finalize: () => lifecycle.finalizeClose(attempt),
  }
}

describe('ProjectRuntimeRegistry real SessionStore shutdown', () => {
  it('延迟会话写入未结束时删除失败，释放并恢复后才允许 purge', async () => {
    const platform = createMemoryPlatform()
    await platform.storage.open()
    const sessions = createAgentSessionStore(platform.storage)
    const session = await sessions.create({
      projectId: 'p1',
      channelId: 'channel',
      model: 'model',
    })
    const lifecycle = createTaskLifecycle()
    let releaseWrite!: () => void
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    const originalPut = platform.storage.put.bind(platform.storage)
    vi.spyOn(platform.storage, 'put').mockImplementation(
      async (table, row) => {
        if (
          table === 'agentSessions' &&
          row.id === session.id &&
          row.title === 'late write'
        ) {
          await writeGate
        }
        return originalPut(table, row)
      },
    )
    registerProjectRuntime({
      projectId: 'p1',
      key: 'canvas-agent',
      beginDispose: () =>
        controlFor(lifecycle, async () => undefined),
    })

    const write = lifecycle.track(() =>
      sessions.updateFields(session.id, { title: 'late write' }),
    )
    const purge = vi.fn(() => sessions.remove(session.id))
    await expect(
      withPreparedProjectRuntimes(['p1'], purge),
    ).rejects.toBeInstanceOf(ProjectRuntimeRecoveryError)
    expect(purge).not.toHaveBeenCalled()
    expect((await sessions.get(session.id))?.title).not.toBe('late write')

    releaseWrite()
    await write
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(lifecycle.state).toBe('open')
    expect((await sessions.get(session.id))?.title).toBe('late write')

    await withPreparedProjectRuntimes(
      ['p1'],
      () => sessions.remove(session.id),
    )
    expect(await sessions.get(session.id)).toBeNull()
  })

  it('idle 后 flush 失败不执行仓储删除，恢复后仍可再次写入', async () => {
    const platform = createMemoryPlatform()
    await platform.storage.open()
    const sessions = createAgentSessionStore(platform.storage)
    const session = await sessions.create({
      projectId: 'p1',
      channelId: 'channel',
      model: 'model',
    })
    const lifecycle = createTaskLifecycle()
    let flushAttempts = 0
    registerProjectRuntime({
      projectId: 'p1',
      key: 'canvas-agent',
      beginDispose: () =>
        controlFor(lifecycle, async () => {
          flushAttempts += 1
          if (flushAttempts === 1) throw new Error('flush failed')
        }),
    })
    const remove = vi.fn(() => sessions.remove(session.id))

    await expect(
      withPreparedProjectRuntimes(['p1'], remove),
    ).rejects.toThrow('flush failed')
    expect(remove).not.toHaveBeenCalled()
    expect(lifecycle.state).toBe('open')

    await expect(
      lifecycle.track(() =>
        sessions.updateFields(session.id, { title: 'after recover' }),
      ),
    ).resolves.toMatchObject({ title: 'after recover' })

    await withPreparedProjectRuntimes(['p1'], remove)
    expect(remove).toHaveBeenCalledOnce()
    expect(await sessions.get(session.id)).toBeNull()
  })
})
