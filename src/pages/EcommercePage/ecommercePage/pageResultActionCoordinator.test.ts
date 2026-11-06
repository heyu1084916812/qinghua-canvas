import { describe, expect, it, vi } from 'vitest'
import type {
  EcommerceResultRecord,
  EcommerceTaskRecord,
} from '../../../domain/ecommerce/tasks'
import type { EcommerceRequest } from '../../../domain/ecommerce/types'
import type { RunPlan } from '../../../domain/shared/execution/plan'
import type { EcommerceRunTask } from '../../../features/ecommerce/execution/ecommerceRunPlan'
import type { EcommerceStoredResultPorts } from './pageResultProjection'
import {
  createPageResultActionCoordinator,
  createResultLibraryActions,
  downloadAllResults,
  retryFailedResults,
  runStoredResultRerun,
  type PageResultActionPorts,
  type PageResultActionView,
  type StoredResultRerunPorts,
} from './pageResultActionCoordinator'

const taskOf = (overrides: Partial<EcommerceTaskRecord> = {}): EcommerceTaskRecord => ({
  id: 'task-active',
  projectId: 'project-1',
  batchId: 'batch-1',
  createdAt: 1,
  updatedAt: 2,
  status: 'done',
  request: {
    usage: 'main',
    platformId: 'amazon',
    language: 'en',
    count: 1,
    ratio: '3:4',
    productNodeId: 'product-node',
    referenceNodeIds: [],
  },
  nodeIds: [],
  ...overrides,
})

const rowOf = (
  id: string,
  nodeId: string,
  overrides: Partial<EcommerceResultRecord> = {},
): EcommerceResultRecord => ({
  id,
  taskId: 'task-source',
  projectId: 'project-1',
  nodeId,
  position: 0,
  createdAt: 1,
  updatedAt: 2,
  status: 'done',
  assetHash: `hash-${id}`,
  ...overrides,
})

const portsOf = (
  overrides: Partial<PageResultActionPorts> = {},
): PageResultActionPorts => ({
  activeTask: taskOf(),
  resultRows: [],
  results: [],
  channels: [],
  platform: {
    assets: {
      read: vi.fn(async () => null),
      readUrl: vi.fn(async () => null),
    },
    files: {
      saveFile: vi.fn(async () => undefined),
      saveFromUrl: vi.fn(async () => 'saved'),
    },
  } as unknown as PageResultActionPorts['platform'],
  onGenerate: vi.fn(async () => undefined),
  retryWorkbenchResult: vi.fn(),
  wait: vi.fn(async () => undefined),
  ...overrides,
})

const preparedOf = (
  task: EcommerceTaskRecord,
  targetRow = rowOf('target-row', 'target-node'),
  running: EcommerceResultRecord = { ...targetRow, status: 'running' },
) => ({ task, targetRow, running })

const storedRerunPortsOf = (
  overrides: Partial<StoredResultRerunPorts> = {},
): StoredResultRerunPorts => {
  const task = taskOf({ id: 'task-source' })
  const row = rowOf('source-row', 'source-node')
  return {
    activeTask: task,
    taskHistory: [],
    row,
    channels: [],
    catalog: {} as StoredResultRerunPorts['catalog'],
    nodes: [],
    taskRepo: {
      appendResults: vi.fn(async () => ({ task, results: [row] })),
      updateResult: vi.fn(async () => undefined),
      results: vi.fn(async () => [row]),
    },
    execution: { run: vi.fn(async () => ({ warnings: [] })) },
    assets: { read: vi.fn(async () => ({ mime: 'image/png' })) },
    logger: { log: vi.fn() },
    lease: { acquire: vi.fn(), release: vi.fn() },
    refresh: {
      task: vi.fn(async () => undefined),
      history: vi.fn(async () => undefined),
      workbench: vi.fn(async () => undefined),
    },
    state: { setActiveTask: vi.fn(), setResultRows: vi.fn() },
    visualInputsFor: vi.fn(async () => []),
    subjectId: vi.fn(() => 'new-subject'),
    now: vi.fn(() => 123),
    prepareStoredResultRerun: vi.fn(async () => preparedOf(task, row)),
    resolveGenerationTarget: vi.fn(() => ({
      channelId: 'channel-target',
      credentialGroupId: 'credential-group',
      credentialGroupIds: ['credential-group'],
      logicalModel: 'Logical Model',
      upstreamModel: 'upstream-model',
      usedMock: false,
    })),
    ...overrides,
  }
}

