import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { registerAllSpecs } from '../../../domain/canvas/nodeSpecs'
import type {
  FusionData,
  NodeSnapshot,
} from '../../../domain/canvas/model/node'
import {
  createRunRecord,
  type RunRecord,
} from '../../../domain/canvas/model/runRecord'
import { createMemoryPlatform } from '../../../platform/memory'
import { createCanvasStore, type CanvasStore } from '../../../state/workbenches/canvas/store'
import { TaskLifecycleClosedError } from '../../../features/shared/lifecycle/taskLifecycle'
import {
  activateCanvasExecutionRuntime,
  disposeAllCanvasExecutionRuntimes,
  disposeCanvasExecutionRuntime,
  resetCanvasExecutionRuntimesForTests,
} from './canvasExecutionRuntime'
import { subscribeRunRecordChanged } from './runRecordEvents'
import {
  useCanvasRunRecorder,
  type CanvasRunRecorder,
  type CanvasRunRecorderInput,
} from './useCanvasRunRecorder'

registerAllSpecs()

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const roots = new Set<TestRenderer.ReactTestRenderer>()
const stores = new Set<CanvasStore>()

afterEach(async () => {
  for (const root of roots) {
    act(() => root.unmount())
  }
  roots.clear()
  for (const store of stores) store.dispose()
  stores.clear()
  vi.restoreAllMocks()
  await disposeAllCanvasExecutionRuntimes()
  resetCanvasExecutionRuntimesForTests()
})

function record(version: number, nodeId = 'node-1'): RunRecord {
  return createRunRecord({
    id: `rec-${version}`,
    nodeId,
    projectId: 'p1',
    version,
    createdAt: 1_000,
    status: 'succeeded',
    inputs: [],
    params: {},
    outputHashes: [],
    fingerprint: `fp-${version}`,
    taskId: `task-${version}`,
    durationMs: 10,
    scope: {
      scopeVersion: 1,
      workbench: 'canvas',
      subjectId: nodeId,
      scopeId: `scope-${version}`,
      operationId: `op-${version}`,
    },
  })
}

async function mountRecorder(
  input: CanvasRunRecorderInput,
): Promise<CanvasRunRecorder> {
  let value!: CanvasRunRecorder

  function Probe() {
    value = useCanvasRunRecorder(input)
    return null
  }

  let root!: TestRenderer.ReactTestRenderer
  await act(async () => {
    root = TestRenderer.create(createElement(Probe))
    await Promise.resolve()
  })
  roots.add(root)
  return value
}

function unmountRecorder(): void {
  for (const root of roots) {
    act(() => root.unmount())
    roots.delete(root)
    return
  }
}

async function setup() {
  const platform = createMemoryPlatform()
  const store = createCanvasStore({
    platform,
    projectId: 'p1',
    debounceMs: 800,
  })
  stores.add(store)
  const runtime = activateCanvasExecutionRuntime('p1')
  const recorder = await mountRecorder({
    projectId: 'p1',
    runtime,
    store,
    storage: platform.storage,
  })
  return { platform, store, runtime, recorder }
}

