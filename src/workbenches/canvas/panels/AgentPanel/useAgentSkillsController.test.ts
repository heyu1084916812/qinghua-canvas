import { createElement, useState } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type {
  SkillEntity,
  UserSkill,
} from '../../../../domain/prompt/skill'
import {
  useAgentSkillsController,
  type AgentSkillsControllerInput,
} from './useAgentSkillsController'

const { navigateMock, takeHandoff, subscribeHandoff, requestLibrary } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  takeHandoff: vi.fn(),
  subscribeHandoff: vi.fn(),
  requestLibrary: vi.fn(),
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}))

vi.mock('../../../../features/canvas/agentSkillHandoff', () => ({
  takeAgentSkillHandoffs: takeHandoff,
  subscribeAgentSkillHandoff: subscribeHandoff,
  requestAgentSkillLibrary: requestLibrary,
}))

type Hook = ReturnType<typeof useAgentSkillsController>

const session: AgentSession = {
  id: 'chat-1',
  projectId: 'p1',
  title: '会话一',
  channelId: '',
  model: 'GPT-6 Astra',
  skillId: 'skill-1',
  messages: [],
  pendingSteers: [],
  queuedTurns: [],
  createdAt: 1,
  updatedAt: 1,
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

function userSkill(id: string, name: string): UserSkill {
  return { ...skill(id, name), source: 'user' }
}

function input(
  patch: Partial<AgentSkillsControllerInput> = {},
): AgentSkillsControllerInput {
  return {
    active: true,
    projectId: 'p1',
    current: session,
    allSkills: [skill('skill-1', '技能一'), skill('skill-2', '技能二')],
    setDraft: vi.fn(),
    patchSession: async () => undefined,
    setOpenPicker: vi.fn(),
    skills: {
      create: vi.fn(async () => userSkill('created', '新技能')),
      reload: vi.fn(async () => undefined),
    },
    presets: {
      loadSkillFavorites: vi.fn(async () => []),
      saveSkillFavorites: vi.fn(async () => undefined),
    },
    notify: vi.fn(),
    trackRun: <T,>(work: () => Promise<T>) => work(),
    ...patch,
  }
}

describe('useAgentSkillsController', () => {
  beforeEach(() => {
    navigateMock.mockClear()
    takeHandoff.mockReset().mockReturnValue([])
    subscribeHandoff.mockReset().mockReturnValue(vi.fn())
    requestLibrary.mockReset().mockReturnValue(false)
  })

  it('技能名称跟随当前会话，setSkill 显式保存 id', async () => {
    const patchSession = vi.fn(async () => undefined)
    const viewRef: { current: Hook | null } = { current: null }
    const props = input({ patchSession })
    function Probe() {
      viewRef.current = useAgentSkillsController(props)
      return null
    }
    act(() => {
      TestRenderer.create(createElement(Probe))
    })

    expect(viewRef.current?.skillLabel).toBe('技能一')
    await act(async () => {
      await viewRef.current!.setSkill('skill-2')
      await viewRef.current!.setSkill('')
    })
    expect(patchSession).toHaveBeenNthCalledWith(1, { skillId: 'skill-2' })
    expect(patchSession).toHaveBeenNthCalledWith(2, { skillId: undefined })
  })

  it('技能 handoff 用同一解析器追加，同技能不重复', () => {
    takeHandoff.mockReturnValue(['skill-1'])
    subscribeHandoff.mockReturnValue(vi.fn())
    let draft = ''
    const viewRef: { current: Hook | null } = { current: null }
    const base = input()
    function Probe() {
      const [value, setValue] = useState('')
      draft = value
      viewRef.current = useAgentSkillsController({
        ...base,
        setDraft: setValue,
      })
      return null
    }
    act(() => {
      TestRenderer.create(createElement(Probe))
    })

    expect(draft).toBe('@[技能一](skill:skill-1) ')
    expect(subscribeHandoff).toHaveBeenCalledTimes(1)
    const listener = subscribeHandoff.mock.calls[0]![1] as () => void
    act(() => listener())
    expect(draft).toBe('@[技能一](skill:skill-1) ')
    expect(viewRef.current?.skillFileRef.current).toBeNull()
    expect(viewRef.current?.skillDirRef.current).toBeNull()
  })

  it('收藏先读回，切换时先更新界面再落库', async () => {
    const loadSkillFavorites = vi.fn(async () => ['skill-1'])
    const saveSkillFavorites = vi.fn(async () => undefined)
    const viewRef: { current: Hook | null } = { current: null }
    const props = input({
      presets: { loadSkillFavorites, saveSkillFavorites },
    })
    function Probe() {
      viewRef.current = useAgentSkillsController(props)
      return null
    }
    await act(async () => {
      TestRenderer.create(createElement(Probe))
    })
    expect(viewRef.current?.skillFavs).toEqual(['skill-1'])

    await act(async () => {
      await viewRef.current!.toggleSkillFavorite('skill-2')
    })
    expect(viewRef.current?.skillFavs).toEqual(['skill-1', 'skill-2'])
    expect(saveSkillFavorites).toHaveBeenLastCalledWith([
      'skill-1',
      'skill-2',
    ])

    await act(async () => {
      await viewRef.current!.toggleSkillFavorite('skill-1')
    })
    expect(viewRef.current?.skillFavs).toEqual(['skill-2'])
  })

  it('导入技能复用解析与 SkillStore，并给出真实成败回执', async () => {
    const create = vi.fn(async () => userSkill('created', '新技能'))
    const reload = vi.fn(async () => undefined)
    const notify = vi.fn()
    const setOpenPicker = vi.fn()
    const viewRef: { current: Hook | null } = { current: null }
    const props = input({
      skills: { create, reload },
      notify,
      setOpenPicker,
    })
    function Probe() {
      viewRef.current = useAgentSkillsController(props)
      return null
    }
    act(() => {
      TestRenderer.create(createElement(Probe))
    })
    const file = {
      name: '我的技能.md',
      text: async () => '技能正文',
    } as File
    const files = [file] as unknown as FileList

    await act(async () => {
      await viewRef.current!.importSkills(files)
    })

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ content: '技能正文' }),
    )
    expect(reload).toHaveBeenCalledTimes(1)
    expect(setOpenPicker).toHaveBeenCalledWith(null)
    expect(notify).toHaveBeenCalledWith('已导入 1 条技能', 'info')
  })

  it('浮层连续加入多个技能：按顺序追加 chip，只取认得的 id', () => {
    takeHandoff.mockImplementation((_project: string, accept: (id: string) => boolean) =>
      ['skill-2', 'skill-1', 'not-loaded-yet'].filter(accept))
    let draft = ''
    const base = input()
    function Probe() {
      const [value, setValue] = useState('做一张海报')
      draft = value
      useAgentSkillsController({ ...base, setDraft: setValue })
      return null
    }
    act(() => {
      TestRenderer.create(createElement(Probe))
    })
    expect(draft).toBe('做一张海报 @[技能二](skill:skill-2) @[技能一](skill:skill-1) ')
  })

  it('在画布页时技能按钮打开画布技能浮层，不跳技能页', () => {
    requestLibrary.mockReturnValue(true)
    const setOpenPicker = vi.fn()
    const viewRef: { current: Hook | null } = { current: null }
    const props = input({ setOpenPicker })
    function Probe() {
      viewRef.current = useAgentSkillsController(props)
      return null
    }
    act(() => {
      TestRenderer.create(createElement(Probe))
    })
    act(() => {
      viewRef.current!.openSkillLibrary()
    })
    expect(requestLibrary).toHaveBeenCalledWith('p1')
    expect(setOpenPicker).toHaveBeenCalledWith(null)
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('打开技能库先收浮层再导航', () => {
    const setOpenPicker = vi.fn()
    const viewRef: { current: Hook | null } = { current: null }
    const props = input({ setOpenPicker })
    function Probe() {
      viewRef.current = useAgentSkillsController(props)
      return null
    }
    act(() => {
      TestRenderer.create(createElement(Probe))
    })

    act(() => {
      viewRef.current!.openSkillLibrary()
    })

    expect(setOpenPicker).toHaveBeenCalledWith(null)
    expect(navigateMock).toHaveBeenCalledWith('/skills')
  })
})