describe('ecommerce result edit actions', () => {
  it('keeps row lookup and all three edit validation errors before generate', async () => {
    const onGenerate = vi.fn(async () => undefined)
    await expect(
      createPageResultActionCoordinator(portsOf({
        resultRows: [],
        onGenerate,
      })).editResult('missing-node', '换背景'),
    ).rejects.toThrow('没找到这张结果对应的素材记录')

    await expect(
      createPageResultActionCoordinator(portsOf({
        resultRows: [rowOf('without-asset', 'node-1', { assetHash: undefined })],
        onGenerate,
      })).editResult('node-1', '换背景'),
    ).rejects.toThrow('这张结果还没有可编辑的素材')

    await expect(
      createPageResultActionCoordinator(portsOf({
        resultRows: [rowOf('with-asset', 'node-2')],
        onGenerate,
      })).editResult('node-2', '   '),
    ).rejects.toThrow('先在左侧「补充要求」写清要换成的背景')
    expect(onGenerate).not.toHaveBeenCalled()
  })

  it('builds the complete edit request, source fields and model fallback', async () => {
    const onGenerate = vi.fn(async () => undefined)
    const coordinator = createPageResultActionCoordinator(portsOf({
      activeTask: taskOf(),
      resultRows: [
        rowOf('result-1', 'node-1', {
          taskId: 'task-source-1',
          assetHash: 'asset-hash-1',
          model: 'Row Model',
        }),
      ],
      onGenerate,
    }))

    await coordinator.editResult('node-1', '  换成暖色背景  ', {
      referenceNodeId: 'reference-node',
    })
    await coordinator.editResult('node-1', '只改背景', {
      model: 'Selected Model',
    })

    expect(onGenerate).toHaveBeenNthCalledWith(
      1,
      {
        usage: 'edit',
        platformId: 'amazon',
        language: 'en',
        count: 1,
        ratio: '3:4',
        productNodeId: 'asset-hash-1',
        referenceNodeIds: ['reference-node'],
        note: '换成暖色背景',
        model: 'Row Model',
      },
      undefined,
      {
        sourceTaskId: 'task-source-1',
        sourceResultId: 'result-1',
        sourceAssetHash: 'asset-hash-1',
      },
    )
    expect(onGenerate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        referenceNodeIds: [],
        model: 'Selected Model',
      }),
      undefined,
      expect.objectContaining({
        sourceResultId: 'result-1',
      }),
    )

    const noModelGenerate = vi.fn(async (_request: EcommerceRequest) => undefined)
    await createPageResultActionCoordinator(portsOf({
      resultRows: [rowOf('result-no-model', 'node-no-model')],
      onGenerate: noModelGenerate,
    })).editResult('node-no-model', '只改背景')
    expect(noModelGenerate.mock.calls[0]?.[0]).not.toHaveProperty('model')
  })

  it('edits rows strictly in order and stops after the first failure', async () => {
    const seen: string[] = []
    const onGenerate = vi.fn(async (request: { productNodeId: string }) => {
      seen.push(request.productNodeId)
      if (request.productNodeId === 'hash-r2') throw new Error('第二张失败')
    })
    const coordinator = createPageResultActionCoordinator(portsOf({
      resultRows: [
        rowOf('r1', 'n1'),
        rowOf('r2', 'n2'),
        rowOf('r3', 'n3'),
      ],
      onGenerate,
    }))

    await expect(
      coordinator.editResults(['n1', 'n2', 'n3'], '全部换背景'),
    ).rejects.toThrow('第二张失败')
    expect(seen).toEqual(['hash-r1', 'hash-r2'])
    expect(onGenerate).toHaveBeenCalledTimes(2)
  })
})

