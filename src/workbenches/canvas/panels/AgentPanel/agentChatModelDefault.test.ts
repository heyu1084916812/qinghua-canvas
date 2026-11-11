import { describe, expect, it } from 'vitest'
import type { CatalogChannelLike } from '../../../../domain/project/modelCatalog'
import { pickSessionChatModel } from './agentChatModelDefault'

const chat = (id: string) => ({ id, category: 'chat' as const, inputTypes: ['text' as const] })
const ch = (over: Partial<CatalogChannelLike> & { id: string }): CatalogChannelLike => ({
  enabled: true,
  models: [],
  modelCache: [],
  modelMap: {},
  ...over,
})

/** 实测环境：Agnes 渠道已停用，对话走 deepseek（经别名映射到固定显示名） */
const agnesOff = ch({ id: 'agnes', enabled: false, models: [chat('agnes-2.5-flash')] })
const deepseek = ch({ id: 'cn', models: [chat('cn:deepseek-v4.1-flash')] })
const options = ['Agnes 2.5 Flash', 'GPT-6 Astra', 'Deepseek 4.1 Flash']

describe('pickSessionChatModel（Agent 实测 Bug A4：新会话回落到停用的 Agnes）', () => {
  it('★ 没有偏好时不取 options[0]（停用渠道），而是第一个有启用渠道提供的模型', () => {
    expect(pickSessionChatModel({ options, preferred: [], channels: [agnesOff, deepseek] })).toBe(
      'Deepseek 4.1 Flash',
    )
  })

  it('★ 沿用当前会话已选的对话模型（排在保存的默认之前）', () => {
    const astra = ch({ id: 'oa', models: [chat('gpt-6-astra')] })
    expect(
      pickSessionChatModel({
        options,
        preferred: ['Deepseek 4.1 Flash', 'GPT-6 Astra'],
        channels: [agnesOff, deepseek, astra],
      }),
    ).toBe('Deepseek 4.1 Flash')
  })

  it('★ 偏好的模型渠道已停用 → 跳过它，绝不回落到停用渠道', () => {
    expect(
      pickSessionChatModel({
        options,
        preferred: ['Agnes 2.5 Flash'],
        channels: [agnesOff, deepseek],
      }),
    ).toBe('Deepseek 4.1 Flash')
  })

  it('没有任何启用渠道提供对话模型 → 空串（让用户去选，而不是塞一个必报错的）', () => {
    expect(pickSessionChatModel({ options, preferred: ['Agnes 2.5 Flash'], channels: [agnesOff] })).toBe(
      '',
    )
  })

  it('偏好不在下拉清单里（例如已设为不常用）→ 不用', () => {
    expect(
      pickSessionChatModel({
        options: ['GPT-6 Astra', 'Deepseek 4.1 Flash'],
        preferred: ['Agnes 2.5 Flash'],
        channels: [ch({ id: 'agnes', models: [chat('agnes-2.5-flash')] }), deepseek],
      }),
    ).toBe('Deepseek 4.1 Flash')
  })
})
