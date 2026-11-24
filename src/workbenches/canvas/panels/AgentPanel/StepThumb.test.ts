import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ openLightbox: vi.fn() }))

vi.mock('../../storeContext', () => ({
  useCanvasStore: () => ({ openLightbox: mocks.openLightbox }),
}))

vi.mock('../../../../features/shared/assets/index', () => ({
  useAsset: () => 'blob:agent-thumb',
}))

import { StepThumb } from './AgentActivityViews'

describe('Agent StepThumb', () => {
  afterEach(() => {
    mocks.openLightbox.mockReset()
    vi.unstubAllGlobals()
  })

  it('打开灯箱时携带按钮内真实图片的 FLIP 快照', () => {
    vi.stubGlobal('getComputedStyle', () => ({ borderRadius: '6px' }))
    const image = {
      tagName: 'IMG',
      currentSrc: 'blob:agent-thumb',
      src: 'blob:agent-thumb',
      getAttribute: () => null,
      getBoundingClientRect: () => ({
        left: 20,
        top: 40,
        width: 72,
        height: 72,
        right: 92,
        bottom: 112,
        x: 20,
        y: 40,
        toJSON: () => ({}),
      }),
    } as unknown as HTMLImageElement
    const host = {
      matches: () => false,
      querySelector: () => image,
    } as unknown as HTMLElement
    let renderer!: TestRenderer.ReactTestRenderer

    act(() => {
      renderer = TestRenderer.create(createElement(StepThumb, { hash: 'hash-agent' }))
    })
    act(() => {
      renderer.root.findByType('button').props.onClick({ currentTarget: host })
    })

    expect(mocks.openLightbox).toHaveBeenCalledWith('hash-agent', {
      sourceRect: {
        left: 20,
        top: 40,
        width: 72,
        height: 72,
        borderRadius: '6px',
        src: 'blob:agent-thumb',
        kind: 'image',
        assetHash: 'hash-agent',
      },
    })
    act(() => renderer.unmount())
  })
})
