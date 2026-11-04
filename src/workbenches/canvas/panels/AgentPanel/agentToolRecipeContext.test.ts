import { describe, expect, it } from 'vitest'
import type { GenerationContextAsset } from '../../../../domain/canvas/model/node'
import type { Channel } from '../../../../domain/project/channel'
import type { ModelCapability } from '../../../../domain/shared/capability'
import {
  createAgentToolRecipeContext,
  type AgentToolRecipeContextInput,
  type AgentToolRecipeSession,
} from './agentToolRecipeContext'

const cap = (
  id: string,
  category: ModelCapability['category'] = 'image',
): ModelCapability => ({ id, category, inputTypes: ['text'] })

const channel = (over: Partial<Channel> & { id: string }): Channel =>
  ({
    name: over.id,
    icon: null,
    protocol: 'mock',
    baseUrl: '',
    credentialRef: null,
    tokenTail: null,
    hasToken: true,
    altCredentialRef: null,
    altTokenTail: null,
    hasAltToken: false,
    credentialGroups: [],
    enabled: true,
    models: [],
    modelCache: [],
    modelMap: {},
    priority: 0,
    weight: 1,
    routeStrategy: 'priority',
    order: 0,
    lastTestAt: null,
    lastTestLatency: null,
    createdAt: 0,
    ...over,
  }) as Channel

const asset = (hash: string, mime: string): GenerationContextAsset => ({
  hash,
  mime,
  role: 'reference',
  name: hash,
})

const genNode = (data: Record<string, unknown>) => ({ data })

interface HarnessInit {
  sessionId?: string
  session?: AgentToolRecipeSession
  explicit?: { image?: string; video?: string }
  sticky?: { image?: string; video?: string }
  selected?: { image?: string; video?: string }
  contextAssets?: GenerationContextAsset[]
  allChannels?: Channel[]
  enabledChannels?: Channel[]
}

const harness = (init: HarnessInit = {}) => {
  const calls: string[] = []
  const state: {
    explicit?: { image?: string; video?: string }
    sticky: { image?: string; video?: string }
    selected: { image?: string; video?: string }
    contextAssets: GenerationContextAsset[]
  } = {
    explicit: init.explicit,
    sticky: init.sticky ?? {},
    selected: init.selected ?? {},
    contextAssets: init.contextAssets ?? [],
  }
  const input: AgentToolRecipeContextInput = {
    sessionId: init.sessionId ?? init.session?.id ?? 'session-a',
    session: init.session,
    getExplicitMediaModels: () => state.explicit,
    getStickyModels: () => state.sticky,
    selectedModelOf: (kind) => state.selected[kind] ?? '',
    allChannels: init.allChannels ?? [],
    enabledChannels: init.enabledChannels ?? [],
    getContextAssets: () => state.contextAssets,
    rememberStickyModel: (id, kind, model) => {
      calls.push(`remember:${id}:${kind}:${model}`)
      // 与真实的 AgentSessionRuntimeState 一致：记下来之后下一轮就读得到，不会再重复写。
      state.sticky[kind] = model
    },
    persistStickyModel: (id, kind, model) => {
      calls.push(`persist:${id}:${kind}:${model}`)
    },
  }
  return { ctx: createAgentToolRecipeContext(input), calls, state }
}

const catalogChannel = (over: Partial<Channel> & { id: string }) =>
  channel({
    models: [
      cap('explicit-img'),
      cap('plan-img'),
      cap('session-img'),
      cap('sticky-img'),
      cap('selected-img'),
      cap('explicit-video', 'video'),
      cap('session-video', 'video'),
    ],
    ...over,
  })

