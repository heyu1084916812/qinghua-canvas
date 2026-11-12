import { describe, expect, it } from 'vitest'
import { htmlToReadableText } from './htmlReadableText'

const FIXTURES = import.meta.glob('./fixtures/*.html', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>
const fixture = (name: string): string => {
  const html = FIXTURES[`./fixtures/${name}`]
  if (html === undefined) throw new Error(`missing fixture ${name}`)
  return html
}

describe('htmlToReadableText', () => {
  it('prefers the longest <article>, drops scripts/styles/nav/footer and keeps structure', () => {
    const { title, text } = htmlToReadableText(fixture('article-page.html'))
    expect(title).toBe('山野茶饮包装：把高山云雾装进纸盒')
    expect(text.split('\n')[0]).toBe('山野茶饮包装：把高山云雾装进纸盒')
    expect(text).toContain('By Lin · 2026-10-01')
    expect(text).toContain('设计团队从茶园清晨的雾气出发')
    expect(text).toContain('内托使用再生纸浆模塑，\n兼顾环保与开箱仪式感。')
    expect(text).toContain('- 主色：雾灰绿 #8FA39A\n- 辅色：米白 & 烫金')
    expect(text).toContain('主视觉：雾面纸盒与烫金山形')
    for (const noise of ['dataLayer', 'inline ad', 'font-family', 'News', 'Related', '请先登录', '分享']) {
      expect(text).not.toContain(noise)
    }
    expect(text).not.toMatch(/\n{3,}/)
  })

  it('falls back to <main>, then role=main, then <body>', () => {
    const long = '正文'.repeat(120)
    expect(htmlToReadableText(`<body><nav>menu</nav><main><p>${long}</p></main><p>outside</p></body>`).text)
      .toBe(long)
    expect(htmlToReadableText(`<body><div role="main"><div><p>${long}</p></div></div><p>outside</p></body>`).text)
      .toBe(long)
    expect(htmlToReadableText('<html><body><p>Short page</p><p>Second line</p></body></html>').text)
      .toBe('Short page\nSecond line')
  })

  it('uses <title> when there is no og:title and survives unclosed markup', () => {
    const result = htmlToReadableText('<title>Plain &amp; simple</title><body><p>Hello <b>world')
    expect(result.title).toBe('Plain & simple')
    expect(result.text).toBe('Hello world')
  })

  it('handles nested articles by balancing tags', () => {
    const long = 'x'.repeat(260)
    const html = `<article><p>outer start</p><article><p>${long}</p></article><p>outer end</p></article>`
    const { text } = htmlToReadableText(html)
    expect(text.startsWith('outer start')).toBe(true)
    expect(text.endsWith('outer end')).toBe(true)
  })
})
