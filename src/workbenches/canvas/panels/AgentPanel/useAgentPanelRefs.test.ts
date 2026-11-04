import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import { AgentSessionRuntimeState } from './agentSessionRuntime'
import { useAgentPanelRefs, type AgentPanelRefs } from './useAgentPanelRefs'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true

function mount(): {
  ref: { current: AgentPanelRefs | null }
  rerender: () => void
  unmount: () => void
} {
  const ref: { current: AgentPanelRefs | null } = { current: null }
  function Probe() {
    ref.current = useAgentPanelRefs()
    return null
  }
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(createElement(Probe))
  })
  return {
    ref,
    rerender: () => {
      act(() => {
        renderer.update(createElement(Probe))
      })
    },
    unmount: () => {
      act(() => {
        renderer.unmount()
      })
    },
  }
}

describe('useAgentPanelRefs', () => {
  /**
   * 这一条是本次拆分的核心不变式：**每个会话桶只有一个宿主**。
   * 如果有人把某个 Map 又在别的 hook 里 `useRef` 一份，两份状态的症状会在
   * 「停止按钮停不掉 / 切换会话后引导丢失」时才暴露，所以这里从对象身份上钉死。
   */
  it('每个桶都是独立对象，没有两个 ref 共用同一个 Map / Set', () => {
    const { ref } = mount()
    const value = ref.current!

    const buckets = [
      value.queuePumpingRef.current,
      value.confirmingRef.current,
      value.stoppingRef.current,
      value.inFlightConfirmationRef.current,
      value.abortRefs.current,
      value.toolModeRef.current,
      value.turnToolsRef.current,
      value.currentTurnIdRef.current,
      value.currentTurnJobIdRef.current,
      value.currentTurnRevisionRef.current,
      value.planAliasesRef.current,
      value.explicitMediaModelsRef.current,
      value.deliveredSteersRef.current,
      value.contextTraceRef.current,
    ]

    expect(new Set(buckets).size).toBe(buckets.length)
    for (const bucket of buckets) {
      expect(bucket.size).toBe(0)
    }
  })

  it('重渲染保持引用不变（换身份就等于清空所有会话的瞬时状态）', () => {
    const { ref, rerender } = mount()
    const first = ref.current!
    const firstAbort = first.abortRefs
    first.abortRefs.current.set('s1', new AbortController())

    rerender()

    expect(ref.current!.abortRefs).toBe(firstAbort)
    expect(ref.current!.abortRefs.current.has('s1')).toBe(true)
    expect(ref.current!.queuePumpingRef).toBe(first.queuePumpingRef)
  })

  it('两个面板实例各有一份（不共用模块级单例）', () => {
    const one = mount()
    const two = mount()

    expect(one.ref.current!.abortRefs).not.toBe(two.ref.current!.abortRefs)
    expect(one.ref.current!.sessionRuntimeRef.current).not.toBe(
      two.ref.current!.sessionRuntimeRef.current,
    )
  })

  it('sessionRuntimeRef 装的是 AgentSessionRuntimeState，不是空对象', () => {
    const { ref } = mount()
    expect(ref.current!.sessionRuntimeRef.current).toBeInstanceOf(
      AgentSessionRuntimeState,
    )
  })

  it('confirmRef / queuePumpRef 的默认实现可安全调用（未赋值时不炸）', async () => {
    const { ref } = mount()
    await expect(ref.current!.confirmRef.current()).resolves.toBeUndefined()
    expect(() => ref.current!.queuePumpRef.current('s1')).not.toThrow()
  })
})
