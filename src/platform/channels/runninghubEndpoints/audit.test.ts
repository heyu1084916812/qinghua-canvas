import { describe, expect, it } from 'vitest'
import {
  RUNNINGHUB_ENDPOINT_SPECS,
  RUNNINGHUB_MODELS,
} from '../runninghubEndpoints'

const GENERATOR_SOURCE = import.meta.glob('../../../../scripts/gen-runninghub-models.mjs', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

const CATALOG_SOURCES = import.meta.glob('./{types,contracts,endpointSpecs.partA,endpointSpecs.partB,endpointSpecs.partC,models}.ts', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

describe('RunningHub generated catalog / read-only split audit', () => {
  it('shows the generator owns every split catalog file and never emits a monolithic table', () => {
    const generator = Object.values(GENERATOR_SOURCE)[0] ?? ''
    expect(generator).toContain("path: 'src/platform/channels/runninghubEndpoints.ts'")
    expect(generator).toContain('writeFileSync(target, source, \'utf8\')')
    expect(generator).toContain('--dry-run')
    expect(generator).toContain('RUNNINGHUB_ENDPOINT_SPECS')
    expect(generator).toContain('RUNNINGHUB_MODELS')
    for (const name of [
      'types.ts',
      'contracts.ts',
      "endpointSpecs.part${suffix}.ts",
      'models.ts',
    ]) {
      expect(generator).toContain(name)
    }
    expect(generator).toContain('endpointSpecs.part')
    expect(generator).toContain('String.fromCharCode(65 + index)')
    expect(Object.keys(CATALOG_SOURCES).length).toBe(6)
    for (const source of Object.values(CATALOG_SOURCES)) {
      expect(source).toContain('**自动生成，别手改**')
    }
    expect(generator).not.toContain("const out = 'src/platform/channels/runninghubEndpoints.ts'")
  })

  it('keeps the single stable facade self-consistent without editing generated data', () => {
    const specIds = new Set(RUNNINGHUB_ENDPOINT_SPECS.map((spec) => spec.id))
    expect(specIds.size).toBe(RUNNINGHUB_ENDPOINT_SPECS.length)
    expect(RUNNINGHUB_ENDPOINT_SPECS.length).toBe(62)
    expect(RUNNINGHUB_MODELS.length).toBe(49)
    for (const model of RUNNINGHUB_MODELS) {
      expect(specIds.has(model.textEndpoint)).toBe(true)
      if (model.imageEndpoint) expect(specIds.has(model.imageEndpoint)).toBe(true)
    }
  })
})
