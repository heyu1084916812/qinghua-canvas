import { describe, expect, it } from 'vitest'
import {
  parseReferenceCurationText,
  referenceUsageId,
} from './referenceCuration'

describe('reference curation rules', () => {
  it('解析真实 What、usage、HowToUse 和身份锚点', () => {
    const parsed = parseReferenceCurationText(JSON.stringify({
      what: '深绿色品牌标志，横向字标，留白充足。',
      usage: 'identityAnchor',
      howToUse: '本任务保持标志字形和比例不变，只适配背景与留白。',
      identityAnchor: true,
      limitations: [],
    }))

    expect(parsed).toEqual({
      ok: true,
      analysis: {
        what: '深绿色品牌标志，横向字标，留白充足。',
        usage: 'identityAnchor',
        howToUse: '本任务保持标志字形和比例不变，只适配背景与留白。',
        identityAnchor: true,
        limitations: [],
      },
    })
  })

  it('拒绝缺少 What 或 HowToUse 的假分析', () => {
    expect(parseReferenceCurationText('{"usage":"style"}')).toEqual({
      ok: false,
      reason: '分析结果缺少 What',
    })
    expect(parseReferenceCurationText(JSON.stringify({
      what: '一张米色背景图',
      usage: 'style',
    }))).toEqual({
      ok: false,
      reason: '分析结果缺少 HowToUse',
    })
  })

  it('usage id 对同一任务稳定，对不同任务隔离', () => {
    const base = {
      projectId: 'p1',
      taskKey: 'simple_generate',
      itemId: 'ref-1',
    }
    expect(referenceUsageId(base)).toBe(referenceUsageId({ ...base }))
    expect(referenceUsageId(base)).not.toBe(
      referenceUsageId({ ...base, taskKey: 'reference_edit' }),
    )
  })
})
