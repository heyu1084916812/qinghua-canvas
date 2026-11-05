import { describe, expect, it, vi } from 'vitest'
import { createChannel, type Channel } from '../../../domain/project/channel'
import type { PresetStore } from '../../project/presetStore'
import { NO_RECIPE, rememberRecipe } from '../../../domain/project/generationPreset'
import { createRecipeCache } from './recipeCache'

function channel(id: string, model: string): Channel {
  return {
    ...createChannel({ name: id, protocol: 'mock', baseUrl: '' }),
    id,
    hasToken: true,
    models: [{ id: model, category: 'image', inputTypes: ['text'] }],
  }
}

function harness(initialRows: [string, typeof NO_RECIPE][] = []) {
  const rows = new Map(initialRows)
  const saved: (typeof NO_RECIPE)[] = []
  let memory = true
  let now = 1000
  const setState = vi.fn((patch: { recipeMemory: boolean }) => {
    memory = patch.recipeMemory
  })
  const presets = {
    async loadAll() {
      return [...rows.entries()]
    },
    async save(recipe: typeof NO_RECIPE) {
      saved.push(recipe)
      rows.set(recipe.channelId, recipe)
    },
    async saveRecipeMemory(enabled: boolean) {
      memory = enabled
    },
  } as unknown as Pick<PresetStore, 'loadAll' | 'save' | 'saveRecipeMemory'>
  const cache = createRecipeCache({
    presets,
    setState,
    recipeMemory: () => memory,
    routableChannels: () => [channel('ch-a', 'a-img'), channel('ch-b', 'b-img')],
    now: () => now,
  })
  return {
    cache,
    rows,
    saved,
    setState,
    setNow(value: number) { now = value },
    memory: () => memory,
  }
}

describe('channelStore/recipeCache', () => {
  it('loads persisted rows once, lifts savedAt watermark and serves the latest recipe', async () => {
    const first = rememberRecipe('ch-a', 'a-img', { ratio: '1:1' }, 5000)!
    const second = rememberRecipe('ch-b', 'b-img', { ratio: '16:9' }, 5001)!
    const h = harness([['ch-a', first], ['ch-b', second]])
    await h.cache.ensure()
    await h.cache.ensure()
    expect(await h.cache.defaultForNewNode({}, 'image')).toMatchObject({
      channelId: 'ch-b', model: 'b-img', params: { ratio: '16:9' },
    })
    h.setNow(5001)
    await h.cache.writeDefault('ch-a', 'a-img', { ratio: '4:3' })
    expect(h.saved.at(-1)?.savedAt).toBe(5002)
    expect(h.rows.get('ch-a')).toMatchObject({ params: { ratio: '4:3' } })
  })

  it('does not overwrite newer concurrent writes when an older save settles late', async () => {
    const h = harness()
    let releaseOlder: (() => void) | undefined
    const pending = new Promise<void>((resolve) => { releaseOlder = resolve })
    const race = createRecipeCache({
      presets: {
        async loadAll() { return new Map<string, typeof NO_RECIPE>() },
        async save(recipe: typeof NO_RECIPE) {
          h.rows.set(recipe.channelId, recipe)
          if (recipe.params.ratio === 'older') {
            await pending
          }
        },
        async saveRecipeMemory() {},
      } as never,
      setState: h.setState,
      recipeMemory: () => true,
      routableChannels: () => [channel('ch-a', 'a-img')],
      now: () => 1000,
    })
    const older = race.writeDefault('ch-a', 'a-img', { ratio: 'older' })
    const newer = race.writeDefault('ch-a', 'a-img', { ratio: 'newer' })
    releaseOlder?.()
    await Promise.all([older, newer])
    expect(await race.defaultForNewNode({}, 'image')).toMatchObject({ params: { ratio: 'newer' } })
  })

  it('honors recipeMemory switch and persists it through the same port', async () => {
    const h = harness()
    await h.cache.setMemory(false)
    expect(h.setState).toHaveBeenCalledWith({ recipeMemory: false })
    await h.cache.remember('ch-a', 'a-img', { ratio: '1:1' })
    expect(h.saved).toHaveLength(0)
    expect(h.rows.size).toBe(0)
    await h.cache.setMemory(true)
    await h.cache.remember('ch-a', 'a-img', { ratio: '1:1' })
    expect(h.saved).toHaveLength(1)
    expect(h.memory()).toBe(true)
  })

  it('falls back to the first routable channel when no recipe exists', async () => {
    const h = harness()
    expect(await h.cache.defaultForNewNode({}, 'image')).toMatchObject({
      channelId: 'ch-a', model: 'a-img',
    })
  })
})
