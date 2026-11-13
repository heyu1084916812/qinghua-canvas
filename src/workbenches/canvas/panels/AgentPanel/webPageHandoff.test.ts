import { describe, expect, it } from 'vitest'
import { appendWebPageLine, webPageDraftLine, webPageResearchItems } from './webPageHandoff'

describe('webPageHandoff（#1089）', () => {
  it('图片 → 调研勾选项：稳定 id、原帖链接优先、标题回落网页标题 / 域名', () => {
    const items = webPageResearchItems({
      url: 'https://www.dribbble.com/search/tea',
      title: '',
      images: [
        { imageUrl: 'https://cdn.dribbble.com/1.png', link: 'https://dribbble.com/shots/1', title: 'Shot 1' },
        { imageUrl: 'https://cdn.dribbble.com/2.png' },
      ],
    })
    expect(items[0]).toMatchObject({ title: 'Shot 1', url: 'https://dribbble.com/shots/1', source: 'dribbble.com' })
    expect(items[1]).toMatchObject({ title: 'dribbble.com', url: 'https://www.dribbble.com/search/tea' })
    expect(items[0]!.id).toMatch(/^webpage-/)
    expect(webPageResearchItems({ url: 'https://www.dribbble.com/', title: '', images: [{ imageUrl: 'https://cdn.dribbble.com/1.png' }] })[0]!.id)
      .toBe(items[0]!.id)
  })

  it('草稿行：有标题带书名号，没有就只写地址；追加到末尾、不重复', () => {
    expect(webPageDraftLine({ url: 'https://a.example/', title: ' 茶包装 ' })).toBe('参考网页「茶包装」 https://a.example/')
    expect(webPageDraftLine({ url: 'https://a.example/', title: '' })).toBe('参考网页 https://a.example/')
    const line = '参考网页 https://a.example/'
    expect(appendWebPageLine('', line)).toBe(line)
    expect(appendWebPageLine('做一组茶包装  \n', line)).toBe(`做一组茶包装\n${line}`)
    expect(appendWebPageLine(`做一组茶包装\n${line}`, line)).toBe(`做一组茶包装\n${line}`)
  })
})
