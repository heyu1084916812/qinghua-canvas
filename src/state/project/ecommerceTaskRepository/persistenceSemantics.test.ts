import { describe, expect, it, vi } from 'vitest'
import { createCanvasStore } from '../../workbenches/canvas/store'
import { registerAllSpecs, resetSpecs } from '../../../domain/canvas/nodeSpecs'
import { createMemoryPlatform } from '../../../platform/memory'

describe('电商任务仓储 · 外部持久化顺序基线', () => {
  it('800ms 防抖窗口内连续命令合并，flush 后最终写胜出且不会复活旧删除', async () => {
    vi.useFakeTimers()
    resetSpecs()
    registerAllSpecs()
    const platform = createMemoryPlatform()
    const store = createCanvasStore({ platform, projectId: 'p1' })
    try {
      const created = store.dispatch({
        kind: 'node.create',
        projectId: 'p1',
        type: 'prompt',
        at: { x: 0, y: 0 },
      })
      expect(created.persist.tables).toContain('nodes')
      const id = store.getSnapshot().nodes[0]!.id
      await vi.advanceTimersByTimeAsync(799)
      expect(await platform.storage.query('nodes', { id })).toHaveLength(0)

      store.dispatch({ kind: 'node.move', ids: [id], dx: 7, dy: 0, phase: 'move' })
      store.dispatch({ kind: 'node.delete', ids: [id] })
      store.undo()
      await store.flush()
      expect(await platform.storage.query('nodes', { id })).toHaveLength(1)

      store.dispatch({ kind: 'node.delete', ids: [id] })
      await vi.advanceTimersByTimeAsync(800)
      expect(await platform.storage.query('nodes', { id })).toHaveLength(0)
    } finally {
      vi.useRealTimers()
      resetSpecs()
    }
  })
})
