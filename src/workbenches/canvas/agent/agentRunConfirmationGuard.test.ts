import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../../../domain/shared/execution/types'
import { turnEndRunTargets } from './agentRunConfirmationGuard'

const user = (content: string): ChatMessage => ({ role: 'user', content })

const assistantCall = (
  id: string,
  name: string,
  args: unknown,
): ChatMessage => ({
  role: 'assistant',
  content: '',
  toolCalls: [{ id, name, args: JSON.stringify(args) }],
})

const toolResult = (
  callId: string,
  toolName: string,
  value: unknown,
): ChatMessage => ({
  role: 'tool',
  toolCallId: callId,
  toolName,
  content: JSON.stringify(value),
})

const appliedGeneration = (nodeId: string): ChatMessage =>
  toolResult('plan-call', 'applyPlan', {
    ok: true,
    createdNodeIds: [nodeId],
    resolvedNodes: [{
      localId: 'gen',
      nodeId,
      type: 'generation',
      title: '海报',
      created: true,
    }],
  })

describe('turnEndRunTargets', () => {
  it('runFrom 从提示词起点执行后，不再按原始起点参数重复弹运行确认', () => {
    const messages: ChatMessage[] = [
      user('做一张海报并运行'),
      assistantCall('plan-call', 'applyPlan', {}),
      appliedGeneration('gen-a'),
      assistantCall('run-call', 'runFrom', { nodeIds: ['prompt-start'] }),
      toolResult('run-call', 'runFrom', {
        ok: true,
        outcomes: [{
          nodeId: 'gen-a',
          targetNodeIds: ['gen-a'],
          ok: true,
          status: 'succeeded',
        }],
      }),
    ]

    expect(turnEndRunTargets(messages)).toEqual([])
  })

  it('runNode 写入新承载节点时，工具结果里的 targetNodeIds 也算已执行', () => {
    const messages: ChatMessage[] = [
      user('用这张图再生成一张'),
      assistantCall('plan-call', 'applyPlan', {}),
      appliedGeneration('source-node'),
      assistantCall('run-call', 'runNode', { nodeIds: ['source-node'] }),
      toolResult('run-call', 'runNode', {
        ok: true,
        outcomes: [{
          nodeId: 'source-node',
          targetNodeIds: ['source-node', 'carrier-node'],
          ok: true,
          status: 'succeeded',
        }],
      }),
    ]

    expect(turnEndRunTargets(messages)).toEqual([])
  })
})
