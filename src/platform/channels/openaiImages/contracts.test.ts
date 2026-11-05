import { describe, expect, it } from 'vitest'
import type {
  OpenAiAdapterConfig,
  OpenAiImagesOptions,
  SoonStudioSubmissionInput,
} from './contracts'

describe('openaiImages / contracts module', () => {
  it('is a type-only boundary with no runtime exports', async () => {
    const module = await import('./contracts')
    expect(Object.keys(module)).toEqual([])
    const options: OpenAiImagesOptions = { soonStudioMaxPolls: 2 }
    expect(options.soonStudioMaxPolls).toBe(2)
    const config: Partial<OpenAiAdapterConfig> = { apiKey: null }
    expect(config.apiKey).toBeNull()
    const input: Partial<SoonStudioSubmissionInput> = { count: 1 }
    expect(input.count).toBe(1)
  })
})
