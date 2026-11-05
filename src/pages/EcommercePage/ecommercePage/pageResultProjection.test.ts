import { describe, expect, it, vi } from 'vitest'
import {
  generationStageOfTerminalResults,
  imageParamOptionsByModel,
  longImageTilesOf,
  prepareStoredResultRerun,
  prescribeEcommerceShots,
  projectEcommerceResults,
  retryableResultIdsOf,
  workbenchActionTargetOf,
  workbenchDisplayStatusOf,
  type EcommerceResultViewContext,
} from './pageResultProjection'

const task = (overrides: Record<string, unknown> = {}) => ({
  id: 't1',
  projectId: 'p',
  batchId: 'b1',
  createdAt: 1,
  updatedAt: 1,
  status: 'done',
  request: { usage: 'set', ratio: '1:1', model: 'stored-model' },
  nodeIds: ['n1'],
  ...overrides,
}) as never

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'r1',
  taskId: 't1',
  projectId: 'p',
  nodeId: 'n1',
  position: 0,
  createdAt: 1,
  updatedAt: 1,
  status: 'done',
  assetHash: 'hash-r1',
  width: 640,
  height: 480,
  ...overrides,
}) as never

function context(overrides: Partial<EcommerceResultViewContext> = {}): EcommerceResultViewContext {
  return {
    activeTask: task(),
    resultRows: [row()],
    nodeIds: ['n1'],
    nodes: [],
    legacyAssetHashesOfNode: () => [],
    resultStateOf: () => null,
    previewOf: () => undefined,
    downloadOf: () => undefined,
    saveToLibraryOf: () => undefined,
    errorDescriptionOf: () => '实时失败',
    runStoredResult: vi.fn(async () => undefined),
    retryWorkbenchResult: vi.fn(),
    retrySaveWorkbenchResult: vi.fn(),
    removeFailedResult: vi.fn(),
    ...overrides,
  }
}

