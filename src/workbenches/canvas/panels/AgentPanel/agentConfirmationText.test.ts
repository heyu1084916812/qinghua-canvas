import { describe, expect, it } from 'vitest'
import { readableConfirmationLines } from './agentConfirmationText'

describe('确认卡长文分段', () => {
  it('把挤在一段的编号项拆成可读行，并保留原文内容', () => {
    const text =
      '做 Logo 前确认 3 件事：1) 职业领域与目标受众：你目前是品牌设计；' +
      '2) 沿用已经确认的品牌名 HE YU、黑白主色；' +
      '3) 画布上的旧图保留不动。'
    expect(readableConfirmationLines(text)).toEqual([
      '做 Logo 前确认 3 件事：',
      '1) 职业领域与目标受众：你目前是品牌设计；',
      '2) 沿用已经确认的品牌名 HE YU、黑白主色；',
      '3) 画布上的旧图保留不动。',
    ])
  })
})
