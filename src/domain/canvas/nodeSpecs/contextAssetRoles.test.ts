import { describe, expect, it } from 'vitest'
import type { GenerationContextAsset } from '../model/node'
import type { NodeInput } from '../model/runRecord'
import {
  contextAssetRoleLine,
  contextAssetRolePrompt,
  usableContextAssets,
} from './contextAssetRoles'

const asset = (
  hash: string,
  patch: Partial<GenerationContextAsset> = {},
): GenerationContextAsset => ({
  hash,
  mime: 'image/png',
  role: 'reference',
  name: hash,
  ...patch,
})

const kitInput = (hash: string): NodeInput => ({
  kind: 'asset',
  nodeId: `context-kit:${hash}`,
  assetHash: hash,
  mime: 'image/png',
})

describe('contextAssetRoles（G2 多图分角色）', () => {
  it('按真实图片输入顺序编号，每张写清分工，不再一律叫「品牌素材」', () => {
    const assets = [
      asset('layout', { name: '杂志排版', usage: 'composition', howToUse: '借左文右图的分栏' }),
      asset('cup', { name: '保温杯', usage: 'subject' }),
    ]
    const prompt = contextAssetRolePrompt(assets, [
      kitInput('layout'),
      kitInput('cup'),
      { kind: 'text', nodeId: 'p', text: '海报' },
    ])
    expect(prompt).toContain('参考图分工（编号与随附图片顺序一致）')
    expect(prompt).toContain('图 1：排版 / 构图参考「杂志排版」——借鉴版式布局')
    expect(prompt).toContain('（本任务用法：借左文右图的分栏）')
    expect(prompt).toContain('图 2：产品主体「保温杯」——保持主体的外形')
    expect(prompt).not.toContain('品牌素材')
  })

  it('Logo 保持硬约束；上游成品图排在套件素材之后并单独说明', () => {
    const prompt = contextAssetRolePrompt(
      [asset('logo', { role: 'logo', name: 'Sogami Logo' })],
      [
        kitInput('logo'),
        { kind: 'asset', nodeId: 'up-1', assetHash: 'h1', mime: 'image/png' },
        { kind: 'asset', nodeId: 'up-2', assetHash: 'h2', mime: 'image/png' },
      ],
    )
    expect(prompt).toContain('图 1：品牌 Logo「Sogami Logo」——必须按原图保留字形')
    expect(prompt).toContain('图 2～图 3：上游节点的成品图')
  })

  it('没有套件素材时不追加任何说明（普通图生图提示词不变）', () => {
    expect(contextAssetRolePrompt([], [kitInput('x')])).toBe('')
    expect(contextAssetRolePrompt(undefined, [])).toBe('')
  })

  it('旧数据没有 usage 时按品牌素材兜底；howToUse 过长截短', () => {
    expect(contextAssetRoleLine(asset('a', { name: '目录参考' }))).toBe(
      '品牌素材「目录参考」——用于核对颜色、字体气质、版式语言和画面规范，不要照抄无关内容。',
    )
    const long = contextAssetRoleLine(asset('b', { usage: 'style', howToUse: '长'.repeat(100) }))
    expect(long).toContain(`${'长'.repeat(60)}…`)
  })

  it('非图片与重复 hash 不进入编号', () => {
    expect(usableContextAssets([
      asset('a'),
      asset('a'),
      asset('v', { mime: 'video/mp4' }),
      asset(' '),
    ]).map((row) => row.hash)).toEqual(['a'])
  })
})