describe('ecommerce page result projection', () => {
  it('keeps newer live failure over old assets, canceled copy, and retry-save recovery paths', () => {
    const liveFailure = projectEcommerceResults(context({
      resultRows: [row({ status: 'running', assetHash: 'h', errorText: undefined })],
      resultStateOf: () => ({ kind: 'failed', error: 'boom' }),
    }))
    expect(liveFailure[0]?.status).toBe('failed')
    expect(liveFailure[0]?.error).toBe('实时失败')

    const canceled = projectEcommerceResults(context({
      resultRows: [row({ status: 'canceled', errorText: undefined })],
    }))
    expect(canceled[0]?.status).toBe('failed')
    expect(canceled[0]?.error).toBe('已取消（结果仍保留在库里）')
    expect(canceled[0]?.onRerun).toBeTypeOf('function')

    const retrySave = projectEcommerceResults(context({
      resultRows: [row({ status: 'failed', recovery: 'retry-save' })],
    }))
    expect(retrySave[0]?.onRerun).toBeUndefined()
    expect(retrySave[0]?.onRetrySave).toBeTypeOf('function')
    expect(retrySave[0]?.onRemoveFailed).toBeTypeOf('function')
  })

  it('uses legacy node fallbacks only when there is no active task', () => {
    const legacy = projectEcommerceResults(context({
      activeTask: null,
      nodeIds: ['legacy-1'],
      nodes: [{
        id: 'legacy-1',
        type: 'generation',
        data: {
          assetHash: 'legacy-hash',
          assetMime: 'image/webp',
          naturalSize: { width: 320, height: 240 },
          prompt: 'old prompt',
          model: 'old model',
          ratio: '4:3',
        },
      }],
      legacyAssetHashesOfNode: (node) => node?.data.assetHash ? [String(node.data.assetHash)] : [],
    }))
    expect(legacy[0]).toMatchObject({
      nodeId: 'legacy-1',
      status: 'done',
      imageHash: 'legacy-hash',
      mime: 'image/webp',
      pixelSize: { width: 320, height: 240 },
    })
    expect(legacy[0]?.onRerun).toBeUndefined()
  })

  it('projects only completed image results with real pixels into long-image tiles', () => {
    expect(longImageTilesOf([
      { nodeId: 'done', status: 'done', imageHash: 'h', pixelSize: { width: 100, height: 50 } },
      { nodeId: 'running', status: 'running', imageHash: 'h', pixelSize: { width: 100, height: 50 } },
      { nodeId: 'video', status: 'done', imageHash: 'h', mime: 'video/mp4', pixelSize: { width: 100, height: 50 } },
    ])).toEqual([{ id: 'done', hash: 'h', width: 100, height: 50 }])
  })

  it('keeps stage identity when terminal-result progress is unchanged', () => {
    const same = { phase: 'generate', label: '正在生成 1/2', current: 1, total: 2 } as const
    const results = [
      { nodeId: 'a', status: 'done' },
      { nodeId: 'b', status: 'running' },
    ] as never[]
    expect(generationStageOfTerminalResults(same, results)).toBe(same)
    expect(generationStageOfTerminalResults(null, results)).toMatchObject({ phase: 'generate', current: 1 })
    expect(generationStageOfTerminalResults(null, results.slice(0, 1))).toMatchObject({
      phase: 'done', label: '本批已结束 1/1',
    })
  })

  it('collects failed and canceled ids for batch retry, with the legacy result-card fallback', () => {
    expect(retryableResultIdsOf(task(), [
      row({ id: 'failed', status: 'failed' }),
      row({ id: 'canceled', status: 'canceled' }),
      row({ id: 'done', status: 'done' }),
    ], [])).toEqual(['failed', 'canceled'])
    expect(retryableResultIdsOf(null, [], [
      { nodeId: 'a', status: 'failed', resultId: 'r1' },
      { nodeId: 'b', status: 'failed' },
    ])).toEqual(['r1'])
  })

  it('preserves append vs in-place preparation and clears stale error before marking running', async () => {
    const appendedRow = row({ id: 'r2', nodeId: 'n2', status: 'pending' })
    const appendResults = vi.fn(async () => ({ task: task({ id: 't2' }), results: [row(), appendedRow] }))
    const updateResult = vi.fn(async () => undefined)
    const appended = await prepareStoredResultRerun({
      activeTask: task(),
      taskHistory: [],
      row: row({ status: 'failed', errorText: '旧错误' }),
      now: 99,
      subjectId: () => 'ecsubject_new',
      taskRepo: { appendResults, updateResult },
    })
    expect(appendResults).toHaveBeenCalledWith('t1', ['ecsubject_new'], [expect.any(Object)])
    expect(appended.targetRow.id).toBe('r2')
    expect(appended.running).toMatchObject({ id: 'r2', status: 'running', updatedAt: 99 })
    expect(appended.running).not.toHaveProperty('errorText')
    expect(updateResult).toHaveBeenCalledWith(appended.running)

    const inPlace = await prepareStoredResultRerun({
      activeTask: null,
      taskHistory: [task()],
      row: row({ errorText: '旧错误' }),
      inPlace: true,
      now: 100,
      subjectId: () => 'unused',
      taskRepo: { appendResults, updateResult },
    })
    expect(appendResults).toHaveBeenCalledTimes(1)
    expect(inPlace.running.id).toBe('r1')
  })

  it('prescribes independent shots with per-shot prompt profile, aspect ratio and metadata', () => {
    const shots = prescribeEcommerceShots({
      count: 2,
      planPrompts: ['p0', 'p1'],
      fallbackPrompt: 'fallback',
      ratio: '1:1',
      shots: [{ title: '首图', ratio: '4:3', headline: '主文案' }, { title: '细节', visualSystem: '微距' }],
      mediaKind: 'image',
      request: { resolution: '2K', quality: 'high' },
      model: 'GPT Image 2',
      imagePromptForModel: ({ prompt, ratio }) => `${prompt}|${ratio}`,
      aspectRatioOf: (ratio) => `aspect:${ratio}`,
    })
    expect(shots).toHaveLength(2)
    expect(shots[0]).toMatchObject({
      prompt: 'p0|4:3',
      params: { mode: 'image', ratio: 'aspect:4:3', count: 1, resolution: '2K', quality: 'high' },
      metadata: { shotTitle: '首图', ratio: '4:3', headline: '主文案' },
    })
    expect(shots[1]?.metadata.visualSystem).toBe('微距')
  })

  it('uses known model sizes as resolution options and keeps the default three tiers', () => {
    const options = imageParamOptionsByModel(['GPT Image 2', '未注册模型'])
    expect(options['GPT Image 2']?.resolutions.length).toBeGreaterThan(0)
    expect(options['未注册模型']?.resolutions).toEqual(['1K', '2K', '4K'])
    expect(options['未注册模型']?.qualities).toEqual([])
  })

  it('uses freshest rows for workbench actions and retains database/live status precedence', () => {
    const stale = row({ updatedAt: 1, assetHash: 'old' })
    const fresh = row({ updatedAt: 2, assetHash: 'new' })
    const target = workbenchActionTargetOf({
      item: { resultId: 'r1' } as never,
      action: 'download',
      workbenchResults: [stale],
      resultRows: [fresh],
    })
    expect(target.hash).toBe('new')
    expect(workbenchActionTargetOf({
      item: { assetHash: 'item-hash' } as never,
      action: 'save',
      workbenchResults: [],
      resultRows: [],
    }).hash).toBe('item-hash')

    expect(workbenchDisplayStatusOf(row({ status: 'running', updatedAt: 5 }), {
      run: { createdAt: 4, status: 'succeeded' },
    })).toBe('running')
    expect(workbenchDisplayStatusOf(row({ status: 'done', assetHash: undefined }), {
      run: { createdAt: 9, status: 'succeeded' },
    })).toBe('failed')
    expect(workbenchDisplayStatusOf(row({ status: 'pending', assetHash: 'hash' }), {
      task: task({ status: 'canceled' }),
    })).toBe('done')
  })
})
