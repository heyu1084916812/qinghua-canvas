import type { GenerationContextAsset } from '../../../../domain/canvas/model/node'
import type { Channel } from '../../../../domain/project/channel'
import {
  capabilityOfLogical,
  channelIdForLogical,
} from '../../../../domain/project/modelCatalog'
import type { AgentNodeType } from '../../../../domain/agent/plan'
import { preferredGeneratedModel } from './mediaMentions'

export interface AgentToolRecipeSession {
  id: string
  channelId: string
  imageModel?: string
  videoModel?: string
}

export interface AgentToolRecipeContextInput {
  sessionId: string
  session?: AgentToolRecipeSession
  getExplicitMediaModels: () =>
    | { image?: string; video?: string }
    | undefined
  getStickyModels: () => { image?: string; video?: string }
  selectedModelOf: (kind: 'image' | 'video') => string
  allChannels: readonly Channel[]
  enabledChannels: readonly Channel[]
  getContextAssets: () => readonly (
    | (GenerationContextAsset & { mime: string })
  )[]
  rememberStickyModel: (
    sessionId: string,
    kind: 'image' | 'video',
    model: string,
  ) => void
  persistStickyModel: (
    sessionId: string,
    kind: 'image' | 'video',
    model: string,
  ) => void
}

export interface AgentToolRecipeContext {
  recipeForGenerated: (
    type: AgentNodeType,
    node: { data: Record<string, unknown> },
  ) => { channelId: string; model: string } | undefined
  explicitRecipeForGenerated: (
    type: AgentNodeType,
    node: { data: Record<string, unknown> },
  ) => { channelId: string; model: string } | undefined
  contextAssetsForGenerated: (
    type: AgentNodeType,
  ) => readonly (GenerationContextAsset & { mime: string })[] | undefined
  categoryOfModel: (
    model: string,
  ) => 'image' | 'video' | 'chat' | undefined
  channelIdForModel: (model: string) => string | undefined
}

export function createAgentToolRecipeContext(
  input: AgentToolRecipeContextInput,
): AgentToolRecipeContext {
  return {
    recipeForGenerated: (type, node) => {
      if (type !== 'generation') return undefined
      const kind = node.data.mode === 'video' ? 'video' : 'image'
      const planned =
        typeof node.data.model === 'string'
          ? node.data.model.trim()
          : ''
      const explicit = input.getExplicitMediaModels()?.[kind]
      const sessionPicked =
        kind === 'video'
          ? input.session?.videoModel
          : input.session?.imageModel
      const stored = input.getStickyModels()[kind]
      const model = preferredGeneratedModel({
        explicit,
        planned,
        sessionPicked,
        sticky: stored,
        selected: input.selectedModelOf(kind),
      })
      if (!model) return undefined
      const channelId = channelIdForLogical(
        input.enabledChannels,
        model,
        input.session?.channelId,
      )
      if (!channelId) return undefined
      if (model !== stored) {
        input.rememberStickyModel(input.sessionId, kind, model)
        if (input.session) {
          input.persistStickyModel(input.sessionId, kind, model)
        }
      }
      return { channelId, model }
    },
    explicitRecipeForGenerated: (type, node) => {
      if (type !== 'generation') return undefined
      const kind = node.data.mode === 'video' ? 'video' : 'image'
      const model = input.getExplicitMediaModels()?.[kind]
      if (!model) return undefined
      const channelId = channelIdForLogical(
        input.enabledChannels,
        model,
        input.session?.channelId,
      )
      return { channelId: channelId ?? '', model }
    },
    contextAssetsForGenerated: (type) => {
      if (type !== 'generation') return undefined
      return input
        .getContextAssets()
        .filter((asset) => asset.mime.startsWith('image/'))
    },
    categoryOfModel: (model) => {
      const category = capabilityOfLogical(
        input.allChannels,
        model,
      )?.category
      return category === 'audio' || category === 'unknown'
        ? undefined
        : category
    },
    channelIdForModel: (model) =>
      channelIdForLogical(input.enabledChannels, model),
  }
}
