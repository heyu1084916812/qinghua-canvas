import { describe, expect, it } from 'vitest'
import { createChannel, type Channel } from '../../../domain/project/channel'
import type { ModelCapability } from '../../../domain/shared/capability'
import type { PresetModel } from '../../../domain/project/modelPresets'
import { normalizeRoutePolicy } from '../../../domain/project/routePlan'
import {
  filteredGlobalModels,
  findGlobalModel,
  loadedRoutingPolicy,
  projectRefreshModels,
  protocolDefinitionRows,
  routeTuningPatch,
  staleModelCachePatches,
  toCustomProtocolDefinition,
  tokenlessRoutableChannels,
  withManualCategory,
} from './modelProjections'

function capability(id: string, category: ModelCapability['category'] = 'image'): ModelCapability {
  return { id, category, inputTypes: ['text'] }
}

function preset(id: string, category: PresetModel['category']): PresetModel {
  return { id, category, vendor: 'openai' }
}

function channel(patch: Partial<Channel> = {}): Channel {
  return {
    ...createChannel({ name: 'A', protocol: 'mock', baseUrl: '' }),
    id: 'ch-a',
    models: [capability('kept')],
    modelCache: [capability('cached'), capability('manual')],
    modelMap: { kept: 'upstream-kept' },
    ...patch,
  }
}

