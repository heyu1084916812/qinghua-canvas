import { describe, expect, it } from 'vitest'
import type { CatalogChannelLike } from '../../domain/project/modelCatalog'
import type { ModelCapability } from '../../domain/shared/capability'
import { defaultRecipeChannelFor } from './defaultRecipeTarget'
import panelSource from './DefaultParamsPanel.tsx?raw'

const cap = (id: string, category: ModelCapability['category']): ModelCapability => ({
  id,
  category,
  inputTypes: ['text'],
})
const ch = (over: Partial<CatalogChannelLike> & { id: string }): CatalogChannelLike => ({
  enabled: true,
  models: [],
  modelCache: [],
  modelMap: {},
  ...over,
})

describe('defaultRecipeChannelFor（Agent 实测 Bug A1：默认生图模型存成对话渠道）', () => {
  const chatChannel = ch({ id: 'chat-site', models: [cap('cn:deepseek-v4.1-flash', 'chat')] })
  const imageChannel = ch({ id: 'xssr', models: [cap('gpt-image-2.5', 'image')] })

  it('★ 解析出的旧渠道是对话渠道时，生图默认要存到真正提供该生图模型的渠道', () => {
    expect(
      defaultRecipeChannelFor([chatChannel, imageChannel], 'gpt-image-2.5', 'image', 'chat-site'),
    ).toBe('xssr')
  })

  it('★ 固定显示名经别名匹配到提供渠道（GPT Image 2 → gpt-image-2）', () => {
    const site = ch({ id: 'img', models: [cap('gpt-image-2', 'image')] })
    expect(defaultRecipeChannelFor([chatChannel, site], 'GPT Image 2', 'image', 'chat-site')).toBe(
      'img',
    )
  })

  it('★ 没有任何启用渠道提供该模型 → undefined（不把配方塞给对话渠道）', () => {
    expect(
      defaultRecipeChannelFor([chatChannel], 'gpt-image-2.5', 'image', 'chat-site'),
    ).toBeUndefined()
  })

  it('停用渠道不算提供者', () => {
    const off = ch({ id: 'off', enabled: false, models: [cap('gpt-image-2.5', 'image')] })
    expect(defaultRecipeChannelFor([chatChannel, off], 'gpt-image-2.5', 'image')).toBeUndefined()
  })

  it('提供者分类与当前类别不符时不认（对话模型不能当生图默认）', () => {
    expect(
      defaultRecipeChannelFor([chatChannel], 'cn:deepseek-v4.1-flash', 'image'),
    ).toBeUndefined()
    expect(defaultRecipeChannelFor([chatChannel], 'cn:deepseek-v4.1-flash', 'chat')).toBe(
      'chat-site',
    )
  })

  it('同优先度多条提供者时，沿用当前解析出的渠道', () => {
    const a = ch({ id: 'a', models: [cap('gpt-image-2.5', 'image')] })
    const b = ch({ id: 'b', models: [cap('gpt-image-2.5', 'image')] })
    expect(defaultRecipeChannelFor([a, b], 'gpt-image-2.5', 'image', 'b')).toBe('b')
  })

  it('★ 面板保存不再直接用 resolved.channelId 写配方', () => {
    const src = panelSource
    expect(src).not.toMatch(/setDefaultRecipe\(resolved\.channelId/)
    expect(src).toMatch(/defaultRecipeChannelFor\(/)
  })
})
