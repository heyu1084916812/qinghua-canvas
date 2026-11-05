import type { PresetStore } from '../../project/presetStore'
import { NO_RECIPE, rememberRecipe, resolveForNode } from '../../../domain/project/generationPreset'
import type { Channel } from '../../../domain/project/channel'

export interface RecipeCachePorts {
  presets: Pick<PresetStore, 'loadAll' | 'save' | 'saveRecipeMemory'>
  setState: (partial: { recipeMemory: boolean }) => void
  recipeMemory: () => boolean
  routableChannels: () => Channel[]
  now: () => number
}

export interface RecipeCache {
  ensure(): Promise<void>
  writeDefault(
    channelId: string,
    model: string,
    params: Record<string, unknown>,
  ): Promise<void>
  remember(
    channelId: string,
    model: string,
    params: Record<string, unknown>,
  ): Promise<void>
  setMemory(enabled: boolean): Promise<void>
  defaultForNewNode(
    node: { channelId?: string; model?: string },
    category?: string,
  ): Promise<ReturnType<typeof resolveForNode>>
}

/**
 * Recipe cache is a derived projection of persisted preset rows. The store owns
 * state; this helper only keeps a monotonic savedAt and a local read cache.
 */
export function createRecipeCache(ports: RecipeCachePorts): RecipeCache {
  const cache = new Map<string, typeof NO_RECIPE>()
  let loaded = false
  let loading: Promise<void> | null = null
  let lastRecipeAt = 0
  const nextRecipeAt = (): number => {
    const now = ports.now()
    lastRecipeAt = now > lastRecipeAt ? now : lastRecipeAt + 1
    return lastRecipeAt
  }

  const ensure = (): Promise<void> => {
    if (loaded) return Promise.resolve()
    if (loading) return loading
    loading = (async () => {
      const rows = await ports.presets.loadAll()
      cache.clear()
      for (const [channelId, recipe] of rows) {
        cache.set(channelId, recipe)
        if (recipe.savedAt > lastRecipeAt) lastRecipeAt = recipe.savedAt
      }
      loaded = true
    })().finally(() => {
      loading = null
    })
    return loading
  }

  const writeDefault = async (
    channelId: string,
    model: string,
    params: Record<string, unknown>,
  ): Promise<void> => {
    try {
      await ensure()
    } catch {
      // A failed preset read must not prevent saving the user's explicit choice.
    }
    const next = rememberRecipe(channelId, model, params, nextRecipeAt())
    if (!next) return
    cache.set(channelId, next)
    await ports.presets.save(next)
  }

  return {
    ensure,
    writeDefault,
    async remember(channelId, model, params) {
      if (!ports.recipeMemory()) return
      await writeDefault(channelId, model, params)
    },
    async setMemory(enabled) {
      ports.setState({ recipeMemory: enabled })
      await ports.presets.saveRecipeMemory(enabled)
    },
    async defaultForNewNode(node, category) {
      await ensure()
      return resolveForNode(
        node,
        ports.routableChannels(),
        (channelId) => cache.get(channelId) ?? NO_RECIPE,
        category,
      )
    },
  }
}
