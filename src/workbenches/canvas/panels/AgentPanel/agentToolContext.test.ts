import { describe, expect, it, vi } from 'vitest'
import type { CanvasStore } from '../../../../state/workbenches/canvas/store'
import type { AgentToolContext } from '../../agent/tools'
import {
  composeAgentToolContext,
  type AgentToolBase,
} from './agentToolContext'

const ALWAYS_KEYS = [
  'categoryOfModel',
  'channelIdForModel',
  'contextAssetsForGenerated',
  'defaultsForNewNode',
  'explicitRecipeForGenerated',
  'memoryContext',
  'origin',
  'recipeForGenerated',
  'rememberMemory',
  'researchDesign',
  'readPage',
  'resolveNodeIds',
  'runNodes',
  'selectedIds',
  'selectedModelOf',
  'sliceImage',
  'splitGrid',
  'store',
  'viewportWorld',
]

const CONDITIONAL_KEYS = ['perImage', 'signal', 'taskPlan']

function harness(
  over: Partial<AgentToolBase> = {},
  options: { withPlan?: boolean } = {},
) {
  const store = { getSnapshot: vi.fn() } as unknown as CanvasStore
  const selection = ['node-1', 'node-2']
  const selectedModelOf = vi.fn((kind: 'image' | 'video') => `model-${kind}`)
  const viewportWorld = { x: 10, y: 20, w: 300, h: 200 }
  const base: AgentToolBase = {
    store,
    origin: { x: 1, y: 2 },
    viewportWorld,
    projectId: 'proj-1',
    sessionId: 's1',
    selection,
    selectedModelOf,
    perImage: true,
    abortSignal: new AbortController().signal,
    ...over,
  }
  const recipe = {
    recipeForGenerated: vi.fn(),
    explicitRecipeForGenerated: vi.fn(),
    contextAssetsForGenerated: vi.fn(),
    categoryOfModel: vi.fn(),
    channelIdForModel: vi.fn(),
  }
  const research = {
    rememberMemory: vi.fn(),
    researchDesign: vi.fn(),
    readPage: vi.fn(),
  }
  const defaults = { defaultsForNewNode: vi.fn() }
  const canvasOps = {
    runNodes: vi.fn(),
    sliceImage: vi.fn(),
    splitGrid: vi.fn(),
  }
  const plan = { get: vi.fn(), save: vi.fn() }
  const aliases = { current: new Map<string, string>() }
  const ctx = composeAgentToolContext({
    base,
    plan: options.withPlan === false ? undefined : plan,
    resolveAliases: () => aliases.current,
    recipe,
    research,
    defaults,
    canvasOps,
  })
  return {
    ctx,
    base,
    store,
    selection,
    selectedModelOf,
    viewportWorld,
    recipe,
    research,
    defaults,
    canvasOps,
    plan,
    aliases,
  }
}

describe('composeAgentToolContext / 键集合', () => {
  it('22 个键一个不多一个不少（条件键全开）', () => {
    const { ctx } = harness()

    expect(Object.keys(ctx).sort()).toEqual(
      [...ALWAYS_KEYS, ...CONDITIONAL_KEYS].sort(),
    )
  })

  it('条件都不成立时只剩 19 个键，三个条件键连键都不存在', () => {
    const { ctx } = harness(
      {
        sessionId: '',
        abortSignal: undefined,
        perImage: false,
      },
      { withPlan: false },
    )

    expect(Object.keys(ctx).sort()).toEqual([...ALWAYS_KEYS].sort())
    expect('taskPlan' in ctx).toBe(false)
    expect('signal' in ctx).toBe(false)
    expect('perImage' in ctx).toBe(false)
  })
})

