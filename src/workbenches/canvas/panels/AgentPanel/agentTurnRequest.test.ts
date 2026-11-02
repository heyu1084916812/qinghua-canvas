import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ContextBundle,
} from '../../../../domain/shared/context'
import type {
  GraphSnapshot,
} from '../../../../domain/canvas/model/graph'
import type {
  NodeSnapshot,
} from '../../../../domain/canvas/model/node'
import type { Skill } from '../../../../domain/prompt/skill'
import type { TextResult } from '../../../../platform/channels/types'
import { createMemoryPlatform } from '../../../../platform/memory'
import {
  clearToolSupportCache,
} from '../../../../features/shared/agent/toolSupport'
import {
  createAgentSessionStore,
  type AgentSession,
} from '../../../../state/agent/sessionStore'
import { agentToolsForRequestMode } from '../../agent/tools'
import type { AgentChatRoute } from './agentChatRoute'
import {
  mentionToken,
} from '../../text/MentionEditor'
import {
  prepareAgentTurnRequest,
  type PrepareAgentTurnRequestInput,
} from './agentTurnRequest'

const CHAT_ROUTE: AgentChatRoute = {
  channelId: 'channel-1',
  logicalModel: '测试对话模型',
  upstreamModel: 'upstream-chat',
  routePlanId: 'route-plan',
  candidates: [
    {
      channelId: 'channel-1',
      model: 'upstream-chat',
    },
  ],
}

const SKILLS: Skill[] = [
  {
    id: 'skill-brand',
    name: '品牌技能',
    description: '测试技能',
    content: '技能正文：保留品牌字形和主色。',
    inputMode: 'any',
    tags: [],
    updatedAt: 1,
  },
]

function emptyBundle(
  projectId: string,
  request: string,
  sessionId: string,
): ContextBundle {
  return {
    request,
    scope: {
      workbench: 'canvas',
      projectId,
      sessionId,
    },
    hardConstraints: [],
    facts: [],
    softPreferences: [],
    projectDecisions: [],
    procedures: [],
    sessionDecisions: [],
    exclusions: [],
    conflicts: [],
    memoryRefs: [],
    kitVersionRefs: [],
    assetHashes: [],
    assets: [],
    budget: {
      maxMemoryChars: 1000,
      usedMemoryChars: 0,
      omittedMemoryRefs: [],
    },
    digest: 'digest-empty',
  }
}

function imageNode(id: string): NodeSnapshot {
  return {
    id,
    projectId: 'p1',
    type: 'generation',
    parentId: null,
    x: 0,
    y: 0,
    w: 240,
    h: 180,
    title: id,
    disabled: false,
    data: {
      mode: 'image',
      prompt: `${id} 的提示词`,
      linkedPromptNodeIds: [],
      channelId: '',
      model: '',
      assetHash: `hash-${id}`,
      assetMime: 'image/png',
      thumbOrder: [],
      upstreamHidden: [],
    },
  } as NodeSnapshot
}

function graphOf(nodes: NodeSnapshot[] = []): GraphSnapshot {
  return {
    projectId: 'p1',
    nodes,
    edges: [],
  }
}

async function createSession(
  patch: Parameters<
    ReturnType<typeof createAgentSessionStore>['updateFields']
  >[1] = {},
): Promise<{
  sessions: ReturnType<typeof createAgentSessionStore>
  session: AgentSession
}> {
  const sessions = createAgentSessionStore(createMemoryPlatform().storage)
  const created = await sessions.create({
    projectId: 'p1',
    channelId: '',
    model: CHAT_ROUTE.logicalModel,
  })
  const session =
    Object.keys(patch).length > 0
      ? (await sessions.updateFields(created.id, patch)) ?? created
      : created
  return { sessions, session }
}

