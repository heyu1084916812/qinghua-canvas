import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ContextBundle,
} from '../../../../domain/shared/context'
import type { ChatMessage } from '../../../../domain/shared/execution/types'
import type {
  GraphSnapshot,
} from '../../../../domain/canvas/model/graph'
import type {
  NodeSnapshot,
} from '../../../../domain/canvas/model/node'
import type { Skill } from '../../../../domain/prompt/skill'
import type { ReferenceSelection } from '../../../../domain/project/referenceLedger'
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
  history: ChatMessage[] = [],
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
  if (history.length > 0) {
    await sessions.saveMessages(created.id, history)
  }
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
      expect(withoutChip.contextTrace?.skillPhaseEvent).toBeUndefined()
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
      expect(withChip.contextTrace?.skillPhaseEvent).toEqual({
        phase: 'skillLoaded',
        title: '技能加载完成',
        detail: '已加载技能「品牌技能」。',
        evidence: ['skill-brand'],
      })
    }
  })

  it('★★ 参考台账命中项进入本轮上下文与 assetRefs，未命中不注入', async () => {
    const { sessions, session } = await createSession()
    const selectForTask = vi.fn(async (
      _projectId: string,
      _taskKey: string,
    ): Promise<ReferenceSelection> => ({
      selected: [
        {
          item: {
            id: 'r1',
            projectId: 'p1',
            title: '品牌标准字',
            source: 'kit',
            kind: 'image',
            assetHash: 'hash-logo',
            what: '绿色圆角标准字',
            createdAt: 1,
            updatedAt: 1,
          },
          usage: {
            id: 'u1',
            itemId: 'r1',
            projectId: 'p1',
            taskKey: 'simple_generate',
            usage: 'identityAnchor',
            howToUse: '保持字形与颜色不变',
            identityAnchor: true,
            createdAt: 1,
          },
        },
      ],
      omitted: [],
    }))
    const result = await prepareAgentTurnRequest({
      ...inputFor({ sessions, session, text: '按参考做一张 KV' }),
      referenceLedger: {
        selectForTask,
        listItems: vi.fn(async () => []),
      },
    })
    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') return
    expect(selectForTask).toHaveBeenCalledWith('p1', 'simple_generate')
    expect(selectForTask.mock.calls[0]?.[1]).not.toBe(result.operationId)
    expect(result.contextPrompt).toContain('本次任务采用的参考台账')
    expect(result.contextPrompt).toContain('保持字形与颜色不变')
    expect(result.contextTrace?.assetRefs).toContainEqual({
      hash: 'hash-logo',
      mime: 'image/png',
      role: 'logo',
      name: '品牌标准字',
    })
    expect(result.contextTrace?.referenceEvidence).toEqual(['r1:u1'])
    expect(result.contextTrace?.referencePhaseEvent).toEqual({
      phase: 'referenceAnalysis',
      title: '参考分析完成 · 1 项依据',
      detail: expect.stringContaining('已读取 1 条参考'),
      evidence: ['r1:u1'],
    })
    expect(result.contextTrace?.referencePhaseEvent?.detail).not.toContain('保持字形与颜色不变')
  })

  it('★★ 套件参考把多图资产集合全部并入本轮 assetRefs', async () => {
    const { sessions, session } = await createSession()
    const readAssetMime = vi.fn(async (hash: string) =>
      hash.startsWith('image-') ? 'image/png' : null,
    )
    const selectForTask = vi.fn(async (
      _projectId: string,
      _taskKey: string,
    ): Promise<ReferenceSelection> => ({
      selected: [{
        item: {
          id: 'kit-ref',
          projectId: 'p1',
          title: 'Anbel',
          source: 'kit',
          kind: 'image',
          assetHash: 'image-logo',
          assets: [
            { hash: 'image-logo', role: 'logo', name: 'Logo' },
            { hash: 'image-room', role: 'reference', name: '空间' },
            { hash: 'broken-photo', role: 'reference', name: '缺失图' },
            { hash: 'image-room', role: 'reference', name: '重复空间' },
          ],
          what: '完整品牌套件',
          createdAt: 1,
          updatedAt: 1,
        },
        usage: {
          id: 'usage-kit',
          itemId: 'kit-ref',
          projectId: 'p1',
          taskKey: 'simple_generate',
          usage: 'style',
          howToUse: '沿用完整套件',
          createdAt: 1,
        },
      }],
      omitted: [],
    }))

    const result = await prepareAgentTurnRequest({
      ...inputFor({ sessions, session, text: '用品牌套件做一张 KV' }),
      readAssetMime,
      referenceLedger: {
        selectForTask,
        listItems: vi.fn(async () => []),
      },
    })

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') return
    expect(result.contextTrace?.assetRefs).toEqual([
      { hash: 'image-logo', mime: 'image/png', role: 'logo', name: 'Logo' },
      { hash: 'image-room', mime: 'image/png', role: 'reference', name: '空间' },
    ])
    expect(readAssetMime).toHaveBeenCalledWith('broken-photo')
  })

  it('★★ 正文参考 chip 与会话持续参考都进入本轮上下文，不依赖 usage 预登记', async () => {
    const { sessions, session } = await createSession({
      referenceIds: ['r2'],
    })
    const listItems = vi.fn(async () => [
      {
        id: 'r1',
        projectId: 'p1',
        title: '本轮参考',
        source: 'file' as const,
        kind: 'image' as const,
        assetHash: 'hash-r1',
        what: '用户上传的版式参考',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'r2',
        projectId: 'p1',
        title: '会话持续参考',
        source: 'pinterest' as const,
        kind: 'image' as const,
        assetHash: 'hash-r2',
        what: '用户从 Pinterest 收藏的配色参考',
        createdAt: 2,
        updatedAt: 2,
      },
    ])
    const result = await prepareAgentTurnRequest({
      ...inputFor({
        sessions,
        session,
        text: `${mentionToken('reference', 'r1', '本轮参考')} 做一张海报`,
      }),
      referenceLedger: {
        selectForTask: vi.fn(async () => ({ selected: [], omitted: [] })),
        listItems,
      },
    })

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') return
    expect(result.contextPrompt).toContain('本轮参考')
    expect(result.contextPrompt).toContain('会话持续参考')
    expect(result.contextTrace?.assetRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ hash: 'hash-r1', role: 'reference' }),
        expect.objectContaining({ hash: 'hash-r2', role: 'reference' }),
      ]),
    )
    expect(listItems).toHaveBeenCalledWith('p1')
  })

  it('★★ 查看画布：与视觉验收共用 route + inputTypes 判据，工具声明包含 visualReview', async () => {
    const { sessions, session } = await createSession()
    const result = await prepareAgentTurnRequest({
      ...inputFor({ sessions, session, text: '检查画布图片是否一致' }),
      channels: [{
        id: 'channel-1', enabled: true, models: [{
          id: 'upstream-chat', category: 'chat', inputTypes: ['text', 'image'],
        }], modelMap: { 测试对话模型: 'upstream-chat' },
      }] as unknown as PrepareAgentTurnRequestInput['channels'],
      canvasReviewEnabled: true,
      activeAgentTools: agentToolsForRequestMode('complex_plan', { canvasReview: true }),
    })
    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') return
    expect(result.turnTools.map((tool) => tool.name)).toContain('visualReview')
    expect(result.systemPrompt).toContain('当前路由的图片能力已由能力目录')
    expect(result.systemPrompt).toContain('验收一致性')
  })

  it('★★ @融合结果 这个图有什么：只把图片交给 chat，不产生 visualReview', async () => {
    const { sessions, session } = await createSession()
    const result = await prepareAgentTurnRequest({
      ...inputFor({
      sessions, session, text: `${mentionToken('node', 'fusion-1', '融合结果')} 这个图有什么`,
      graph: graphOf([imageNode('fusion-1')]),
      }),
      channels: [{ id: 'channel-1', enabled: true, models: [{ id: 'upstream-chat', category: 'chat', inputTypes: ['text'] }], modelMap: { 测试对话模型: 'upstream-chat' } }] as unknown as PrepareAgentTurnRequestInput['channels'],
      canvasReviewEnabled: true,
      activeAgentTools: agentToolsForRequestMode('complex_plan', { canvasReview: true }),
    })
    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') return
    expect(result.requestMode).toBe('reference_edit')
    expect(result.visualNodeIds).toEqual(['fusion-1'])
    expect(result.turnTools.map((tool) => tool.name)).not.toContain('visualReview')
    expect(result.systemPrompt).toContain('本次真实图片输入确认')
    expect(result.systemPrompt).toContain('描述 / 识别图片直接回答')
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

  it('★★ 502 后普通「继续」升级 full，并保留上次失败原因与原始需求', async () => {
    const original = '云岚茶品牌全案：宋韵、青瓷主色、12 页作品集'
    const { sessions, session } = await createSession({}, [
      { role: 'user', content: original },
      { role: 'assistant', content: '服务端返回错误（HTTP 502）：upstream failed' },
    ])
    const result = await prepareAgentTurnRequest(inputFor({
      sessions,
      session,
      text: '继续',
    }))
    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') return
    expect(result.requestMode).toBe('complex_plan')
    expect(result.promptProfile).toBe('full')
    expect(result.persistedTurn.modelWindow[0]?.content).toBe(original)
    expect(result.systemPrompt).toContain('HTTP 502')
    expect(result.systemPrompt).not.toContain('轻量执行规则')
  })

  it('★★ 「下一步」/ internalControl / active taskPlan / paused / 未完生成四种状态都强制 full', async () => {
    const activePlan = {
      id: 'plan-1',
      title: '品牌全案',
      summary: '分阶段完成',
      steps: [
        { id: 'step-1', title: '视觉规范', status: 'done' as const },
        { id: 'step-2', title: '主视觉', status: 'in_progress' as const },
      ],
      currentStepId: 'step-2',
      createdAt: 1,
      updatedAt: 2,
    }
    const states: Array<{
      text: string
      patch?: Parameters<ReturnType<typeof createAgentSessionStore>['updateFields']>[1]
      internalControl?: boolean
      history?: ChatMessage[]
    }> = [
      { text: '下一步', patch: { taskPlan: activePlan } },
      { text: '继续', patch: { taskPlan: activePlan } },
      { text: '继续', internalControl: true },
      {
        text: '继续',
        patch: { continuation: { reason: 'max_steps' as const, maxSteps: 8, createdAt: 1 } },
      },
      {
        text: '继续',
        patch: { pendingConfirmation: { callId: 'call-1', name: 'runNode', args: {} } },
      },
      {
        text: '继续',
        history: [{ role: 'user', content: '生成 4 张主视觉' }, { role: 'assistant', content: '图像生成中 0/4' }],
      },
      {
        text: '继续',
        history: [{ role: 'user', content: '品牌全案' }, { role: 'assistant', content: 'HTTP 502' }],
      },
    ]
    for (const state of states) {
      clearToolSupportCache()
      const { sessions, session } = await createSession(state.patch ?? {}, state.history)
      const result = await prepareAgentTurnRequest({
        ...inputFor({ sessions, session, text: state.text }),
        ...(state.internalControl ? { internalControl: true } : {}),
      })
      expect(result.kind, state.text).toBe('ready')
      if (result.kind !== 'ready') continue
      expect(result.requestMode, state.text).toBe('complex_plan')
      expect(result.promptProfile, state.text).toBe('full')
      expect(result.systemPrompt, state.text).toContain('本次会话状态摘要')
    }
  })

  it('★★ 轻量档原始短句不误升 full，也不注入 sessionBrief', async () => {
    const { sessions, session } = await createSession()
    const result = await prepareAgentTurnRequest(inputFor({
      sessions,
      session,
      text: '画一只猫',
    }))
    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') return
    expect(result.requestMode).toBe('simple_generate')
    expect(result.systemPrompt).not.toContain('本次会话状态摘要')
  })

  it('★★ 502 后全新需求仍是轻量档，不把上一轮未完成状态带成新任务', async () => {
    const { sessions, session } = await createSession({}, [
      { role: 'assistant', content: '服务端返回错误（HTTP 502）：upstream failed' },
    ])
    const result = await prepareAgentTurnRequest(inputFor({
      sessions,
      session,
      text: '画一只新的猫',
    }))
    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') return
    expect(result.requestMode).toBe('simple_generate')
    expect(result.promptProfile).toBe('light')
    expect(result.systemPrompt).not.toContain('本次会话状态摘要')
  })

  /**
   * #919 的兜底底座：附件账（`pendingAssetIds`）可能被并发投递整字段覆盖掉一条，
   * 但只要正文里有 node chip，发送链路照样把该节点并进本轮视觉输入
   * （`visualNodeIds = union(pendingAssetIds, 正文 node mentions)`）。
   *
   * 这条把「丢写 ≠ 丢附件」钉在机器上，是 #919 判 P3、不动实现的依据。
   */
  it('★★ 附件账少一条但正文有 chip：视觉输入仍然两条都在', async () => {
    const { sessions, session } = await createSession({
      // 模拟 #919 覆盖后的结果：img-a 已从账上丢掉
      pendingAssetIds: ['img-b'],
    })
    const graph = graphOf([imageNode('img-a'), imageNode('img-b')])
    const result = await prepareAgentTurnRequest(
      inputFor({
        sessions,
        session,
        graph,
        text:
          `${mentionToken('node', 'img-a', '图一')} ` +
          `${mentionToken('node', 'img-b', '图二')} 各生成一张横版`,
      }),
    )

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') return
    expect(result.visualNodeIds).toEqual(['img-b', 'img-a'])
    const last = (await sessions.messagesFor(session.id)).at(-1)
    expect(last?.imageNodeIds).toEqual(['img-b', 'img-a'])
  })

  /**
   * #935：**停止发生在「工具探测已就绪、请求还没发」之间**必须整单放弃。
   *
   * 这条分支的代价直接是钱：放过去 = 用户点了停止，请求照样发出去。
   * 构造：先把工具探测缓存预热（同渠道/模型第二次不再探），再让上下文读取挂起，
   * 挂起期间 abort，然后放行 —— 恰好走到 `if (signal.aborted)` 那一步。
   * 断言里的 `execute` 是**故意会抛**的 spy：它一旦被调用就说明请求发出去了。
   */
  it('★★ 工具探测之后停止：不再发请求，返回 tool_probe 失败', async () => {
    const { sessions, session } = await createSession()
    // 1) 预热探测缓存：下一次 ensureToolSupport 直接命中缓存，不会再探一次
    await prepareAgentTurnRequest(
      inputFor({ sessions, session, text: '预热探测' }),
    )
    const forbiddenExecute = vi.fn(() => {
      throw new Error('停止之后不许再发请求')
    })
    let releaseRead!: (bundle: ContextBundle) => void
    const read = vi.fn(
      () =>
        new Promise<ContextBundle>((resolve) => {
          releaseRead = resolve
        }),
    )
    const abort = new AbortController()
    const onRouteReady = vi.fn(async () => {})
    const pending = prepareAgentTurnRequest({
      ...inputFor({
        sessions,
        session,
        text: '停止这一轮',
        onRouteReady,
        memory: { read },
        routeExecution: { execute: forbiddenExecute } as never,
      }),
      signal: abort.signal,
    })

    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1))
    abort.abort()
    releaseRead(emptyBundle('p1', '停止这一轮', session.id))
    const result = await pending

    expect(result.kind).toBe('failed')
    expect(result).toMatchObject({
      phase: 'tool_probe',
      message: '用户已停止当前回合',
    })
    // 关键：一条请求都没发出去
    expect(forbiddenExecute).not.toHaveBeenCalled()
    // 与 aborted_before_job 的区别：Job 已经建好（onRouteReady 已触发）
    expect(onRouteReady).toHaveBeenCalledTimes(1)
    expect((await sessions.messagesFor(session.id)).at(-1)).toMatchObject({
      role: 'user',
      content: '停止这一轮',
    })
  })

  /**
   * #935：上下文冲突必须**拒发**，且用户那条消息不许跟着丢。
   *
   * 写错的两种代价：①带着冲突素材发出去（图/引用对不上，钱白花）；
   * ②顺手把已落库的用户消息回滚掉（用户看到自己那句话消失）。
   * 冲突判断在工具探测**之前**，所以这里断言"一条请求都没发出"。
   */
  it('★★ 上下文有冲突：拒发（不发任何请求），保留已落库用户消息', async () => {
    const { sessions, session } = await createSession()
    const text = '把这张图和这条视频合成一条'
    const execute = vi.fn()
    const bundle: ContextBundle = {
      ...emptyBundle('p1', text, session.id),
      conflicts: [
        {
          key: 'asset-usage',
          values: ['image', 'video'],
          sources: ['session'],
          message: '同一份素材被指定成两种用途',
        },
      ],
    }
    const result = await prepareAgentTurnRequest(
      inputFor({
        sessions,
        session,
        text,
        memory: { read: async () => bundle },
        routeExecution: { execute } as never,
      }),
    )

    expect(result.kind).toBe('failed')
    expect(result).toMatchObject({
      phase: 'context_conflict',
      message: expect.stringContaining('同一份素材被指定成两种用途'),
    })
    expect(execute).not.toHaveBeenCalled()
    expect((await sessions.messagesFor(session.id)).at(-1)).toMatchObject({
      role: 'user',
      content: text,
    })
  })
})
