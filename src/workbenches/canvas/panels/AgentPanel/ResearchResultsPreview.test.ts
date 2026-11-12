import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import { ResearchResultsPreview } from './ResearchResultsPreview'

describe('ResearchResultsPreview', () => {
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
