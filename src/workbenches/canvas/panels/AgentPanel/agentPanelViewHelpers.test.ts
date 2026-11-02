import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  originOf,
  viewportWorldOf,
  withModelIcons,
} from './agentPanelViewHelpers'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('agentPanelViewHelpers', () => {
  it('模型勾选只反映正文里已有的模型', () => {
    const options = withModelIcons(
      ['A', 'B'],
      new Set(['B']),
      (name) => (name === 'A' ? { vendor: 'openai' } : undefined),
    )

    expect(options.map((item) => [item.value, item.selected])).toEqual([
      ['A', false],
      ['B', true],
    ])
    expect(options[0]?.icon).toBeTruthy()
    expect(options[1]?.icon).toBeUndefined()
  })

  it('新节点落点仍保持在当前视口内偏移', () => {
    expect(originOf({ x: 20, y: 30 })).toEqual({ x: 140, y: 150 })
  })

  it('视口世界尺寸按画布元素和缩放计算', () => {
    vi.stubGlobal('window', {
      innerWidth: 1000,
      innerHeight: 800,
    })
    vi.stubGlobal('document', {
      querySelector: () => ({ clientWidth: 600, clientHeight: 400 }),
    })

    expect(viewportWorldOf({ x: 12, y: 24, zoom: 2 })).toEqual({
      x: 12,
      y: 24,
      w: 300,
      h: 200,
    })
  })
})
