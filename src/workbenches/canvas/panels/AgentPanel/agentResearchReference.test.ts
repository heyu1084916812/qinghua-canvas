import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '../../../../platform/memory'
import { createAssetLibraryRepository } from '../../../../state/project/assetLibraryRepository'
import { createReferenceLedgerRepository } from '../../../../state/project/referenceLedgerRepository'
import {
  addResearchCandidateToProject,
  researchItemOf,
} from './agentResearchReference'
import { addResearchSourceReferenceToProject } from './researchSourceReference'

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89,
])

function platformWithImage() {
  const platform = createMemoryPlatform()
  return {
    ...platform,
    network: {
      async request() {
        return {
          status: 200,
          headers: { 'content-type': 'image/png' },
          text: async () => '',
          json: async <T,>() => ({}) as T,
          arrayBuffer: async () => PNG.buffer.slice(0),
        }
      },
      async *stream() {},
    },
  }
}

describe('agent research reference', () => {
  it('maps public candidates into the design research provider contract', () => {
    expect(researchItemOf({
      id: 'openverse:1',
      title: 'Reference',
      url: 'https://example.com/source',
      imageUrl: 'https://example.com/image.png',
      source: 'openverse',
      description: 'Description',
      credit: 'Author',
      license: 'CC BY',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    })).toMatchObject({
      source: 'openverse',
      credit: 'Author',
      license: 'CC BY',
    })
  })

  it('keeps SearXNG as a distinct public research provider', () => {
    expect(researchItemOf({
      id: 'searxng:web:1:https://example.com',
      title: 'Web result',
      url: 'https://example.com',
      imageUrl: '',
      source: 'searxng',
      description: 'Public search result',
    }).source).toBe('searxng')
  })

  it('keeps open collection sources distinct from generic web pages', () => {
    expect(researchItemOf({
      id: 'archive:1',
      title: 'Archive',
      url: 'https://archive.org/details/archive',
      imageUrl: 'https://archive.org/services/img/archive',
      source: 'Internet Archive',
    }).source).toBe('internetArchive')
    expect(researchItemOf({
      id: 'artic:1',
      title: 'Poster',
      url: 'https://www.artic.edu/artworks/1',
      imageUrl: 'https://www.artic.edu/image.jpg',
      source: 'Art Institute',
    }).source).toBe('artic')
    expect(researchItemOf({
      id: 'cleveland:1',
      title: 'Cleveland poster',
      url: 'https://clevelandart.org/art/1',
      imageUrl: 'https://openaccess-cdn.clevelandart.org/1.jpg',
      source: 'Cleveland Museum',
    }).source).toBe('cleveland')
    expect(researchItemOf({
      id: 'met:1',
      title: 'Met poster',
      url: 'https://www.metmuseum.org/art/collection/search/1',
      imageUrl: 'https://images.metmuseum.org/1.jpg',
      source: 'Met Museum',
    }).source).toBe('met')
  })

  it('stores the selected image as an asset and project reference', async () => {
    const platform = platformWithImage()
    const result = await addResearchCandidateToProject(
      {
        id: 'wikipedia:1',
        title: 'Packaging reference',
        url: 'https://example.com/source',
        imageUrl: 'https://example.com/image.png',
        source: 'wikipedia',
        description: '公开网页里的包装参考',
        license: 'CC BY-SA',
      },
      {
        platform,
        projectId: 'project-1',
        signal: new AbortController().signal,
      },
    )

    expect(result).toMatchObject({
      ok: true,
      item: {
        projectId: 'project-1',
        source: 'search',
        kind: 'image',
        title: 'Packaging reference',
      },
    })
    expect((await createReferenceLedgerRepository(platform.storage).listItems('project-1')))
      .toHaveLength(1)
    expect((await createAssetLibraryRepository(platform.storage).list()))
      .toEqual([expect.objectContaining({ mime: 'image/png' })])
    const [reference] = await createReferenceLedgerRepository(platform.storage)
      .listItems('project-1')
    expect(reference?.what).toContain('图源：查看图片搜索结果')
    expect(reference?.what).toContain('来源页面：https://example.com/source')
    expect(reference?.what).toContain('图片地址：https://example.com/image.png')
  })

  it('creates a source-only conversation reference without downloading the image', async () => {
    const platform = createMemoryPlatform()
    const result = await addResearchSourceReferenceToProject(
      {
        id: 'openverse:blocked',
        title: 'Blocked image',
        url: 'https://example.com/source',
        imageUrl: 'https://example.com/blocked.png',
        source: 'openverse',
      },
      {
        platform,
        projectId: 'project-1',
      },
    )

    expect(result).toMatchObject({
      ok: true,
      item: {
        projectId: 'project-1',
        source: 'search',
        kind: 'text',
        url: 'https://example.com/source',
      },
    })
    expect(result.item?.what).toContain('图源：查看图片搜索结果')
    expect(result.item?.what).toContain('图片地址：https://example.com/blocked.png')
    expect(await platform.storage.query('assets', {})).toEqual([])
  })

  it('creates a text reference when the candidate has no image', async () => {
    const platform = createMemoryPlatform()
    const result = await addResearchCandidateToProject(
      {
        id: 'wikipedia:text',
        title: 'Text only',
        url: 'https://example.com/page',
        imageUrl: '',
        source: 'wikipedia',
      },
      {
        platform,
        projectId: 'project-1',
        signal: new AbortController().signal,
      },
    )

    expect(result).toMatchObject({
      ok: true,
      item: {
        projectId: 'project-1',
        kind: 'text',
        url: 'https://example.com/page',
      },
    })
    expect(await platform.storage.query('assets', {})).toEqual([])
    expect(await createReferenceLedgerRepository(platform.storage)
      .listItems('project-1')).toHaveLength(1)
  })
})
