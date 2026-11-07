import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createChannel } from '../../../domain/project/channel'
import { BUILTIN_CATALOG } from '../../../domain/project/protocol'
import type { EcommerceTaskRecord, EcommerceResultRecord } from '../../../domain/ecommerce/tasks'
import type { EcommerceGenerationStage } from '../../../domain/ecommerce/progress'
import type { EcommerceRequest } from '../../../domain/ecommerce/types'
import type { RunPlan } from '../../../domain/shared/execution/plan'
import type { EcommerceRunTask } from '../../../features/ecommerce/execution/ecommerceRunPlan'
import {
  createPageGenerationActionCoordinator,
  type PageGenerationActionPorts,
  type PageGenerationStatePort,
} from './pageGenerationActionCoordinator'

const leaseMocks = vi.hoisted(() => ({
  acquire: vi.fn(),
  release: vi.fn(),
}))

vi.mock('../../../features/ecommerce/execution/taskLease', () => ({
  acquireEcommerceTaskLease: leaseMocks.acquire,
  releaseEcommerceTaskLease: leaseMocks.release,
}))

const requestOf = (overrides: Partial<EcommerceRequest> = {}): EcommerceRequest => ({
  usage: 'white-bg',
  mediaKind: 'image',
  language: 'zh-CN',
  count: 1,
  ratio: '1:1',
  productNodeId: 'product-node',
  referenceNodeIds: [],
  ...overrides,
})

const channelOf = () => ({
  ...createChannel({
    name: '隔离 mock',
    protocol: 'mock',
    baseUrl: '',
  }),
  id: 'channel-1',
  models: [{
    id: 'Image Model',
    category: 'image' as const,
    inputTypes: ['text', 'image'] as ('text' | 'image' | 'video' | 'audio')[],
  }],
  modelMap: { 'Image Model': 'upstream-image' },
})

const taskOf = (request = requestOf()): EcommerceTaskRecord => ({
  id: 'task-1',
  projectId: 'project-1',
  batchId: 'batch-1',
  createdAt: 1,
  updatedAt: 1,
  status: 'running',
  request: {
    ...request,
    resolvedModel: 'Image Model',
    resolvedChannelId: 'channel-1',
  },
  nodeIds: ['result-subject'],
})

const rowOf = (
  status: EcommerceResultRecord['status'],
  overrides: Partial<EcommerceResultRecord> = {},
): EcommerceResultRecord => ({
  id: 'result-1',
  taskId: 'task-1',
  projectId: 'project-1',
  nodeId: 'result-subject',
  position: 0,
  createdAt: 1,
  updatedAt: 1,
  status,
  ...overrides,
})

const taskRepoOf = (
  overrides: Partial<PageGenerationActionPorts['taskRepo']> = {},
): PageGenerationActionPorts['taskRepo'] => ({
  create: vi.fn(async () => ({ task: taskOf(), results: [rowOf('pending')] })),
  results: vi.fn(async () => [rowOf('done')]),
  appendResults: vi.fn(async () => ({ task: taskOf(), results: [rowOf('pending')] })),
  updateResult: vi.fn(async () => undefined),
  retrySave: vi.fn(async () => ({ ok: true, result: null })),
  updateTask: vi.fn(async () => undefined),
  reconcileFromRunRecords: vi.fn(async () => ({ results: [], tasks: [] })),
  ...overrides,
})

function harness(overrides: Partial<PageGenerationActionPorts> = {}) {
  let currentStage: EcommerceGenerationStage | null = null
  const stages: unknown[] = []
  const state: PageGenerationStatePort = {
    setSubmitting: vi.fn(),
    setShotPlanNote: vi.fn(),
    setPreparingShots: vi.fn(),
    setGenerationStage: vi.fn((update) => {
      currentStage = typeof update === 'function' ? update(currentStage) : update
      stages.push(currentStage)
    }),
    setGenerationFailed: vi.fn(),
    setActiveTask: vi.fn(),
    setResultRows: vi.fn(),
  }
  const createdTask = {
    task: taskOf(),
    results: [rowOf('pending')],
  }
  const ports = ({
    projectId: 'project-1',
    platforms: [],
    channels: [channelOf()],
    channelStore: {
      defaultForNewNode: vi.fn(async () => ({
        channelId: 'channel-1',
        model: 'Image Model',
        params: {},
        substituted: false,
      })),
      protocolCatalog: vi.fn(() => BUILTIN_CATALOG),
    },
    strategy: 'priority',
    chatTarget: null,
    nodes: [],
    taskRepo: taskRepoOf({ create: vi.fn(async () => createdTask) }),
    reconcile: vi.fn(async () => undefined),
    canvasSaveQueue: vi.fn(async () => undefined),
    canvasRepo: { sync: vi.fn(async () => []) },
    runLogs: { query: vi.fn(async () => ({ entries: [], total: 0 })) },
    assets: {
      read: vi.fn(async () => ({ mime: 'image/png' })),
    },
    contextInputs: vi.fn(async () => []),
    execution: {
      run: vi.fn(async () => ({ warnings: [] })),
    },
    logger: { log: vi.fn() },
    refresh: {
      history: vi.fn(async () => undefined),
      workbench: vi.fn(async () => undefined),
    },
    requestShots: vi.fn(async () => ({
      ok: true as const,
      shots: [{ title: '主图', brief: '按商品图生成', prompt: '生成一张商品图。' }],
      analysis: '商品外观清楚',
      designSystem: {
        name: '默认',
        palette: ['白色'],
        typography: '无衬线',
        lighting: '柔光',
        composition: '居中',
        imageTreatment: '真实',
      },
    })),
    visualInputsFor: vi.fn(async () => []),
    nextBatchId: vi.fn(() => 'batch-new'),
    state,
    ...overrides,
  }) as PageGenerationActionPorts
  return {
    ports,
    state,
    stages,
    lease: leaseMocks,
    coordinator: createPageGenerationActionCoordinator(ports),
    createdTask,
  }
}

