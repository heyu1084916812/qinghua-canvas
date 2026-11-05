import { describe, expect, it } from 'vitest'
import {
  createCatalogFixture,
  RUNNINGHUB_ENDPOINT_SPECS_A,
  RUNNINGHUB_ENDPOINT_SPECS_B,
  RUNNINGHUB_ENDPOINT_SPECS_C,
} from './catalogFixture'
import * as facade from '../runninghubEndpoints'

describe('RunningHub catalog fixture', () => {
  it('reconstructs the exact catalog shape needed by the generator', () => {
    const catalog = createCatalogFixture()
    expect(catalog.version).toBe('2026-06-02')
    expect(catalog.total).toBe(356)
    expect(catalog.endpoints).toHaveLength(62)
    expect(catalog.endpoints.map((endpoint) => endpoint.endpoint)).toEqual(
      facade.RUNNINGHUB_ENDPOINT_SPECS.map((spec) => spec.id),
    )
    for (const spec of facade.RUNNINGHUB_ENDPOINT_SPECS) {
      const endpoint = catalog.endpoints.find((item) => item.endpoint === spec.id)
      expect(endpoint?.task).toBe(spec.task)
      expect(endpoint?.output_type).toBe(spec.kind)
      expect(endpoint?.name_cn).toBe(spec.label)
      for (const [key, value] of Object.entries(spec.requiredDefaults ?? {})) {
        expect(endpoint?.params.some((param) => param.key === key && param.default === value)).toBe(true)
      }
    }
  })

  it('keeps the three committed chunk identities', () => {
    expect(RUNNINGHUB_ENDPOINT_SPECS_A.length).toBe(21)
    expect(RUNNINGHUB_ENDPOINT_SPECS_B.length).toBe(21)
    expect(RUNNINGHUB_ENDPOINT_SPECS_C.length).toBe(20)
  })
})