describe('useCanvasRunRecorder', () => {
  it('append 后先 flush，再发出记录变更通知', async () => {
    const { platform, store, recorder } = await setup()
    const order: string[] = []
    const originalFlush = store.flush.bind(store)
    vi.spyOn(store, 'flush').mockImplementation(async () => {
      order.push('flush')
      await originalFlush()
    })
    const unsubscribe = subscribeRunRecordChanged(() => order.push('notify'))

    try {
      await act(async () => {
        await recorder.appendRecord(record(3))
      })
    } finally {
      unsubscribe()
    }

    expect(order).toEqual(['flush', 'notify'])
    expect(await platform.storage.query('runRecords', { id: 'rec-3' })).toHaveLength(1)
  })

  it('storage 事务失败时原样拒绝，且不误发通知', async () => {
    const { platform, recorder } = await setup()
    const failure = new Error('storage offline')
    vi.spyOn(platform.storage, 'transaction').mockRejectedValueOnce(failure)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const notify = vi.fn()
    const unsubscribe = subscribeRunRecordChanged(notify)

    try {
      await expect(recorder.appendRecord(record(4))).rejects.toBe(failure)
    } finally {
      unsubscribe()
    }
    expect(notify).not.toHaveBeenCalled()
  })

  it('runtime 已关闭时拒绝新的引擎外记录，且不 dispatch', async () => {
    const { store, recorder } = await setup()
    await disposeCanvasExecutionRuntime('p1', 100)
    const dispatch = vi.spyOn(store, 'dispatch')

    await expect(recorder.appendRecord(record(5))).rejects.toBeInstanceOf(
      TaskLifecycleClosedError,
    )
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('版本基线读取失败不会毒化账本，下一次挂载会重试', async () => {
    const platform = createMemoryPlatform()
    const seeded = record(5)
    await platform.storage.put('runRecords', seeded as never)
    const store = createCanvasStore({
      platform,
      projectId: 'p1',
      debounceMs: 800,
    })
    stores.add(store)
    const runtime = activateCanvasExecutionRuntime('p1')
    vi.spyOn(platform.storage, 'query').mockRejectedValueOnce(new Error('read failed'))

    const first = await mountRecorder({
      projectId: 'p1',
      runtime,
      store,
      storage: platform.storage,
    })
    expect(first.nextVersion('node-1')).toBe(1)
    unmountRecorder()
    await act(async () => {
      await Promise.resolve()
    })

    const second = await mountRecorder({
      projectId: 'p1',
      runtime,
      store,
      storage: platform.storage,
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(second.nextVersion('node-1')).toBe(6)
  })

  it('融合记录只在 fuse 完成后构造，并挂到真实结果节点', async () => {
    const { platform, store, recorder } = await setup()
    store.dispatch({
      kind: 'node.create',
      projectId: 'p1',
      type: 'fusion',
      at: { x: 0, y: 0 },
    })
    store.dispatch({
      kind: 'node.create',
      projectId: 'p1',
      type: 'generation',
      at: { x: 100, y: 0 },
    })
    const graph = store.getSnapshot()
    const fusionNode = graph.nodes.find((node) => node.type === 'fusion')!
    const resultNode = graph.nodes.find((node) => node.type === 'generation')!
    store.dispatch({
      kind: 'node.updateData',
      id: resultNode.id,
      patch: { assetHash: 'result-hash' },
      transient: true,
    })

    await act(async () => {
      await recorder.appendFusionRecord({
        node: fusionNode as NodeSnapshot<FusionData>,
        outcome: { ok: true, resultNodeId: resultNode.id },
        startedAt: 2_000,
        durationMs: 25,
        operationId: 'op-fusion',
        workbench: 'canvas',
      })
    })

    const rows = await platform.storage.query('runRecords', {
      projectId: 'p1',
    }) as unknown as RunRecord[]
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      nodeId: resultNode.id,
      version: 1,
      status: 'succeeded',
      outputHashes: ['result-hash'],
      sentChannelId: 'local',
      sentModel: '本地融合',
      scopeId: `fusion:${fusionNode.id}:op-fusion`,
    })
  })

  it('融合失败记录留在融合节点，不带产物并保留原因', async () => {
    const { platform, store, recorder } = await setup()
    store.dispatch({
      kind: 'node.create',
      projectId: 'p1',
      type: 'fusion',
      at: { x: 0, y: 0 },
    })
    const fusionNode = store.getSnapshot().nodes.find(
      (node) => node.type === 'fusion',
    )!

    await act(async () => {
      await recorder.appendFusionRecord({
        node: fusionNode as NodeSnapshot<FusionData>,
        outcome: { ok: false, reason: '缺少原图' },
        startedAt: 3_000,
        durationMs: 5,
        operationId: 'op-fusion-failed',
        workbench: 'canvas',
      })
    })

    const rows = await platform.storage.query('runRecords', {
      projectId: 'p1',
    }) as unknown as RunRecord[]
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      nodeId: fusionNode.id,
      status: 'failed',
      outputHashes: [],
      errorText: '缺少原图',
      sentChannelId: 'local',
    })
  })
})