describe('channelStore/modelProjections', () => {
  it('filters global models by category and flags uncommon ids once', () => {
    const builtins = [preset('image-a', 'image'), preset('chat-a', 'chat')]
    const custom = [preset('rare', 'image'), preset('rare', 'image')]
    expect(filteredGlobalModels(builtins, custom, ['rare'], 'image').map((m) => m.id)).toEqual(['image-a'])
    expect(filteredGlobalModels(builtins, custom, ['rare'], 'image', true).map((m) => m.id)).toEqual([
      'image-a', 'rare', 'rare',
    ])
    expect(findGlobalModel(builtins, custom, '  chat-a ')).toBe(builtins[1])
    expect(findGlobalModel(builtins, custom, 'missing')).toBeUndefined()
  })

  it('normalizes bad custom protocol rows without creating a second catalog', () => {
    expect(protocolDefinitionRows([
      null as never,
      {},
      {
        id: 'custom-a',
        name: 'Custom A',
        capabilities: ['chat', 'bogus', 'image'],
        recipe: { auth: { type: 'none' } },
        defaultBaseUrl: 'https://example.test',
        versionPath: '/v1/models',
      },
      { id: 'custom-b', capabilities: 'bad' },
    ])).toMatchObject([
      {
        id: 'custom-a',
        name: 'Custom A',
        short: 'custom-a',
        family: 'declarative-http',
        capabilities: ['chat', 'image'],
        defaultBaseUrl: 'https://example.test',
        versionPath: '/v1/models',
      },
      { id: 'custom-b', name: 'custom-b', capabilities: [] },
    ])
    expect(toCustomProtocolDefinition({})).toBeNull()
  })

  it('preserves manual category, selection identity and logical names while merging a pulled model cache', () => {
    const source = channel({
      models: [
        capability('kept'),
        { ...capability('manual'), category: 'video', categoryManual: true },
      ],
      modelCache: [{ ...capability('manual'), category: 'video', categoryManual: true }],
    })
    const pulled: ModelCapability[] = [
      { ...capability('kept'), inputTypes: ['text', 'image'] },
      { ...capability('manual', 'chat'), inputTypes: ['text'] },
      capability('fresh'),
    ]
    const projection = projectRefreshModels({ channel: source, group: undefined, pulled })
    expect(projection.models.map((model) => model.id)).toEqual(['kept', 'manual', 'fresh'])
    expect(projection.models[1]).toMatchObject({
      id: 'manual', category: 'video', categoryManual: true, upstreamCategory: 'chat',
    })
    expect(projection.refreshedSelection.map((model) => model.id)).toEqual(['kept', 'manual'])
    expect(projection.refreshedSelection[0].inputTypes).toEqual(['text', 'image'])
    expect(projection.logicalNames).toEqual(['kept', 'manual', 'fresh'])
    expect(projection.update).toMatchObject({
      modelCache: projection.models,
      models: projection.refreshedSelection,
    })
    expect(withManualCategory(capability('other'), 'manual', 'video')).toEqual(capability('other'))
  })

  it('projects a group refresh without replacing unrelated groups', () => {
    const groupA = {
      id: 'group-a', name: 'A', credentialRef: 'cred-a', tokenTail: null,
      hasToken: true, priority: 1, models: [capability('a-selected')],
      modelCache: [capability('a-cached')], createdAt: 1,
    }
    const groupB = { ...groupA, id: 'group-b', name: 'B' }
    const source = channel({ credentialGroups: [groupA, groupB], models: [], modelCache: [] })
    const pulled = [capability('a-selected', 'chat'), capability('a-new')]
    const projection = projectRefreshModels({ channel: source, group: groupA, pulled })
    expect(projection.nextGroups[0]).toMatchObject({ id: 'group-a', modelCache: pulled })
    expect(projection.nextGroups[1]).toBe(groupB)
    expect(projection.update).toMatchObject({ credentialGroups: projection.nextGroups })
  })

  it('clears stale model caches only for tokenless RunningHub rows and keeps other channels', () => {
    const stale = channel({
      id: 'rh', protocol: 'runninghub-api', hasToken: false,
      models: [capability('stale')], modelCache: [capability('stale-cache')],
      credentialGroups: [{
        id: 'g', name: 'G', credentialRef: 'cred', tokenTail: null, hasToken: false,
        priority: 0, models: [capability('g-stale')], modelCache: [capability('g-cache')], createdAt: 1,
      }],
    })
    const configured = channel({ id: 'rh-ok', protocol: 'runninghub-api', hasToken: true })
    const other = channel({ id: 'other', protocol: 'mock', hasToken: false })
    const patches = staleModelCachePatches([stale, configured, other])
    expect(patches.map((entry) => entry.id)).toEqual(['rh'])
    expect(patches[0]?.patch).toMatchObject({ modelCache: [], models: [] })
    expect((patches[0]?.patch.credentialGroups ?? [])[0]).toMatchObject({ modelCache: [], models: [] })
  })

  it('projects tokenless route channels without mutating the source state', () => {
    const source = channel({
      id: 'cli', protocol: 'cli-gateway', baseUrl: 'http://127.0.0.1:1', hasToken: false,
      credentialGroups: [{
        id: 'g', name: 'G', credentialRef: 'cred', tokenTail: null, hasToken: false,
        priority: 0, models: [], modelCache: [], createdAt: 1,
      }],
    })
    const projected = tokenlessRoutableChannels([source], true, (protocol) => protocol === 'cli-gateway')
    expect(projected[0].hasToken).toBe(true)
    expect(projected[0].credentialGroups[0].hasToken).toBe(true)
    expect(source.hasToken).toBe(false)
    expect(source.credentialGroups[0].hasToken).toBe(false)
  })

  it('keeps route tuning integral and nonnegative, and preserves legacy priority policy', () => {
    expect(routeTuningPatch({ priority: 7.9, weight: 3.4 })).toEqual({ priority: 7, weight: 3 })
    expect(routeTuningPatch({ priority: Number.NaN, weight: -9 })).toEqual({ priority: 0, weight: 0 })
    expect(routeTuningPatch({})).toEqual({})
    const priorityPolicy = normalizeRoutePolicy(undefined)
    expect(loadedRoutingPolicy(priorityPolicy, 'balanced')).toMatchObject({ strategy: 'balanced' })
    expect(loadedRoutingPolicy(normalizeRoutePolicy({ strategy: 'round_robin' }), 'balanced')).toMatchObject({
      strategy: 'round_robin',
    })
  })
})
