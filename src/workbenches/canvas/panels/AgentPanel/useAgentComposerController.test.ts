import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import {
  mentionToken,
  type MentionEditorHandle,
} from '../../text/MentionEditor'
import { TaskLifecycleClosedError } from '../../../../features/shared/lifecycle/taskLifecycle'
import { loadAgentDraft, saveAgentDraft } from './agentDraft'
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

/**
 * #938：只补"用户能感觉到"的分支。
 *
 * 覆盖范围：草稿持久化失败、mention 增删同步附件账、切会话不覆盖正在写的草稿、
 * 按 pendingAssetIds 重建 chip、右键拖拽不改高度、键盘上下限与普通键放行。
 * 纯 getter / SSR / 端口透传不补。
 */
describe('useAgentComposerController · 用户可见分支', () => {
  function renderHook(props: AgentComposerControllerInput) {
    const viewRef: { current: Hook | null } = { current: null }
    function Probe() {
      viewRef.current = useAgentComposerController(props)
      return null
    }
    let root!: TestRenderer.ReactTestRenderer
    act(() => {
      root = TestRenderer.create(createElement(Probe))
    })
    return {
      get: () => viewRef.current!,
      unmount: () => act(() => root.unmount()),
    }
  }

  it('★★ 草稿持久化失败：关停时静默返回 false，其它错误照抛（不许假装存上了）', () => {
    const closed = renderHook(
      input({
        trackRunSync: () => {
          throw new TaskLifecycleClosedError()
        },
      }),
    )
    expect(closed.get().writeDraftForSession('s1', 'x')).toBe(false)
    expect(closed.get().clearDraftForSession('s1')).toBe(false)

    const boom = new Error('storage full')
    const failing = renderHook(
      input({
        trackRunSync: () => {
          throw boom
        },
      }),
    )
    expect(() => failing.get().writeDraftForSession('s1', 'x')).toThrow(
      boom,
    )
    expect(() => failing.get().clearDraftForSession('s1')).toThrow(boom)
  })

  it('★★ 删掉正文里的图片 chip：附件账立即同步（不留幽灵附件）', () => {
    const onPendingAssetsChange = vi.fn()
    const h = renderHook(
      input({ pendingAssetIds: ['img-1'], onPendingAssetsChange }),
    )
    const withChip = mentionToken('node', 'img-1', '图一')

    // chip 还在：账不变，不许乱通知
    act(() => {
      h.get().replaceDraft(withChip)
    })
    expect(onPendingAssetsChange).not.toHaveBeenCalled()

    // chip 被删掉：立刻把 img-1 从附件账里拿掉
    act(() => {
      h.get().replaceDraft('只剩文字')
    })
    expect(onPendingAssetsChange).toHaveBeenLastCalledWith('s1', [])
  })

  it('★★ 切会话时正在写的草稿不被已存草稿覆盖', () => {
    saveAgentDraft('s2', '上次存的新会话草稿', draftStorage)
    const ref: { current: Hook | null } = { current: null }
    let root!: TestRenderer.ReactTestRenderer
    function Probe({ current }: { current: AgentSession }) {
      ref.current = useAgentComposerController(
        input({
          session: current,
          pendingAssetIds: current.pendingAssetIds ?? [],
        }),
      )
      return null
    }
    act(() => {
      root = TestRenderer.create(createElement(Probe, { current: session }))
    })
    act(() => {
      ref.current?.replaceDraft('我正在写的半句')
    })

    act(() => {
      root.update(
        createElement(Probe, {
          current: { ...session, id: 's2', title: '会话二' },
        }),
      )
    })

    expect(ref.current?.draft).toBe('我正在写的半句')
  })

  it('★★ 切回没有草稿但带附件的会话：按 pendingAssetIds 重建 chip', () => {
    const withAssets = {
      ...session,
      id: 's3',
      title: '会话三',
      pendingAssetIds: ['img-9'],
    }
    const h = renderHook(
      input({ session: withAssets, pendingAssetIds: ['img-9'] }),
    )

    expect(h.get().draft).toBe(mentionToken('node', 'img-9', 'img-9'))
    expect(loadAgentDraft('s3', draftStorage)).toBe(
      mentionToken('node', 'img-9', 'img-9'),
    )
  })

  it('★ 右键/中键按在手柄上：不改高度、也不抢焦点', () => {
    const h = renderHook(input())
    const preventDefault = vi.fn()
    const focus = vi.fn()

    act(() => {
      h.get().beginComposerResize({
        button: 2,
        clientY: 300,
        preventDefault,
        currentTarget: { focus },
      })
    })
    expect(preventDefault).not.toHaveBeenCalled()
    expect(focus).not.toHaveBeenCalled()
    expect(h.get().composerResizing).toBe(false)

    // 对照：左键必须进入拖拽态
    act(() => {
      h.get().beginComposerResize({
        button: 0,
        clientY: 300,
        preventDefault,
        currentTarget: { focus },
      })
    })
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(focus).toHaveBeenCalledTimes(1)
    expect(h.get().composerResizing).toBe(true)
  })

  it('★★ 键盘微调：↑↓ 各自加减、End 到上限、普通键不拦截', () => {
    const panel = {
      closest: () => panel,
      getBoundingClientRect: () => ({ height: 700 }),
    } as unknown as HTMLElement
    const h = renderHook(input({ panelRef: { current: panel } }))
    expect(h.get().composerHeight).toBe(104)

    act(() => {
      h.get().resizeComposerWithKeyboard({
        key: 'ArrowUp',
        preventDefault: vi.fn(),
      })
    })
    act(() => {
      h.get().resizeComposerWithKeyboard({
        key: 'ArrowUp',
        preventDefault: vi.fn(),
      })
    })
    expect(h.get().composerHeight).toBe(136)

    act(() => {
      h.get().resizeComposerWithKeyboard({
        key: 'ArrowDown',
        preventDefault: vi.fn(),
      })
    })
    expect(h.get().composerHeight).toBe(120)

    act(() => {
      h.get().resizeComposerWithKeyboard({
        key: 'End',
        preventDefault: vi.fn(),
      })
    })
    const atEnd = h.get().composerHeight
    expect(atEnd).toBeGreaterThan(136)

    // 普通按键必须放行（不然会吞掉用户输入）
    const plain = vi.fn()
    act(() => {
      h.get().resizeComposerWithKeyboard({ key: 'a', preventDefault: plain })
    })
    expect(plain).not.toHaveBeenCalled()
    expect(h.get().composerHeight).toBe(atEnd)
  })
})
