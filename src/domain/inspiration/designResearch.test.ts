import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RESEARCH_IMAGE_RESULTS,
  DEFAULT_RESEARCH_MAX_RESULTS,
  DESIGN_RESEARCH_RIGHTS_NOTE,
  MAX_RESEARCH_IMAGE_RESULTS,
  MAX_RESEARCH_MAX_RESULTS,
  MAX_RESEARCH_URLS,
  MIN_RESEARCH_IMAGE_RESULTS,
  buildDesignResearchReport,
  dedupeResearchItems,
  extractOpenGraphImages,
  inferResearchMode,
  normalizeResearchRequest,
  parsePinterestHtml,
  planResearchQueries,
  type DesignResearchItem,
} from './designResearch'

describe('normalizeResearchRequest', () => {
  it('normalizes topic, seed URLs, tracking parameters, and result limits', () => {
    const request = normalizeResearchRequest(
      '  handmade   soap  ',
      [
        'https://www.example.com/moodboard/?utm_source=newsletter#top',
        'https://example.com/moodboard/?utm_medium=email',
        'not a url',
        'mailto:test@example.com',
      ],
      999,
    )

    expect(request).toEqual({
      topic: 'handmade soap',
      urls: ['https://www.example.com/moodboard/'],
      maxResults: MAX_RESEARCH_MAX_RESULTS,
      mode: 'image',
      imageMaxResults: DEFAULT_RESEARCH_IMAGE_RESULTS,
    })
  })

  it('uses defaults for blank and invalid limits', () => {
    expect(normalizeResearchRequest('brand system', null, Number.NaN)).toEqual({
      topic: 'brand system',
      urls: [],
      maxResults: DEFAULT_RESEARCH_MAX_RESULTS,
      mode: 'image',
      imageMaxResults: DEFAULT_RESEARCH_IMAGE_RESULTS,
    })
  })

  it('keeps image target independent and clamps it to 30–50', () => {
    expect(normalizeResearchRequest('poster', [], 12, { mode: 'image' })).toMatchObject({
      maxResults: 12,
      mode: 'image',
      imageMaxResults: DEFAULT_RESEARCH_IMAGE_RESULTS,
    })
    expect(
      normalizeResearchRequest('poster', [], 12, { mode: 'image', imageMaxResults: 1 })
        .imageMaxResults,
    ).toBe(MIN_RESEARCH_IMAGE_RESULTS)
    expect(
      normalizeResearchRequest('poster', [], 12, { mode: 'image', imageMaxResults: 999 })
        .imageMaxResults,
    ).toBe(MAX_RESEARCH_IMAGE_RESULTS)
  })

  it('caps seed URLs so a pasted list cannot fan out without bound', () => {
    const urls = Array.from({ length: MAX_RESEARCH_URLS + 4 }, (_, index) =>
      `https://example.com/${index}`,
    )
    expect(normalizeResearchRequest('brand', urls).urls).toHaveLength(MAX_RESEARCH_URLS)
  })
})

describe('planResearchQueries', () => {
  it('creates six searches across Google, Pinterest, and Behance', () => {
    const queries = planResearchQueries('  ceramic  coffee ')

    expect(queries).toHaveLength(6)
    expect(new Set(queries.map((query) => query.source))).toEqual(
      new Set(['google', 'pinterest', 'behance']),
    )
    expect(queries.every((query) => query.query.includes('ceramic coffee'))).toBe(true)
    expect(queries.find((query) => query.source === 'pinterest')?.url).toContain(
      'pinterest.com/search/pins',
    )
    expect(queries.find((query) => query.source === 'behance')?.url).toContain(
      'behance.net/search/projects',
    )
  })

  it('does not manufacture queries for an empty topic', () => {
    expect(planResearchQueries('   ')).toEqual([])
  })
})

