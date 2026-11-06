import { describe, expect, it, vi } from 'vitest'
import type {
  EcommerceResultRecord,
  EcommerceTaskRecord,
} from '../../../domain/ecommerce/tasks'
import type { EcommerceRequest } from '../../../domain/ecommerce/types'
import {
  createPageResultActionCoordinator,
  createResultLibraryActions,
  downloadAllResults,
  retryFailedResults,
  type PageResultActionPorts,
  type PageResultActionView,
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
