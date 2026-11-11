import { describe, expect, it, vi } from 'vitest'
import type { ReferenceItem } from '../../../../domain/project/referenceLedger'
import { runAgentReferenceCuration } from './agentReferenceCuration'

const png = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10,
  0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 1, 0, 0, 0, 1,
])

function item(overrides: Partial<ReferenceItem> = {}): ReferenceItem {
  return {
    id: 'ref-kit-1',
    projectId: 'p1',
    title: 'Anbel',
    source: 'kit',
    kind: 'image',
    assetHash: 'asset-logo',
    assets: [
      { hash: 'asset-logo', role: 'logo', name: 'Logo' },
      { hash: 'asset-missing', role: 'reference', name: '应用图' },
    ],
    what: '等待分析',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function storageWith(rows: { referenceItems: ReferenceItem[] }) {
  const tables: Record<string, Record<string, unknown>[]> = {
    referenceItems: rows.referenceItems as unknown as Record<string, unknown>[],
    referenceUsages: [],
  }
  return {
    async query(table: string, filter: Record<string, unknown>) {
      return (tables[table] ?? []).filter((row) =>
        Object.entries(filter).every(([key, value]) => row[key] === value),
      )
    },
    async put(table: string, row: Record<string, unknown>) {
      const list = tables[table] ?? (tables[table] = [])
      const id = String(row.id)
      const at = list.findIndex((candidate) => candidate.id === id)
      if (at >= 0) list[at] = row
      else list.push(row)
    },
    tables,
  }
}

describe('runAgentReferenceCuration', () => {
  it('读取套件多图、跳过缺图，并把 What / usage / HowToUse 写回台账', async () => {
    const storage = storageWith({ referenceItems: [item()] })
    const execute = vi.fn(async (_request: unknown) => ({
      text: JSON.stringify({
        what: '深绿色 Anbel 横向 Logo，留白充足。',
        usage: 'identityAnchor',
        howToUse: '本任务保持字标比例和颜色不变，应用图只借鉴版式。',
        identityAnchor: true,
        limitations: ['应用图未取到'],
      }),
    }))
    const result = await runAgentReferenceCuration({
      storage: storage as never,
      assets: {
        read: vi.fn(async (hash: string) =>
          hash === 'asset-logo'
            ? { bytes: png, mime: 'image/png' }
            : null),
      },
      routeExecution: { execute },
      onRecordWarning: vi.fn(),
    }, {
      projectId: 'p1',
      sessionId: 's1',
      operationId: 'op1',
      taskKey: 'reference_edit',
      task: '为 Anbel 做一张横向海报',
      route: {
        channelId: 'c1',
        logicalModel: 'Vision',
        upstreamModel: 'vision-upstream',
        routePlanId: 'plan',
        candidates: [{ channelId: 'c1', model: 'vision-upstream' }],
      },
      preferredItemIds: ['ref-kit-1'],
    })

    expect(result.ok).toBe(true)
    expect(result.analyzed).toHaveLength(1)
    expect(result.limitations.join('\n')).toContain('应用图')
    expect(execute).toHaveBeenCalledOnce()
    expect(execute.mock.calls[0]![0]).toMatchObject({
      channelId: 'c1',
      model: 'vision-upstream',
      inputs: [{ assetHash: 'asset-logo', mime: 'image/png' }],
    })
    expect(storage.tables.referenceItems?.[0]?.what).toBe(
      '深绿色 Anbel 横向 Logo，留白充足。',
    )
    expect(storage.tables.referenceUsages?.[0]).toMatchObject({
      itemId: 'ref-kit-1',
      projectId: 'p1',
      taskKey: 'reference_edit',
      usage: 'identityAnchor',
      identityAnchor: true,
    })
  })

  it('没有模型路由时明确失败，不写假描述', async () => {
    const storage = storageWith({ referenceItems: [item()] })
    const result = await runAgentReferenceCuration({
      storage: storage as never,
      assets: { read: vi.fn() },
      routeExecution: { execute: vi.fn() },
      onRecordWarning: vi.fn(),
    }, {
      projectId: 'p1',
      sessionId: 's1',
      operationId: 'op1',
      taskKey: 'style',
      task: '做海报',
      route: null,
    })

    expect(result.ok).toBe(false)
    expect(result.summary).toContain('没有可用于参考分析的对话模型路由')
    expect(storage.tables.referenceItems?.[0]?.what).toBe('等待分析')
  })

  it('当前任务已有 usage 时不重复调用模型', async () => {
    const storage = storageWith({ referenceItems: [item()] })
    storage.tables.referenceUsages?.push({
      id: 'u1',
      itemId: 'ref-kit-1',
      projectId: 'p1',
      taskKey: 'reference_edit',
      usage: 'style',
      howToUse: '已有用法',
      createdAt: 2,
    })
    const execute = vi.fn()
    const result = await runAgentReferenceCuration({
      storage: storage as never,
      assets: { read: vi.fn() },
      routeExecution: { execute },
      onRecordWarning: vi.fn(),
    }, {
      projectId: 'p1',
      sessionId: 's1',
      operationId: 'op1',
      taskKey: 'reference_edit',
      task: '做海报',
      route: {
        channelId: 'c1',
        logicalModel: 'Vision',
        upstreamModel: 'vision-upstream',
        routePlanId: 'plan',
        candidates: [],
      },
    })

    expect(result.ok).toBe(true)
    expect(result.summary).toContain('已是最新')
    expect(execute).not.toHaveBeenCalled()
  })

  it('C1：文件名标题换成分析给出的语义短名；用户起过的标题保持不变', async () => {
    const run = async (title: string) => {
      const storage = storageWith({ referenceItems: [item({ title, assets: undefined })] })
      const execute = vi.fn(async (_request: unknown) => ({
        text: JSON.stringify({
          title: '拿铁杯产品图',
          what: '白色拿铁杯，杯身有绿色字标。',
          usage: 'subject',
          howToUse: '借：杯子外形；避：原图背景。',
        }),
      }))
      const result = await runAgentReferenceCuration({
        storage: storage as never,
        assets: { read: vi.fn(async () => ({ bytes: png, mime: 'image/png' })) },
        routeExecution: { execute },
        onRecordWarning: vi.fn(),
      }, {
        projectId: 'p1',
        sessionId: 's1',
        operationId: 'op1',
        taskKey: 'task:t1',
        task: '做一张拿铁海报',
        route: {
          channelId: 'c1',
          logicalModel: 'Vision',
          upstreamModel: 'vision-upstream',
          routePlanId: 'plan',
          candidates: [{ channelId: 'c1', model: 'vision-upstream' }],
        },
        preferredItemIds: ['ref-kit-1'],
      })
      return { stored: storage.tables.referenceItems?.[0]?.title, reported: result.analyzed[0]?.title }
    }
    expect(await run('_Image 17.jpg')).toEqual({ stored: '拿铁杯产品图', reported: '拿铁杯产品图' })
    expect(await run('我的杯子')).toEqual({ stored: '我的杯子', reported: '我的杯子' })
  })

  it('C3：单图参考的 What 追加本地像素采样的主色 HEX', async () => {
    const storage = storageWith({ referenceItems: [item({ title: '杯子', assets: undefined })] })
    const samplePalette = vi.fn(async () => [
      { hex: '#1F3D2B', share: 0.62 },
      { hex: '#F4EFE6', share: 0.3 },
    ])
    const result = await runAgentReferenceCuration({
      storage: storage as never,
      assets: { read: vi.fn(async () => ({ bytes: png, mime: 'image/png' })) },
      routeExecution: {
        execute: vi.fn(async () => ({
          text: JSON.stringify({ what: '深绿色杯子，米色背景。', usage: 'subject', howToUse: '借：杯子；避：背景。' }),
        })),
      },
      onRecordWarning: vi.fn(),
      samplePalette,
    }, {
      projectId: 'p1',
      sessionId: 's1',
      operationId: 'op1',
      taskKey: 'task:t1',
      task: '做海报',
      route: {
        channelId: 'c1',
        logicalModel: 'Vision',
        upstreamModel: 'vision-upstream',
        routePlanId: 'plan',
        candidates: [{ channelId: 'c1', model: 'vision-upstream' }],
      },
      preferredItemIds: ['ref-kit-1'],
    })
    expect(samplePalette).toHaveBeenCalledWith(png, 'image/png')
    const expected = '深绿色杯子，米色背景。主色（本地像素采样）：#1F3D2B 62%、#F4EFE6 30%。'
    expect(storage.tables.referenceItems?.[0]?.what).toBe(expected)
    expect(result.analyzed[0]?.what).toBe(expected)
  })
})