describe('parsePinterestHtml', () => {
  it('extracts pin URLs, images, and titles, then merges duplicate pin links', () => {
    const html = [
      '<a href="/pin/111/warm-kitchen/">',
      '  <img data-src="//i.pinimg.com/564x/one.jpg" alt="Warm kitchen">',
      '</a>',
      '<a href="https://www.pinterest.com/pin/222/" title="Editorial table">',
      '  <img src="https://i.pinimg.com/564x/two.jpg">',
      '</a>',
      '<a href="/pin/111/">',
      '  <img src="https://i.pinimg.com/originals/one-large.jpg" alt="Warm kitchen">',
      '</a>',
    ].join('')

    const items = parsePinterestHtml(html, 'https://www.pinterest.com/ideas/kitchen/')

    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      id: 'pinterest:111',
      source: 'pinterest',
      title: 'Warm kitchen',
      url: 'https://www.pinterest.com/pin/111/warm-kitchen/',
      imageUrl: 'https://i.pinimg.com/564x/one.jpg',
    })
    expect(items[1]).toMatchObject({
      id: 'pinterest:222',
      title: 'Editorial table',
      imageUrl: 'https://i.pinimg.com/564x/two.jpg',
    })
  })

  it('uses the public pin metadata when a single pin page has no card anchor', () => {
    const html = [
      '<meta content="Quiet reading room | Pinterest" property="og:title">',
      '<meta property="og:image" content="/images/reading-room.jpg">',
    ].join('')

    expect(
      parsePinterestHtml(html, 'https://www.pinterest.com/pin/333/quiet-reading-room/'),
    ).toEqual([
      {
        id: 'pinterest:333',
        source: 'pinterest',
        title: 'Quiet reading room',
        url: 'https://www.pinterest.com/pin/333/quiet-reading-room/',
        imageUrl: 'https://www.pinterest.com/images/reading-room.jpg',
      },
    ])
  })

  it('returns an empty array when no pin can be parsed', () => {
    expect(parsePinterestHtml('', 'https://www.pinterest.com/')).toEqual([])
    expect(parsePinterestHtml('<main>No pins here</main>', 'https://www.pinterest.com/')).toEqual(
      [],
    )
  })
})

describe('extractOpenGraphImages', () => {
  it('resolves relative Open Graph image URLs and removes duplicates', () => {
    const html = [
      '<meta content="/media/hero.jpg" property="og:image">',
      '<meta property="og:image" content="https://cdn.example.com/media/hero.jpg">',
      '<meta property="og:image:secure_url" content="assets/detail.jpg">',
    ].join('')

    expect(extractOpenGraphImages(html, 'https://example.com/projects/one')).toEqual([
      'https://example.com/media/hero.jpg',
      'https://cdn.example.com/media/hero.jpg',
      'https://example.com/projects/assets/detail.jpg',
    ])
  })

  it('falls back to ordinary image tags when no social metadata exists', () => {
    const html = [
      '<img data-src="../images/one.jpg" src="/placeholder.png">',
      '<img srcset="//cdn.example.com/two.jpg 1x, //cdn.example.com/two@2x.jpg 2x">',
      '<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP">',
    ].join('')

    expect(extractOpenGraphImages(html, 'https://example.com/blog/post/')).toEqual([
      'https://example.com/blog/images/one.jpg',
      'https://cdn.example.com/two@2x.jpg',
    ])
  })
})

describe('dedupeResearchItems', () => {
  it('deduplicates by canonical source URL and canonical image URL', () => {
    const items: DesignResearchItem[] = [
      {
        id: 'one',
        source: 'pinterest',
        title: 'One',
        url: 'https://www.pinterest.com/pin/1/slug/?utm_source=feed',
        imageUrl: 'https://i.pinimg.com/one.jpg?utm_source=feed',
      },
      {
        id: 'duplicate-page',
        source: 'pinterest',
        title: 'Duplicate page',
        url: 'https://pinterest.com/pin/1/',
        imageUrl: 'https://i.pinimg.com/different.jpg',
      },
      {
        id: 'duplicate-image',
        source: 'behance',
        title: 'Duplicate image',
        url: 'https://www.behance.net/gallery/1',
        imageUrl: 'https://i.pinimg.com/one.jpg?utm_medium=email',
      },
      {
        id: 'two',
        source: 'behance',
        title: 'Two',
        url: 'https://www.behance.net/gallery/2?utm_campaign=launch',
        imageUrl: 'https://cdn.example.com/two.jpg',
      },
      {
        id: 'duplicate-second-image',
        source: 'web',
        title: 'Duplicate second image',
        url: 'https://example.com/another-source',
        imageUrl: 'https://cdn.example.com/two.jpg',
      },
    ]

    expect(dedupeResearchItems(items).map((item) => item.id)).toEqual(['one', 'two'])
  })

  it('returns a new empty array for empty input', () => {
    expect(dedupeResearchItems([])).toEqual([])
  })
})

