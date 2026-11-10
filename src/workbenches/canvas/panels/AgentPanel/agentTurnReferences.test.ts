import { describe, expect, it } from 'vitest'
import type { ReferenceSelection } from '../../../../domain/project/referenceLedger'
import { projectAgentTurnReferences } from './agentTurnReferences'

const selection: ReferenceSelection = {
  selected: [
    {
      item: {
        id: 'r1',
        projectId: 'p1',
        title: '标准字',
        source: 'kit',
        kind: 'image',
        assetHash: 'hash-logo',
        what: '绿色圆角标准字',
        createdAt: 1,
        updatedAt: 1,
      },
      usage: {
        id: 'u1',
        itemId: 'r1',
        projectId: 'p1',
        taskKey: 'kv',
        usage: 'identityAnchor',
        howToUse: '保持字形与颜色',
        identityAnchor: true,
        createdAt: 1,
      },
    },
    {
      item: {
        id: 'r2',
        projectId: 'p1',
        title: '品牌 brief',
        source: 'file',
        kind: 'text',
        what: '自然有机语气',
        createdAt: 2,
        updatedAt: 2,
      },
      usage: {
        id: 'u2',
        itemId: 'r2',
        projectId: 'p1',
        taskKey: 'kv',
        usage: 'textGuide',
        howToUse: '文案只保留一句',
        createdAt: 2,
      },
    },
  ],
  omitted: [{ item: {
    id: 'r3',
    projectId: 'p1',
    title: '无关图',
    source: 'link',
    kind: 'image',
    what: '无关',
    createdAt: 3,
    updatedAt: 3,
  }, reason: 'no_usage' }],
}

describe('Agent turn reference projection', () => {
  it('writes selected What/HowToUse into prompt and only real assets into refs', () => {
    const result = projectAgentTurnReferences(selection, (hash) =>
      hash === 'hash-logo' ? 'image/png' : null,
    )
    expect(result.prompt).toContain('按当前任务匹配到 2 张参考')
    expect(result.prompt).toContain('保持字形与颜色')
    expect(result.prompt).toContain('文案只保留一句')
    expect(result.assetRefs).toEqual([{
      hash: 'hash-logo',
      mime: 'image/png',
      role: 'logo',
      name: '标准字',
    }])
    expect(result.warnings).toEqual([])
    expect(result.evidence).toEqual(['r1:u1', 'r2:u2'])
    expect(result.phaseEvent).toEqual({
      phase: 'referenceAnalysis',
      title: '参考分析完成 · 2 项依据',
      detail: expect.stringContaining('已读取 2 条参考'),
      evidence: ['r1:u1', 'r2:u2'],
    })
    expect(result.phaseEvent?.detail).not.toContain('保持字形与颜色')
    expect(result.phaseEvent?.detail).not.toContain('绿色圆角标准字')
  })

  it('does not turn text cards into image refs', () => {
    const result = projectAgentTurnReferences({
      selected: [selection.selected[1]!],
      omitted: [],
    }, () => 'image/png')
    expect(result.assetRefs).toEqual([])
  })

  it('projects every image in a multi-asset kit card once, logo first', () => {
    const result = projectAgentTurnReferences({
      selected: [{
        item: {
          id: 'kit-1',
          projectId: 'p1',
          title: 'Anbel',
          source: 'kit',
          kind: 'image',
          assetHash: 'logo-hash',
          assets: [
            { hash: 'logo-hash', role: 'logo', name: 'Logo' },
            { hash: 'photo-1', role: 'reference', name: '空间一' },
            { hash: 'photo-2', role: 'reference', name: '空间二' },
            { hash: 'photo-1', role: 'reference', name: '重复素材' },
          ],
          what: '完整品牌套件',
          createdAt: 1,
          updatedAt: 1,
        },
        usage: {
          id: 'usage-kit',
          itemId: 'kit-1',
          projectId: 'p1',
          taskKey: 'kv',
          usage: 'style',
          howToUse: '沿用品牌图片',
          createdAt: 1,
        },
      }],
      omitted: [],
    }, (hash) => hash === 'missing' ? null : 'image/png')

    expect(result.assetRefs).toEqual([
      { hash: 'logo-hash', mime: 'image/png', role: 'logo', name: 'Logo' },
      { hash: 'photo-1', mime: 'image/png', role: 'reference', name: '空间一' },
      { hash: 'photo-2', mime: 'image/png', role: 'reference', name: '空间二' },
    ])
  })

  it('reports a missing kit asset and continues with the remaining images', () => {
    const result = projectAgentTurnReferences({
      selected: [{
        item: {
          id: 'kit-missing',
          projectId: 'p1',
          title: '品牌套件',
          source: 'kit',
          kind: 'image',
          assets: [
            { hash: 'logo', role: 'logo', name: 'Logo' },
            { hash: 'missing-photo', role: 'reference', name: '缺失照片' },
          ],
          what: '完整套件',
          createdAt: 1,
          updatedAt: 1,
        },
        usage: {
          id: 'usage-missing',
          itemId: 'kit-missing',
          projectId: 'p1',
          taskKey: 'kv',
          usage: 'style',
          howToUse: '沿用视觉体系',
          createdAt: 1,
        },
      }],
      omitted: [],
    }, (hash) => hash === 'logo' ? 'image/png' : null)

    expect(result.assetRefs).toEqual([
      { hash: 'logo', mime: 'image/png', role: 'logo', name: 'Logo' },
    ])
    expect(result.warnings).toEqual([
      '套件素材「缺失照片」已缺失，本轮已跳过。',
    ])
    expect(result.phaseEvent?.detail).toContain('缺失照片')
  })
})
