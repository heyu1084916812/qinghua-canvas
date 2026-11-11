import { describe, expect, it, vi } from 'vitest'
import { registerAllSpecs } from '../../../../domain/canvas/nodeSpecs'
import type { GraphSnapshot } from '../../../../domain/canvas/model/graph'
import type { NodeSnapshot } from '../../../../domain/canvas/model/node'
import { arrangeLoopTasks, runCanvasLoop, sourceOfLoopTask } from './loopRunPlan'

registerAllSpecs()

function node(
  id: string,
  type: 'loop' | 'generation',
  data: Record<string, unknown>,
  title = id,
): NodeSnapshot {
  return {
    id,
    projectId: 'p1',
    type,
    parentId: null,
    disabled: false,
    title,
    x: 0,
    y: 0,
    w: 200,
    h: 120,
    data,
  } as NodeSnapshot
}

function graph(): GraphSnapshot {
  const loop = node('loop-1', 'loop', {
    count: 2,
    loopStart: 1,
    batch: 1,
    mode: 'serial',
    useImageInput: false,
    usePrompt: true,
    prompts: ['round-a', 'round-b'],
  })
  const generation = node('gen-1', 'generation', {
    mode: 'image',
    prompt: '画一只猫',
    channelId: 'ch-valid',
    model: 'image-model',
  }, '生成')
  return {
    projectId: 'p1',
    nodes: [loop, generation],
    edges: [{
      id: 'edge-1',
      projectId: 'p1',
      source: loop.id,
      target: generation.id,
    }],
  }
}

function setup() {
  const current = graph()
  const launch = vi.fn(async () => ({ ok: true }) as const)
  const ports = {
    graph: current,
    getSnapshot: () => current,
    dispatch: vi.fn(),
    notify: vi.fn(),
    flush: vi.fn(async () => undefined),
    activeRunNodeIds: () => new Set<string>(),
    launch,
  }
  return { current, launch, ports }
}

describe('canvas loop run plan', () => {
  it('每轮冻结提示词并把多轮任务合并成一次 launch', async () => {
    const { current, launch, ports } = setup()
    const loopNode = current.nodes[0] as NodeSnapshot<
      import('../../../../domain/canvas/model/node').LoopData
    >
    const result = await runCanvasLoop(
      loopNode,
      undefined,
      new AbortController().signal,
      ports,
    )

    expect(result).toEqual({ ok: true })
    expect(launch).toHaveBeenCalledTimes(1)
    const [plan, originNodeId] = launch.mock.calls[0] as unknown as [
      { tasks: unknown[]; id: string; scope: string; mode: string },
      string,
    ]
    expect(originNodeId).toBe('loop-1')
    expect(plan.scope).toBe('node')
    expect(plan.mode).toBe('single')
    expect(plan.tasks).toHaveLength(2)
    expect(ports.dispatch).toHaveBeenCalledTimes(3)
    expect(ports.dispatch).toHaveBeenNthCalledWith(1, {
      kind: 'node.updateData',
      id: 'loop-1',
      patch: {
        __roundPrompt: 'round-a',
        __roundAssets: [],
        lastRoundIndex: 1,
        lastRoundPrompt: 'round-a',
        lastRoundAssets: [],
      },
      transient: true,
    })
    expect(ports.dispatch).toHaveBeenLastCalledWith({
      kind: 'node.updateData',
      id: 'loop-1',
      patch: { __roundPrompt: undefined, __roundAssets: undefined },
      transient: true,
    })
    expect(ports.flush).toHaveBeenCalledTimes(1)
  })

  it('已取消时零 launch、零计划写入', async () => {
    const { current, launch, ports } = setup()
    const abort = new AbortController()
    abort.abort()
    const result = await runCanvasLoop(
      current.nodes[0] as never,
      undefined,
      abort.signal,
      ports,
    )
    expect(result).toMatchObject({ ok: false, canceled: true })
    expect(launch).not.toHaveBeenCalled()
    expect(ports.dispatch).not.toHaveBeenCalled()
  })

  it('下游无生成节点时按整批失败返回', async () => {
    const { current, launch, ports } = setup()
    const withoutGeneration = {
      ...current,
      nodes: [current.nodes[0]],
      edges: [],
    }
    ports.graph = withoutGeneration
    ports.getSnapshot = () => withoutGeneration
    const result = await runCanvasLoop(
      withoutGeneration.nodes[0] as never,
      undefined,
      undefined,
      ports,
    )
    expect(result).toMatchObject({ ok: false, canceled: false })
    expect(ports.notify).toHaveBeenCalledWith(
      '循环节点下游还没有生成节点，无法运行',
      'error',
    )
    expect(launch).not.toHaveBeenCalled()
  })

  it('槽位按来源分组重排并统一 callCount', () => {
    const { current } = setup()
    const task = (id: string, from: string) => ({
      id,
      nodeId: 'gen-1',
      request: { prompt: '画一只猫', kind: 'image' },
      slot: { kind: 'new', title: 'old', connectFrom: from },
      sourceTitle: '生成',
      targetTitle: '生成',
      materialTitle: '',
      presetName: '',
    })
    const arranged = arrangeLoopTasks(
      [task('a', 'gen-1'), task('b', 'gen-2'), task('c', 'gen-1')] as never,
      current,
    )
    expect(sourceOfLoopTask(arranged[0]!)).toBe('gen-1')
    expect(arranged.map((item) => item.outputIndex)).toEqual([0, 0, 1])
    expect(arranged.map((item) => item.outputTotal)).toEqual([2, 1, 2])
    expect(arranged.map((item) => item.callCount)).toEqual([3, 3, 3])
    expect(arranged.map((item) => item.seq)).toEqual([0, 1, 2])
  })
})
