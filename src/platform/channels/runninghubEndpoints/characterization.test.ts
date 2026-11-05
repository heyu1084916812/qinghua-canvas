import { describe, expect, it } from 'vitest'
import * as facade from '../runninghubEndpoints'
import * as contracts from './contracts'
import * as endpointPartA from './endpointSpecs.partA'
import * as endpointPartB from './endpointSpecs.partB'
import * as endpointPartC from './endpointSpecs.partC'
import { RUNNINGHUB_MODELS } from './models'
import {
  RUNNINGHUB_ENDPOINT_SPECS_A,
  RUNNINGHUB_ENDPOINT_SPECS_B,
  RUNNINGHUB_ENDPOINT_SPECS_C,
} from './catalogFixture'

const EXPECTED_EXPORTS = [
  'RUNNINGHUB_ENDPOINT_SPECS',
  'RUNNINGHUB_MODELS',
]

const EXPECTED_DECLARED_EXPORTS = [
  'RUNNINGHUB_ENDPOINT_SPECS',
  'RUNNINGHUB_MODELS',
  'RunningHubDrivenParam',
  'RunningHubEndpointSpec',
  'RunningHubMediaParam',
  'RunningHubModel',
]

const FACADE_SOURCE = import.meta.glob('../runninghubEndpoints.ts', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

const criticalEndpoints = [
  'rhart-image-g-3/image-to-image',
  'rhart-image-n-pro-official/edit',
  'kling-v3.0-pro/text-to-video',
  'alibaba/wan-2.7/video-edit',
  'alibaba/wan-2.7/video-extend',
  'rhart-video-g-official/video-extend',
  'kling-video-o3-pro/video-edit',
  'gemini-omni-flash/video-edit',
]

function stableHash(value: unknown): string {
  const seen = new WeakSet<object>()
  const canonical = (input: unknown): unknown => {
    if (!input || typeof input !== 'object') return input
    if (seen.has(input as object)) throw new Error('目录数据不应出现环')
    seen.add(input as object)
    if (Array.isArray(input)) return input.map(canonical)
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    )
  }
  let hash = 2166136261
  for (const byte of new TextEncoder().encode(JSON.stringify(canonical(value)))) {
    hash ^= byte
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

describe('RunningHub catalog split / characterization', () => {
  it('preserves all six public facade exports and both value array identities', () => {
    expect(Object.keys(facade).sort()).toEqual(EXPECTED_EXPORTS)
    const source = Object.values(FACADE_SOURCE)[0] ?? ''
    const declared = [
      ...source.matchAll(/^\s{2}(RUNNINGHUB_\w+|RunningHub\w+),?$/gm),
    ].map((match) => match[1])
    expect(declared.sort()).toEqual(EXPECTED_DECLARED_EXPORTS)
    expect(facade.RUNNINGHUB_ENDPOINT_SPECS).toBe(contracts.RUNNINGHUB_ENDPOINT_SPECS)
    expect(facade.RUNNINGHUB_MODELS).toBe(RUNNINGHUB_MODELS)
    expect(Object.keys(contracts).sort()).toEqual([
      'RUNNINGHUB_ENDPOINT_SPECS',
      'RUNNINGHUB_MODELS',
    ])
  })

  it('keeps 62 sorted, unique endpoints and 49 models in the original order', () => {
    const specs = facade.RUNNINGHUB_ENDPOINT_SPECS
    const ids = specs.map((spec) => spec.id)
    expect(specs.length).toBe(62)
    expect(new Set(ids).size).toBe(62)
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)))
    expect(facade.RUNNINGHUB_MODELS.length).toBe(49)
    expect(facade.RUNNINGHUB_MODELS.map((model) => model.id).slice(0, 3)).toEqual([
      'Nano Banana Pro',
      'Nano Banana 2',
      'Midjourney',
    ])
    expect(facade.RUNNINGHUB_MODELS.at(-1)?.textEndpoint).toBe(
      'rhart-video-v3.1-fast-official/video-extend',
    )
    for (const model of facade.RUNNINGHUB_MODELS) {
      expect(ids).toContain(model.textEndpoint)
      if (model.imageEndpoint) expect(ids).toContain(model.imageEndpoint)
    }
  })

  it('pins the generated catalog byte-independent structure hash', () => {
    expect(
      stableHash([facade.RUNNINGHUB_ENDPOINT_SPECS, facade.RUNNINGHUB_MODELS]),
    ).toBe('7254c602')
  })

  it('keeps image-to-image and video edit/extend media and required defaults', () => {
    const byId = new Map(
      facade.RUNNINGHUB_ENDPOINT_SPECS.map((spec) => [spec.id, spec]),
    )
    for (const id of criticalEndpoints) expect(byId.has(id)).toBe(true)

    expect(byId.get('rhart-image-g-3/image-to-image')).toMatchObject({
      task: 'image-to-image',
      media: { key: 'imageUrls', type: 'IMAGE', required: true },
    })
    expect(byId.get('rhart-image-n-pro-official/edit')?.requiredDefaults).toEqual({
      resolution: '1k',
    })
    expect(byId.get('kling-v3.0-pro/text-to-video')?.requiredDefaults).toEqual({
      duration: '5',
      sound: true,
    })
    expect(byId.get('alibaba/wan-2.7/video-edit')).toMatchObject({
      task: 'video-edit',
      media: { key: 'imageUrls', type: 'IMAGE', multiple: true, required: true },
      secondaryMedia: { key: 'videoUrl', type: 'VIDEO' },
      requiredDefaults: { resolution: '720P', duration: '0', aspectRatio: '16:9' },
    })
    expect(byId.get('alibaba/wan-2.7/video-extend')).toMatchObject({
      task: 'video-extend',
      media: { key: 'videoUrl', type: 'VIDEO', required: true },
      requiredDefaults: { resolution: '1080P', duration: '5' },
    })
    expect(byId.get('kling-video-o3-pro/video-edit')?.requiredDefaults).toEqual({
      keepOriginalSound: true,
    })
    expect(byId.get('gemini-omni-flash/video-edit')?.resolution?.options).toEqual([
      '720p',
      '1080p',
      '4k',
    ])
    for (const spec of facade.RUNNINGHUB_ENDPOINT_SPECS) {
      if (spec.ratio) expect(['aspectRatio', 'ratio']).toContain(spec.ratio.key)
      if (spec.resolution) {
        expect(['resolution', 'targetResolution']).toContain(spec.resolution.key)
      }
      if (spec.fps) expect(spec.fps.key).toBe('targetFps')
      if (spec.scale) expect(spec.scale.key).toBe('scale')
    }
  })

  it('composes the endpoint catalog from generated, boundable chunks', () => {
    expect(endpointPartA.RUNNINGHUB_ENDPOINT_SPECS_A.length).toBe(21)
    expect(endpointPartB.RUNNINGHUB_ENDPOINT_SPECS_B.length).toBe(21)
    expect(endpointPartC.RUNNINGHUB_ENDPOINT_SPECS_C.length).toBe(20)
    expect(RUNNINGHUB_ENDPOINT_SPECS_A).toBe(
      endpointPartA.RUNNINGHUB_ENDPOINT_SPECS_A,
    )
    expect(RUNNINGHUB_ENDPOINT_SPECS_B).toBe(
      endpointPartB.RUNNINGHUB_ENDPOINT_SPECS_B,
    )
    expect(RUNNINGHUB_ENDPOINT_SPECS_C).toBe(
      endpointPartC.RUNNINGHUB_ENDPOINT_SPECS_C,
    )
    expect(contracts.RUNNINGHUB_ENDPOINT_SPECS).toEqual([
      ...endpointPartA.RUNNINGHUB_ENDPOINT_SPECS_A,
      ...endpointPartB.RUNNINGHUB_ENDPOINT_SPECS_B,
      ...endpointPartC.RUNNINGHUB_ENDPOINT_SPECS_C,
    ])
  })
})
