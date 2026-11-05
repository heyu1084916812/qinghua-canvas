import { RUNNINGHUB_ENDPOINT_SPECS_A } from './endpointSpecs.partA'
import { RUNNINGHUB_ENDPOINT_SPECS_B } from './endpointSpecs.partB'
import { RUNNINGHUB_ENDPOINT_SPECS_C } from './endpointSpecs.partC'
import type { RunningHubEndpointSpec } from './types'

export {
  RUNNINGHUB_ENDPOINT_SPECS_A,
  RUNNINGHUB_ENDPOINT_SPECS_B,
  RUNNINGHUB_ENDPOINT_SPECS_C,
}

export interface CatalogParam {
  key: string
  type: string
  required?: boolean
  multiple?: boolean
  options?: string[]
  default?: unknown
}

export interface CatalogEndpoint {
  endpoint: string
  task: string
  output_type: 'image' | 'video'
  name_cn: string
  params: CatalogParam[]
}

export interface CatalogFixture {
  version: string
  total: number
  endpoints: CatalogEndpoint[]
}

const mediaSlots = (spec: RunningHubEndpointSpec) =>
  [spec.media, spec.secondaryMedia, spec.audio].filter(
    (slot): slot is NonNullable<typeof slot> => slot !== undefined,
  )

function paramsOf(spec: RunningHubEndpointSpec): CatalogParam[] {
  const knownKeys = [
    spec.promptKey,
    ...mediaSlots(spec).map((slot) => slot.key),
    ...(['ratio', 'resolution', 'duration', 'fps', 'scale'] as const)
      .map((role) => spec[role]?.key)
      .filter((item): item is string => item !== undefined),
  ]
  const defaults = Object.entries(spec.requiredDefaults ?? {})
  const params = defaults.map(([key, value]): CatalogParam => {
    const param: CatalogParam = {
      key,
      type:
        typeof value === 'boolean'
          ? 'BOOLEAN'
          : typeof value === 'number'
            ? 'NUMBER'
            : 'STRING',
      required: true,
      default: value,
    }
    const slot = mediaSlots(spec).find((item) => item.key === key)
    if (slot) {
      param.type = slot.type
      if (slot.multiple) param.multiple = true
    }
    const driven = (['ratio', 'resolution', 'duration', 'fps', 'scale'] as const)
      .map((role) => spec[role])
      .find((item) => item?.key === key)
    if (driven?.options) param.options = driven.options
    return param
  })
  for (const key of knownKeys) {
    if (key && !params.some((param) => param.key === key)) {
      const slot = mediaSlots(spec).find((item) => item.key === key)
      const driven = (['ratio', 'resolution', 'duration', 'fps', 'scale'] as const)
        .map((role) => spec[role])
        .find((item) => item?.key === key)
      params.push({
        key,
        type: slot?.type ?? 'STRING',
        ...(slot?.multiple ? { multiple: true } : {}),
        ...(slot?.required ? { required: true } : {}),
        ...(driven?.options ? { options: driven.options } : {}),
      })
    }
  }
  return params
}

export function createCatalogFixture(): CatalogFixture {
  const specs = [
    ...RUNNINGHUB_ENDPOINT_SPECS_A,
    ...RUNNINGHUB_ENDPOINT_SPECS_B,
    ...RUNNINGHUB_ENDPOINT_SPECS_C,
  ]
  return {
    version: '2026-06-02',
    total: 356,
    endpoints: specs.map((spec) => ({
      endpoint: spec.id,
      task: spec.task,
      output_type: spec.kind,
      name_cn: spec.label,
      params: paramsOf(spec),
    })),
  }
}