function inputFor(args: {
  sessions: ReturnType<typeof createAgentSessionStore>
  session: AgentSession
  text: string
  graph?: GraphSnapshot
  onRouteReady?: (operationId: string) => Promise<void>
  prepareRoute?: PrepareAgentTurnRequestInput['prepareRoute']
  memory?: PrepareAgentTurnRequestInput['memory']
  routeExecution?: PrepareAgentTurnRequestInput['routeExecution']
}): PrepareAgentTurnRequestInput {
  const memory =
    args.memory ?? {
      read: vi.fn(async ({ projectId, request, sessionId }) =>
        emptyBundle(projectId, request, sessionId ?? ''),
      ),
    }
  const routeExecution =
    args.routeExecution ?? {
      execute: vi.fn(async (): Promise<TextResult> => ({
        text: '',
        toolCalls: [
          {
            id: 'probe-call',
            name: 'agent_probe',
            args: '{}',
          },
        ],
      })),
    }
  return {
    session: args.session,
    text: args.text,
    graph: args.graph ?? graphOf(),
    selection: [],
    sessions: args.sessions,
    prepareRoute:
      args.prepareRoute ??
      (async () => ({
        ok: true,
        route: { ...CHAT_ROUTE, candidates: [...CHAT_ROUTE.candidates] },
      })),
    onPersisted: vi.fn(),
    onRouteReady: args.onRouteReady ?? vi.fn(async () => {}),
    memory,
    projectId: 'p1',
    readAssetMime: vi.fn(async () => 'image/png'),
    notifyContextError: vi.fn(),
    skills: SKILLS,
    channels: [],
    canvasReviewEnabled: false,
    activeAgentTools: agentToolsForRequestMode('complex_plan', {
      canvasReview: false,
    }),
    generationAvailability: {
      image: { ready: true, reason: null },
      video: { ready: true, reason: null },
    },
    routeExecution,
    signal: new AbortController().signal,
    notifyRecordWarning: vi.fn(),
  }
}

