import { describe, expect, it, vi } from 'vitest'
import type { GenerationContextAsset } from '../../../../domain/canvas/model/node'
import type { AgentCanvasRunDeps } from './agentCanvasRun'
import { createAgentToolCanvasOps } from './agentToolCanvasOps'

const asset = (hash: string, mime: string): GenerationContextAsset => ({
  hash,
  mime,
  role: 'reference',
  name: hash,
})

function harness(assets: readonly GenerationContextAsset[] = []) {
  const store = {} as never
  const platform = {} as never
  const contextAssets = { current: assets }
  const runCanvasNodes = vi.fn(
    async (
      _deps: AgentCanvasRunDeps,
      _input: {
        sessionId: string
        nodeIds: readonly string[]
        signal?: AbortSignal
      },
    ) => [],
  )
  const cropAsset = vi.fn(async (_deps: unknown, _input: unknown) => ({
    ok: true as const,
    nodeId: 'n-1',
  }))
  const extractSelection = vi.fn(async (_deps: unknown, _input: unknown) => ({
    ok: true as const,
    nodeId: 'n-2',
  }))
  const splitNodeToGrid = vi.fn(async (_deps: unknown, _input: unknown) => ({
    ok: true as const,
    nodeIds: ['a', 'b'],
  }))
  const ops = createAgentToolCanvasOps({
    sessionId: 's1',
    store,
    platform,
    execution: {} as never,
    channels: {} as never,
    setRunTasksFor: vi.fn(),
    runCanvasNodes:
      runCanvasNodes as unknown as Parameters<
        typeof createAgentToolCanvasOps
      >[0]['runCanvasNodes'],
    cropAsset:
      cropAsset as unknown as Parameters<
        typeof createAgentToolCanvasOps
      >[0]['cropAsset'],
    extractSelection:
      extractSelection as unknown as Parameters<
        typeof createAgentToolCanvasOps
      >[0]['extractSelection'],
    splitNodeToGrid:
      splitNodeToGrid as unknown as Parameters<
        typeof createAgentToolCanvasOps
      >[0]['splitNodeToGrid'],
    getContextAssets: () => contextAssets.current,
  })
  return {
    ops,
    runCanvasNodes,
    cropAsset,
    extractSelection,
    splitNodeToGrid,
    contextAssets,
    store,
    platform,
  }
}

describe('runNodes / 上下文素材', () => {
  it('只把 image/* 交进去，且与 contextAssetsForGenerated 同一条规则', async () => {
    const h = harness([
      asset('a', 'image/png'),
      asset('b', 'video/mp4'),
      asset('c', 'application/pdf'),
    ])

    await h.ops.runNodes(['n1'])

    const deps = h.runCanvasNodes.mock.calls[0]![0] as AgentCanvasRunDeps
    expect(deps.contextAssets.map((item) => item.hash)).toEqual(['a'])
  })

  it('每次调用都现取素材（批准后才执行时不能拿旧快照）', async () => {
    const h = harness([asset('a', 'image/png')])

    await h.ops.runNodes(['n1'])
    h.contextAssets.current = [asset('z', 'image/jpeg')]
    await h.ops.runNodes(['n2'])

    const first = h.runCanvasNodes.mock.calls[0]![0] as AgentCanvasRunDeps
    const second = h.runCanvasNodes.mock.calls[1]![0] as AgentCanvasRunDeps
    expect(first.contextAssets.map((item) => item.hash)).toEqual(['a'])
    expect(second.contextAssets.map((item) => item.hash)).toEqual(['z'])
  })

  it('signal 原样透传；没有信号时连键都不出', async () => {
    const h = harness()
    const signal = new AbortController().signal

    await h.ops.runNodes(['n1'], signal)
    await h.ops.runNodes(['n2'])

    expect(h.runCanvasNodes.mock.calls[0]![1]).toEqual({
      sessionId: 's1',
      nodeIds: ['n1'],
      signal,
    })
    const second = h.runCanvasNodes.mock.calls[1]![1]!
    expect(second).toEqual({ sessionId: 's1', nodeIds: ['n2'] })
    expect('signal' in second).toBe(false)
  })
})

describe('sliceImage / splitGrid', () => {
  it('crop 走 cropAsset、extract 走 extractSelection，deps 用 store + platform', async () => {
    const h = harness()
    const rect = { x: 1, y: 2, w: 3, h: 4 }

    await h.ops.sliceImage!('n1', 'crop', rect, '1:1')
    await h.ops.sliceImage!('n2', 'extract', rect)

    expect(h.cropAsset).toHaveBeenCalledWith(
      { platform: h.platform, store: h.store },
      { nodeId: 'n1', rect, ratio: '1:1' },
    )
    const extractInput = h.extractSelection.mock.calls[0]![1] as Record<
      string,
      unknown
    >
    expect(extractInput).toEqual({ nodeId: 'n2', rect })
    expect('ratio' in extractInput).toBe(false)
  })

  it('splitGrid 透传 rows / cols 与同一套 deps', async () => {
    const h = harness()

    await h.ops.splitGrid!('n1', 2, 3)

    expect(h.splitNodeToGrid).toHaveBeenCalledWith(
      { platform: h.platform, store: h.store },
      { nodeId: 'n1', rows: 2, cols: 3 },
    )
  })
})
