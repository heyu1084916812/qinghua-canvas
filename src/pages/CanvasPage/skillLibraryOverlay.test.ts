import { createElement } from 'react'
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { focusTrapTarget } from './skillLibraryFocus'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { navigateMock, sendMock, viewProps } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  sendMock: vi.fn(),
  viewProps: { current: null as null | Record<string, unknown> },
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateMock }))
vi.mock('../../features/canvas/agentSkillHandoff', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  sendSkillToAgent: sendMock,
}))
// 共享视图在 SkillsPage 自己的测试里覆盖；这里只验证浮层外壳与投递出口。
vi.mock('../SkillsPage/SkillLibraryView', () => ({
  SkillLibraryView: (props: Record<string, unknown>) => {
    viewProps.current = props
    return null
  },
}))
vi.mock('../SkillsPage/useSkillLibraryState', () => ({
  useSkillLibraryState: (onAdd: (skill: { id: string; name: string }) => unknown) => ({
    detail: (globalThis as { __detail?: unknown }).__detail ?? null,
    notice: null,
    onAdd,
  }),
}))

type Listener = (event: { key: string; preventDefault(): void }) => void
let listeners: Listener[] = []
beforeEach(() => {
  listeners = []
  sendMock.mockReset()
  navigateMock.mockReset()
  ;(globalThis as { __detail?: unknown }).__detail = null
  vi.stubGlobal('window', {
    addEventListener: (_: string, fn: Listener) => listeners.push(fn),
    removeEventListener: (_: string, fn: Listener) => { listeners = listeners.filter((item) => item !== fn) },
  })
  vi.stubGlobal('document', { activeElement: null })
  vi.stubGlobal('HTMLElement', class {})
})
afterEach(() => vi.unstubAllGlobals())

const press = (key: string) => act(() => listeners.forEach((fn) => fn({ key, preventDefault() {} })))

async function mountOverlay() {
  const { SkillLibraryOverlay } = await import('./SkillLibraryOverlay')
  const onClose = vi.fn()
  const onOpenSkillsPage = vi.fn()
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(createElement(SkillLibraryOverlay, { projectId: 'p1', onClose, onOpenSkillsPage }))
  })
  return { renderer, onClose, onOpenSkillsPage }
}

describe('focusTrapTarget', () => {
  it('Tab 到末尾回到开头，Shift+Tab 到开头回到末尾，中间不接管', () => {
    const list = ['a', 'b', 'c']
    expect(focusTrapTarget(list, 'c', false)).toBe('a')
    expect(focusTrapTarget(list, 'a', true)).toBe('c')
    expect(focusTrapTarget(list, 'b', false)).toBeNull()
    expect(focusTrapTarget(list, null, false)).toBe('a')
    expect(focusTrapTarget([], null, true)).toBeNull()
  })
})

describe('SkillLibraryOverlay', () => {
  it('是带标题的模态对话框，内容是共享的 SkillLibraryView（contained）', async () => {
    const { renderer } = await mountOverlay()
    const dialog = renderer.root.find((node) => node.props['data-skill-library-dialog'] !== undefined)
    expect(dialog.props.role).toBe('dialog')
    expect(dialog.props['aria-modal']).toBe('true')
    expect(viewProps.current?.contained).toBe(true)
  })

  it('加入 Agent 投递给本项目的技能 handoff，并给出可继续添加的提示', async () => {
    await mountOverlay()
    const state = viewProps.current!.state as { onAdd: (s: { id: string; name: string }) => string }
    expect(state.onAdd({ id: 'builtin:image-logo', name: 'Logo' })).toContain('可继续添加')
    expect(sendMock).toHaveBeenCalledWith('p1', 'builtin:image-logo')
  })

  it('× 与 Esc 关闭；详情打开时 Esc 只关详情', async () => {
    const { renderer, onClose } = await mountOverlay()
    act(() => renderer.root.find((node) => node.props['data-skill-library-close'] !== undefined).props.onClick())
    expect(onClose).toHaveBeenCalledTimes(1)
    press('Escape')
    expect(onClose).toHaveBeenCalledTimes(2)
    ;(globalThis as { __detail?: unknown }).__detail = { kind: 'builtin', skill: { id: 'x' } }
    const second = await mountOverlay()
    listeners = listeners.slice(-1)
    press('Escape')
    expect(second.onClose).not.toHaveBeenCalled()
  })

  it('点背景关闭；新建 / 预设词去完整技能页', async () => {
    const { renderer, onClose, onOpenSkillsPage } = await mountOverlay()
    const backdrop = renderer.root.find((node) => node.props['data-skill-library-backdrop'] !== undefined)
    act(() => backdrop.props.onPointerDown({ target: 1, currentTarget: 1 }))
    expect(onClose).toHaveBeenCalled()
    ;(viewProps.current!.onNew as () => void)()
    expect(onOpenSkillsPage).toHaveBeenCalled()
  })
})

describe('CanvasSkillLibraryHost', () => {
  it('收到本项目的「打开技能库」请求才挂浮层；去技能页时先关浮层', async () => {
    const { CanvasSkillLibraryHost } = await import('./CanvasSkillLibraryHost')
    const { requestAgentSkillLibrary } = await import('../../features/canvas/agentSkillHandoff')
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(createElement(CanvasSkillLibraryHost, { projectId: 'host-p' }))
    })
    expect(renderer.toJSON()).toBeNull()
    expect(requestAgentSkillLibrary('other')).toBe(false)
    await act(async () => {
      expect(requestAgentSkillLibrary('host-p')).toBe(true)
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(renderer.root.findAll((node) => node.props['data-skill-library-overlay'] !== undefined)).toHaveLength(1)
    await act(async () => {
      ;(viewProps.current!.onOpenPresets as () => void)()
    })
    expect(navigateMock).toHaveBeenCalledWith('/skills')
    expect(renderer.root.findAll((node) => node.props['data-skill-library-overlay'] !== undefined)).toHaveLength(0)
    act(() => renderer.unmount())
    expect(requestAgentSkillLibrary('host-p')).toBe(false)
  })
})
