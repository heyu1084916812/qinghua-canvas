import { createElement, useState } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { SkillEntity } from '../../../../domain/prompt/skill'
import type { Channel } from '../../../../domain/project/channel'
import { useAgentComposerController } from './useAgentComposerController'
import {
  useAgentModelSelectionController,
  type AgentModelSelectionControllerInput,
} from './useAgentModelSelectionController'
import { useAgentSkillsController } from './useAgentSkillsController'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const { takeHandoff, subscribeHandoff } = vi.hoisted(() => ({
  takeHandoff: vi.fn(() => null),
  subscribeHandoff: vi.fn(() => () => {}),
}))

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../../../../features/canvas/agentSkillHandoff', () => ({
  takeAgentSkillHandoff: takeHandoff,
  subscribeAgentSkillHandoff: subscribeHandoff,
}))

/**
 * **A → B → A 的会话隔离**（行为级）。
 *
 * 这是「两份状态」最容易出事的地方：草稿、技能、模型选择三项都挂在**当前会话**上，
 * 一旦某个 hook 偷偷把状态按「组件」而不是「会话」存，切走再回来就会串味
 * （A 的草稿出现在 B、B 选了技能 A 也跟着变）。之前只有视觉证据，这里把它钉成断言。
 *
 * 三个 hook 用的是同一个宿主里真实的三套控制器，共享一份内存会话表；
 * 切换动作与面板一致：先 `resetForSession`，再换 `current`。
 */

function session(id: string, patch: Partial<AgentSession> = {}): AgentSession {
  return {
    id,
    projectId: 'p1',
    title: `会话 ${id}`,
    channelId: '',
    model: 'GPT-6 Astra',
    messages: [],
    pendingSteers: [],
    queuedTurns: [],
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  }
}

function skill(id: string, name: string): SkillEntity {
  return {
    id,
    name,
    description: '',
    content: 'body',
    inputMode: 'text',
    tags: [],
    updatedAt: 1,
    source: 'builtin',
  }
}

const ALL_SKILLS = [skill('skill-1', '技能一'), skill('skill-2', '技能二')]

/** 内存会话表：模拟 sessionStore 的字段写（按 sessionId 落位） */
function createSessionTable(rows: AgentSession[]) {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const writes: Array<{ sessionId: string; patch: Record<string, unknown> }> =
    []
  return {
    get: (id: string): AgentSession | null => byId.get(id) ?? null,
    writes,
    patch: async (sessionId: string, patch: Record<string, unknown>) => {
      writes.push({ sessionId, patch })
      const current = byId.get(sessionId)
      if (!current) return null
      const next = { ...current, ...patch } as AgentSession
      byId.set(sessionId, next)
      return next
    },
  }
}

function createDraftStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  }
}

/** 空渠道表：这份测试只关心「写到哪个会话上」，不关心模型清单怎么来的 */
type ModelChannels = AgentModelSelectionControllerInput['channels']
/** 同一个引用：`useSyncExternalStore` 的 getSnapshot 每次新建对象会无限重渲染 */
const CHANNEL_STATE = { customModels: [], uncommonModelIds: [] }
const CHANNELS: ModelChannels = {
  subscribe: () => () => {},
  // 控制器只读这两个字段，其余状态与这份测试无关，故只补够用的一份
  getState: () => CHANNEL_STATE as unknown as ReturnType<
    ModelChannels['getState']
  >,
  globalModelsOf: () =>
    [] as unknown as ReturnType<ModelChannels['globalModelsOf']>,
}

/**
 * 下面这些都是**跨渲染稳定**的常量。
 *
 * 控制器里有依赖「端口身份」的 effect（技能收藏、素材同步……）：测试里每次渲染都新建
 * 一个 `vi.fn()` 会让它们每帧重跑、`setState` → 再渲染 → 死循环（实测直接 OOM）。
 */
const NO_ASSETS: readonly string[] = []
const NOOP = () => {}
const NO_SELECTION: readonly string[] = []
const NO_CHANNELS: readonly Channel[] = []
const NO_NODES = (): readonly { id: string; data: unknown }[] => []
const PANEL_REF = { current: null }
const TRACK_RUN_SYNC = <T,>(work: () => T): T => work()
const TRACK_RUN = <T,>(work: () => Promise<T>): Promise<T> => work()
const SKILLS_API = {
  create: async () => ({ ...skill('created', '新技能'), source: 'user' as const }),
  reload: async () => undefined,
}
const PRESETS_API = {
  loadSkillFavorites: async () => [] as string[],
  saveSkillFavorites: async () => undefined,
}