describe('ecommerce result upscale action', () => {
  it('requires the original asset and an enabled image channel before generate', async () => {
    const onGenerate = vi.fn(async () => undefined)
    await expect(
      createPageResultActionCoordinator(portsOf({
        resultRows: [rowOf('r1', 'n1', { assetHash: undefined })],
        onGenerate,
      })).upscaleResult('n1', 'standard', '4x'),
    ).rejects.toThrow('没找到这张结果的原始素材')

    await expect(
      createPageResultActionCoordinator(portsOf({
        resultRows: [rowOf('r1', 'n1')],
        channels: [
          {
            id: 'disabled',
            enabled: false,
            models: [{ id: 'Topaz 图像超清 Standard', category: 'image' }],
          },
          {
            id: 'video-only',
            enabled: true,
            models: [{ id: 'Topaz 图像超清 Standard', category: 'video' }],
          },
        ],
        onGenerate,
      })).upscaleResult('n1', 'standard', '4x'),
    ).rejects.toThrow(
      '当前没有可用的「Topaz 图像超清 Standard」渠道，请先在 RunningHub 勾选该模型',
    )
    expect(onGenerate).not.toHaveBeenCalled()
  })

  it('uses the resolved channel and preserves the upscale payload and lineage', async () => {
    const onGenerate = vi.fn(async () => undefined)
    const coordinator = createPageResultActionCoordinator(portsOf({
      activeTask: taskOf(),
      resultRows: [
        rowOf('result-2', 'node-2', {
          taskId: 'task-source-2',
          assetHash: 'asset-hash-2',
        }),
      ],
      channels: [
        {
          id: 'target-channel',
          enabled: true,
          models: [{ id: 'Topaz 图像超清 Standard', category: 'image' }],
        },
      ],
      onGenerate,
    }))

    await coordinator.upscaleResult('node-2', 'standard', '4x')

    expect(onGenerate).toHaveBeenCalledWith(
      {
        usage: 'edit',
        channelId: 'target-channel',
        platformId: 'amazon',
        language: 'en',
        count: 1,
        ratio: '3:4',
        productNodeId: 'asset-hash-2',
        referenceNodeIds: [],
        note: 'AI 超清：通用，4x 无损放大。保持商品、构图、颜色和画面文字内容不变，只提升清晰度与细节。',
        model: 'Topaz 图像超清 Standard',
        scale: '4x',
      },
      undefined,
      {
        sourceTaskId: 'task-source-2',
        sourceResultId: 'result-2',
        sourceAssetHash: 'asset-hash-2',
      },
    )
  })
})

describe('ecommerce result batch actions', () => {
  it('downloads only done rows with image hashes, in result order with numbered waits', async () => {
    const trace: string[] = []
    const platform = portsOf().platform
    const downloadAsset = vi.fn(async (
      _deps: unknown,
      hash: string,
      prefix?: string,
    ) => {
      trace.push(`download:${hash}:${prefix}`)
    }) as unknown as PageResultActionPorts['downloadAsset']
    const wait = vi.fn(async (milliseconds: number) => {
      trace.push(`wait:${milliseconds}`)
    })
    const results: PageResultActionView[] = [
      { nodeId: 'n1', status: 'done', imageHash: 'image-1' },
      { nodeId: 'n2', status: 'running', imageHash: 'image-2' },
      { nodeId: 'n3', status: 'done' },
      { nodeId: 'n4', status: 'failed', imageHash: 'image-3' },
      { nodeId: 'n5', status: 'done', imageHash: 'image-4' },
    ]

    await downloadAllResults({ results, platform, downloadAsset, wait })

    expect(trace).toEqual([
      'download:image-1:轻画-电商-1',
      'wait:250',
      'download:image-4:轻画-电商-2',
      'wait:250',
    ])
    expect(downloadAsset).toHaveBeenNthCalledWith(
      1,
      platform,
      'image-1',
      '轻画-电商-1',
    )
    expect(downloadAsset).toHaveBeenNthCalledWith(
      2,
      platform,
      'image-4',
      '轻画-电商-2',
    )
  })

  it('retries retryable rows in existing order and does nothing for an empty set', async () => {
    const retried: string[] = []
    const retryWorkbenchResult = vi.fn(async (resultId: string) => {
      retried.push(resultId)
    })
    await retryFailedResults({
      activeTask: taskOf(),
      resultRows: [
        rowOf('done-row', 'n1'),
        rowOf('failed-row-1', 'n2', { status: 'failed' }),
        rowOf('canceled-row', 'n3', { status: 'canceled' }),
        rowOf('failed-row-2', 'n4', { status: 'failed' }),
      ],
      results: [],
      retryWorkbenchResult,
    })

    expect(retried).toEqual(['failed-row-1', 'canceled-row', 'failed-row-2'])

    const emptyRetry = vi.fn()
    await retryFailedResults({
      activeTask: taskOf(),
      resultRows: [rowOf('done-only', 'n1')],
      results: [],
      retryWorkbenchResult: emptyRetry,
    })
    expect(emptyRetry).not.toHaveBeenCalled()
  })
})

