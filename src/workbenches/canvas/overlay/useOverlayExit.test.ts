import React from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useOverlayExit } from './useOverlayExit'

function Probe({ active, retain }: { active: string | null; retain: boolean }) {
  const state = useOverlayExit(active, retain)
  return React.createElement('output', { 'data-value': state.value ?? '', 'data-closing': String(state.closing) })
}

describe('useOverlayExit', () => {
  afterEach(() => vi.useRealTimers())

  it('retains the previous overlay during a short dismiss animation', () => {
    vi.useFakeTimers()
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(React.createElement(Probe, { active: 'node-a', retain: true }))
    })
    act(() => {
      renderer!.update(React.createElement(Probe, { active: null, retain: true }))
    })
    expect(renderer!.root.findByType('output').props).toMatchObject({
      'data-value': 'node-a',
      'data-closing': 'true',
    })
    act(() => { vi.advanceTimersByTime(160) })
    expect(renderer!.root.findByType('output').props).toMatchObject({
      'data-value': '',
      'data-closing': 'false',
    })
  })

  it('does not retain after a drag or another non-dismiss hide', () => {
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(React.createElement(Probe, { active: 'node-a', retain: true }))
    })
    act(() => {
      renderer!.update(React.createElement(Probe, { active: null, retain: false }))
    })
    expect(renderer!.root.findByType('output').props).toMatchObject({
      'data-value': '',
      'data-closing': 'false',
    })
  })
})


