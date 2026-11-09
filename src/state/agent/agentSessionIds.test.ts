import { describe, expect, it, vi } from 'vitest'
import { createMemoryPlatform } from '../../platform/memory'
import type { AgentSession } from './agentSessionTypes'
import {
  appendAgentSessionIds,
  normalizeAgentSessionIds,
} from './agentSessionIds'

const session: AgentSession = {
  id: 's1',
  projectId: 'p1',
  title: '会话',
  channelId: '',
  model: 'm1',
  queuedTurns: [],
  pendingSteers: [],
  messages: [],
  createdAt: 1,
  updatedAt: 1,
}

describe('agent session id rules', () => {
  it('归一化、trim、去重并过滤空值', () => {
    expect(normalizeAgentSessionIds([
      ' ref-1 ',
      'ref-1',
      '',
      '  ',
      3,
      'ref-2',
    ])).toEqual(['ref-1', 'ref-2'])
    expect(normalizeAgentSessionIds(null)).toEqual([])
  })

  it('在单个事务里按最新值追加，空数组仍能读回已存 id', async () => {
    const storage = createMemoryPlatform().storage
    let current = session
    const ensureSplit = vi.fn(async () => {})
    const load = vi.fn(async () => current)
    const save = vi.fn(async (_target: unknown, next: AgentSession) => {
      current = next
    })

    const first = await appendAgentSessionIds({
      storage,
      ensureSplit,
      id: 's1',
      ids: ['ref-1', 'ref-1'],
      currentIds: (row) => row.referenceIds ?? [],
      apply: (row, ids) => ({ ...row, referenceIds: ids }),
      load,
      save,
    })
    current = {
      ...current,
      referenceIds: ['ref-1', 'ref-2'],
    }
    const second = await appendAgentSessionIds({
      storage,
      ensureSplit,
      id: 's1',
      ids: [],
      currentIds: (row) => row.referenceIds ?? [],
      apply: (row, ids) => ({ ...row, referenceIds: ids }),
      load,
      save,
    })

    expect(first?.referenceIds).toEqual(['ref-1'])
    expect(second?.referenceIds).toEqual(['ref-1', 'ref-2'])
    expect(save).toHaveBeenCalledTimes(1)
  })
})
