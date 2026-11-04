import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import { AgentPanelView } from './AgentPanelView'

vi.mock('./AgentPanelHeader', async () => {
  const { createElement } = await import('react')
  return { AgentPanelHeader: () => createElement('header') }
})
vi.mock('./AgentConversationPane', async () => {
  const { createElement } = await import('react')
  return { AgentConversationPane: () => createElement('main') }
})
vi.mock('./AgentComposerPane', async () => {
  const { createElement } = await import('react')
  return { AgentComposerPane: () => createElement('footer') }
})

const session: AgentSession = {
  id: 's1',
  projectId: 'p1',
  title: '会话一',
  channelId: '',
  model: 'GPT-6 Astra',
  messages: [],
  pendingSteers: [],
  queuedTurns: [],
  createdAt: 1,
  updatedAt: 1,
}

function renderView(overrides: Partial<{
  current: AgentSession | null
  openPicker: string | null
  onDismissPicker: () => void
  onDropFiles: (files: FileList | null) => void
}> = {}) {
  const props = {
    current: session,
    openPicker: 'agent-model',
    headerProps: {} as never,
    conversationProps: {} as never,
    composerProps: {} as never,
    onDismissPicker: vi.fn(),
    onDropFiles: vi.fn(),
    ...overrides,
  }
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(createElement(AgentPanelView, props))
  })
  return { props, renderer }
}

describe('AgentPanelView', () => {
  it('保留面板与当前会话标记，并组合三个视图壳', () => {
    const { renderer } = renderView()
    const panel = renderer.root.findByType('aside')

    expect(panel.props['data-agent-panel']).toBe(true)
    expect(panel.props['data-agent-session-id']).toBe('s1')
    expect(renderer.root.findByType('header')).toBeTruthy()
    expect(renderer.root.findByType('main')).toBeTruthy()
    expect(renderer.root.findByType('footer')).toBeTruthy()
  })

  it('浮层开启时 Esc 只关闭浮层并阻止继续冒泡', () => {
    const onDismissPicker = vi.fn()
    const { renderer } = renderView({ onDismissPicker })
    const event = {
      key: 'Escape',
      preventDefault: vi.fn(),
    }

    act(() => {
      renderer.root.findByType('aside').props.onKeyDown(event)
    })

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(onDismissPicker).toHaveBeenCalledTimes(1)
  })

  it('没有浮层时 Esc 不拦截下游快捷键', () => {
    const onDismissPicker = vi.fn()
    const { renderer } = renderView({ openPicker: null, onDismissPicker })
    const handler = renderer.root.findByType('aside').props.onKeyDown
    /** #930：监听**确实挂上了**才算数 —— 否则下面两条"没调用"是空转。 */
    expect(typeof handler).toBe('function')

    const event = {
      key: 'Escape',
      preventDefault: vi.fn(),
    }

    act(() => {
      handler(event)
    })

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(onDismissPicker).not.toHaveBeenCalled()
  })

  it('有浮层但不是 Esc：同样放行（key 判断也是活的）', () => {
    const onDismissPicker = vi.fn()
    const { renderer } = renderView({ openPicker: 'agent-model', onDismissPicker })
    const event = {
      key: 'a',
      preventDefault: vi.fn(),
    }

    act(() => {
      renderer.root.findByType('aside').props.onKeyDown(event)
    })

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(onDismissPicker).not.toHaveBeenCalled()
  })

  it('拖入文件时阻止默认打开，并把文件交给显式端口', () => {
    const onDropFiles = vi.fn()
    const { renderer } = renderView({ onDropFiles })
    const files = [{ name: 'a.png' }] as unknown as FileList
    const event = {
      preventDefault: vi.fn(),
      dataTransfer: { files },
    }

    act(() => {
      renderer.root.findByType('aside').props.onDrop(event)
    })

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(onDropFiles).toHaveBeenCalledWith(files)
  })
})
