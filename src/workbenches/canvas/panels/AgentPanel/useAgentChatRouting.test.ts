import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { Channel } from '../../../../domain/project/channel'
import type { RoutePlanResult } from '../../../../domain/project/routePlan'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import {
  useAgentChatRouting,
  type AgentChatRoutingInput,
} from './useAgentChatRouting'

type Hook = ReturnType<typeof useAgentChatRouting>

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true

function session(id: string, model: string): AgentSession {
  return {
    id,
    projectId: 'p1',
    title: `会话 ${id}`,
    channelId: '',
    model,
    messages: [],
    pendingSteers: [],
    queuedTurns: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

function planResult(
  logicalModel: string,
  channelId: string,
  upstreamModel: string,
): RoutePlanResult {
  return {
    ok: true,
    plan: {
      logicalModel,
      capability: 'chat',
      strategy: 'priority',
      maxAttempts: 1,
      cursor: 0,
      nextCursor: 1,
      cursorModulus: 1,
      candidates: [
        {
          key: `${channelId}:${upstreamModel}`,
          channelId,
          logicalModel,
          upstreamModel,
          capability: 'chat',
          priority: 1,
          groupPriority: 1,
          weight: 1,
          latencyMs: null,
        },
      ],
    },
  }
}

function emptyPlan(logicalModel: string): RoutePlanResult {
  const planned = planResult(logicalModel, 'unused', 'unused')
  if (!planned.ok) return planned
  return {
    ok: true,
    plan: {
      ...planned.plan,
      candidates: [],
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

function input(
  patch: Partial<AgentChatRoutingInput> = {},
): AgentChatRoutingInput {
  return {
    channels: {
      planGenerationRoute: vi.fn(async ({ logicalModel }) =>
        planResult(logicalModel, 'channel-1', 'upstream-1'),
      ),
      completeWithTools: vi.fn() as never,
    } as AgentChatRoutingInput['channels'],
    allChannels: [] as Channel[],
    ...patch,
  }
}

function render(props: AgentChatRoutingInput): {
  viewRef: { current: Hook | null }
  update: (
    next: AgentChatRoutingInput,
    afterUpdate?: () => void,
  ) => void
  updateWithoutPassiveEffects: (next: AgentChatRoutingInput) => void
} {
  const viewRef: { current: Hook | null } = { current: null }
  function Probe(next: AgentChatRoutingInput) {
    viewRef.current = useAgentChatRouting(next)
    return null
  }
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(createElement(Probe, props))
  })
  return {
    viewRef,
    update: (next, afterUpdate) => {
      act(() => {
        renderer.update(createElement(Probe, next))
        afterUpdate?.()
      })
    },
    updateWithoutPassiveEffects: (next) => {
      const previous = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
      reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
      try {
        renderer.update(createElement(Probe, next))
      } finally {
        reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previous
      }
    },
  }
}

describe('useAgentChatRouting', () => {
  it('同模型 cache hit，换逻辑模型 miss，fresh 强制重新计划', async () => {
    const planned = vi.fn(async ({ logicalModel }) =>
      planResult(logicalModel, `channel-${logicalModel}`, `up-${logicalModel}`),
    )
    const props = input({
      channels: {
        planGenerationRoute: planned,
        completeWithTools: vi.fn() as never,
      } as AgentChatRoutingInput['channels'],
    })
    const { viewRef } = render(props)
    const first = session('s1', 'model-a')

    let routeA!: Awaited<ReturnType<Hook['prepareChatRoute']>>
    await act(async () => {
      routeA = await viewRef.current!.prepareChatRoute(first)
    })
    expect(routeA.ok).toBe(true)
    expect(viewRef.current!.cachedChatRoute(first)).toBe(
      routeA.ok ? routeA.route : null,
    )
    expect(planned).toHaveBeenCalledTimes(1)

    await act(async () => {
      const hit = await viewRef.current!.prepareChatRoute(first)
      expect(hit.ok && hit.route).toBe(
        routeA.ok ? routeA.route : null,
      )
    })
    expect(planned).toHaveBeenCalledTimes(1)

    const second = { ...first, model: 'model-b' }
    await act(async () => {
      const changed = await viewRef.current!.prepareChatRoute(second)
      expect(changed.ok && changed.route.logicalModel).toBe('model-b')
    })
    expect(planned).toHaveBeenCalledTimes(2)

    await act(async () => {
      await viewRef.current!.prepareChatRoute(second, true)
    })
    expect(planned).toHaveBeenCalledTimes(3)
  })

  it('同 session A 慢 B 快时 cache 只接受 B', async () => {
    const firstPlan = deferred<RoutePlanResult>()
    const secondPlan = deferred<RoutePlanResult>()
    const planned = vi
      .fn<AgentChatRoutingInput['channels']['planGenerationRoute']>()
      .mockImplementationOnce(() => firstPlan.promise)
      .mockImplementationOnce(() => secondPlan.promise)
    const props = input({
      channels: {
        planGenerationRoute: planned,
        completeWithTools: vi.fn() as never,
      } as AgentChatRoutingInput['channels'],
    })
    const { viewRef } = render(props)
    const target = session('s1', 'model-a')

    let slow!: ReturnType<Hook['prepareChatRoute']>
    let fast!: ReturnType<Hook['prepareChatRoute']>
    act(() => {
      slow = viewRef.current!.prepareChatRoute(target, true)
      fast = viewRef.current!.prepareChatRoute(target, true)
    })
    await act(async () => {
      secondPlan.resolve(planResult('model-a', 'channel-b', 'up-b'))
      await fast
    })
    expect(viewRef.current!.cachedChatRoute(target)?.channelId).toBe(
      'channel-b',
    )

    let slowResult!: Awaited<ReturnType<Hook['prepareChatRoute']>>
    await act(async () => {
      firstPlan.resolve(planResult('model-a', 'channel-a', 'up-a'))
      slowResult = await slow
    })
    expect(slowResult.ok && slowResult.route.channelId).toBe('channel-a')
    expect(viewRef.current!.cachedChatRoute(target)?.channelId).toBe(
      'channel-b',
    )
  })

  it('clear 后旧 prepare 晚归不得写回缓存', async () => {
    const pending = deferred<RoutePlanResult>()
    const props = input({
      channels: {
        planGenerationRoute: vi.fn(() => pending.promise),
        completeWithTools: vi.fn() as never,
      } as AgentChatRoutingInput['channels'],
    })
    const { viewRef } = render(props)
    const target = session('s1', 'model-a')

    let preparing!: ReturnType<Hook['prepareChatRoute']>
    act(() => {
      preparing = viewRef.current!.prepareChatRoute(target, true)
      viewRef.current!.clearChatRoute(target.id)
    })
    await act(async () => {
      pending.resolve(planResult('model-a', 'channel-a', 'up-a'))
      await preparing
    })
    expect(viewRef.current!.cachedChatRoute(target)).toBeNull()
  })

  it('route success 回写使用对象身份 CAS', async () => {
    const props = input()
    const { viewRef } = render(props)
    const target = session('s1', 'model-a')
    let prepared!: Awaited<ReturnType<Hook['prepareChatRoute']>>
    await act(async () => {
      prepared = await viewRef.current!.prepareChatRoute(target)
    })
    if (!prepared.ok) throw new Error('route preparation failed')
    const base = prepared.route
    const promoted = {
      ...base,
      channelId: 'channel-2',
      upstreamModel: 'up-2',
    }

    expect(viewRef.current!.commitChatRoute(target.id, base, promoted)).toBe(
      true,
    )
    expect(viewRef.current!.cachedChatRoute(target)).toBe(promoted)
    expect(
      viewRef.current!.commitChatRoute(target.id, base, {
        ...base,
        channelId: 'stale',
      }),
    ).toBe(false)
    expect(viewRef.current!.cachedChatRoute(target)).toBe(promoted)

    viewRef.current!.clearChatRoute(target.id)
    expect(
      viewRef.current!.commitChatRoute(target.id, promoted, promoted),
    ).toBe(false)
    expect(viewRef.current!.cachedChatRoute(target)).toBeNull()
  })

  it('渠道配置变化会清除已有缓存并使在途路由失效', async () => {
    const pending = deferred<RoutePlanResult>()
    const planned = vi
      .fn<AgentChatRoutingInput['channels']['planGenerationRoute']>()
      .mockResolvedValueOnce(planResult('model-a', 'channel-a', 'up-a'))
      .mockImplementationOnce(() => pending.promise)
    const props = input({
      channels: {
        planGenerationRoute: planned,
        completeWithTools: vi.fn() as never,
      } as AgentChatRoutingInput['channels'],
    })
    const { viewRef, updateWithoutPassiveEffects } = render(props)
    const target = session('s1', 'model-a')

    let prepared!: Awaited<ReturnType<Hook['prepareChatRoute']>>
    await act(async () => {
      prepared = await viewRef.current!.prepareChatRoute(target, true)
    })
    if (!prepared.ok) throw new Error('route preparation failed')
    const oldBaseRoute = prepared.route
    expect(viewRef.current!.cachedChatRoute(target)).not.toBeNull()
    updateWithoutPassiveEffects({
      ...props,
      allChannels: [] as Channel[],
    })
    expect(viewRef.current!.cachedChatRoute(target)).toBeNull()
    expect(
      viewRef.current!.commitChatRoute(target.id, oldBaseRoute, {
        ...oldBaseRoute,
        channelId: 'channel-stale',
      }),
    ).toBe(false)
    expect(viewRef.current!.cachedChatRoute(target)).toBeNull()

    let preparing!: ReturnType<Hook['prepareChatRoute']>
    act(() => {
      preparing = viewRef.current!.prepareChatRoute(target, true)
    })
    updateWithoutPassiveEffects({
      ...props,
      allChannels: [] as Channel[],
    })
    await act(async () => {
      pending.resolve(planResult('model-a', 'channel-a', 'up-a'))
      await preparing
    })
    expect(viewRef.current!.cachedChatRoute(target)).toBeNull()
  })

  it('错误映射保持原有文案', async () => {
    const planned = vi
      .fn<AgentChatRoutingInput['channels']['planGenerationRoute']>()
      .mockResolvedValueOnce({ ok: false, reason: 'no_token' })
      .mockResolvedValueOnce({ ok: false, reason: 'policy_excluded' })
      .mockResolvedValueOnce({ ok: false, reason: 'model_missing' })
      .mockResolvedValueOnce(emptyPlan('model-a'))
    const props = input({
      channels: {
        planGenerationRoute: planned,
        completeWithTools: vi.fn() as never,
      } as AgentChatRoutingInput['channels'],
    })
    const { viewRef } = render(props)
    const target = session('s1', 'model-a')

    await act(async () => {
      await expect(
        viewRef.current!.prepareChatRoute(target, true),
      ).resolves.toEqual({
        ok: false,
        message: '「model-a」的 Key 还未配置',
      })
      await expect(
        viewRef.current!.prepareChatRoute(target, true),
      ).resolves.toEqual({
        ok: false,
        message: '「model-a」已被当前路由范围排除',
      })
      await expect(
        viewRef.current!.prepareChatRoute(target, true),
      ).resolves.toEqual({
        ok: false,
        message:
          '没有可用的模型服务提供「model-a」：请在模型服务里勾选该模型或补好模型映射',
      })
      await expect(
        viewRef.current!.prepareChatRoute(target, true),
      ).resolves.toEqual({
        ok: false,
        message: '没有可用的模型服务提供「model-a」',
      })
    })
  })
})
