import { describe, expect, it } from 'vitest'
import {
  nextSeriesStage,
  seriesDirectiveOf,
  seriesOrchestrationPrompt,
  seriesStageReleased,
  withSeriesStage,
} from './seriesOrchestration'

describe('seriesDirectiveOf', () => {
  it('「先定 Logo」各种说法 → logo_first', () => {
    for (const text of ['先定 Logo', '先把logo定下来', '先做个 LOGO 看看', 'logo 定了再做包装', '先设计一下标志', '只做 logo']) {
      expect(seriesDirectiveOf(text), text).toBe('logo_first')
    }
  })

  it('同时提到两类以上物料或「整套」→ full_series；单张 → null', () => {
    expect(seriesDirectiveOf('做 Logo、包装和海报')).toBe('full_series')
    expect(seriesDirectiveOf('来一整套品牌视觉')).toBe('full_series')
    expect(seriesDirectiveOf('做一张咖啡海报')).toBeNull()
    expect(seriesDirectiveOf('海报角落印上 logo')).toBe('full_series')
  })
})

describe('nextSeriesStage', () => {
  it('logo_first 跨回合保留，放行词解除；新任务不继承', () => {
    expect(nextSeriesStage({ previous: undefined, continued: false, text: '先定 Logo' })).toBe('logo_first')
    expect(nextSeriesStage({ previous: 'logo_first', continued: true, text: '再大一点' })).toBe('logo_first')
    for (const text of ['可以了', '继续', '就这个，做包装吧', '满意']) {
      expect(nextSeriesStage({ previous: 'logo_first', continued: true, text }), text).toBeUndefined()
    }
    expect(nextSeriesStage({ previous: 'logo_first', continued: false, text: '画只猫' })).toBeUndefined()
    expect(seriesStageReleased('logo_first', undefined)).toBe(true)
    expect(seriesStageReleased(undefined, undefined)).toBe(false)
  })

  it('withSeriesStage 无阶段时去掉键', () => {
    const staged: { id: string; seriesStage?: 'logo_first' } = { id: 't', seriesStage: 'logo_first' }
    const plain: { id: string; seriesStage?: 'logo_first' } = { id: 't' }
    expect(withSeriesStage(staged, undefined)).toEqual({ id: 't' })
    expect(withSeriesStage(plain, 'logo_first')).toEqual({ id: 't', seriesStage: 'logo_first' })
  })
})

describe('seriesOrchestrationPrompt', () => {
  it('三种情形各给一段，其余为空', () => {
    expect(seriesOrchestrationPrompt({ stage: 'logo_first', directive: 'logo_first', released: false })).toContain('只做 Logo')
    expect(seriesOrchestrationPrompt({ stage: undefined, directive: null, released: true })).toContain('继续延展')
    expect(seriesOrchestrationPrompt({ stage: undefined, directive: 'full_series', released: false })).toContain('整套串行')
    expect(seriesOrchestrationPrompt({ stage: undefined, directive: null, released: false })).toBe('')
  })
})
