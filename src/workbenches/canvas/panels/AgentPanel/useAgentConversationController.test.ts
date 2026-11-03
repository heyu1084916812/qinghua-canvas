import { createElement, useRef } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationItem } from './conversation'
import {
  useAgentConversationController,
  type AgentConversationController,
} from './useAgentConversationController'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true

type Hook = ReturnType<typeof useAgentConversationController>

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal(
    'window',
    Object.assign(Object.create(Object.prototype), {
      matchMedia: vi.fn(() => ({ matches: false })),
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.useFakeTimers()
})

function text(text: string): ConversationItem {
  return { kind: 'text', text }
}

describe('useAgentConversationController', () => {
  it('流式 reveal 按 tick 增长，完成时清空且旧会话不覆盖新状态', async () => {
    const viewRef: { current: AgentConversationController | null } = {
      current: null,
    }
    let root!: TestRenderer.ReactTestRenderer
    function Probe() {
      const scrollRef = useRef<HTMLDivElement | null>(null)
      viewRef.current = useAgentConversationController({
        items: [text('1234567890')],
        sessionId: 's1',
        messages: [],
        status: null,
        taskPlan: undefined,
        queuedCount: 0,
        pendingCount: 0,
        composerHeight: 104,
        scrollRef,
        conversationViewportRef: {
          current: null,
        } as never,
      })
      return null
    }
    act(() => {
      root = TestRenderer.create(createElement(Probe))
    })
    act(() => {
      viewRef.current?.beginReveal('s1', '1234567890')
    })
    expect(viewRef.current?.messageReveal).toMatchObject({
      sessionId: 's1',
      fullText: '1234567890',
      visibleLength: 1,
    })
    expect(viewRef.current?.visibleItems).toEqual([
      { kind: 'text', text: '1' },
    ])

    await act(async () => {
      await vi.advanceTimersByTimeAsync(24)
    })
    expect(viewRef.current?.messageReveal?.visibleLength).toBe(2)

    expect(viewRef.current?.visibleItems).toEqual([
      { kind: 'text', text: '12' },
    ])

    for (let tick = 0; tick < 20; tick += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(24)
      })
      if (!viewRef.current?.messageReveal) break
    }
    expect(viewRef.current?.messageReveal).toBeNull()

    act(() => {
      viewRef.current?.beginReveal('s2', '1234567890')
    })
    for (let tick = 0; tick < 20; tick += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(24)
      })
      if (!viewRef.current?.messageReveal) break
    }
    expect(viewRef.current?.messageReveal).toBeNull()

    act(() => root.unmount())
  })

  it('保留 outcome 传入的初始 reveal 长度', () => {
    let hook!: Hook
    function Probe() {
      const scrollRef = useRef<HTMLDivElement | null>(null)
      hook = useAgentConversationController({
        items: [text('abc')],
        sessionId: 's1',
        messages: [],
        status: null,
        taskPlan: undefined,
        queuedCount: 0,
        pendingCount: 0,
        composerHeight: 104,
        scrollRef,
        conversationViewportRef: { current: null } as never,
      })
      return null
    }
    act(() => {
      TestRenderer.create(createElement(Probe))
    })

    act(() => {
      hook.beginReveal('s1', 'abc', 0)
    })
    expect(hook.messageReveal?.visibleLength).toBe(0)
    expect(hook.visibleItems).toEqual([{ kind: 'text', text: '' }])
  })

  it('visibleItems 只改写匹配的文本项，且不复制会话真相', () => {
    let hook!: Hook
    function Probe() {
      const scrollRef = useRef<HTMLDivElement | null>(null)
      hook = useAgentConversationController({
        items: [
          { kind: 'text', text: 'same' },
          { kind: 'user', text: 'hi' },
          { kind: 'text', text: 'same' },
        ],
        sessionId: 's1',
        messages: [],
        status: null,
        taskPlan: undefined,
        queuedCount: 0,
        pendingCount: 0,
        composerHeight: 104,
        scrollRef,
        conversationViewportRef: {
          current: null,
        } as never,
      })
      return null
    }
    act(() => {
      TestRenderer.create(createElement(Probe))
    })

    act(() => {
      hook.beginReveal('s1', 'same')
    })

    expect(hook.streamingTextIndex).toBe(2)
    expect(hook.visibleItems[0]).toEqual({ kind: 'text', text: 'same' })
    expect(hook.visibleItems[2]).toEqual({ kind: 'text', text: 's' })
  })

  it('expanded toggle 不共享旧 Set 引用', () => {
    let hook!: Hook
    function Probe() {
      const scrollRef = useRef<HTMLDivElement | null>(null)
      hook = useAgentConversationController({
        items: [],
        sessionId: 's1',
        messages: [],
        status: null,
        taskPlan: undefined,
        queuedCount: 0,
        pendingCount: 0,
        composerHeight: 104,
        scrollRef,
        conversationViewportRef: {
          current: null,
        } as never,
      })
      return null
    }
    act(() => {
      TestRenderer.create(createElement(Probe))
    })

    const before = hook.expanded
    act(() => {
      hook.toggleStep('step-1')
    })
    expect(hook.expanded).not.toBe(before)
    expect([...hook.expanded]).toEqual(['step-1'])
    expect([...before]).toEqual([])
  })

  it('自动跟随显示 jump；用户上滚后不再自动回底；可跳回', async () => {
    let hook!: Hook
    const scrollEl: {
      scrollTop: number
      scrollHeight: number
      clientHeight: number
      scrollTo: ReturnType<typeof vi.fn>
    } = {
      scrollTop: 700,
      scrollHeight: 1200,
      clientHeight: 200,
      scrollTo: vi.fn(),
    }
    const conversationViewportRef = {
      current: null,
    } as never
    const scrollRef = {
      current: scrollEl,
    } as never
    function Probe() {
      hook = useAgentConversationController({
        items: [],
        sessionId: 's1',
        messages: [{ id: 'm1' }] as never,
        status: null,
        taskPlan: undefined,
        queuedCount: 0,
        pendingCount: 0,
        composerHeight: 104,
        scrollRef,
        conversationViewportRef,
      })
      return null
    }
    act(() => {
      TestRenderer.create(createElement(Probe))
    })

    expect(hook.showJumpToLatest).toBe(false)

    scrollEl.scrollTop = 700
    act(() => {
      hook.onConversationScroll()
    })
    expect(hook.showJumpToLatest).toBe(true)

    await act(async () => {
      hook.jumpToLatest()
      await Promise.resolve()
    })
    expect(scrollEl.scrollTo).toHaveBeenCalledWith({
      top: 1200,
      behavior: 'smooth',
    })
  })

  it('composer 收缩时按 viewport 前后高度修正滚动', () => {
    let hook!: Hook
    const scrollEl: {
      scrollTop: number
      scrollHeight: number
      clientHeight: number
      scrollTo: ReturnType<typeof vi.fn>
    } = {
      scrollTop: 0,
      scrollHeight: 1000,
      clientHeight: 200,
      scrollTo: vi.fn(),
    }
    const conversationViewportRef = {
      current: null,
    } as never
    const scrollRef = {
      current: scrollEl,
    } as never
    function Probe(props: { composerHeight: number }) {
      hook = useAgentConversationController({
        items: [],
        sessionId: 's1',
        messages: [{ id: 'm1' }] as never,
        status: null,
        taskPlan: undefined,
        queuedCount: 0,
        pendingCount: 0,
        composerHeight: props.composerHeight,
        scrollRef,
        conversationViewportRef,
      })
      return null
    }
    let root!: TestRenderer.ReactTestRenderer
    act(() => {
      root = TestRenderer.create(
        createElement(Probe, { composerHeight: 104 }),
      )
    })

    scrollEl.scrollTop = 500
    act(() => {
      hook.onConversationScroll()
    })

    scrollEl.clientHeight = 140
    act(() => {
      root.update(createElement(Probe, { composerHeight: 164 }))
    })
    expect(scrollEl.scrollTop).toBe(560)
    act(() => root.unmount())
  })

  it('切会话 reset 清 reveal、jump 并恢复跟随', () => {
    let hook!: Hook
    function Probe() {
      const scrollRef = useRef<HTMLDivElement | null>(null)
      hook = useAgentConversationController({
        items: [],
        sessionId: 's1',
        messages: [],
        status: null,
        taskPlan: undefined,
        queuedCount: 0,
        pendingCount: 0,
        composerHeight: 104,
        scrollRef,
        conversationViewportRef: { current: null } as never,
      })
      return null
    }
    act(() => {
      TestRenderer.create(createElement(Probe))
    })

    act(() => {
      hook.beginReveal('s1', 'old')
    })
    act(() => {
      hook.resetForSessionSwitch()
    })

    expect(hook.messageReveal).toBeNull()
    expect(hook.showJumpToLatest).toBe(false)
    expect(hook.stickToLatestRef.current).toBe(true)
  })
})
