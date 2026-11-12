import { createElement } from 'react'
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { PlatformProvider } from '../../app/providers/PlatformProvider'
import { SkillStoreContext, type SkillStoreApi } from '../../app/providers/SkillStoreProvider'
import { createPlatform } from '../../platform'
import type { BuiltinSkill } from '../../domain/prompt/skill'
import { SkillLibraryView } from './SkillLibraryView'
import { useSkillLibraryState, type SkillLibraryAddToAgent, type SkillLibraryState } from './useSkillLibraryState'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../state/project/libtvSkillCatalog', () => ({
  LIBTV_CATALOG_TOTAL: 0,
  libtvCategoryCounts: () => new Map(),
  loadLibtvCatalog: async () => [],
  loadLibtvSkillFiles: async () => null,
}))

const builtin = { id: 'builtin:test-poster', name: '海报设计', description: '海报', content: '正文', inputMode: 'any', tags: [], source: 'builtin' } as unknown as BuiltinSkill
const store = {
  skills: [builtin], builtinSkills: [builtin], userSkills: [], loading: false,
  reload: async () => {}, create: vi.fn(), save: vi.fn(), remove: vi.fn(), copyBuiltin: vi.fn(), restoreBuiltin: vi.fn(),
} as unknown as SkillStoreApi

function mount(onAdd: SkillLibraryAddToAgent, contained = false) {
  const ref: { state?: SkillLibraryState } = {}
  function Probe() {
    const state = useSkillLibraryState(onAdd)
    ref.state = state
    return createElement(SkillLibraryView, { state, contained, onNew: () => {}, onOpenPresets: () => {} })
  }
  let renderer!: ReactTestRenderer
  const platform = createPlatform('memory')
  act(() => {
    renderer = TestRenderer.create(
      createElement(PlatformProvider, { runtime: 'memory', create: () => platform },
        createElement(SkillStoreContext.Provider, { value: store }, createElement(Probe))),
    )
  })
  return { renderer, ref }
}

const find = (renderer: ReactTestRenderer, attr: string, value?: string) =>
  renderer.root.findAll((node) => typeof node.type === 'string' && node.props[attr] !== undefined && (value === undefined || node.props[attr] === value))

describe('SkillLibraryView（技能页与画布浮层共用的浏览视图）', () => {
  it('卡片「使用」把解析后的技能交给出口并显示成功提示', async () => {
    const onAdd = vi.fn(() => '已加入「海报设计」')
    const { renderer, ref } = mount(onAdd)
    await act(async () => ref.state!.setSource('mine'))
    const use = find(renderer, 'data-skill-card-use', builtin.id)[0]!
    await act(async () => use.props.onClick({ stopPropagation() {} }))
    expect(onAdd).toHaveBeenCalledWith({ id: builtin.id, name: '海报设计' })
    expect(ref.state!.notice).toEqual({ kind: 'ok', text: '已加入「海报设计」' })
  })

  it('出口返回 error 时显示错误提示', async () => {
    const { renderer, ref } = mount(() => ({ error: '没有画布' }))
    await act(async () => ref.state!.setSource('mine'))
    await act(async () => find(renderer, 'data-skill-card-use', builtin.id)[0]!.props.onClick({ stopPropagation() {} }))
    expect(ref.state!.notice).toEqual({ kind: 'error', text: '没有画布' })
  })

  it('contained 时详情弹窗收在浮层内（不锁 body 滚动）', async () => {
    const { renderer, ref } = mount(() => 'ok', true)
    const body = { style: { overflow: '' } }
    const doc = globalThis as unknown as { document?: unknown; window?: unknown }
    const prevDoc = doc.document
    const prevWin = doc.window
    doc.document = { body }
    doc.window = { addEventListener() {}, removeEventListener() {} }
    try {
      await act(async () => ref.state!.setSource('mine'))
      await act(async () => ref.state!.setDetail({ kind: 'builtin', skill: builtin }))
      expect(find(renderer, 'data-skill-detail-scrim', 'contained')).toHaveLength(1)
      expect(body.style.overflow).toBe('')
    } finally {
      doc.document = prevDoc
      doc.window = prevWin
    }
  })
})
