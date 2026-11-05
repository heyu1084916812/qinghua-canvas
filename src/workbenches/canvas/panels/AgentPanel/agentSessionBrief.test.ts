import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '../../../../domain/shared/execution/types'
import {
  resolveContinuationMessages,
  sessionBriefForContinuation,
} from './agentSessionBrief'

function plan() {
  return {
    id: 'plan-1',
    title: '云岚茶品牌全案',
    summary: '宋韵、青瓷主色、12 页作品集',
    steps: [
      { id: 'step-1', title: '建立视觉规范', status: 'done' as const },
      { id: 'step-2', title: '生成主视觉', status: 'in_progress' as const },
      { id: 'step-3', title: '生成详情页', status: 'pending' as const },
    ],
    currentStepId: 'step-2',
    createdAt: 1,
    updatedAt: 2,
  }
}

const persisted: ChatMessage[] = [
  {
    role: 'user',
    content: '请继续做「云岚茶」全案，保留宋韵和青瓷主色',
    display: '请继续做「云岚茶」全案',
  },
  { role: 'assistant', content: '', toolCalls: [{ id: 'call-1', name: 'readGraph', args: '{}' }] },
  { role: 'tool', content: '{"ok":true,"nodes":4}', toolCallId: 'call-1', toolName: 'readGraph' },
  { role: 'assistant', content: '已读完画布' },
]

describe('agentSessionBrief', () => {
  it('轻量档检查点只由原始需求、taskPlan 与最近工具账本构成结构化复原', () => {
    const brief = sessionBriefForContinuation({
      messages: persisted,
      taskPlan: plan(),
      graphSummary: { nodes: 4, edges: 3, generated: 1 },
      runRecord: { status: 'failed', reason: 'HTTP 502' },
      promptProfile: 'light',
    })
    expect(brief).toContain('云岚茶')
    expect(brief).toContain('宋韵')
    expect(brief).toContain('生成主视觉｜in_progress')
    expect(brief).toContain('readGraph')
    expect(brief).toContain('failed')
    expect(brief).toContain('HTTP 502')
    expect(brief).toContain('4 个节点')
    expect(brief).not.toContain('生成成功')
    expect(brief).not.toContain('已生成完成')
  })

  it('full 档不重复注入 sessionBrief', () => {
    expect(sessionBriefForContinuation({
      messages: persisted,
      promptProfile: 'full',
    })).toBeUndefined()
  })

  it('续跑优先用目标会话持久消息；本地为空或疑似串会话时恢复，不重放付费请求', async () => {
    const sessions = {
      messagesFor: vi.fn(async () => persisted),
    }
    const crossSession: ChatMessage[] = [{ role: 'user', content: '另一个会话的需求' }]
    for (const local of [[], crossSession]) {
      const resolved = await resolveContinuationMessages({
        sessionId: 'session-a',
        localMessages: local,
        localRevision: local.length === 0 ? 8 : 9,
        sessionRevision: 8,
        sessions,
        graphSummary: { nodes: 4, edges: 3, generated: 1 },
        runRecord: { status: 'failed', reason: 'HTTP 502' },
        taskPlan: plan(),
        promptProfile: 'light',
      })
      expect(resolved.source).toBe('persisted')
      expect(resolved.messages[0]?.role).toBe('system')
      expect(resolved.messages[0]?.content).toContain('云岚茶')
      expect(resolved.messages.slice(1)).toEqual(persisted)
      expect(resolved.messages.filter((m) => m.role === 'tool')).toHaveLength(1)
      expect(resolved.messages.filter((m) => m.role === 'system')).toHaveLength(1)
      expect(sessions.messagesFor).toHaveBeenCalledWith('session-a')
    }
  })

  it('本地长度/revision 与持久历史一致时不改写原消息数组', async () => {
    const local = [...persisted]
    const resolved = await resolveContinuationMessages({
      sessionId: 'session-a',
      localMessages: local,
      localRevision: 8,
      sessionRevision: 8,
      sessions: { messagesFor: vi.fn(async () => persisted) },
    })
    expect(resolved.source).toBe('local')
    expect(resolved.messages).toBe(local)
  })

  it('切换会话时只按目标 id 读史，不能把当前界面的另一会话消息带进续跑', async () => {
    const messagesFor = vi.fn(async (id: string): Promise<ChatMessage[]> =>
      id === 'session-a' ? persisted : [{ role: 'user', content: 'B 的私密需求' }],
    )
    const resolved = await resolveContinuationMessages({
      sessionId: 'session-a',
      localMessages: [{ role: 'user', content: 'B 的私密需求' }],
      localRevision: 9,
      sessionRevision: 8,
      sessions: { messagesFor },
      promptProfile: 'full',
    })
    expect(messagesFor).toHaveBeenCalledWith('session-a')
    expect(JSON.stringify(resolved.messages)).not.toContain('B 的私密需求')
    expect(resolved.messages.slice(-1)).toEqual(persisted.slice(-1))
  })

  it('持久层失败时保守使用本地非空历史，不伪造恢复成功', async () => {
    const resolved = await resolveContinuationMessages({
      sessionId: 'session-a',
      localMessages: persisted,
      localRevision: 8,
      sessionRevision: 8,
      sessions: { messagesFor: vi.fn(async () => { throw new Error('storage offline') }) },
    })
    expect(resolved.source).toBe('local')
    expect(resolved.messages).toEqual(persisted)
  })
})
