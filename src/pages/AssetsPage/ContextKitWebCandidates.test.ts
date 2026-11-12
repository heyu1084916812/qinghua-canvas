import { createElement } from 'react'
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { PlatformProvider } from '../../app/providers/PlatformProvider'
import { createPlatform } from '../../platform'
import { ContextKitWebCandidates, roleOfCandidate } from './ContextKitWebCandidates'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])

describe('ContextKitWebCandidates', () => {
  it('Logo / 图标类候选按 Logo 角色加入，其余按参考', () => {
    expect(roleOfCandidate({ url: 'u', source: 'logo-img', label: '' })).toBe('logo')
    expect(roleOfCandidate({ url: 'u', source: 'icon', label: '' })).toBe('logo')
    expect(roleOfCandidate({ url: 'u', source: 'og-image', label: '' })).toBe('reference')
  })

  it('候选先下载校验；只把勾选的图片、颜色和资料交出去', async () => {
    const platform = createPlatform('memory')
    platform.network.request = (async (req: { url: string }) => ({
      status: req.url.endsWith('bad.png') ? 404 : 200,
      headers: { 'content-type': 'image/png' },
      text: async () => '',
      json: async () => ({}),
      arrayBuffer: async () => PNG.buffer.slice(0),
    })) as never
    const createObjectURL = vi.fn(() => 'blob:x')
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }))
    const onAdd = vi.fn()
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = TestRenderer.create(createElement(PlatformProvider, { runtime: 'memory', create: () => platform },
        createElement(ContextKitWebCandidates, {
          url: 'https://a.com/',
          busy: false,
          onCancel: vi.fn(),
          onAdd,
          page: {
            title: 'A',
            text: '品牌介绍',
            candidates: [
              { url: 'https://a.com/logo.png', source: 'logo-img', label: '页面 Logo' },
              { url: 'https://a.com/bad.png', source: 'img', label: '页面图片' },
            ],
            colors: [{ hex: '#FF6600', label: '网页主题色' }],
          },
        })))
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    const tiles = renderer.root.findAll((node) => node.type === 'button' && node.props['data-context-web-candidate'] !== undefined)
    expect(tiles[1]!.props.disabled).toBe(true)
    act(() => tiles[0]!.props.onClick())
    const add = renderer.root.find((node) => node.props['data-context-web-add'] !== undefined)
    act(() => add.props.onClick())
    expect(onAdd).toHaveBeenCalledWith({
      images: [{ bytes: PNG, mime: 'image/png', name: 'logo.png', role: 'logo' }],
      colors: [{ name: '网页主题色', value: '#ff6600' }],
      text: '品牌介绍',
    })
    act(() => renderer.unmount())
    vi.unstubAllGlobals()
  })
})