describe('prepareAgentTurnRequest', () => {
  beforeEach(() => {
    clearToolSupportCache()
  })

  it('★★ 技能只认当前正文 chip，不因会话残留 skillId 自动注入', async () => {
    const { sessions, session } = await createSession({
      skillId: 'skill-brand',
    })

    const withoutChip = await prepareAgentTurnRequest(
      inputFor({
        sessions,
        session,
        text: '做一张新品海报',
      }),
    )
    expect(withoutChip.kind).toBe('ready')
    if (withoutChip.kind === 'ready') {
      expect(withoutChip.systemPrompt).not.toContain('技能正文：保留品牌字形和主色。')
    }

    clearToolSupportCache()
    const withChip = await prepareAgentTurnRequest(
      inputFor({
        sessions,
        session,
        text: `${mentionToken('skill', 'skill-brand', '品牌技能')} 做一张新品海报`,
      }),
    )
    expect(withChip.kind).toBe('ready')
    if (withChip.kind === 'ready') {
      expect(withChip.skill?.id).toBe('skill-brand')
      expect(withChip.systemPrompt).toContain('技能正文：保留品牌字形和主色。')
    }
  })

  it('★★ 多图请求识别 per-image、按 reference_edit 裁剪工具并保留 JSON 降级', async () => {
    const { sessions, session } = await createSession()
    const graph = graphOf([
      imageNode('img-a'),
      imageNode('img-b'),
    ])
    const result = await prepareAgentTurnRequest(
      inputFor({
        sessions,
        session,
        graph,
        text:
          `${mentionToken('node', 'img-a', '图一')} ` +
          `${mentionToken('node', 'img-b', '图二')} ` +
          '分别改成 3D 风格，其余保持不变',
        routeExecution: {
          execute: vi.fn(async (): Promise<TextResult> => ({
            text: '只返回文字',
          })),
        },
      }),
    )

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') return
    expect(result.perImage).toBe(true)
    expect(result.requestMode).toBe('reference_edit')
    expect(result.promptProfile).toBe('light')
    expect(result.turnTools).toEqual(
      agentToolsForRequestMode('reference_edit', {
        canvasReview: false,
      }),
    )
    expect(result.turnTools.map((tool) => tool.name)).not.toContain(
      'moveNodes',
    )
    expect(result.toolMode).toBe('json')
    expect(result.systemPrompt).toContain(
      '当前模型不支持原生工具调用（JSON 模式）',
    )
  })

  it('★★ 后台会话只读取目标 sessionId 的历史', async () => {
    const sessions = createAgentSessionStore(createMemoryPlatform().storage)
    const a = await sessions.create({
      projectId: 'p1',
      channelId: '',
      model: CHAT_ROUTE.logicalModel,
    })
    const b = await sessions.create({
      projectId: 'p1',
      channelId: '',
      model: CHAT_ROUTE.logicalModel,
    })
    await sessions.saveMessages(a.id, [
      { role: 'user', content: 'A 的历史' },
      { role: 'assistant', content: 'A 的回答' },
    ])
    await sessions.saveMessages(b.id, [
      { role: 'user', content: 'B 的历史' },
      { role: 'assistant', content: 'B 的回答' },
    ])

    const result = await prepareAgentTurnRequest(
      inputFor({
        sessions,
        session: b,
        text: 'B 的新请求',
      }),
    )

    expect(result.kind).toBe('ready')
    if (result.kind === 'ready') {
      expect(
        result.persistedTurn.historyMessages.map((message) => message.content),
      ).toEqual(['B 的历史', 'B 的回答', 'B 的新请求'])
    }
    expect(
      (await sessions.messagesFor(a.id)).map((message) => message.content),
    ).toEqual(['A 的历史', 'A 的回答'])
    expect(
      (await sessions.messagesFor(b.id)).map((message) => message.content),
    ).toEqual(['B 的历史', 'B 的回答', 'B 的新请求'])
  })

  it('★★ 路由失败保留已落库用户消息，且不触发 Job-ready 回调', async () => {
    const { sessions, session } = await createSession()
    const onRouteReady = vi.fn(async () => {})
    const read = vi.fn()
    const execute = vi.fn()
    const result = await prepareAgentTurnRequest(
      inputFor({
        sessions,
        session,
        text: '请继续修改这张图',
        onRouteReady,
        prepareRoute: async () => ({
          ok: false,
          message: '没有可用渠道',
        }),
        memory: { read },
        routeExecution: { execute } as never,
      }),
    )

    expect(result).toMatchObject({
      kind: 'route_failed',
      message: '没有可用渠道',
    })
    expect(onRouteReady).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
    expect((await sessions.messagesFor(session.id)).at(-1)).toMatchObject({
      role: 'user',
      content: '请继续修改这张图',
    })
  })

  it('★★ 路由准备期间停止回合时不再创建 planning Job', async () => {
    const { sessions, session } = await createSession()
    const abort = new AbortController()
    const onRouteReady = vi.fn(async () => {})
    const input = inputFor({
      sessions,
      session,
      text: '停止这一轮',
      onRouteReady,
      prepareRoute: async () => {
        abort.abort()
        return {
          ok: true,
          route: {
            ...CHAT_ROUTE,
            candidates: [...CHAT_ROUTE.candidates],
          },
        }
      },
    })
    const result = await prepareAgentTurnRequest({
      ...input,
      signal: abort.signal,
    })

    expect(result.kind).toBe('aborted_before_job')
    expect(onRouteReady).not.toHaveBeenCalled()
    expect((await sessions.messagesFor(session.id)).at(-1)).toMatchObject({
      role: 'user',
      content: '停止这一轮',
    })
  })

  it('★★ 系统提示词带入本轮素材与当前任务计划', async () => {
    const { sessions, session } = await createSession({
      pendingAssetIds: ['asset-current'],
      taskPlan: {
        id: 'plan-1',
        title: '新品发布',
        summary: '分阶段完成',
        steps: [
          {
            id: 'step-1',
            title: '确认品牌方向',
            status: 'in_progress',
          },
          {
            id: 'step-2',
            title: '生成主图',
            status: 'pending',
          },
        ],
        currentStepId: 'step-1',
        createdAt: 1,
        updatedAt: 2,
      },
    })
    const result = await prepareAgentTurnRequest(
      inputFor({
        sessions,
        session,
        text: '继续推进',
      }),
    )

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') return
    expect(result.visualNodeIds).toContain('asset-current')
    expect(result.systemPrompt).toContain('素材节点 asset-current')
    expect(result.systemPrompt).toContain('确认品牌方向')
    expect(result.requestMode).toBe('complex_plan')
  })
})
