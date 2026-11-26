import { describe, expect, it } from 'vitest'
import {
  ecommerceImageRatioOf,
  uniformImageRatioOf,
  uniformImageRatioPrompt,
} from './outputConstraints'

describe('Agent 输出比例约束', () => {
  it('★★ 只把“整组统一”的明确比例写成约束', () => {
    expect(uniformImageRatioOf('主图都要统一成 1：1，并加文字排版')).toBe('1:1')
    expect(uniformImageRatioOf('每张都用 16:9')).toBe('16:9')
    expect(uniformImageRatioOf('主图 1:1，详情页 3:4')).toBeUndefined()
  })

  it('提示词明确要求所有生成节点写同一个 ratio', () => {
    expect(uniformImageRatioPrompt('1:1')).toContain('整组图片统一为 1:1')
    expect(uniformImageRatioPrompt('1:1')).toContain(
      '所有新建生成节点的 `data.ratio` 必须写这个值',
    )
  })

  it('电商任务未写明比例时默认 1:1；写了两个不同比例时不强行统一', () => {
    expect(ecommerceImageRatioOf('淘宝五张主图')).toBe('1:1')
    expect(ecommerceImageRatioOf('五张主图都用 4:5')).toBe('4:5')
    expect(ecommerceImageRatioOf('主图 1:1，详情页 3:4')).toBeUndefined()
  })
})
