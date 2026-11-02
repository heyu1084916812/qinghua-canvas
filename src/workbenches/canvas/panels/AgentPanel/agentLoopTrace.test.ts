import { describe, expect, it } from 'vitest'
import type { TextRunRequest } from '../../../../platform/channels/types'
import {
  agentLoopTrace,
  promoteAgentChatRouteCandidate,
} from './agentLoopTrace'
import type { AgentChatRoute } from './agentChatRoute'

const request: TextRunRequest = {
  kind: 'text',
  channelId: 'channel-1',
  model: 'upstream-chat',
  prompt: '请把这些图做成海报',
  inputs: [],
  params: {},
  messages: [
    { role: 'user', content: '请把这些图做成海报' },
  ],
}

describe('agentLoopTrace', () => {
  it('★★ trace 带上会话作用域、operation 与工具模式', () => {
    const trace = agentLoopTrace({
      projectId: 'p1',
      sessionId: 'session-1',
      operationId: 'op-1',
      request,
      purpose: 'agent',
      toolMode: 'json',
    })
    expect(trace).toMatchObject({
      projectId: 'p1',
      workbench: 'canvas',
      subjectId: 'session-1',
      scopeId: 'session:session-1',
      operationId: 'op-1',
      sentChannelId: 'channel-1',
      sentModel: 'upstream-chat',
    })
    expect(trace.params).toMatchObject({
      kind: 'text',
      purpose: 'agent',
      toolMode: 'json',
      messageCount: 1,
      prompt: '请把这些图做成海报',
    })
  })

  it('★★ 有套件上下文时写入 digest 与引用；没有时不留空字段', () => {
    const withContext = agentLoopTrace({
      projectId: 'p1',
      sessionId: 'session-1',
      operationId: 'op-1',
      request,
      purpose: 'agent',
      toolMode: 'native',
      context: {
        digest: 'digest-1',
        memoryRefs: [{ id: 'mem-1', revision: 2 }],
        kitVersionRefs: [{ kitId: 'kit-1', version: 3 }],
        assetRefs: [],
        brief: '摘要',
      },
    })
    expect(withContext.params).toMatchObject({
      contextDigest: 'digest-1',
      memoryRefs: [{ id: 'mem-1', revision: 2 }],
      kitVersionRefs: [{ kitId: 'kit-1', version: 3 }],
    })
    const without = agentLoopTrace({
      projectId: 'p1',
      sessionId: 'session-1',
      operationId: 'op-1',
      request,
      purpose: 'agent-tool-probe',
      toolMode: 'native',
    })
    expect(without.params).not.toHaveProperty('contextDigest')
    expect(without.params).toMatchObject({ purpose: 'agent-tool-probe' })
  })
})

describe('promoteAgentChatRouteCandidate', () => {
  it('★★ 成功候选提升到队首并按三元组去重', () => {
    const route: AgentChatRoute = {
      channelId: 'channel-old',
      credentialGroupId: 'group-old',
      logicalModel: '测试对话模型',
      upstreamModel: 'upstream-old',
      routePlanId: 'plan',
      candidates: [
        {
          channelId: 'channel-old',
          credentialGroupId: 'group-old',
          model: 'upstream-old',
        },
        {
          channelId: 'channel-new',
          model: 'upstream-new',
        },
      ],
    }
    const promoted = promoteAgentChatRouteCandidate(route, {
      channelId: 'channel-new',
      model: 'upstream-new',
    })
    expect(promoted).toMatchObject({
      channelId: 'channel-new',
      upstreamModel: 'upstream-new',
      logicalModel: '测试对话模型',
    })
    expect(promoted.credentialGroupId).toBeUndefined()
    expect(promoted.candidates).toEqual([
      { channelId: 'channel-new', model: 'upstream-new' },
      {
        channelId: 'channel-old',
        credentialGroupId: 'group-old',
        model: 'upstream-old',
      },
    ])
    /** 纯函数：不能原地改写旧 route */
    expect(route.channelId).toBe('channel-old')
    expect(route.candidates).toHaveLength(2)
  })

  it('★★ 同一候选已在队首时不重复追加', () => {
    const route: AgentChatRoute = {
      channelId: 'channel-1',
      logicalModel: '测试对话模型',
      upstreamModel: 'upstream-1',
      routePlanId: 'plan',
      candidates: [{ channelId: 'channel-1', model: 'upstream-1' }],
    }
    const promoted = promoteAgentChatRouteCandidate(route, {
      channelId: 'channel-1',
      model: 'upstream-1',
    })
    expect(promoted.candidates).toEqual([
      { channelId: 'channel-1', model: 'upstream-1' },
    ])
  })
})
