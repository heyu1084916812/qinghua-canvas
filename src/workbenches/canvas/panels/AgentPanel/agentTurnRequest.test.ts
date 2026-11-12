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
  {
    id: 'skill-poster',
    name: '海报技能',
    description: '测试技能二',
    content: '技能正文：竖版 3:4，标题占上三分之一。',
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
  autoCurateReferences?: PrepareAgentTurnRequestInput['autoCurateReferences']
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
    ...(args.autoCurateReferences
      ? { autoCurateReferences: args.autoCurateReferences }
      : {}),
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

  it('★★ 技能浮层加入的多枚技能 chip 本轮全部注入（2026-11-12）', async () => {
    const { sessions, session } = await createSession()
    const ready = await prepareAgentTurnRequest(
      inputFor({
        sessions,
        session,
        text: `${mentionToken('skill', 'skill-brand', '品牌技能')} ${mentionToken('skill', 'skill-poster', '海报技能')} 做一张新品海报`,
      }),
    )
    expect(ready.kind).toBe('ready')
    if (ready.kind === 'ready') {
      expect(ready.skill?.id).toBe('skill-brand')
      expect(ready.skills?.map((item) => item.id)).toEqual(['skill-brand', 'skill-poster'])
      expect(ready.systemPrompt).toContain('## 本轮启用的技能（2 个）')
      expect(ready.systemPrompt).toContain('技能正文：保留品牌字形和主色。')
      expect(ready.systemPrompt).toContain('技能正文：竖版 3:4，标题占上三分之一。')
      expect(ready.contextTrace?.skillPhaseEvent?.evidence).toEqual(['skill-brand', 'skill-poster'])
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
    // G1：台账按任务键选用法，不再按请求模式（simple_generate）。
    expect(selectForTask).toHaveBeenCalledWith('p1', result.taskKey)
    expect(result.taskKey).toBe(`task:${result.agentTask.id}`)
    expect(result.requestMode).toBe('simple_generate')
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
      title: '参考素材分析结束 · 1 项依据',
      detail: expect.stringContaining('已读取 1 条参考'),
      evidence: ['r1:u1'],
    })
    expect(result.contextTrace?.referencePhaseEvent?.detail).toContain('保持字形与颜色不变')
  })

  it('★★ 显式参考 chip 先自动分析，再把当前任务的 usage 接入本轮', async () => {
    const { sessions, session } = await createSession({
      referenceIds: ['kit-1'],
    })
    const item = {
      id: 'kit-1',
      projectId: 'p1',
      title: '品牌套件',
      source: 'kit' as const,
      kind: 'image' as const,
      assets: [
        { hash: 'image-logo', role: 'logo' as const, name: 'Logo' },
        { hash: 'image-photo', role: 'reference' as const, name: '照片' },
      ],
      what: '等待自动分析',
      createdAt: 1,
      updatedAt: 1,
    }
    let curatedTaskKey = ''
    const events: string[] = []
    const autoCurateReferences: NonNullable<
      PrepareAgentTurnRequestInput['autoCurateReferences']
    > = vi.fn(async (input) => {
      curatedTaskKey = input.taskKey
      events.push('curate')
      return {
        ok: true,
        summary: '分析了 1 条参考',
        taskKey: input.taskKey,
        analyzed: [{
          itemId: item.id,
          title: item.title,
          what: '完整品牌套件',
          usage: 'identityAnchor' as const,
          howToUse: 'Logo 保持原样，照片只作为版式参考',
        }],
        failed: [],
        limitations: [],
      }
    })
    const result = await prepareAgentTurnRequest({
      ...inputFor({
        sessions,
        session,
        text: '用这个套件做一张新品海报',
        autoCurateReferences,
      }),
      onReferenceAnalysis: (state) => { events.push(state) },
      referenceLedger: {
        selectForTask: vi.fn(async (_projectId, taskKey) => ({
          selected: curatedTaskKey === taskKey
            ? [{
                item: { ...item, what: '完整品牌套件' },
                usage: {
                  id: 'usage-kit',
                  itemId: item.id,
                  projectId: 'p1',
                  taskKey,
                  usage: 'identityAnchor' as const,
                  howToUse: 'Logo 保持原样，照片只作为版式参考',
                  identityAnchor: true,
                  createdAt: 1,
                },
              }]
            : [],
          omitted: [],
        })),
        listItems: vi.fn(async () => [item]),
      },
    })

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') return
    expect(autoCurateReferences).toHaveBeenCalledWith(expect.objectContaining({
      task: '用这个套件做一张新品海报',
      itemIds: ['kit-1'],
    }))
    expect(result.contextTrace?.assetRefs.map((asset) => asset.hash)).toEqual([
      'image-logo',
      'image-photo',
    ])
    expect(result.contextPrompt).toContain('Logo 保持原样')
    expect(result.contextTrace?.referenceEvidence).toEqual(['kit-1:usage-kit'])
    // G-R4：先「参考素材分析中」→ 分析 → 「参考素材分析结束」，都在模型请求之前
    expect(events).toEqual(['running', 'curate', 'done'])
  })

  it('★★ 自动参考分析失败时继续使用显式 chip，并把原因写入可追溯 warning', async () => {
    const { sessions, session } = await createSession({
      referenceIds: ['kit-missing'],
    })
    const item = {
      id: 'kit-missing',
      projectId: 'p1',
      title: '缺图套件',
      source: 'kit' as const,
      kind: 'image' as const,
      assets: [
        { hash: 'image-ok', role: 'logo' as const, name: 'Logo' },
        { hash: 'image-missing', role: 'reference' as const, name: '照片' },
      ],
      what: '完整套件',
      createdAt: 1,
      updatedAt: 1,
    }
    const notifyContextError = vi.fn()
    const result = await prepareAgentTurnRequest({
      ...inputFor({
        sessions,
        session,
        text: '用这个套件做海报',
        autoCurateReferences: vi.fn(async () => ({
          ok: false,
          summary: '1 条失败',
          taskKey: 'simple_generate',
          analyzed: [],
          failed: [{
            itemId: item.id,
            title: item.title,
            reason: '视觉模型不可用',
          }],
          limitations: ['照片缺失'],
        })),
      }),
      notifyContextError,
      readAssetMime: vi.fn(async (hash: string) =>
        hash === 'image-ok' ? 'image/png' : null,
      ),
      referenceLedger: {
        selectForTask: vi.fn(async (): Promise<ReferenceSelection> => ({
          selected: [],
          omitted: [],
        })),
        listItems: vi.fn(async () => [item]),
      },
    })

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') return
    expect(notifyContextError).toHaveBeenCalledWith(
      '有 1 条参考没有完成自动分析，已按显式 chip 继续。',
    )
    expect(result.contextTrace?.assetRefs.map((asset) => asset.hash))
      .toEqual(['image-ok'])
    expect(result.contextTrace?.referenceWarnings).toEqual(expect.arrayContaining([
      '参考「缺图套件」自动分析失败：视觉模型不可用',
      '照片缺失',
      '套件素材「照片」已缺失，本轮已跳过。',
    ]))
    expect(result.contextTrace?.referencePhaseEvent?.detail).toContain(
      '视觉模型不可用',
    )
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
      { hash: 'image-room', mime: 'image/png', role: 'reference', name: '空间', usage: 'style', howToUse: '沿用完整套件' },
    ])
    expect(result.contextTrace?.referenceWarnings).toEqual([
      '套件素材「缺失图」已缺失，本轮已跳过。',
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
  it('★★ G1 参考用法按任务存：同任务改图沿用任务键与参考，换无关新需求开新任务', async () => {
    const { sessions, session } = await createSession()
    const keys: string[] = []
    const autoCurated: string[][] = []
    const run = async (text: string) => {
      clearToolSupportCache()
      const latest = (await sessions.get(session.id)) ?? session
      const result = await prepareAgentTurnRequest({
        ...inputFor({
          sessions,
          session: latest,
          text,
          autoCurateReferences: vi.fn(async (input) => {
            autoCurated.push([...input.itemIds])
            return { ok: true, summary: '', taskKey: input.taskKey, analyzed: [], failed: [], limitations: [] }
          }),
        }),
        referenceLedger: {
          selectForTask: vi.fn(async (_projectId: string, taskKey: string) => {
            keys.push(taskKey)
            return { selected: [], omitted: [] }
          }),
          listItems: vi.fn(async () => []),
        },
      })
      if (result.kind !== 'ready') throw new Error(result.kind)
      return result
    }
    const first = await run(`${mentionToken('reference', 'ref-product', '产品图')} 帮我做一张咖啡店海报`)
    const edit = await run('logo 再大一点')
    const series = await run('再出一张横版的')
    const unrelated = await run('画一只在月球上的猫')
    expect(first.agentTaskReason).toBe('first')
    expect(edit.taskKey).toBe(first.taskKey)
    expect(series.taskKey).toBe(first.taskKey)
    expect(unrelated.taskKey).not.toBe(first.taskKey)
    // 每回合读两次任务参考：分析前挑侧栏待分析图、分析后装配上下文。
    expect(keys).toEqual([
      first.taskKey, first.taskKey,
      first.taskKey, first.taskKey,
      first.taskKey, first.taskKey,
      unrelated.taskKey, unrelated.taskKey,
    ])
    // 同一任务后续回合没再 @，产品图仍随任务进入参考分析；新任务不带旧参考。
    expect(autoCurated).toEqual([['ref-product'], ['ref-product'], ['ref-product']])
    expect(unrelated.agentTask.referenceIds).toEqual([])
    expect((await sessions.get(session.id))?.agentTask?.id).toBe(unrelated.agentTask.id)
  })
  it('★★ G2 显式参考按提及顺序进入图片输入（编号与「第 1 张 / 第 2 张」一致）', async () => {
    const { sessions, session } = await createSession()
    const image = (id: string, createdAt: number) => ({
      id,
      projectId: 'p1',
      title: id,
      source: 'file' as const,
      kind: 'image' as const,
      assetHash: `hash-${id}`,
      what: id,
      createdAt,
      updatedAt: createdAt,
    })
    const result = await prepareAgentTurnRequest({
      ...inputFor({
        sessions,
        session,
        text:
          `用${mentionToken('reference', 'layout', '排版')}的排版，` +
          `把${mentionToken('reference', 'cup', '产品')}放进去做一张海报`,
      }),
      referenceLedger: {
        selectForTask: vi.fn(async () => ({ selected: [], omitted: [] })),
        // 台账按创建时间返回：产品图更早，但用户先提的是排版图。
        listItems: vi.fn(async () => [image('cup', 1), image('layout', 2)]),
      },
    })
    if (result.kind !== 'ready') throw new Error(result.kind)
    expect(result.contextTrace?.assetRefs.map((row) => row.hash)).toEqual([
      'hash-layout',
      'hash-cup',
    ])
  })

  it('★★ G5 参考栏多张无用法的图且无法分析：退回提示先发问题卡；回答问题卡那一回合不再提示', async () => {
    const { sessions, session } = await createSession()
    const image = (id: string) => ({
      item: {
        id,
        projectId: 'p1',
        title: `${id}.jpg`,
        source: 'file' as const,
        kind: 'image' as const,
        assetHash: `hash-${id}`,
        what: `${id} 的画面`,
        createdAt: 1,
        updatedAt: 1,
      },
      reason: 'no_usage' as const,
    })
    const ledger = {
      selectForTask: vi.fn(async () => ({ selected: [], omitted: [image('a'), image('b')] })),
      listItems: vi.fn(async () => []),
    }
    const result = await prepareAgentTurnRequest({
      ...inputFor({ sessions, session, text: '帮我做一张新品海报' }),
      referenceLedger: ledger,
    })
    if (result.kind !== 'ready') throw new Error(result.kind)
    expect(result.contextPrompt).toContain('参考图的分工拿不准，先问用户')
    expect(result.contextPrompt).toContain('askQuestions')
    expect(result.contextPrompt).toContain('【a.jpg】（referenceItemId: a）')

    const card = JSON.stringify({ ok: true, awaitingAnswers: true, questions: [{ id: 'r', question: '怎么用？' }] })
    const asked = await sessions.saveMessages(session.id, [
      { role: 'user', content: '帮我做一张新品海报' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'q', name: 'askQuestions', args: '{}' }] },
      { role: 'tool', toolCallId: 'q', toolName: 'askQuestions', content: card },
      { role: 'assistant', content: '先问一下' },
    ])
    clearToolSupportCache()
    const answer = await prepareAgentTurnRequest({
      ...inputFor({ sessions, session: asked ?? session, text: '问题卡回答：\n1. 怎么用？ → 都不用' }),
      referenceLedger: ledger,
    })
    if (answer.kind !== 'ready') throw new Error(answer.kind)
    expect(answer.agentTaskReason).toBe('continuation')
    expect(answer.contextPrompt).not.toContain('参考图的分工拿不准')
  })

  it('★★ G5 修订：侧栏无用法的图先自动分析；分工清楚就直接用、不提示问题卡，同任务不重复分析', async () => {
    const { sessions, session } = await createSession()
    const image = (id: string) => ({
      item: {
        id,
        projectId: 'p1',
        title: `${id}.jpg`,
        source: 'file' as const,
        kind: 'image' as const,
        assetHash: `hash-${id}`,
        what: `${id} 的画面`,
        createdAt: 1,
        updatedAt: 1,
      },
      reason: 'no_usage' as const,
    })
    const ledger = {
      selectForTask: vi.fn(async () => ({ selected: [], omitted: [image('cup'), image('mood')] })),
      listItems: vi.fn(async () => []),
    }
    const autoCurateReferences = vi.fn(async (args: { taskKey: string; itemIds: readonly string[] }) => ({
      ok: true,
      summary: '',
      taskKey: args.taskKey,
      analyzed: [
        { itemId: 'cup', title: '杯子', what: '白底杯', usage: 'subject' as const, howToUse: '借：杯形；避：白底', roleClear: true, relevant: true },
        { itemId: 'mood', title: '氛围', what: '暖色海报', usage: 'style' as const, howToUse: '借：暖色；避：文字', roleClear: true, relevant: true },
      ],
      failed: [],
      limitations: [],
    }))
    const result = await prepareAgentTurnRequest({
      ...inputFor({ sessions, session, text: '帮我做一张新品海报', autoCurateReferences }),
      referenceLedger: ledger,
    })
    if (result.kind !== 'ready') throw new Error(result.kind)
    expect(autoCurateReferences).toHaveBeenCalledOnce()
    expect(autoCurateReferences.mock.calls[0]![0].itemIds).toEqual(['cup', 'mood'])
    expect(result.contextPrompt).toContain('参考图已自动分析')
    expect(result.contextPrompt).not.toContain('参考图的分工拿不准')
    expect(result.agentTask.referenceReview).toEqual({ analyzedIds: ['cup', 'mood'], pendingIds: [] })

    clearToolSupportCache()
    const latest = (await sessions.get(session.id)) ?? session
    expect(latest.agentTask?.referenceReview?.analyzedIds).toEqual(['cup', 'mood'])
    const again = await prepareAgentTurnRequest({
      ...inputFor({ sessions, session: latest, text: '标题再大一点', autoCurateReferences }),
      referenceLedger: ledger,
    })
    if (again.kind !== 'ready') throw new Error(again.kind)
    expect(again.agentTaskReason).toBe('refinement')
    expect(autoCurateReferences).toHaveBeenCalledOnce()
  })

  it('★★ G9 问题卡回答在本回合准备阶段（模型与生图之前）交给参考分析重写用法；同任务后续回合不再问', async () => {
    const { sessions, session } = await createSession()
    const confirmed = new Set<string>()
    const image = (id: string) => ({
      id,
      projectId: 'p1',
      title: `${id}.jpg`,
      source: 'file' as const,
      kind: 'image' as const,
      assetHash: `hash-${id}`,
      what: `${id} 的画面`,
      createdAt: 1,
      updatedAt: 1,
    })
    const ledger = {
      selectForTask: vi.fn(async (_projectId: string, taskKey: string) => ({
        selected: [...confirmed].map((id) => ({
          item: image(id),
          usage: {
            id: `u-${id}`, itemId: id, projectId: 'p1', taskKey, usage: 'subject' as const,
            howToUse: '借：杯形与杯盖；避：白底', confirmedByUser: true as const, createdAt: 2,
          },
        })),
        omitted: ['cup', 'can'].filter((id) => !confirmed.has(id))
          .map((id) => ({ item: image(id), reason: 'no_usage' as const })),
      })),
      listItems: vi.fn(async () => []),
    }
    const autoCurateReferences = vi.fn(async (args: {
      taskKey: string
      itemIds: readonly string[]
      userConstraints?: Readonly<Record<string, string>>
    }) => {
      const constraints = args.userConstraints ?? {}
      Object.keys(constraints).forEach((id) => confirmed.add(id))
      return {
        ok: true,
        summary: '',
        taskKey: args.taskKey,
        analyzed: args.itemIds.map((itemId) => ({
          itemId, title: itemId, what: itemId, usage: 'subject' as const, howToUse: '借：外形；避：背景',
          roleClear: true, relevant: true,
          ...(constraints[itemId] ? { confirmedByUser: true } : {}),
        })),
        failed: [],
        limitations: [],
      }
    })
    const run = async (text: string) => {
      clearToolSupportCache()
      const latest = (await sessions.get(session.id)) ?? session
      const result = await prepareAgentTurnRequest({
        ...inputFor({ sessions, session: latest, text, autoCurateReferences }),
        referenceLedger: ledger,
      })
      if (result.kind !== 'ready') throw new Error(result.kind)
      return result
    }

    const first = await run('帮我做一张新品海报')
    expect(first.contextPrompt).toContain('参考图的分工拿不准，先问用户')
    expect(first.agentTask.referenceReview?.pendingIds).toEqual(['cup', 'can'])

    const card = JSON.stringify({
      ok: true,
      awaitingAnswers: true,
      questions: [
        { id: 'q1', question: '第 1 张怎么用？', options: ['锁定产品', '借风格'], referenceItemId: 'cup' },
        { id: 'q2', question: '第 2 张怎么用？', options: ['锁定产品', '不用'], referenceItemId: 'can' },
      ],
    })
    const history = await sessions.messagesFor(session.id)
    await sessions.saveMessages(session.id, [
      ...history,
      { role: 'assistant', content: '', toolCalls: [{ id: 'q', name: 'askQuestions', args: '{}' }] },
      { role: 'tool', toolCallId: 'q', toolName: 'askQuestions', content: card },
      { role: 'assistant', content: '先问一下' },
    ])
    autoCurateReferences.mockClear()
    const answer = await run('问题卡回答：\n1. 第 1 张怎么用？ → 锁定产品\n2. 第 2 张怎么用？ → 未回答')
    expect(answer.agentTaskReason).toBe('continuation')
    expect(autoCurateReferences).toHaveBeenCalledOnce()
    expect(autoCurateReferences.mock.calls[0]![0].userConstraints).toEqual({ cup: '第 1 张怎么用？ → 锁定产品' })
    expect(answer.contextPrompt).toContain('1 张参考已按用户的回答重写用法')
    expect(answer.agentTask.referenceReview?.pendingIds).toEqual([])

    autoCurateReferences.mockClear()
    const later = await run('再出一张横版的')
    expect(later.agentTaskReason).toBe('series')
    expect(autoCurateReferences).not.toHaveBeenCalled()
    expect(later.contextPrompt).not.toContain('参考图的分工拿不准')
  })

  it('★★ 「先定 Logo」只做 Logo 并停下：阶段随任务保留，用户放行后转为串行延展', async () => {
    const { sessions, session } = await createSession()
    const run = async (text: string) => {
      clearToolSupportCache()
      const latest = (await sessions.get(session.id)) ?? session
      const result = await prepareAgentTurnRequest(inputFor({ sessions, session: latest, text }))
      if (result.kind !== 'ready') throw new Error(result.kind)
      return result
    }
    const first = await run('帮我做一套咖啡品牌：Logo、包装和海报，先定 Logo')
    expect(first.agentTask.seriesStage).toBe('logo_first')
    expect(first.contextPrompt).toContain('本回合**只做 Logo**')
    const tweak = await run('Logo 再大一点')
    expect(tweak.agentTask.seriesStage).toBe('logo_first')
    expect(tweak.contextPrompt).toContain('只做 Logo')
    const released = await run('Logo 可以了，继续')
    expect(released.agentTask.id).toBe(first.agentTask.id)
    expect(released.agentTask.seriesStage).toBeUndefined()
    expect(released.contextPrompt).toContain('Logo 已确认，继续延展')
    expect((await sessions.get(session.id))?.agentTask?.seriesStage).toBeUndefined()
  })

  it('★★ 整套（Logo + 包装 + 海报）默认串行：上下文写明锚点顺序', async () => {
    const { sessions, session } = await createSession()
    const result = await prepareAgentTurnRequest(
      inputFor({ sessions, session, text: '帮我设计咖啡品牌的 Logo、包装和海报' }),
    )
    if (result.kind !== 'ready') throw new Error(result.kind)
    expect(result.agentTask.seriesStage).toBeUndefined()
    expect(result.contextPrompt).toContain('整套串行')
  })
})


