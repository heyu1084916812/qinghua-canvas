import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  __resetAgentWebResearchForTest,
  getAgentWebResearch,
  setAgentWebResearch,
  subscribeAgentWebResearch,
} from './agentWebResearch'

afterEach(() => __resetAgentWebResearchForTest())

describe('agentWebResearch store', () => {
  it('defaults on, notifies on change and ignores non-boolean values as default', () => {
    expect(getAgentWebResearch()).toBe(true)
    const listener = vi.fn()
    const off = subscribeAgentWebResearch(listener)
    setAgentWebResearch(false)
    expect(getAgentWebResearch()).toBe(false)
    setAgentWebResearch(false)
    expect(listener).toHaveBeenCalledTimes(1)
    setAgentWebResearch('yes')
    expect(getAgentWebResearch()).toBe(true)
    off()
    setAgentWebResearch(false)
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