describe('recipeForGenerated', () => {
  const session: AgentToolRecipeSession = {
    id: 'session-a',
    channelId: 'ch-a',
    imageModel: 'session-img',
    videoModel: 'session-video',
  }

  it('本轮正文的模型 chip 压过计划里写的模型', () => {
    const { ctx } = harness({
      session,
      explicit: { image: 'explicit-img' },
      enabledChannels: [catalogChannel({ id: 'ch-a' })],
    })

    expect(ctx.recipeForGenerated('generation', genNode({ model: 'plan-img' })))
      .toEqual({ channelId: 'ch-a', model: 'explicit-img' })
  })

  it('视频节点用视频档的显式模型', () => {
    const { ctx } = harness({
      session,
      explicit: { video: 'explicit-video' },
      enabledChannels: [catalogChannel({ id: 'ch-a' })],
    })

    expect(ctx.recipeForGenerated('generation', genNode({ mode: 'video' })))
      .toEqual({ channelId: 'ch-a', model: 'explicit-video' })
  })

  it('计划里写的模型压过会话当前模型', () => {
    const { ctx } = harness({
      session,
      enabledChannels: [catalogChannel({ id: 'ch-a' })],
    })

    expect(ctx.recipeForGenerated('generation', genNode({ model: 'plan-img' })))
      .toEqual({ channelId: 'ch-a', model: 'plan-img' })
  })

  it('计划里的空串 / 空白回落到会话当前模型', () => {
    const { ctx } = harness({
      session,
      enabledChannels: [catalogChannel({ id: 'ch-a' })],
    })

    expect(ctx.recipeForGenerated('generation', genNode({ model: '   ' })))
      .toEqual({ channelId: 'ch-a', model: 'session-img' })
  })

  it('会话当前模型压过上次用过的模型', () => {
    const { ctx } = harness({
      session,
      sticky: { image: 'sticky-img' },
      enabledChannels: [catalogChannel({ id: 'ch-a' })],
    })

    expect(ctx.recipeForGenerated('generation', genNode({})))
      .toEqual({ channelId: 'ch-a', model: 'session-img' })
  })

  it('上次用过的模型压过画布选中的节点模型', () => {
    const { ctx } = harness({
      sticky: { image: 'sticky-img' },
      selected: { image: 'selected-img' },
      enabledChannels: [catalogChannel({ id: 'ch-a' })],
    })

    expect(ctx.recipeForGenerated('generation', genNode({})))
      .toEqual({ channelId: 'ch-a', model: 'sticky-img' })
  })

  it('全都没有时回落到画布选中的节点模型', () => {
    const { ctx } = harness({
      selected: { image: 'selected-img' },
      enabledChannels: [catalogChannel({ id: 'ch-a' })],
    })

    expect(ctx.recipeForGenerated('generation', genNode({})))
      .toEqual({ channelId: 'ch-a', model: 'selected-img' })
  })

  it('取不到模型时返回 undefined', () => {
    const { ctx, calls } = harness({
      enabledChannels: [catalogChannel({ id: 'ch-a' })],
    })

    expect(ctx.recipeForGenerated('generation', genNode({}))).toBeUndefined()
    expect(calls).toEqual([])
  })

  it('渠道只在启用渠道里反查：模型只在 allChannels 里时不配方', () => {
    const { ctx, calls } = harness({
      explicit: { image: 'explicit-img' },
      allChannels: [catalogChannel({ id: 'ch-a' })],
      enabledChannels: [],
    })

    expect(ctx.recipeForGenerated('generation', genNode({}))).toBeUndefined()
    expect(calls).toEqual([])
  })

  it('模式不认识时按图片档处理', () => {
    const { ctx } = harness({
      explicit: { image: 'explicit-img', video: 'explicit-video' },
      enabledChannels: [catalogChannel({ id: 'ch-a' })],
    })

    expect(ctx.recipeForGenerated('generation', genNode({ mode: 'weird' })))
      .toEqual({ channelId: 'ch-a', model: 'explicit-img' })
  })

  it('非生成节点一律 undefined，也不写 sticky', () => {
    const { ctx, calls } = harness({
      explicit: { image: 'explicit-img' },
      enabledChannels: [catalogChannel({ id: 'ch-a' })],
    })

    expect(ctx.recipeForGenerated('prompt', genNode({}))).toBeUndefined()
    expect(ctx.explicitRecipeForGenerated('prompt', genNode({})))
      .toBeUndefined()
    expect(ctx.contextAssetsForGenerated('prompt')).toBeUndefined()
    expect(calls).toEqual([])
  })
})

describe('sticky 模型的记忆与落库顺序', () => {
  const session: AgentToolRecipeSession = { id: 'session-a', channelId: 'ch-a' }

  it('先记 ref 再落库，且带上这次真正用上的模型', () => {
    const { ctx, calls } = harness({
      session,
      explicit: { image: 'explicit-img' },
      enabledChannels: [catalogChannel({ id: 'ch-a' })],
    })

    ctx.recipeForGenerated('generation', genNode({}))

    expect(calls).toEqual([
      'remember:session-a:image:explicit-img',
      'persist:session-a:image:explicit-img',
    ])
  })

  it('视频档记到视频档字段上', () => {
    const { ctx, calls } = harness({
      session,
      explicit: { video: 'explicit-video' },
      enabledChannels: [catalogChannel({ id: 'ch-a' })],
    })

    ctx.recipeForGenerated('generation', genNode({ mode: 'video' }))

    expect(calls).toEqual([
      'remember:session-a:video:explicit-video',
      'persist:session-a:video:explicit-video',
    ])
  })

  it('模型没变时不写，避免每建一次节点落一次库', () => {
    const { ctx, calls } = harness({
      session,
      explicit: { image: 'explicit-img' },
      sticky: { image: 'explicit-img' },
      enabledChannels: [catalogChannel({ id: 'ch-a' })],
    })

    expect(ctx.recipeForGenerated('generation', genNode({})))
      .toEqual({ channelId: 'ch-a', model: 'explicit-img' })
    expect(calls).toEqual([])
  })

  it('没有会话对象时只记 ref，不落库', () => {
    const { ctx, calls } = harness({
      sessionId: 'session-a',
      explicit: { image: 'explicit-img' },
      enabledChannels: [catalogChannel({ id: 'ch-a' })],
    })

    ctx.recipeForGenerated('generation', genNode({}))

    expect(calls).toEqual(['remember:session-a:image:explicit-img'])
  })
})

