import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetAgentCanvasReviewForTest,
  getAgentCanvasReview,
  setAgentCanvasReview,
  subscribeAgentCanvasReview,
} from './agentCanvasReview'

beforeEach(() => __resetAgentCanvasReviewForTest())

describe('Agent 画布巡检开关', () => {
  it('默认关闭，并允许偏好状态同步到订阅者', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeAgentCanvasReview(listener)

    expect(getAgentCanvasReview()).toBe(false)
    setAgentCanvasReview(true)
    expect(getAgentCanvasReview()).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
  })

  it('损坏值回退默认关闭', () => {
    setAgentCanvasReview(true)
    setAgentCanvasReview('broken')
    expect(getAgentCanvasReview()).toBe(false)
  })
})
