import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import { ResearchResultsPreview } from './ResearchResultsPreview'

describe('ResearchResultsPreview', () => {
  it('G-R5: web mode lists the first 5 sources when the step is expanded, the rest behind +N 更多', () => {
    const items = Array.from({ length: 18 }, (_, i) => ({
      id: `web:${i}`, title: `来源 ${i}`, url: `https://site${i}.example.com/p`, imageUrl: '', source: 'bing',
    }))
    const render = (sourcesExpanded: boolean) => {
      let renderer!: TestRenderer.ReactTestRenderer
      act(() => {
        renderer = TestRenderer.create(createElement(ResearchResultsPreview, {
          items, researchMode: 'web', sourcesExpanded,
        }))
      })
      return renderer
    }
    const collapsed = render(false)
    expect(collapsed.root.findAll((n) => n.props['data-agent-research-source-link'] !== undefined)).toHaveLength(0)
    const open = render(true)
    const links = open.root.findAll((n) => n.type === 'a' && n.props['data-agent-research-source-link'] !== undefined)
    expect(links.map((n) => n.props.href)).toEqual(items.slice(0, 5).map((i) => i.url))
    expect(open.root.findByProps({ 'data-agent-research-more': true }).children.join('')).toBe('+13 更多')
    // 「联网搜索结果」块仍可打开全部来源
    const row = open.root.findByProps({ 'data-agent-research-sources-open': true })
    expect(JSON.stringify(row.findByType('strong').children)).toContain('联网搜索结果')
    expect(open.root.findAll((n) => n.props['data-agent-research-gallery-open'] !== undefined)).toHaveLength(0)
  })

  it('shows compact web-source and image-gallery entries', () => {
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(
        createElement(ResearchResultsPreview, {
          items: [
            {
              id: 'behance:1',
              title: 'Poster reference',
              url: 'https://www.behance.net/gallery/1/poster',
              imageUrl: 'https://cdn.example.com/poster.jpg',
              source: 'tavily',
            },
            {
              id: 'dribbble:1',
              title: '色板参考',
              url: 'https://dribbble.com/shots/1',
              imageUrl: 'https://cdn.example.com/palette.jpg',
              source: 'tavily',
            },
          ],
        }),
      )
    })

    expect(
      renderer.root.findByProps({ 'data-agent-research-count': 2 }),
    ).toBeTruthy()
    expect(
      renderer.root.findByProps({ 'data-agent-research-sources-open': true }),
    ).toBeTruthy()
    expect(
      renderer.root.findByProps({ 'data-agent-research-gallery-open': true }),
    ).toBeTruthy()
    const previewImages = renderer.root.findAllByType('img')
    expect(previewImages).toHaveLength(2)
    expect(previewImages.every((image) => image.props.loading === 'eager')).toBe(true)
    expect(previewImages.every((image) => image.props.decoding === 'sync')).toBe(true)
  })

  it('image mode only exposes the image-search entry', () => {
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(
        createElement(ResearchResultsPreview, {
          researchMode: 'image',
          items: [
            {
              id: 'tavily:image:1',
              title: 'Poster reference',
              url: 'https://www.behance.net/gallery/1/poster',
              imageUrl: 'https://cdn.example.com/poster.jpg',
              source: 'tavily',
            },
          ],
        }),
      )
    })

    expect(
      renderer.root.findByProps({ 'data-agent-research-mode': 'image' }),
    ).toBeTruthy()
    expect(
      renderer.root.findAllByProps({ 'data-agent-research-sources-open': true }),
    ).toHaveLength(0)
    expect(
      renderer.root.findByProps({ 'data-agent-research-gallery-open': true }),
    ).toBeTruthy()
  })

  it('web and mixed modes keep the web-source entry', () => {
    for (const researchMode of ['web', 'mixed'] as const) {
      let renderer!: TestRenderer.ReactTestRenderer
      act(() => {
        renderer = TestRenderer.create(
          createElement(ResearchResultsPreview, {
            researchMode,
            items: [
              {
                id: `${researchMode}:1`,
                title: 'Source',
                url: 'https://example.com/article',
                imageUrl: researchMode === 'mixed' ? 'https://cdn.example.com/hero.jpg' : '',
                source: 'tavily',
              },
            ],
          }),
        )
      })

      expect(
        renderer.root.findByProps({ 'data-agent-research-sources-open': true }),
      ).toBeTruthy()
    }
  })

  it('renders a text-only source list when there are no images', () => {
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(
        createElement(ResearchResultsPreview, {
          items: [
            {
              id: 'text:1',
              title: '包装趋势',
              url: 'https://www.thedieline.com/blog/post',
              imageUrl: '',
              source: 'tavily',
            },
          ],
        }),
      )
    })

    expect(
      renderer.root.findByProps({ 'data-agent-research-sources-open': true }),
    ).toBeTruthy()
    expect(
      renderer.root.findAllByProps({ 'data-agent-research-gallery-open': true }),
    ).toHaveLength(0)
  })
})
