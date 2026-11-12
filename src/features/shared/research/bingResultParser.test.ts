import { describe, expect, it } from 'vitest'
import {
  decodeBingRedirect,
  parseBingImageResults,
  parseBingWebResults,
} from './bingResultParser'

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

function bingRedirect(target: string): string {
  const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(target)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return `https://www.bing.com/ck/a?!&amp;&amp;p=0f&amp;ptn=3&amp;u=a1${encoded}&amp;ntb=1`
}

describe('decodeBingRedirect', () => {
  it('unwraps the base64url target of a /ck/a click-tracking link', () => {
    expect(decodeBingRedirect(bingRedirect('https://www.behance.net/gallery/1/Tea'))).toBe(
      'https://www.behance.net/gallery/1/Tea',
    )
    expect(decodeBingRedirect(bingRedirect('https://www.zcool.com.cn/work/茶.html'))).toBe(
      'https://www.zcool.com.cn/work/茶.html',
    )
  })

  it('passes direct external links through and rejects Bing-internal or broken links', () => {
    expect(decodeBingRedirect('https://dribbble.com/shots/1')).toBe('https://dribbble.com/shots/1')
    expect(decodeBingRedirect('/search?q=next')).toBe('')
    expect(decodeBingRedirect('https://www.bing.com/ck/a?u=a1!!!')).toBe('')
    expect(decodeBingRedirect(bingRedirect('javascript:alert(1)'))).toBe('')
    expect(decodeBingRedirect('not a url at all')).toBe('')
  })
})

describe('parseBingWebResults', () => {
  it('extracts title, decoded URL and snippet from the real result page fixture', () => {
    const result = parseBingWebResults(fixture('bing-web.html'))
    expect(result.status).toBe('ok')
    expect(result.hits).toHaveLength(3)
    expect(result.hits[1]).toEqual({
      title: 'Tea Packaging Projects :: Photos, videos, logos ... - Behance',
      url: 'https://www.behance.net/search/projects/Tea%20Packaging',
      snippet:
        "Behance is the world's largest creative network for showcasing and discovering creative Tea Packaging work",
    })
    for (const hit of result.hits) {
      expect(hit.url.startsWith('https://www.bing.com')).toBe(false)
      expect(hit.title).not.toMatch(/<|&amp;/)
    }
  })

  it('handles zh-CN pages, entities and trailing script/pagination blocks', () => {
    const result = parseBingWebResults(fixture('bing-web-zh.html'))
    expect(result.status).toBe('ok')
    expect(result.hits.map((hit) => hit.url)).toEqual([
      'https://zh.wikipedia.org/wiki/%E5%92%96%E5%95%A1',
      'https://www.coffeeyo.com/',
    ])
    expect(result.hits[1]?.title).toBe('咖啡网 - 中国咖啡产业门户 | 云南咖啡 · 咖啡展览会 · 咖啡行情 · 品牌黄页')
    expect(result.hits[0]?.snippet).toContain('咖啡植物')
  })

  it('stays robust to extra classes, nested deep links and date prefixes', () => {
    const html = `<input id="sb_form_q"><ol id="b_results">
      <li class="b_algo b_vtl_deeplinks" data-id>
        <h2 class="b_topTitle"><a href="${bingRedirect('https://www.pinterest.com/ideas/tea/')}"><strong>Tea</strong> &amp; Packaging</a></h2>
        <div class="b_caption"><p class="b_lineclamp3"><span class="news_dt">2025年3月5日</span>&nbsp;&#0183; Tea ideas on Pinterest</p></div>
        <ul class="b_vList"><li><a href="https://www.pinterest.com/ideas/x/">deep</a></li></ul>
      </li>
      <li class="b_algo"><h2><a href="${bingRedirect('https://www.pinterest.com/ideas/tea/')}">Duplicate</a></h2></li>
      <li class="b_algo"><div>no heading here</div></li>
      <li class="b_ans"><h2><a href="https://example.com/answer">Answer card</a></h2></li>
    </ol>`
    const result = parseBingWebResults(html)
    expect(result.hits).toEqual([
      {
        title: 'Tea & Packaging',
        url: 'https://www.pinterest.com/ideas/tea/',
        snippet: 'Tea ideas on Pinterest',
      },
    ])
  })

  it('classifies captcha, empty and unknown pages instead of guessing', () => {
    expect(parseBingWebResults(fixture('bing-captcha.html'))).toEqual({ status: 'captcha', hits: [] })
    expect(parseBingWebResults(fixture('bing-images-empty.html')).status).toBe('empty')
    expect(parseBingWebResults('<html><body>Service Unavailable</body></html>').status).toBe(
      'unrecognized',
    )
  })
})

describe('parseBingImageResults', () => {
  it('reads page URL, original image, thumbnail and cleaned title from the m= JSON', () => {
    const result = parseBingImageResults(fixture('bing-images.html'))
    expect(result.status).toBe('ok')
    expect(result.hits).toHaveLength(3)
    expect(result.hits[0]).toEqual({
      title: 'Pin on 12',
      pageUrl: 'https://id.pinterest.com/pin/445856431851923588/',
      imageUrl: 'https://i.pinimg.com/originals/e9/77/9e/e9779e65d3f64945e25b6052b282ea1b.jpg',
      thumbnailUrl: 'https://ts3.mm.bing.net/th?id=OIP.VxZ_vYJqlB0sWnZlWz9nugHaE8&pid=15.1',
      description: 'Pin on 12',
    })
    // Bing 的命中高亮私有区字符被去掉。
    expect(result.hits[1]?.description).toMatch(/^Coffee Beans Background Image/)
    expect(result.hits[1]?.description).not.toMatch(/[\ue000-\ue00f]/)
    expect(result.hits[2]?.imageUrl).toContain('images.pexels.com')
  })

  it('skips tiles with broken JSON or no usable image and dedupes repeats', () => {
    const tile = (m: string) => `<a class="iusc" m="${m.replace(/"/g, '&quot;')}" href="/images/x"></a>`
    const html = `<input id="sb_form_q">${[
      tile('{"purl":"https://dribbble.com/shots/1","murl":"https://cdn.dribbble.com/1.png","t":"A"}'),
      tile('{"purl":"https://dribbble.com/shots/1","murl":"https://cdn.dribbble.com/1.png","t":"A again"}'),
      tile('{"purl":"https://dribbble.com/shots/2","murl":"data:image/png;base64,AAAA"}'),
      tile('{not json'),
      `<a class="iusc" m='{"purl":"https://are.na/b/1","turl":"https://tse1.mm.bing.net/th?id=1","t":"Single quoted"}'></a>`,
    ].join('')}`
    const result = parseBingImageResults(html)
    expect(result.hits.map((hit) => hit.title)).toEqual(['A', 'Single quoted'])
    expect(result.hits[1]).toMatchObject({ imageUrl: '', thumbnailUrl: 'https://tse1.mm.bing.net/th?id=1' })
  })

  it('reports empty and captcha image pages', () => {
    expect(parseBingImageResults(fixture('bing-images-empty.html'))).toEqual({ status: 'empty', hits: [] })
    expect(parseBingImageResults(fixture('bing-captcha.html')).status).toBe('captcha')
  })
})