describe('buildDesignResearchReport', () => {
  it('summarizes actual sources, query plans, moodboard groups, and rights', () => {
    const request = normalizeResearchRequest('minimal bakery identity', [], 2, { mode: 'web' })
    const items: DesignResearchItem[] = [
      {
        id: 'pinterest:1',
        source: 'pinterest',
        title: 'Bakery pin',
        url: 'https://www.pinterest.com/pin/1/',
        imageUrl: 'https://i.pinimg.com/one.jpg',
      },
      {
        id: 'behance:1',
        source: 'behance',
        title: 'Bakery project',
        url: 'https://www.behance.net/gallery/1',
        imageUrl: 'https://cdn.example.com/behance.jpg',
      },
      {
        id: 'web:1',
        source: 'web',
        title: 'Third item',
        url: 'https://example.com/third',
        imageUrl: 'https://example.com/third.jpg',
      },
    ]

    const report = buildDesignResearchReport({ request, items })

    expect(report.totalItems).toBe(2)
    expect(report.items.map((item) => item.id)).toEqual(['pinterest:1', 'behance:1'])
    expect(report.queries).toHaveLength(6)
    expect(report.sources).toEqual([
      {
        source: 'behance',
        name: 'behance.net',
        url: 'https://behance.net',
        itemCount: 1,
      },
      {
        source: 'pinterest',
        name: 'pinterest.com',
        url: 'https://pinterest.com',
        itemCount: 1,
      },
    ])
    expect(report.moodboard).toEqual([
      {
        id: 'pinterest',
        title: 'Pinterest',
        itemIds: ['pinterest:1'],
      },
      {
        id: 'behance',
        title: 'Behance',
        itemIds: ['behance:1'],
      },
    ])
    expect(report.rightsNote).toBe(DESIGN_RESEARCH_RIGHTS_NOTE)
  })

  it('accepts an explicit query plan without changing it', () => {
    const request = normalizeResearchRequest('packaging', [], 12, { mode: 'web' })
    const queries = planResearchQueries('packaging').slice(0, 3)
    const report = buildDesignResearchReport({ request, items: [], queries })

    expect(report.queries).toEqual(queries)
    expect(report.sources).toEqual([])
    expect(report.moodboard).toEqual([])
  })

  it('image mode ignores the web result cap and keeps image-bearing candidates up to its own target', () => {
    const request = normalizeResearchRequest('poster references', [], 12, {
      mode: 'image',
      imageMaxResults: 30,
    })
    const items: DesignResearchItem[] = Array.from({ length: 35 }, (_, index) => ({
      id: `image:${index}`,
      source: 'tavily',
      title: `Poster ${index}`,
      url: `https://example.com/poster-${index}`,
      imageUrl: `https://cdn.example.com/poster-${index}.jpg`,
    }))
    items.push({
      id: 'text:ignored',
      source: 'tavily',
      title: 'Text only',
      url: 'https://example.com/article',
      imageUrl: '',
    })

    const report = buildDesignResearchReport({ request, items })

    expect(report.request.mode).toBe('image')
    expect(report.totalItems).toBe(30)
    expect(report.items.every((item) => item.imageUrl.length > 0)).toBe(true)
  })
})

describe('inferResearchMode (B6: bare "ui" no longer matches inside English words)', () => {
  it('does not treat build / guide / quick as an image request', () => {
    expect(inferResearchMode({ topic: 'build guide for a quick market research report' })).toBe('web')
    expect(inferResearchMode({ topic: 'industry news article' })).toBe('web')
  })

  it('still treats UI as an image / visual request', () => {
    expect(inferResearchMode({ topic: 'mobile UI trends' })).toBe('image')
    expect(inferResearchMode({ topic: '外卖 App UI 设计' })).toBe('image')
    expect(inferResearchMode({ topic: '找一些ui参考' })).toBe('image')
  })
})
