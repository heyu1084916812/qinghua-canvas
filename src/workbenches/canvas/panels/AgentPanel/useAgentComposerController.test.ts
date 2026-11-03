import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { MentionEditorHandle } from '../../text/MentionEditor'
import { saveAgentDraft } from './agentDraft'
import {
  useAgentComposerController,
  type AgentComposerControllerInput,
} from './useAgentComposerController'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true

type Hook = ReturnType<typeof useAgentComposerController>

const storage = new Map<string, string>()
const draftStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storage.set(key, value)
  },
}

const session: AgentSession = {
  id: 's1',
  projectId: 'project-1',
  title: '会话一',
  channelId: '',
  model: 'GPT-6 Astra',
  imageModel: 'GPT Image 2',
  videoModel: '',
  messages: [],
  pendingSteers: [],
  queuedTurns: [],
  createdAt: 1,
  updatedAt: 1,
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal(
    'window',
    Object.assign(Object.create(Object.prototype), {
      matchMedia: vi.fn(() => ({ matches: false })),
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      innerHeight: 900,
      localStorage: {
        getItem: draftStorage.getItem,
        setItem: draftStorage.setItem,
      },
    }),
  )
  storage.clear()
  vi.stubGlobal('localStorage', {
    getItem: draftStorage.getItem,
    setItem: draftStorage.setItem,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.useFakeTimers()
})

function input(
  patch: Partial<AgentComposerControllerInput> = {},
): AgentComposerControllerInput {
  return {
    session,
    draftStorage,
    pendingAssetIds: session.pendingAssetIds ?? [],
    onPendingAssetsChange: vi.fn(),
    panelRef: { current: null },
    trackRunSync: <T,>(work: () => T) => work(),
    ...patch,
  }
}

describe('useAgentComposerController', () => {
  it('恢复会话草稿，空文本显式清空后旧草稿不复活', () => {
    saveAgentDraft('s1', '旧草稿', draftStorage)
    const viewRef: { current: Hook | null } = { current: null }
    function Probe() {
      viewRef.current = useAgentComposerController(input())
      return null
    }
    act(() => {
      TestRenderer.create(createElement(Probe))
    })

    expect(viewRef.current?.draft).toBe('旧草稿')

    act(() => {
      viewRef.current?.replaceDraft('')
    })
    expect(viewRef.current?.draft).toBe('')

    act(() => {
      viewRef.current?.restoreForSession('s1')
    })
    expect(viewRef.current?.draft).toBe('')
  })

  it('切到新会话后不串旧草稿，并恢复新会话已存草稿', () => {
    saveAgentDraft('s2', '新会话草稿', draftStorage)
    const viewRef: { current: Hook | null } = { current: null }
    let root!: TestRenderer.ReactTestRenderer
    function Probe({ current }: { current: AgentSession }) {
      viewRef.current = useAgentComposerController(
        input({
          session: current,
          pendingAssetIds: current.pendingAssetIds ?? [],
        }),
      )
      return null
    }
    act(() => {
      root = TestRenderer.create(
        createElement(Probe, { current: session }),
      )
    })

    act(() => {
      viewRef.current?.replaceDraft('旧会话草稿')
      viewRef.current?.resetForSession('s2')
      root.update(
        createElement(Probe, {
          current: { ...session, id: 's2', title: '会话二' },
        }),
      )
    })

    expect(viewRef.current?.draft).toBe('新会话草稿')
  })

  it('mention 插入去重且由 editorRef 承担光标位置', () => {
    const viewRef: { current: Hook | null } = { current: null }
    function Probe() {
      viewRef.current = useAgentComposerController(input())
      return null
    }
    act(() => {
      TestRenderer.create(createElement(Probe))
    })
    const editor = {
      insertMention: vi.fn(),
    } as unknown as MentionEditorHandle
    viewRef.current!.editorRef.current = editor

    act(() => {
      viewRef.current?.insertMention('node', 'n1', '主图')
      viewRef.current?.insertMention('node', 'n1', '主图')
    })

    expect(editor.insertMention).toHaveBeenCalledTimes(1)
    expect(editor.insertMention).toHaveBeenCalledWith(
      '@[主图](node:n1)',
    )
  })

  it('draft 删除图片 chip 后 pendingAssetIds 同步，延迟 timer 在切会话清理', async () => {
    const onPendingAssetsChange = vi.fn()
    const viewRef: { current: Hook | null } = { current: null }
    let root!: TestRenderer.ReactTestRenderer
    function Probe() {
      viewRef.current = useAgentComposerController(
        input({ onPendingAssetsChange }),
      )
      return null
    }
    act(() => {
      root = TestRenderer.create(createElement(Probe))
    })

    act(() => {
      viewRef.current?.replaceDraft('无图片')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(160)
    })
    expect(onPendingAssetsChange).toHaveBeenCalledWith('s1', [])

    act(() => {
      viewRef.current?.replaceDraft('')
    })
    act(() => {
      viewRef.current?.resetForSession('s2')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(160)
    })
    expect(onPendingAssetsChange).toHaveBeenCalledTimes(1)

    act(() => {
      viewRef.current?.replaceDraft('')
    })
    act(() => {
      root.unmount()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(160)
    })
    expect(onPendingAssetsChange).toHaveBeenCalledTimes(1)
  })

  it('composer 高度读取、clamp、指针拖动与键盘调整', () => {
    const viewRef: { current: Hook | null } = { current: null }
    const panelRef = { current: null as HTMLElement | null }
    const panel = {
      closest: () => panel,
      getBoundingClientRect: () => ({ height: 700 }),
    } as unknown as HTMLElement
    panelRef.current = panel
    function Probe() {
      viewRef.current = useAgentComposerController(
        input({ panelRef }),
      )
      return null
    }
    act(() => {
      TestRenderer.create(createElement(Probe))
    })

    expect(viewRef.current?.composerHeight).toBe(104)

    const listeners = new Map<
      string,
      EventListener
    >()
    const windowAddEventListener = vi
      .spyOn(window, 'addEventListener')
      .mockImplementation((type, handler) => {
        listeners.set(String(type), handler as EventListener)
      })
    const removeEventListener = vi.spyOn(
      window,
      'removeEventListener',
    )
    act(() => {
      viewRef.current?.beginComposerResize({
        button: 0,
        preventDefault: vi.fn(),
        currentTarget: { focus: vi.fn() },
        clientY: 300,
      } as never)
    })
    listeners.get('pointermove')?.({ clientY: 260 } as never)
    listeners.get('pointerup')?.({} as never)
    expect(viewRef.current?.composerHeight).toBe(144)
    expect(
      removeEventListener.mock.calls.filter(([type]) =>
        ['pointermove', 'pointerup', 'pointercancel'].includes(String(type)),
      ),
    ).toHaveLength(3)
    windowAddEventListener.mockRestore()

    act(() => {
      viewRef.current?.resizeComposerWithKeyboard({
        key: 'ArrowUp',
        preventDefault: vi.fn(),
      } as never)
    })
    expect(viewRef.current?.composerHeight).toBe(160)
    act(() => {
      viewRef.current?.resizeComposerWithKeyboard({
        key: 'Home',
        preventDefault: vi.fn(),
      } as never)
    })
    expect(viewRef.current?.composerHeight).toBe(104)
  })

  it('picker 唯一开启，会话切换 reset 不改运行态', () => {
    const viewRef: { current: Hook | null } = { current: null }
    function Probe() {
      viewRef.current = useAgentComposerController(input())
      return null
    }
    act(() => {
      TestRenderer.create(createElement(Probe))
    })

    act(() => {
      viewRef.current?.setOpenPicker('agent-mention')
    })
    expect(viewRef.current?.openPicker).toBe('agent-mention')

    act(() => {
      viewRef.current?.resetForSession('s2')
    })
    expect(viewRef.current?.openPicker).toBeNull()
  })
})