describe('composeAgentToolContext / 条件键存在性', () => {
  const cases: Array<{
    label: string
    sessionId: string
    withSignal: boolean
    perImage: boolean
    expected: { taskPlan: boolean; signal: boolean; perImage: boolean }
  }> = [
    {
      label: '无会话、无信号、非逐图 → 三个都不出',
      sessionId: '',
      withSignal: false,
      perImage: false,
      expected: { taskPlan: false, signal: false, perImage: false },
    },
    {
      label: '有会话、无信号 → 只出 taskPlan',
      sessionId: 's1',
      withSignal: false,
      perImage: false,
      expected: { taskPlan: true, signal: false, perImage: false },
    },
    {
      label: '无会话、有信号 → 只出 signal',
      sessionId: '',
      withSignal: true,
      perImage: false,
      expected: { taskPlan: false, signal: true, perImage: false },
    },
    {
      label: '三者都成立 → 三个都在',
      sessionId: 's1',
      withSignal: true,
      perImage: true,
      expected: { taskPlan: true, signal: true, perImage: true },
    },
  ]

  it.each(cases)('$label', ({ sessionId, withSignal, perImage, expected }) => {
    const { ctx } = harness(
      {
        sessionId,
        abortSignal: withSignal ? new AbortController().signal : undefined,
        perImage,
      },
      { withPlan: sessionId !== '' },
    )

    expect('taskPlan' in ctx).toBe(expected.taskPlan)
    expect('signal' in ctx).toBe(expected.signal)
    expect('perImage' in ctx).toBe(expected.perImage)
  })

  it('perImage 出键时值必须是字面量 true（不是 ref 引用）', () => {
    const { ctx } = harness({ perImage: true })

    expect(ctx.perImage).toBe(true)
  })
})

describe('composeAgentToolContext / 引用与快照', () => {
  it('store 原样传引用，不做 thunk', () => {
    const h = harness()

    expect(h.ctx.store).toBe(h.store)
    expect(typeof h.ctx.store).toBe('object')
  })

  it('viewportWorld 是建 ctx 时算好的值（不是函数）', () => {
    const h = harness()

    expect(h.ctx.viewportWorld).toEqual(h.viewportWorld)
    expect(typeof h.ctx.viewportWorld).not.toBe('function')
  })

  it('selectedIds 是函数，返回建 ctx 时那份数组（同一引用）', () => {
    const h = harness()

    expect(typeof h.ctx.selectedIds).toBe('function')
    expect(h.ctx.selectedIds!()).toBe(h.selection)
  })

  it('selectedModelOf 保持同一引用，不被包装', () => {
    const h = harness()

    expect(h.ctx.selectedModelOf).toBe(h.selectedModelOf)
    expect(h.ctx.selectedModelOf!('video')).toBe('model-video')
  })

  it('memoryContext 只在有会话时带 sessionId 键', () => {
    const withSession = harness()
    expect(withSession.ctx.memoryContext).toEqual({
      workbench: 'canvas',
      projectId: 'proj-1',
      sessionId: 's1',
    })

    const withoutSession = harness({ sessionId: '' })
    expect(withoutSession.ctx.memoryContext).toEqual({
      workbench: 'canvas',
      projectId: 'proj-1',
    })
    expect('sessionId' in withoutSession.ctx.memoryContext!).toBe(false)
  })

  it('resolveNodeIds 每次调用现取别名表（applyPlan 之后才写）', () => {
    const h = harness()

    expect(h.ctx.resolveNodeIds!(['a', 'b'])).toEqual(['a', 'b'])
    h.aliases.current.set('a', 'node-real')
    expect(h.ctx.resolveNodeIds!(['a', 'b'])).toEqual(['node-real', 'b'])
  })
})

describe('composeAgentToolContext / 四块装配原样展开', () => {
  it('recipe / research / defaults / canvasOps 的成员都是同一引用', () => {
    const h = harness()
    const ctx: AgentToolContext = h.ctx

    expect(ctx.recipeForGenerated).toBe(h.recipe.recipeForGenerated)
    expect(ctx.explicitRecipeForGenerated).toBe(
      h.recipe.explicitRecipeForGenerated,
    )
    expect(ctx.contextAssetsForGenerated).toBe(
      h.recipe.contextAssetsForGenerated,
    )
    expect(ctx.categoryOfModel).toBe(h.recipe.categoryOfModel)
    expect(ctx.channelIdForModel).toBe(h.recipe.channelIdForModel)
    expect(ctx.rememberMemory).toBe(h.research.rememberMemory)
    expect(ctx.researchDesign).toBe(h.research.researchDesign)
    expect(ctx.defaultsForNewNode).toBe(h.defaults.defaultsForNewNode)
    expect(ctx.runNodes).toBe(h.canvasOps.runNodes)
    expect(ctx.sliceImage).toBe(h.canvasOps.sliceImage)
    expect(ctx.splitGrid).toBe(h.canvasOps.splitGrid)
    expect(ctx.taskPlan).toBe(h.plan)
  })
})