describe('explicitRecipeForGenerated', () => {
  it('显式模型 + 反查到的渠道', () => {
    const { ctx } = harness({
      explicit: { image: 'explicit-img' },
      enabledChannels: [catalogChannel({ id: 'ch-a' })],
    })

    expect(ctx.explicitRecipeForGenerated('generation', genNode({})))
      .toEqual({ channelId: 'ch-a', model: 'explicit-img' })
  })

  it('反查不到渠道时渠道留空串，模型照旧返回', () => {
    const { ctx } = harness({ explicit: { image: 'explicit-img' } })

    expect(ctx.explicitRecipeForGenerated('generation', genNode({})))
      .toEqual({ channelId: '', model: 'explicit-img' })
  })

  it('没有显式模型时返回 undefined', () => {
    const { ctx } = harness({
      enabledChannels: [catalogChannel({ id: 'ch-a' })],
    })

    expect(ctx.explicitRecipeForGenerated('generation', genNode({})))
      .toBeUndefined()
  })
})

describe('contextAssetsForGenerated', () => {
  it('只留图片素材，视频与其他 MIME 一律丢掉', () => {
    const { ctx } = harness({
      contextAssets: [
        asset('a', 'image/png'),
        asset('b', 'video/mp4'),
        asset('c', 'application/pdf'),
        asset('d', 'image/jpeg'),
      ],
    })

    expect(ctx.contextAssetsForGenerated('generation')?.map((item) => item.hash))
      .toEqual(['a', 'd'])
  })

  it('没有素材时返回空数组（不是 undefined）', () => {
    const { ctx } = harness()

    expect(ctx.contextAssetsForGenerated('generation')).toEqual([])
  })
})

describe('categoryOfModel / channelIdForModel', () => {
  const allChannels = [
    channel({
      id: 'ch-all',
      models: [
        cap('img-1', 'image'),
        cap('vid-1', 'video'),
        cap('chat-1', 'chat'),
        cap('voice-1', 'audio'),
        cap('weird-1', 'unknown'),
      ],
    }),
  ]

  it('图片 / 视频 / 对话直接透传类别', () => {
    const { ctx } = harness({ allChannels })

    expect(ctx.categoryOfModel('img-1')).toBe('image')
    expect(ctx.categoryOfModel('vid-1')).toBe('video')
    expect(ctx.categoryOfModel('chat-1')).toBe('chat')
  })

  it('音频 / 未知 / 查不到都返回 undefined', () => {
    const { ctx } = harness({ allChannels })

    expect(ctx.categoryOfModel('voice-1')).toBeUndefined()
    expect(ctx.categoryOfModel('weird-1')).toBeUndefined()
    expect(ctx.categoryOfModel('nope')).toBeUndefined()
  })

  it('类别查 allChannels，渠道反查只认 enabledChannels', () => {
    const { ctx } = harness({ allChannels, enabledChannels: [] })

    expect(ctx.categoryOfModel('vid-1')).toBe('video')
    expect(ctx.channelIdForModel('vid-1')).toBeUndefined()
  })

  it('模型在启用渠道里时反查出渠道 id', () => {
    const { ctx } = harness({ enabledChannels: allChannels })

    expect(ctx.channelIdForModel('img-1')).toBe('ch-all')
  })
})

describe('会话互不串味与实时取值', () => {
  it('两个会话各自取自己的显式 / sticky 模型', () => {
    const enabledChannels = [catalogChannel({ id: 'ch-a' })]
    const a = harness({
      session: { id: 'session-a', channelId: 'ch-a' },
      explicit: { image: 'explicit-img' },
      enabledChannels,
    })
    const b = harness({
      session: { id: 'session-b', channelId: 'ch-a' },
      sticky: { image: 'sticky-img' },
      enabledChannels,
    })

    expect(a.ctx.recipeForGenerated('generation', genNode({}))?.model)
      .toBe('explicit-img')
    expect(b.ctx.recipeForGenerated('generation', genNode({}))?.model)
      .toBe('sticky-img')
    expect(a.ctx.recipeForGenerated('generation', genNode({}))?.model)
      .toBe('explicit-img')

    expect(a.calls).toEqual([
      'remember:session-a:image:explicit-img',
      'persist:session-a:image:explicit-img',
    ])
    // B 用的就是它自己的 sticky，模型没变 ⇒ 一次都不写。
    expect(b.calls).toEqual([])
  })

  it('getter 每次调用都读最新值（批准后才执行时不能拿到旧快照）', () => {
    const { ctx, state } = harness({
      enabledChannels: [catalogChannel({ id: 'ch-a' })],
    })

    state.explicit = { image: 'sticky-img' }
    expect(ctx.recipeForGenerated('generation', genNode({}))?.model)
      .toBe('sticky-img')

    state.explicit = { image: 'explicit-img' }
    expect(ctx.recipeForGenerated('generation', genNode({}))?.model)
      .toBe('explicit-img')
  })
})
