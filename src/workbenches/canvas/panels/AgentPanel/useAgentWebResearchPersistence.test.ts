import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  __resetAgentWebResearchForTest,
  getAgentWebResearch,
  setAgentWebResearch,
} from '../../../../state/ui/agentWebResearch'
import { bindAgentWebResearchPersistence } from './useAgentWebResearchPersistence'

afterEach(() => __resetAgentWebResearchForTest())

describe('bindAgentWebResearchPersistence', () => {
  it('restores the saved choice without re-saving it, then persists user toggles', async () => {
    const save = vi.fn(async () => undefined)
    const unbind = bindAgentWebResearchPersistence({
      loadAgentWebResearch: async () => false,
      saveAgentWebResearch: save,
    })
    await vi.waitFor(() => expect(getAgentWebResearch()).toBe(false))
    await Promise.resolve()
    expect(save).not.toHaveBeenCalled()
    setAgentWebResearch(true)
    expect(save).toHaveBeenCalledWith(true)
    unbind()
    setAgentWebResearch(false)
    expect(save).toHaveBeenCalledTimes(1)
  })
})
