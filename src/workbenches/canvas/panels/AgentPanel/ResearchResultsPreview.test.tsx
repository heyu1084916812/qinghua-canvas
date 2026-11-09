import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import { ResearchResultsPreview } from './ResearchResultsPreview'

describe('ResearchResultsPreview', () => {
  it('renders bounded public candidates with source labels', () => {
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(createElement(ResearchResultsPreview, {
        limit: 2,
        items: [
          {
            id: 'openverse:1',
            title: 'Packaging reference',
            url: 'https://example.com/openverse',
            imageUrl: 'https://example.com/openverse.jpg',
            source: 'openverse',
          },
          {
            id: 'wikipedia:1',
            title: 'Sustainable packaging',
            url: 'https://zh.wikipedia.org/wiki/Packaging',
            imageUrl: '',
            source: 'wikipedia',
            description: '材料、回收与生命周期',
          },
          {
            id: 'openverse:3',
            title: 'Hidden by limit',
            url: 'https://example.com/hidden',
            imageUrl: 'https://example.com/hidden.jpg',
            source: 'openverse',
          },
        ],
      }))
    })

    const grid = renderer.root.findByProps({ 'data-agent-research-results': true })
    expect(grid.props['data-agent-research-count']).toBe(3)
    expect(renderer.root.findAllByType('a')).toHaveLength(2)
    expect(renderer.root.findAllByType('img')).toHaveLength(1)
    expect(
      renderer.root.findAll((node) => node.props['data-agent-research-item'] === 'wikipedia'),
    ).toHaveLength(1)
  })
})
