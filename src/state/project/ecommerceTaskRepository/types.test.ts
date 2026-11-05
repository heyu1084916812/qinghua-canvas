import { describe, expect, it } from 'vitest'
import * as types from './types'

describe('电商仓储 · 类型模块', () => {
  it('没有运行时导出', () => {
    expect(Object.keys(types)).toEqual([])
  })
})
