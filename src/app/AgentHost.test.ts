import {
  createElement,
  StrictMode,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  beginAgentHostDispose,
  disposeAgentHost,
  freezeAgentHostGeneration,
  getAgentHosts,
  invalidateAgentHostsForHmr,
  registerAgentHostRenderer,
  removeAgentHost,
  resetAgentHostsForTests,
  setAgentHostActive,
  setAgentHostDisposer,
  upsertAgentHost,
  type AgentHostRendererProps,
} from './AgentHostRegistry'
import { AgentHostOutlet } from './AgentHostOutlet'
import {
  createTaskLifecycle,
  type TaskLifecycleCloseAttempt,
  type TaskShutdownControl,
} from '../features/shared/lifecycle/taskLifecycle'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  resetAgentHostsForTests()
})

function shutdownControl(
  waitForIdle: () => Promise<void>,
  reopenable = true,
): TaskShutdownControl {
  let finalized = false
  return {
    waitForIdle,
    whenIdle: () => waitForIdle().catch(() => undefined),
    canReopen: () => reopenable && !finalized,
    reopenIfIdle: () => reopenable && !finalized,
    canFinalize: () => !finalized,
    finalize() {
      finalized = true
      return true
    },
  }
}

describe('AgentHost registry / outlet', () => {
  it('StrictMode 注册幂等，只保留一条 project host record', () => {
    function Registrar() {
      useEffect(() => {
        upsertAgentHost({
          id: 'canvas:p1',
          kind: 'probe',
          payload: { projectId: 'p1' },
          active: true,
        })
      }, [])
      return null
    }

    act(() => {
      TestRenderer.create(
        createElement(
          StrictMode,
          null,
          createElement(Registrar),
        ),
      )
    })

    expect(getAgentHosts()).toHaveLength(1)
    expect(getAgentHosts()[0]).toMatchObject({
      id: 'canvas:p1',
      active: true,
    })
  })

  it('active 切换只更新可见性，A/B renderer 实例与本地状态不丢', () => {
    const instances: object[] = []
    const setters: Record<
      string,
      Dispatch<SetStateAction<number>>
    > = {}

    function Probe({ host }: AgentHostRendererProps) {
      const identity = useRef({})
      const [count, setCount] = useState(0)
      instances.push(identity.current)
      setters[host.id] = setCount
      return createElement(
        'span',
        { 'data-probe': host.id },
        `${host.active ? 'active' : 'inactive'}:${count}`,
      )
    }

    registerAgentHostRenderer('probe', Probe)
    upsertAgentHost({
      id: 'canvas:p1',
      kind: 'probe',
      payload: { projectId: 'p1' },
      active: true,
    })
    upsertAgentHost({
      id: 'canvas:p2',
      kind: 'probe',
      payload: { projectId: 'p2' },
      active: false,
    })

    let root!: TestRenderer.ReactTestRenderer
    act(() => {
      root = TestRenderer.create(createElement(AgentHostOutlet))
    })
    act(() => setters['canvas:p1']!(7))
    const p1Instance = instances.at(-2)
    const p2Instance = instances.at(-1)

    act(() => {
      setAgentHostActive('canvas:p1', false)
      setAgentHostActive('canvas:p2', true)
    })
    act(() => {
      setAgentHostActive('canvas:p2', false)
      setAgentHostActive('canvas:p1', true)
    })

    expect(root.root.findAllByType(Probe)).toHaveLength(2)
    expect(instances).toContain(p1Instance)
    expect(instances).toContain(p2Instance)
    expect(
      root.root.findAll(
        (node) =>
          node.type === 'span' &&
          node.props['data-probe'] === 'canvas:p1',
      )[0]?.children,
    ).toEqual(['active:7'])
    expect(
      root.root.findAll(
        (node) =>
          node.type === 'div' &&
          node.props['data-agent-host-record'] === 'canvas:p1',
      )[0]?.props['data-agent-host-active'],
    ).toBe('true')
    expect(
      root.root.findAll(
        (node) =>
          node.type === 'div' &&
          node.props['data-agent-host-record'] === 'canvas:p2',
      )[0]?.props['data-agent-host-active'],
    ).toBe('false')
  })

  it('remove 与 dispose 分别删除 record，dispose 先等待宿主 abort / flush', async () => {
    registerAgentHostRenderer(
      'probe',
      ({ host }: AgentHostRendererProps) =>
        createElement('span', null, host.id),
    )
    upsertAgentHost({
      id: 'canvas:p1',
      kind: 'probe',
      payload: {},
    })

    let disposed = false
    setAgentHostDisposer('canvas:p1', () =>
      shutdownControl(async () => {
        await Promise.resolve()
        disposed = true
      }))
    act(() => setAgentHostActive('canvas:p1', false))
    expect(disposed).toBe(false)

    await act(async () => {
      await disposeAgentHost('canvas:p1')
    })

    expect(disposed).toBe(true)
    expect(getAgentHosts()).toEqual([])

    upsertAgentHost({
      id: 'canvas:p2',
      kind: 'probe',
      payload: {},
    })
    act(() => {
      removeAgentHost('canvas:p2')
    })
    expect(getAgentHosts()).toEqual([])
  })

  it('旧代际异步 dispose 不得删除 HMR 后注册的新 host', async () => {
    registerAgentHostRenderer(
      'probe',
      ({ host }: AgentHostRendererProps) =>
        createElement('span', null, host.id),
    )
    const first = upsertAgentHost({
      id: 'canvas:p1',
      kind: 'probe',
      payload: { generation: 'old' },
    })
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    setAgentHostDisposer(
      first.id,
      () => shutdownControl(async () => gate),
      first.generation,
    )

    const disposingOld = disposeAgentHost(
      first.id,
      first.generation,
    )
    invalidateAgentHostsForHmr('probe')
    const second = upsertAgentHost({
      id: 'canvas:p1',
      kind: 'probe',
      payload: { generation: 'new' },
      active: true,
    })
    expect(second.generation).not.toBe(first.generation)

    release()
    await disposingOld

    expect(getAgentHosts()).toHaveLength(1)
    expect(getAgentHosts()[0]).toMatchObject({
      generation: second.generation,
      payload: { generation: 'new' },
      active: true,
    })
  })

  it('冻结代际期间 HMR 与重复 upsert 不产生新 host generation', () => {
    const first = upsertAgentHost({
      id: 'canvas:p1',
      kind: 'probe',
      payload: { revision: 1 },
      active: true,
    })
    const release = freezeAgentHostGeneration(
      first.id,
      first.generation,
    )

    invalidateAgentHostsForHmr('probe')
    const frozen = upsertAgentHost({
      id: first.id,
      kind: 'probe',
      payload: { revision: 2 },
      active: true,
    })
    expect(frozen.generation).toBe(first.generation)
    expect(frozen.payload).toEqual({ revision: 2 })

    release()
    invalidateAgentHostsForHmr('probe')
    const next = upsertAgentHost({
      id: first.id,
      kind: 'probe',
      payload: { revision: 3 },
      active: true,
    })
    expect(next.generation).not.toBe(first.generation)
  })

  it('宿主 dispose 失败时保留 record，删除流程可重试', async () => {
    const host = upsertAgentHost({
      id: 'canvas:p1',
      kind: 'probe',
      payload: {},
    })
    const beginShutdown = vi.fn(() =>
      shutdownControl(async () => {
        throw new Error('flush failed')
      }))
    setAgentHostDisposer(
      host.id,
      beginShutdown,
      host.generation,
    )

    await expect(
      disposeAgentHost(host.id, host.generation),
    ).rejects.toThrow('flush failed')
    expect(getAgentHosts()).toHaveLength(1)

    await expect(
      disposeAgentHost(host.id, host.generation),
    ).rejects.toThrow('flush failed')
    expect(beginShutdown).toHaveBeenCalledTimes(2)
  })

  it('idle 后删除失败会恢复同一 host lifecycle，不留下 closed 僵尸', async () => {
    const host = upsertAgentHost({
      id: 'canvas:p1',
      kind: 'probe',
      payload: {},
    })
    const lifecycle = createTaskLifecycle()
    let attempt!: TaskLifecycleCloseAttempt
    setAgentHostDisposer(
      host.id,
      () => {
        attempt = lifecycle.beginClose()
        return {
          waitForIdle: () => lifecycle.waitForIdle(100),
          whenIdle: lifecycle.whenIdle,
          canReopen: () => lifecycle.canReopen(attempt),
          reopenIfIdle: () => lifecycle.reopenIfIdle(attempt),
          canFinalize: () => lifecycle.canFinalize(attempt),
          finalize: () => lifecycle.finalizeClose(attempt),
        }
      },
      host.generation,
    )

    const control = beginAgentHostDispose(host.id, host.generation)
    await control!.waitForIdle()
    expect(control!.reopenIfIdle()).toBe(true)
    expect(lifecycle.state).toBe('open')
    await expect(
      lifecycle.track(async () => 'send-again'),
    ).resolves.toBe('send-again')
    expect(getAgentHosts()).toHaveLength(1)
  })
})
