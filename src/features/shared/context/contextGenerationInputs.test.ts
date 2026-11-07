import { describe, expect, it, vi } from 'vitest'
import { brandContextPrompt, contextGenerationInputs, mergeContextGenerationInputs } from './contextGenerationInputs'
import type { ContextGenerationInputPorts } from './contextGenerationInputs'

const bundleOf = (assets: { hash: string; role: 'logo' | 'reference'; name: string }[]) =>
  ({ assets }) as Awaited<ReturnType<ContextGenerationInputPorts['contextRepo']['bundleForProject']>>

const asset = (hash: string, nodeId = hash) => ({
  kind: 'asset' as const,
  nodeId,
  assetHash: hash,
  mime: 'image/png',
})

describe('contextGenerationInputs', () => {
  it('reads bound kit assets through ContextRepository and preserves logo/reference roles', async () => {
    const bundleForProject = vi.fn(async () => bundleOf([
        { hash: 'logo', role: 'logo' as const, name: '主 Logo' },
        { hash: 'reference', role: 'reference' as const, name: '包装参考' },
      ]))
    const read = vi.fn(async (hash: string) => ({
      mime: hash === 'logo' ? 'image/svg+xml' : 'image/jpeg',
    }))

    await expect(contextGenerationInputs({
      contextRepo: { bundleForProject },
      assets: { read },
      projectId: 'project-1',
      request: '最终商品图',
      taskId: 'task-1',
    })).resolves.toEqual([
      { ...asset('logo', 'context:logo:logo'), mime: 'image/svg+xml' },
      { ...asset('reference', 'context:reference:reference'), mime: 'image/jpeg' },
    ])
    expect(bundleForProject).toHaveBeenCalledWith({
      projectId: 'project-1',
      workbench: 'ecommerce',
      request: '最终商品图',
      taskId: 'task-1',
    })
  })

  it.each([
    { payload: null, error: '已不存在' },
    { payload: { mime: 'video/mp4' }, error: '不是图片' },
  ])('rejects a missing or non-image kit asset before execution', async ({ payload, error }) => {
    await expect(contextGenerationInputs({
      contextRepo: {
        bundleForProject: vi.fn(async () => bundleOf([
          { hash: 'broken', role: 'reference' as const, name: '失效参考' },
        ])),
      },
      assets: { read: vi.fn(async () => payload) },
      projectId: 'project-1',
      request: '最终视频',
    })).rejects.toThrow(error)
  })

  it('appends kit assets after user product/reference inputs and deduplicates by hash', () => {
    expect(mergeContextGenerationInputs(
      [asset('product'), asset('reference'), asset('shared', 'user-choice')],
      [asset('shared', 'context:logo:shared'), asset('brand')],
    ).map((input) => input.kind === 'asset' ? input.assetHash : input.kind))
      .toEqual(['product', 'reference', 'shared', 'brand'])
    expect(mergeContextGenerationInputs([], [asset('shared')])[0]?.nodeId)
      .toBe('shared')
  })

  it('labels appended logos and references once in Chinese without overriding Canvas rules', () => {
    const prompt = brandContextPrompt([
      { ...asset('logo'), nodeId: 'context:logo:logo' },
      { ...asset('logo'), nodeId: 'context:logo:logo' },
      { ...asset('reference'), nodeId: 'context:reference:reference' },
    ])
    expect(prompt).toContain('追加素材 1：品牌 Logo')
    expect(prompt).toContain('不是无关 Logo')
    expect(prompt).toContain('追加素材 2：品牌参考图')
    expect(prompt).toContain('不把它当作商品图替代')
    expect(prompt.match(/追加素材 1/g)).toHaveLength(1)
    expect(brandContextPrompt([asset('product')])).toBe('')
  })
})