describe('ecommerce stored result rerun actions', () => {
  it('selects activeTask, then history, and rejects a missing source before prepare', async () => {
    const row = rowOf('source-row', 'source-node')
    const active = taskOf({ id: row.taskId, updatedAt: 10 })
    const staleHistory = taskOf({ id: row.taskId, updatedAt: 99 })
    const activePrepare = vi.fn(async (_ports: EcommerceStoredResultPorts) => preparedOf(active, row))
    await runStoredResultRerun(storedRerunPortsOf({
      row,
      activeTask: active,
      taskHistory: [staleHistory],
      prepareStoredResultRerun: activePrepare,
    }))
    expect(activePrepare.mock.calls[0]?.[0].activeTask).toBe(active)

    const otherActive = taskOf({ id: 'other-task' })
    const history = taskOf({ id: row.taskId, updatedAt: 11 })
    const historyPrepare = vi.fn(async (_ports: EcommerceStoredResultPorts) => preparedOf(history, row))
    await runStoredResultRerun(storedRerunPortsOf({
      row,
      activeTask: otherActive,
      taskHistory: [history],
      prepareStoredResultRerun: historyPrepare,
    }))
    expect(historyPrepare.mock.calls[0]?.[0].activeTask).toBe(history)

    const missingPrepare = vi.fn()
    await expect(runStoredResultRerun(storedRerunPortsOf({
      row,
      activeTask: otherActive,
      taskHistory: [],
      prepareStoredResultRerun: missingPrepare,
    }))).rejects.toThrow('找不到这张图所属的电商任务')
    expect(missingPrepare).not.toHaveBeenCalled()
  })

  it('updates stored rows for appended draws and only replaces the row in place', async () => {
    const sourceRow = rowOf('source-row', 'source-node')
    const appendedTask = taskOf({ id: sourceRow.taskId })
    const appendedRow = rowOf('appended-row', 'appended-node')
    const appendedRunning = { ...appendedRow, status: 'running' as const }
    const storedRows = [rowOf('stored-row', 'stored-node')]
    const setActiveTask = vi.fn()
    const setResultRows = vi.fn()
    const results = vi.fn(async () => storedRows)
    await runStoredResultRerun(storedRerunPortsOf({
      row: sourceRow,
      taskRepo: {
        appendResults: vi.fn(),
        updateResult: vi.fn(),
        results,
      },
      prepareStoredResultRerun: vi.fn(async () =>
        preparedOf(appendedTask, appendedRow, appendedRunning)),
      state: { setActiveTask, setResultRows },
    }))
    expect(setActiveTask).toHaveBeenCalledWith(appendedTask)
    expect(results).toHaveBeenCalledWith(appendedTask.id)
    expect(setResultRows).toHaveBeenNthCalledWith(1, storedRows)
    const appendUpdater = setResultRows.mock.calls[1]?.[0] as (
      rows: EcommerceResultRecord[],
    ) => EcommerceResultRecord[]
    expect(appendUpdater([sourceRow, appendedRow])).toEqual([sourceRow, appendedRunning])

    const inPlaceRunning = { ...sourceRow, status: 'running' as const }
    const inPlaceSetActive = vi.fn()
    const inPlaceSetRows = vi.fn()
    const inPlaceResults = vi.fn(async () => storedRows)
    await runStoredResultRerun(storedRerunPortsOf({
      row: sourceRow,
      inPlace: true,
      taskRepo: {
        appendResults: vi.fn(),
        updateResult: vi.fn(),
        results: inPlaceResults,
      },
      prepareStoredResultRerun: vi.fn(async () =>
        preparedOf(taskOf({ id: sourceRow.taskId }), sourceRow, inPlaceRunning)),
      state: { setActiveTask: inPlaceSetActive, setResultRows: inPlaceSetRows },
    }))
    expect(inPlaceSetActive).not.toHaveBeenCalled()
    expect(inPlaceResults).not.toHaveBeenCalled()
    expect(inPlaceSetRows).toHaveBeenCalledTimes(1)
    const inPlaceUpdater = inPlaceSetRows.mock.calls[0]?.[0] as (
      rows: EcommerceResultRecord[],
    ) => EcommerceResultRecord[]
    expect(inPlaceUpdater([sourceRow])).toEqual([inPlaceRunning])
  })

  it('stops after prepare when the generation target is unavailable', async () => {
    const visualInputsFor = vi.fn(async () => [])
    const run = vi.fn()
    const acquire = vi.fn()
    await expect(runStoredResultRerun(storedRerunPortsOf({
      visualInputsFor,
      resolveGenerationTarget: vi.fn(() => null),
      execution: { run },
      lease: { acquire, release: vi.fn() },
    }))).rejects.toThrow('这个结果对应的模型 / 渠道已经不可用')
    expect(visualInputsFor).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
    expect(acquire).not.toHaveBeenCalled()
  })

  it('builds the complete run plan and preserves acquire/run/log/refresh/release order', async () => {
    const trace: string[] = []
    const sourceHash = 'source-asset-hash'
    const row = rowOf('source-result', 'source-node', {
      ratio: '4:5',
      prompt: '  keep the product  ',
      shotTitle: '主图',
    })
    const task = taskOf({
      id: row.taskId,
      sourceResultId: 'original-result',
      sourceAssetHash: sourceHash,
      request: {
        ...taskOf().request,
        mediaKind: 'video',
        model: 'fallback-model',
        resolvedModel: 'logical-model',
        channelId: 'fallback-channel',
        resolvedChannelId: 'requested-channel',
        ratio: '3:4',
        note: 'task note',
        resolution: '2k',
        quality: 'high',
        scale: '2x',
        durationSec: 8,
      },
    })
    const existingInput = {
      kind: 'asset' as const,
      nodeId: 'existing-node',
      assetHash: 'existing-hash',
      mime: 'image/png',
    }
    const run = vi.fn(async (plan: RunPlan<EcommerceRunTask>) => {
      trace.push('run')
      expect(plan).toBeDefined()
      return { warnings: ['投影失败'] }
    })
    const ports = storedRerunPortsOf({
      row,
      activeTask: task,
      prepareStoredResultRerun: vi.fn(async () => preparedOf(task, row)),
      resolveGenerationTarget: vi.fn(() => ({
        channelId: 'target-channel',
        credentialGroupId: 'target-group',
        credentialGroupIds: ['target-group', 'target-group-alt'],
        logicalModel: 'target-logical',
        upstreamModel: 'target-upstream',
        usedMock: false,
      })),
      visualInputsFor: vi.fn(async () => [existingInput]),
      assets: { read: vi.fn(async () => ({ mime: 'image/jpeg' })) },
      execution: { run },
      logger: { log: vi.fn(() => trace.push('warning')) },
      lease: {
        acquire: vi.fn(() => trace.push('acquire')),
        release: vi.fn(() => trace.push('release')),
      },
      refresh: {
        task: vi.fn(async () => {
          trace.push('refresh-task')
        }),
        history: vi.fn(async () => {
          trace.push('refresh-history')
        }),
        workbench: vi.fn(async () => {
          trace.push('refresh-workbench')
        }),
      },
      now: () => 456,
    })

    await runStoredResultRerun(ports)
    expect(trace).toEqual([
      'acquire',
      'run',
      'warning',
      'refresh-task',
      'refresh-history',
      'refresh-workbench',
      'release',
    ])
    expect(ports.prepareStoredResultRerun).toHaveBeenCalledWith(expect.objectContaining({
      activeTask: task,
      row,
      now: 456,
      subjectId: ports.subjectId,
      taskRepo: ports.taskRepo,
    }))
    expect(ports.resolveGenerationTarget).toHaveBeenCalledWith({
      channels: [],
      category: 'video',
      catalog: ports.catalog,
      strategy: undefined,
      logicalModel: 'logical-model',
      channelId: 'requested-channel',
    })

    const plan = run.mock.calls[0]?.[0]
    expect(plan).toMatchObject({
      id: `ecommerce:${task.id}:run`,
      scope: 'global',
      mode: 'single',
      tasks: [{
        taskId: task.id,
        resultId: row.id,
        nodeId: row.nodeId,
        request: {
          kind: 'video',
          channelId: 'target-channel',
          model: 'target-upstream',
          logicalModel: 'target-logical',
          credentialGroupId: 'target-group',
          credentialGroupIds: ['target-group', 'target-group-alt'],
          prompt: 'keep the product',
          inputs: [
            existingInput,
            {
              kind: 'asset',
              nodeId: 'result:original-result',
              assetHash: sourceHash,
              mime: 'image/jpeg',
            },
          ],
          params: {
            ratio: '4:5',
            count: 1,
            resolution: '2k',
            quality: 'high',
            scale: '2x',
            durationSec: 8,
          },
        },
        metadata: { shotTitle: '主图' },
      }],
    })
  })

  it('does not read or append the source asset when visual inputs already contain it', async () => {
    const row = rowOf('source-result', 'source-node')
    const task = taskOf({
      id: row.taskId,
      sourceAssetHash: 'already-present',
    })
    const run = vi.fn(async (_plan: RunPlan<EcommerceRunTask>) => ({ warnings: [] }))
    const read = vi.fn(async () => ({ mime: 'image/png' }))
    await runStoredResultRerun(storedRerunPortsOf({
      row,
      activeTask: task,
      prepareStoredResultRerun: vi.fn(async () => preparedOf(task, row)),
      visualInputsFor: vi.fn(async () => [{
        kind: 'asset' as const,
        nodeId: 'existing',
        assetHash: 'already-present',
        mime: 'image/png',
      }]),
      assets: { read },
      execution: { run },
    }))
    expect(read).not.toHaveBeenCalled()
    const inputs = run.mock.calls[0]?.[0].tasks[0]?.request.inputs
    expect(inputs).toHaveLength(1)
    expect(inputs?.[0]).toMatchObject({ kind: 'asset', assetHash: 'already-present' })
  })

  it('releases the lease when execution fails and skips refreshes', async () => {
    const refreshTask = vi.fn(async () => undefined)
    const refreshHistory = vi.fn(async () => undefined)
    const refreshWorkbench = vi.fn(async () => undefined)
    const release = vi.fn()
    await expect(runStoredResultRerun(storedRerunPortsOf({
      execution: { run: vi.fn(async () => {
        throw new Error('exec failed')
      }) },
      lease: { acquire: vi.fn(), release },
      refresh: {
        task: refreshTask,
        history: refreshHistory,
        workbench: refreshWorkbench,
      },
    }))).rejects.toThrow('exec failed')
    expect(release).toHaveBeenCalledTimes(1)
    expect(refreshTask).not.toHaveBeenCalled()
    expect(refreshHistory).not.toHaveBeenCalled()
    expect(refreshWorkbench).not.toHaveBeenCalled()
  })
})

