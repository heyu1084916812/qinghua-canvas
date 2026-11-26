import { describe, expect, it } from 'vitest'
import { projectResearchConversation } from './agentResearchConversation'

describe('Agent 调研对话投影', () => {
  it('保留真实检索词、目标数量和各站原因', () => {
    const projected = projectResearchConversation({
      request: { imageMaxResults: 100, maxResults: 12 },
      searchQueries: ['电商主图', '详情页排版'],
      items: [{
        id: 'r1',
        title: '主图',
        url: 'https://www.huaban.com/pins/1',
        imageUrl: 'https://cdn.example.com/main.jpg',
        source: '花瓣',
      }],
      siteStatuses: [
        { site: '花瓣', status: 'ok', itemCount: 48 },
        { site: 'Pinterest', status: 'needs-login', itemCount: 0, note: '需要登录一次' },
      ],
    }, 'image', String)
    expect(projected.itemCount).toBe(1)
    expect(projected.status).toMatchObject({
      target: 100,
      actual: 1,
      queries: ['电商主图', '详情页排版'],
    })
    expect(projected.status.siteStatuses[1]).toMatchObject({
      site: 'Pinterest',
      note: '需要登录一次',
    })
  })

  it('过滤非公开链接，并按图片模式保留最多 120 条', () => {
    const items = Array.from({ length: 125 }, (_, index) => ({
      id: `r${index}`,
      title: `参考 ${index}`,
      url: `https://example.com/${index}`,
      imageUrl: `https://cdn.example.com/${index}.jpg`,
      source: 'web',
    }))
    items.push({
      id: 'private',
      title: 'private',
      url: 'javascript:alert(1)',
      imageUrl: '',
      source: 'web',
    })
    const projected = projectResearchConversation({
      request: { imageMaxResults: 100 },
      items,
    }, 'image', String)
    expect(projected.items).toHaveLength(120)
    expect(projected.items.some((item) => item.id === 'private')).toBe(false)
  })
})
