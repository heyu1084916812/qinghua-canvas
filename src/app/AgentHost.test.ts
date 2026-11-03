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
import { afterEach, describe, expect, it } from 'vitest'
import {
  disposeAgentHost,
  getAgentHosts,
  registerAgentHostRenderer,
  removeAgentHost,
  resetAgentHostsForTests,
  setAgentHostActive,
  setAgentHostDisposer,
  upsertAgentHost,
  type AgentHostRendererProps,
} from './AgentHostRegistry'
import { AgentHostOutlet } from './AgentHostOutlet'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  resetAgentHostsForTests()
})

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
    setAgentHostDisposer('canvas:p1', async () => {
      await Promise.resolve()
      disposed = true
    })
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
    act(() => removeAgentHost('canvas:p2'))
    expect(getAgentHosts()).toEqual([])
  })
})
