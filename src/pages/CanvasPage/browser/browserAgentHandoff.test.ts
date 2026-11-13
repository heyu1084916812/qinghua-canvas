import { describe, expect, it, vi } from 'vitest'
import { browserAgentStatus, readBrowserPageForAgent } from './browserAgentHandoff'

const SNAPSHOT = {
  url: 'https://packagingoftheworld.com/tea',
  title: 'Tea packaging',
  images: [
    { src: 'https://packagingoftheworld.com/1.jpg', width: 1200, height: 900, alt: 'Box', link: 'https://packagingoftheworld.com/p/1', title: '' },
    { src: 'https://packagingoftheworld.com/2.jpg', width: 1200, height: 900, alt: '', link: '', title: '' },
  ],
  signals: { passwordField: false, challengeMarkers: [], gatedCount: 0, textLength: 2000 },
}

describe('画布浏览器「交给 Agent」读当前网页（#1089）', () => {
  it('原生视图：在 canvas 视图执行提取脚本，图片带原帖链接与标题', async () => {
    const extract = vi.fn(async () => JSON.stringify(SNAPSHOT))
    const result = await readBrowserPageForAgent({ url: 'https://packagingoftheworld.com/tea?x', title: '', viewId: 'canvas', view: { extract } })
    expect(extract).toHaveBeenCalledWith('canvas', expect.stringContaining('JSON.stringify'))
    expect(result.extracted).toBe(true)
    expect(result.page).toEqual({
      url: 'https://packagingoftheworld.com/tea',
      title: 'Tea packaging',
      images: [
        { imageUrl: 'https://packagingoftheworld.com/1.jpg', link: 'https://packagingoftheworld.com/p/1', title: 'Box' },
        { imageUrl: 'https://packagingoftheworld.com/2.jpg' },
      ],
    })
  })

  it('iframe 退回 / 端口没有 extract / 脚本超时 / 脚本报错：只交地址与标题', async () => {
    const base = { url: 'https://a.example/', title: ' A ', viewId: 'canvas' }
    const fallback = { page: { url: 'https://a.example/', title: 'A', images: [] }, extracted: false }
    expect(await readBrowserPageForAgent({ ...base, view: null })).toEqual(fallback)
    expect(await readBrowserPageForAgent({ ...base, view: {} })).toEqual(fallback)
    expect(await readBrowserPageForAgent({ ...base, view: { extract: async () => { throw new Error('timeout') } } })).toEqual(fallback)
    expect(await readBrowserPageForAgent({ ...base, view: { extract: async () => '{"error":"boom"}' } })).toEqual(fallback)
    expect(await readBrowserPageForAgent({ ...base, view: { extract: async () => 'not json' } })).toEqual(fallback)
  })

  it('状态文案', () => {
    const page = { url: 'https://a.example/', title: 'A', images: [{ imageUrl: 'https://a.example/1.jpg' }] }
    expect(browserAgentStatus(true, page)).toContain('1 张图片')
    expect(browserAgentStatus(true, { ...page, images: [] })).toContain('没有可用的图片')
    expect(browserAgentStatus(false, page)).toContain('读不到这个页面的图片')
    expect(browserAgentStatus(true, null)).toContain('没有可交给 Agent 的地址')
  })
})
