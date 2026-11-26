import { describe, expect, it } from 'vitest'
import {
  expectsPerImageFlows,
  looksLikeCombineRequest,
  looksLikePreserveRequest,
  looksLikeStyleOnlyRequest,
} from './agentPromptIntent'

describe('Agent 原话意图', () => {
  it('识别保持 / 只换风格 / 合成意图', () => {
    expect(looksLikePreserveRequest('其他都别动，只把背景换掉')).toBe(true)
    expect(looksLikeStyleOnlyRequest('换成 3D 渲染风格')).toBe(true)
    expect(looksLikeCombineRequest('把这两张图合成一张')).toBe(true)
  })

  it('多张图默认各自一条流程，明确合成才不拆', () => {
    expect(expectsPerImageFlows('把两张图换成 3d 材质', 2)).toBe(true)
    expect(expectsPerImageFlows('把两张图合成一张', 2)).toBe(false)
    expect(expectsPerImageFlows('换成 3d 材质', 1)).toBe(false)
  })
})