describe('ecommerce result library actions', () => {
  it('keeps single-result download routing and missing hashes inert', () => {
    const platform = portsOf().platform
    const downloadAsset = vi.fn(async () => undefined) as unknown as
      PageResultActionPorts['downloadAsset']
    const actions = createResultLibraryActions({
      projectId: 'project-1',
      platform,
      assetLibraryRepo: { save: vi.fn(async () => undefined) },
      logger: { log: vi.fn() },
      downloadAsset,
    })

    expect(actions.downloadOf(undefined)).toBeUndefined()
    actions.downloadOf('asset-1')?.()
    expect(downloadAsset).toHaveBeenCalledWith(platform, 'asset-1')
  })

  it('saves available result bytes and logs the existing failure path', async () => {
    const save = vi.fn(async () => undefined)
    const log = vi.fn()
    const platform = portsOf().platform
    const assets = platform.assets as {
      read(hash: string): Promise<{ mime: string; bytes: { length: number } } | null>
    }
    assets.read = vi.fn(async () => ({
      mime: 'image/png',
      bytes: { length: 128 },
    }))
    const actions = createResultLibraryActions({
      projectId: 'project-1',
      platform,
      assetLibraryRepo: { save },
      logger: { log },
    })

    await actions.saveToLibraryOf('asset-2', {
      width: 640,
      height: 480,
      prompt: '商品主图',
      model: 'Image Model',
      ratio: '1:1',
    })?.()
    expect(save).toHaveBeenCalledWith({
      hash: 'asset-2',
      mime: 'image/png',
      bytes: 128,
      width: 640,
      height: 480,
      savedAt: expect.any(Number),
      projectId: 'project-1',
      prompt: '商品主图',
      model: 'Image Model',
      ratio: '1:1',
    })

    assets.read = vi.fn(async () => {
      throw new Error('读取失败')
    })
    await actions.saveToLibraryOf('asset-3', {})?.()
    expect(log).toHaveBeenCalledWith(
      'warn',
      '[ecommerce] 收藏结果失败',
      { error: 'Error: 读取失败' },
    )
  })
})
