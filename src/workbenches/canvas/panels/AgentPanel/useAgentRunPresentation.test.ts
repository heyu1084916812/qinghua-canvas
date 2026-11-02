import { describe, expect, it } from 'vitest'
import type { AgentLoopActivity } from '../../agent/agentLoop'
import { mergeAgentActivityHistory } from './useAgentRunPresentation'

function activity(
  patch: Partial<AgentLoopActivity> & Pick<AgentLoopActivity, 'id' | 'phase'>,
): AgentLoopActivity {
  const { status = 'running', ...rest } = patch
  return {
    status,
    ...rest,
  }
}

describe('mergeAgentActivityHistory', () => {
  it('同一工具活动只保留最新一条并维持顺序', () => {
    const merged = mergeAgentActivityHistory(
      [
        activity({ id: 'tool-1', phase: 'tool' }),
        activity({ id: 'tool-2', phase: 'tool' }),
      ],
      activity({ id: 'tool-1', phase: 'tool', status: 'done' }),
    )

    expect(merged.map((item) => item.id)).toEqual(['tool-2', 'tool-1'])
    expect(merged[1]?.status).toBe('done')
  })

  it('思考活动只保留最新一条，工具历史不被挤掉', () => {
    const merged = mergeAgentActivityHistory(
      [
        activity({ id: 'thinking-1', phase: 'thinking' }),
        activity({ id: 'tool-1', phase: 'tool' }),
      ],
      activity({ id: 'thinking-2', phase: 'thinking' }),
    )

    expect(merged.map((item) => item.id)).toEqual(['tool-1', 'thinking-2'])
  })

  it('最多保留八条可见活动', () => {
    const current = Array.from({ length: 8 }, (_, index) =>
      activity({ id: `tool-${index}`, phase: 'tool' }),
    )
    const merged = mergeAgentActivityHistory(
      current,
      activity({ id: 'tool-8', phase: 'tool' }),
    )

    expect(merged).toHaveLength(8)
    expect(merged[0]?.id).toBe('tool-1')
    expect(merged[7]?.id).toBe('tool-8')
  })
})