function mount(rows: AgentSession[], initialId: string) {
  const table = createSessionTable(rows)
  const draftStorage = createDraftStorage()
  const sessionIdRef = { current: initialId }
  /** 与面板一致：只写**当前**会话（身份稳定，跨渲染不变） */
  const patchCurrent = (patch: { skillId?: string }) =>
    table.patch(sessionIdRef.current, patch)
  const api: {
    composer: ReturnType<typeof useAgentComposerController> | null
    skills: ReturnType<typeof useAgentSkillsController> | null
    models: ReturnType<typeof useAgentModelSelectionController> | null
    sessionId: string
  } = { composer: null, skills: null, models: null, sessionId: initialId }
  let setSessionId!: (id: string) => void

  function Harness() {
    const [sessionId, setSession] = useState(initialId)
    setSessionId = setSession
    sessionIdRef.current = sessionId
    api.sessionId = sessionId
    const current = table.get(sessionId)
    const composer = useAgentComposerController({
      session: current,
      draftStorage,
      pendingAssetIds: current?.pendingAssetIds ?? NO_ASSETS,
      onPendingAssetsChange: NOOP,
      panelRef: PANEL_REF,
      trackRunSync: TRACK_RUN_SYNC,
    })
    const models = useAgentModelSelectionController({
      current,
      draft: composer.draft,
      channels: CHANNELS,
      allChannels: NO_CHANNELS,
      selection: NO_SELECTION,
      getCanvasNodes: NO_NODES,
      patchSession: table.patch,
      clearChatRoute: NOOP,
      rememberStickyModel: NOOP,
    })
    const skills = useAgentSkillsController({
      active: true,
      projectId: 'p1',
      current,
      allSkills: ALL_SKILLS,
      setDraft: composer.setDraft,
      // 面板的 patchSession 只写**当前**会话：这里用 ref 取当前 id，保持端口身份稳定
      patchSession: patchCurrent,
      setOpenPicker: composer.setOpenPicker,
      skills: SKILLS_API,
      presets: PRESETS_API,
      notify: NOOP,
      trackRun: TRACK_RUN,
    })
    api.composer = composer
    api.skills = skills
    api.models = models
    return null
  }

  act(() => {
    TestRenderer.create(createElement(Harness))
  })

  /** 面板切换会话的动作顺序：先复位输入区，再让 session effect 恢复新会话的草稿 */
  const switchTo = (id: string) => {
    act(() => {
      // 同一批里完成：分两次 act 会让「复位」先触发一次旧会话的草稿回填，
      // 测出来的是批处理差异，不是产品行为（真实面板里这两个动作同属一次切换）。
      api.composer!.resetForSession(id)
      setSessionId(id)
    })
  }

  return { api, table, switchTo }
}

beforeEach(() => {
  vi.stubGlobal(
    'window',
    Object.assign(Object.create(Object.prototype), {
      matchMedia: vi.fn(() => ({ matches: false })),
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      innerHeight: 900,
      localStorage: createDraftStorage(),
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('A → B → A 的会话隔离', () => {
  it('草稿跟着会话走：切走是空的，切回来原文还在', () => {
    const { api, switchTo } = mount([session('a'), session('b')], 'a')

    // 走编辑器真实的输入路径（`replaceDraft` 会按 sessionId 落盘）
    act(() => {
      api.composer!.replaceDraft('A 的草稿')
    })
    expect(api.composer!.draft).toBe('A 的草稿')

    switchTo('b')
    expect(api.composer!.draft).toBe('')

    switchTo('a')
    expect(api.composer!.draft).toBe('A 的草稿')
  })

  it('技能只写在当前会话上：B 看不到 A 选的技能，回来还在', async () => {
    const { api, table, switchTo } = mount([session('a'), session('b')], 'a')

    await act(async () => {
      await api.skills!.setSkill('skill-1')
    })
    expect(table.get('a')?.skillId).toBe('skill-1')
    expect(table.get('b')?.skillId).toBeUndefined()
    expect(api.skills!.skillLabel).toBe('技能一')

    switchTo('b')
    expect(api.skills!.skillLabel).toBe('技能')
    expect(table.get('b')?.skillId).toBeUndefined()

    switchTo('a')
    expect(api.skills!.skillLabel).toBe('技能一')
  })

  it('模型选择只写在当前会话上：切走再回来仍是 A 的那一档', async () => {
    const { api, table, switchTo } = mount([session('a'), session('b')], 'a')

    await act(async () => {
      await api.models!.setModelKind('imageModel', 'img-A')
    })
    expect(table.get('a')?.imageModel).toBe('img-A')
    expect(table.get('b')?.imageModel).toBeUndefined()

    switchTo('b')
    expect(api.models!.selectedModelOf('image')).not.toBe('img-A')

    switchTo('a')
    expect(table.get('a')?.imageModel).toBe('img-A')
    expect(
      table.writes.filter((write) => write.sessionId === 'b'),
    ).toEqual([])
  })
})