describe('ecommerce page generation action coordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    leaseMocks.acquire.mockClear()
    leaseMocks.release.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects an invalid deterministic plan before AI or task creation', async () => {
    const h = harness()

    await expect(h.coordinator.onGenerate(requestOf({ productNodeId: '' })))
      .rejects.toThrow('先上传一张产品图')

    expect(h.ports.requestShots).not.toHaveBeenCalled()
    expect(h.ports.channelStore.defaultForNewNode).not.toHaveBeenCalled()
    expect(h.ports.taskRepo.create).not.toHaveBeenCalled()
    expect(h.state.setSubmitting).toHaveBeenNthCalledWith(1, true)
    expect(h.state.setSubmitting).toHaveBeenLastCalledWith(false)
    expect(h.state.setGenerationFailed).toHaveBeenCalledWith(
      '先上传一张产品图 —— 没有产品图就没有可改的主体',
    )
  })

  it('uses a confirmed shot plan only when its length exactly matches count', async () => {
    const h = harness()
    const shotPlan = [{
      title: '确认主图',
      brief: '确认过的画面',
      prompt: '只使用确认后的提示词。',
    }]

    await h.coordinator.onGenerate(requestOf(), shotPlan)

    expect(h.ports.requestShots).not.toHaveBeenCalled()
    expect(h.state.setShotPlanNote).toHaveBeenCalledWith('这 1 张使用已确认的逐张方案。')
    expect(h.state.setGenerationStage).toHaveBeenCalledWith({
      phase: 'prompts',
      label: '正在采用已确认的逐张提示词',
    })
    expect(h.ports.taskRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({ resolvedModel: 'Image Model' }),
    }))
    const runPlan = vi.mocked(h.ports.execution.run).mock.calls[0]?.[0] as RunPlan<EcommerceRunTask>
    expect(runPlan.tasks[0]?.request.prompt).toContain('只使用确认后的提示词。')
    await vi.advanceTimersByTimeAsync(0)
    expect(h.lease.release).toHaveBeenCalledWith('task-1')
  })

  it('does not use a mismatched confirmed plan and expands without a chat model', async () => {
    const h = harness()

    await expect(
      h.coordinator.onGenerate(
        requestOf({ usage: 'set', count: 2 }),
        [{ title: '只有一张', brief: '不完整', prompt: '不完整提示词' }],
      ),
    ).rejects.toThrow('没有可用的对话模型')

    expect(h.ports.requestShots).not.toHaveBeenCalled()
    expect(h.state.setPreparingShots).not.toHaveBeenCalled()
    expect(h.ports.taskRepo.create).not.toHaveBeenCalled()
  })

  it('unlocks shot preparation on request failure and does not create a task', async () => {
    const h = harness({
      chatTarget: {
        channelId: 'chat-channel',
        logicalModel: 'Chat Model',
        upstreamModel: 'chat-upstream',
      },
      requestShots: vi.fn(async () => ({ ok: false as const, error: '上游无响应' })),
    })

    await expect(
      h.coordinator.onGenerate(requestOf({ usage: 'set', count: 2 })),
    ).rejects.toThrow('商品分析或逐张提示词生成失败：上游无响应')

    expect(h.state.setPreparingShots).toHaveBeenNthCalledWith(1, true)
    expect(h.state.setPreparingShots).toHaveBeenLastCalledWith(false)
    expect(h.ports.taskRepo.create).not.toHaveBeenCalled()
  })

  it('reports a missing target after recipe resolution and before task creation', async () => {
    const h = harness({
      channels: [],
      channelStore: {
        defaultForNewNode: vi.fn(async () => null),
        protocolCatalog: vi.fn(() => BUILTIN_CATALOG),
      },
    })

    await expect(h.coordinator.onGenerate(requestOf())).rejects.toThrow(
      '还没有可用的生图模型服务',
    )
    expect(h.ports.taskRepo.create).not.toHaveBeenCalled()
    expect(h.lease.acquire).not.toHaveBeenCalled()
  })

  it('preserves task, result metadata, RunPlan fields and lease/order semantics', async () => {
    const request = requestOf({
      usage: 'set',
      count: 2,
      ratio: 'smart',
      resolution: '2K',
      quality: 'high',
      note: '保留商品外观',
    })
    const createdTask = {
      task: taskOf(request),
      results: [
        rowOf('pending', { id: 'result-a', nodeId: 'subject-a', position: 0 }),
        rowOf('pending', { id: 'result-b', nodeId: 'subject-b', position: 1 }),
      ],
    }
    const trace: string[] = []
    leaseMocks.acquire.mockImplementation(() => {
      trace.push('acquire')
    })
    leaseMocks.release.mockImplementation(() => {
      trace.push('release')
    })
    const h = harness({
      chatTarget: {
        channelId: 'chat-channel',
        logicalModel: 'Chat Model',
        upstreamModel: 'chat-upstream',
      },
      reconcile: vi.fn(async () => {
        trace.push('reconcile')
      }),
      taskRepo: taskRepoOf({
        create: vi.fn(async () => {
          trace.push('task-create')
          return createdTask
        }),
        results: vi.fn(async () => {
          trace.push('results')
          return [rowOf('done', { id: 'result-a' }), rowOf('done', { id: 'result-b' })]
        }),
        updateTask: vi.fn(async () => {
          trace.push('refresh-task')
          return undefined
        }),
      }),
      execution: {
        run: vi.fn(async () => {
          trace.push('exec-run')
          return { warnings: ['warning-1'] }
        }),
      },
      logger: {
        log: vi.fn((_level, _message, details) => {
          trace.push(`warning:${String((details as { warning?: string })?.warning)}`)
        }),
      },
      refresh: {
        history: vi.fn(async () => {
          trace.push('refresh-history')
        }),
        workbench: vi.fn(async () => {
          trace.push('refresh-workbench')
        }),
      },
      visualInputsFor: vi.fn(async () => [{
        kind: 'asset' as const,
        nodeId: 'product-node',
        assetHash: 'product-hash',
        mime: 'image/png',
      }]),
      requestShots: vi.fn(async () => ({
        ok: true as const,
        analysis: '商品外观清楚',
        designSystem: {
          name: '默认',
          palette: ['白色'],
          typography: '无衬线',
          lighting: '柔光',
          composition: '居中',
          imageTreatment: '真实',
        },
        shots: [
          { title: '主图', brief: '第一张', prompt: '第一张商品图。' },
          { title: '细节', brief: '第二张', prompt: '第二张商品细节。' },
        ],
      })),
    })

    await h.coordinator.onGenerate(request)
    await vi.advanceTimersByTimeAsync(0)

    expect(h.ports.taskRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      batchId: 'batch-new',
      request: expect.objectContaining({
        resolvedModel: 'Image Model',
        resolvedChannelId: 'channel-1',
      }),
      nodeIds: [expect.any(String), expect.any(String)],
      metadata: expect.any(Array),
    }))
    const plan = vi.mocked(h.ports.execution.run).mock.calls[0]?.[0] as RunPlan<EcommerceRunTask>
    expect(plan.tasks).toHaveLength(2)
    expect(plan.tasks[0]?.request).toMatchObject({
      kind: 'image',
      channelId: 'channel-1',
      model: 'upstream-image',
      logicalModel: 'Image Model',
      inputs: [{
        kind: 'asset',
        nodeId: 'product-node',
        assetHash: 'product-hash',
        mime: 'image/png',
      }],
    })
    expect(plan.tasks[0]?.resultId).toBe('result-a')
    expect(plan.tasks[1]?.resultId).toBe('result-b')
    expect(trace.indexOf('warning:warning-1')).toBeGreaterThan(
      trace.indexOf('exec-run'),
    )
    expect(trace.indexOf('warning:warning-1')).toBeLessThan(
      trace.indexOf('reconcile'),
    )
    expect(trace).toEqual([
      'task-create',
      'acquire',
      'refresh-workbench',
      'exec-run',
      'warning:warning-1',
      'reconcile',
      'results',
      'results',
      'refresh-task',
      'refresh-history',
      'refresh-workbench',
      'release',
    ])
  })

  it('appends kit assets to final media requests before creating a paid task', async () => {
    const h = harness({
      contextInputs: vi.fn(async () => [
        { kind: 'asset' as const, nodeId: 'context:logo:logo', assetHash: 'logo', mime: 'image/png' },
        { kind: 'asset' as const, nodeId: 'context:reference:reference', assetHash: 'reference', mime: 'image/png' },
      ]),
    })
    await h.coordinator.onGenerate(requestOf())
    const plan = vi.mocked(h.ports.execution.run).mock.calls[0]?.[0]
    expect(plan?.tasks[0]?.request.inputs.map((input) => input.kind === 'asset' ? input.assetHash : input.kind))
      .toEqual(['logo', 'reference'])
    expect(vi.mocked(h.ports.contextInputs).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(h.ports.taskRepo.create).mock.invocationCallOrder[0])
  })

  it('does not create a paid task when a bound kit asset is missing', async () => {
    const h = harness({
      contextInputs: vi.fn(async () => { throw new Error('缺失 Logo 已停止生成') }),
    })
    await expect(h.coordinator.onGenerate(requestOf())).rejects.toThrow('缺失 Logo')
    expect(h.ports.taskRepo.create).not.toHaveBeenCalled()
    expect(h.ports.execution.run).not.toHaveBeenCalled()
    expect(h.state.setGenerationFailed).toHaveBeenCalledWith(expect.stringContaining('已停止生成'))
  })

  it('releases the lease when execution fails', async () => {
    const h = harness({
      execution: {
        run: vi.fn(async () => {
          throw new Error('渠道断线')
        }),
      },
    })

    await h.coordinator.onGenerate(requestOf())
    await vi.advanceTimersByTimeAsync(0)

    expect(h.ports.logger.log).toHaveBeenCalledWith(
      'warn',
      '[ecommerce] 执行失败',
      { error: '渠道断线' },
    )
    expect(h.lease.release).toHaveBeenCalledWith('task-1')
  })

  it('polls until a terminal result and updates stages from 0/N to done', async () => {
    let results = 0
    const h = harness({
      taskRepo: taskRepoOf({
        create: vi.fn(async () => ({
          task: taskOf(),
          results: [rowOf('pending')],
        })),
        results: vi.fn(async () => {
          results += 1
          return [rowOf(results > 1 ? 'done' : 'pending')]
        }),
      }),
      reconcile: vi.fn(async () => undefined),
    })

    await h.coordinator.onGenerate(requestOf())
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(250)

    expect(h.ports.reconcile).toHaveBeenCalledTimes(2)
    expect(h.stages).toContainEqual({
      phase: 'generate',
      label: '正在生成 0/1',
      current: 0,
      total: 1,
    })
    expect(h.stages).toContainEqual({
      phase: 'done',
      label: '本批已结束 1/1',
      current: 1,
      total: 1,
    })
    expect(h.ports.taskRepo.updateTask).toHaveBeenCalledTimes(1)
    expect(h.ports.refresh.history).toHaveBeenCalledTimes(1)
    expect(h.ports.refresh.workbench).toHaveBeenCalledTimes(2)
    expect(h.lease.release).toHaveBeenCalledWith('task-1')
  })

  it('stops polling at the ten-minute bound and still settles the task', async () => {
    const h = harness({
      taskRepo: taskRepoOf({
        create: vi.fn(async () => ({
          task: taskOf(),
          results: [rowOf('pending')],
        })),
        results: vi.fn(async () => [rowOf('pending')]),
      }),
      reconcile: vi.fn(async () => undefined),
    })

    await h.coordinator.onGenerate(requestOf())
    await vi.advanceTimersByTimeAsync(10 * 60_000)

    expect(h.ports.reconcile).toHaveBeenCalledTimes(2400)
    expect(h.ports.taskRepo.updateTask).toHaveBeenCalledTimes(1)
    expect(h.lease.release).toHaveBeenCalledWith('task-1')
    expect(h.stages).toContainEqual({
      phase: 'done',
      label: '本批已结束 1/1',
      current: 1,
      total: 1,
    })
  })

  it('unlocks submitting on both synchronous setup failure and success paths', async () => {
    const invalid = harness()
    await expect(invalid.coordinator.onGenerate(requestOf({ productNodeId: '' })))
      .rejects.toThrow()
    expect(invalid.state.setSubmitting).toHaveBeenLastCalledWith(false)

    const valid = harness()
    await valid.coordinator.onGenerate(requestOf())
    expect(valid.state.setSubmitting).toHaveBeenLastCalledWith(false)
    await vi.advanceTimersByTimeAsync(0)
  })
})
