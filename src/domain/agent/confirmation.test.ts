import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../shared/execution/types'
import { transitionAgentJob, type AgentJob } from './job'
import {
  confirmationApprovalSteps,
  confirmationRequiresExplicitApproval,
  confirmationRunsGeneration,
  confirmationSettlementMessages,
} from './confirmation'

function job(): AgentJob {
  return {
    id: 'job-1',
    sessionId: 'session-1',
    projectId: 'project-1',
    turnId: 'turn-1',
    status: 'waiting_confirmation',
    revision: 4,
    createdAt: 10,
    updatedAt: 20,
  }
}

const request = { callId: 'call-1', name: 'runNode', args: { nodeIds: ['n1'] } }

describe('Agent 确认卡', () => {
  it('批准写操作先回 planning，再进入 waiting_generation', () => {
    const steps = confirmationApprovalSteps(request)
    const planned = transitionAgentJob(job(), steps[0]!.to, 30, steps[0]!.patch)
    const waiting = transitionAgentJob(
      planned,
      steps[1]!.to,
      40,
      steps[1]!.patch,
    )

    expect(steps.map((step) => [step.to, step.eventType])).toEqual([
      ['planning', 'confirmation_resolved'],
      ['waiting_generation', 'generation_started'],
    ])
    expect(waiting).toMatchObject({
      status: 'waiting_generation',
      pendingCallId: 'call-1',
      revision: 6,
    })
  })

  it('记忆确认只回到 planning，不进入生成状态', () => {
    expect(
      confirmationApprovalSteps({ ...request, name: 'rememberMemory' }),
    ).toEqual([
      {
        to: 'planning',
        eventType: 'confirmation_resolved',
        patch: { pendingCallId: undefined },
      },
    ])
  })

  it('任务计划与中途确认只推进规划，且自动模式也必须让用户亲自确认', () => {
    for (const name of ['proposeTaskPlan', 'requestTaskConfirmation']) {
      expect(confirmationRunsGeneration(name)).toBe(false)
      expect(confirmationApprovalSteps({ ...request, name })).toHaveLength(1)
    }
    expect(confirmationRequiresExplicitApproval('proposeTaskPlan')).toBe(true)
    expect(
      confirmationRequiresExplicitApproval('proposeTaskPlan', undefined, {
        autoRun: true,
      }),
    ).toBe(true)
    expect(
      confirmationRequiresExplicitApproval('requestTaskConfirmation', {
        purpose: 'clarification',
      }),
    ).toBe(true)
    expect(
      confirmationRequiresExplicitApproval('requestTaskConfirmation', {
        purpose: 'review',
      }),
    ).toBe(false)
    expect(confirmationRunsGeneration('runNode')).toBe(true)
    expect(confirmationRequiresExplicitApproval('runNode')).toBe(false)
  })

  it('危险画布操作与记忆确认不进入生成状态，且自动模式必须人工批准', () => {
    for (const name of ['updateNode', 'deleteNodes', 'deleteEdges', 'rememberMemory']) {
      expect(confirmationRunsGeneration(name)).toBe(false)
      expect(confirmationApprovalSteps({ ...request, name })).toHaveLength(1)
      expect(confirmationRequiresExplicitApproval(name)).toBe(true)
      expect(
        confirmationRequiresExplicitApproval(name, undefined, { autoRun: true }),
      ).toBe(true)
    }
    expect(confirmationRequiresExplicitApproval('runNode')).toBe(false)
    expect(confirmationRequiresExplicitApproval('runFrom')).toBe(false)
  })

  it('取消只补齐配对的工具结果，不产生下一次模型回复', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: '换一个风格' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call-1', name: 'runNode', args: '{"nodeIds":["n1"]}' }],
      },
    ]
    const settled = confirmationSettlementMessages(messages, request, 'canceled')

    expect(settled).toHaveLength(3)
    expect(settled[2]).toMatchObject({
      role: 'tool',
      toolCallId: 'call-1',
      toolName: 'runNode',
    })
    expect(JSON.parse(settled[2]!.content)).toMatchObject({
      ok: false,
      canceled: true,
    })
    expect(settled.at(-1)?.role).toBe('tool')
  })

  it('★★ 多工具批次被取消时，当前调用记 canceled，后续调用按顺序记未开始', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: '运行并删除旧图' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'read-1', name: 'readGraph', args: '{}' },
          { id: 'call-1', name: 'runNode', args: '{"nodeIds":["n1"]}' },
          { id: 'later-1', name: 'deleteNodes', args: '{"nodeIds":["n2"]}' },
        ],
      },
      {
        role: 'tool',
        toolCallId: 'read-1',
        toolName: 'readGraph',
        content: '{"ok":true}',
      },
    ]

    const settled = confirmationSettlementMessages(messages, request, 'canceled')
    expect(
      settled
        .filter((message) => message.role === 'tool')
        .map((message) => message.toolCallId),
    ).toEqual(['read-1', 'call-1', 'later-1'])
    expect(JSON.parse(settled.at(-1)!.content)).toMatchObject({
      canceled: true,
      notStarted: true,
    })
  })

  it('同一调用已有结果时不会补第二条', () => {
    const messages: ChatMessage[] = [
      {
        role: 'tool',
        toolCallId: 'call-1',
        toolName: 'runNode',
        content: '{"ok":true}',
      },
    ]
    expect(
      confirmationSettlementMessages(messages, request, 'interrupted'),
    ).toEqual(messages)
  })

  it('★★ 迟到结果插回对应工具批次，不落到后续用户消息之后', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: '旧任务' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'call-1', name: 'deleteNodes', args: '{"nodeIds":["n1"]}' },
        ],
      },
      { role: 'user', content: '新任务' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'call-2', name: 'runNode', args: '{"nodeIds":["n2"]}' },
        ],
      },
    ]

    const settled = confirmationSettlementMessages(
      messages,
      { callId: 'call-1', name: 'deleteNodes' },
      'interrupted',
    )

    expect(settled.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'user',
      'assistant',
    ])
    expect(settled[2]).toMatchObject({
      role: 'tool',
      toolCallId: 'call-1',
    })
    expect(settled[3]).toEqual({ role: 'user', content: '新任务' })
  })
})