describe('prepareAgentTurnRequest · @ 套件', () => {
  beforeEach(() => {
    clearToolSupportCache()
  })

  it('★★ @ 套件按冻结版本注入本轮，并随会话保留到后续回合', async () => {
    const { createContextRepository } = await import('../../../../state/shared/contextRepository')
    const { createAgentMemoryPort } = await import('../../../../features/shared/agent/MemoryPort')
    const { kitMentionId } = await import('../../../../domain/shared/kitMention')
    const repo = createContextRepository(createMemoryPlatform().storage)
    const created = await repo.createKit({ kind: 'brand', name: 'Anbel', guide: 'v1 指南：主色墨绿。' })
    await repo.saveKitVersion(created.kit.id, { guide: 'v2 指南：主色橙色。' })
    const memory = createAgentMemoryPort(repo)
    const { sessions, session } = await createSession()

    const first = await prepareAgentTurnRequest(inputFor({
      sessions,
      session,
      memory,
      text: `按 ${mentionToken('kit', kitMentionId(created.kit.id, 1), 'Anbel')} 做一张海报`,
    }))
    expect(first.kind).toBe('ready')
    if (first.kind !== 'ready') return
    expect(first.systemPrompt).toContain('v1 指南：主色墨绿。')
    expect(first.systemPrompt).not.toContain('v2 指南')
    expect(first.contextTrace?.kitVersionRefs).toEqual([{ kitId: created.kit.id, version: 1 }])
    const stored = await sessions.get(session.id)
    expect(stored?.kitRefs).toEqual([{ kitId: created.kit.id, version: 1, name: 'Anbel' }])
    expect(await repo.listProjectBindings('p1')).toEqual([])

    clearToolSupportCache()
    const second = await prepareAgentTurnRequest(inputFor({
      sessions,
      session: stored!,
      memory,
      text: '再出一张横版',
    }))
    expect(second.kind === 'ready' && second.systemPrompt).toContain('v1 指南：主色墨绿。')
  })
})
