import { describe, expect, it } from 'vitest'
import type {
  PreparedShotVideo,
  StoryboardVideoExecutionControllerArgs,
  VideoEditTarget,
} from './contracts'

describe('storyboard video execution / contracts module', () => {
  it('is a type-only boundary with no runtime exports', async () => {
    const module = await import('./contracts')
    expect(Object.keys(module)).toEqual([])
    const target: Partial<VideoEditTarget> = {
      supportsReferenceImage: true,
      requiresReferenceImage: false,
    }
    const prepared: Partial<PreparedShotVideo> = { includeEndFrame: false }
    const args: Partial<StoryboardVideoExecutionControllerArgs> = {
      projectId: 'project-1',
    }
    expect(target.supportsReferenceImage).toBe(true)
    expect(prepared.includeEndFrame).toBe(false)
    expect(args.projectId).toBe('project-1')
  })
})
