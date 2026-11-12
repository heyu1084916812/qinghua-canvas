import { afterEach, describe, expect, it, vi } from 'vitest'
import { RESEARCH_IMAGE_SAVE_TIMEOUT_MS, researchActionSignal } from './researchActionAbort'

afterEach(() => {
  vi.useRealTimers()
})

describe('researchActionSignal (B6: no leaked timers or listeners)', () => {
  it('times out and reports it when the action is still running', () => {
    vi.useFakeTimers()
    const action = researchActionSignal()
    vi.advanceTimersByTime(RESEARCH_IMAGE_SAVE_TIMEOUT_MS)
    expect(action.signal.aborted).toBe(true)
    expect(action.timedOut()).toBe(true)
  })

  it('dispose clears the deadline timer and the parent listener', () => {
    vi.useFakeTimers()
    const parent = new AbortController()
    const remove = vi.spyOn(parent.signal, 'removeEventListener')
    const action = researchActionSignal(parent.signal)
    expect(vi.getTimerCount()).toBe(1)
    action.dispose()
    expect(vi.getTimerCount()).toBe(0)
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    vi.advanceTimersByTime(RESEARCH_IMAGE_SAVE_TIMEOUT_MS * 2)
    parent.abort()
    expect(action.signal.aborted).toBe(false)
    expect(action.timedOut()).toBe(false)
  })

  it('a parent abort aborts the action and frees the timer', () => {
    vi.useFakeTimers()
    const parent = new AbortController()
    const action = researchActionSignal(parent.signal)
    parent.abort()
    expect(action.signal.aborted).toBe(true)
    expect(action.timedOut()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('an already aborted parent starts no timer', () => {
    vi.useFakeTimers()
    const parent = new AbortController()
    parent.abort()
    const action = researchActionSignal(parent.signal)
    expect(action.signal.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
})
