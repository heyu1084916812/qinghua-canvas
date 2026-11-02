import { describe, expect, it } from 'vitest'
import { AgentSessionRuntimeState } from './agentSessionRuntime'

describe('AgentSessionRuntimeState', () => {
  it('keeps per-image routing isolated between parallel sessions', () => {
    const runtime = new AgentSessionRuntimeState()

    runtime.setPerImage('session-a', true)
    runtime.setPerImage('session-b', false)

    expect(runtime.isPerImage('session-a')).toBe(true)
    expect(runtime.isPerImage('session-b')).toBe(false)
  })

  it('keeps sticky image and video models isolated between sessions', () => {
    const runtime = new AgentSessionRuntimeState()

    runtime.rememberStickyModel('session-a', 'image', 'image-a')
    runtime.rememberStickyModel('session-a', 'video', 'video-a')
    runtime.rememberStickyModel('session-b', 'image', 'image-b')

    expect(runtime.stickyModelsFor('session-a')).toEqual({
      image: 'image-a',
      video: 'video-a',
    })
    expect(runtime.stickyModelsFor('session-b')).toEqual({ image: 'image-b' })
  })

  it('clears only the deleted session bucket', () => {
    const runtime = new AgentSessionRuntimeState()
    runtime.setPerImage('session-a', true)
    runtime.rememberStickyModel('session-a', 'image', 'image-a')
    runtime.setPerImage('session-b', true)

    runtime.clearSession('session-a')

    expect(runtime.isPerImage('session-a')).toBe(false)
    expect(runtime.stickyModelsFor('session-a')).toEqual({})
    expect(runtime.isPerImage('session-b')).toBe(true)
  })
})
