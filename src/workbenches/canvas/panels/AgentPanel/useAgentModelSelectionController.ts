import {
  useCallback,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react'
import type { Channel } from '../../../../domain/project/channel'
import {
  capabilityOfLogical,
  channelIdForLogical,
  panelModelOptions,
  toLogicalName,
} from '../../../../domain/project/modelCatalog'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { ChannelStore } from '../../../../state/channel/channelStore'
import { parseMentions } from '../../text/MentionEditor'
import { pickSessionChatModel } from './agentChatModelDefault'

export interface AgentModelSelectionControllerInput {
  current: AgentSession | null
  draft: string
  channels: Pick<
    ChannelStore,
    'subscribe' | 'getState' | 'globalModelsOf'
  >
  allChannels: readonly Channel[]
  selection: readonly string[]
  getCanvasNodes: () => readonly { id: string; data: unknown }[]
  patchSession: (
    sessionId: string,
    patch: {
      model?: string
      channelId?: string
      imageModel?: string
      videoModel?: string
    },
  ) => Promise<AgentSession | null>
  clearChatRoute: (sessionId: string) => void
  rememberStickyModel: (
    sessionId: string,
    kind: 'image' | 'video',
    model: string,
  ) => void
}

export interface AgentModelSelectionController {
  globalImageModels: string[]
  globalVideoModels: string[]
  modelOptionsByKind: {
    image: readonly string[]
    video: readonly string[]
    chat: string[]
  }
  chatModelOptions: string[]
  mentionedModels: ReadonlySet<string>
  shownModel: string
  /**
   * 新会话的对话模型：按偏好顺序（当前会话 → 保存默认）取第一个有**启用**渠道
   * 提供的；都不行再取清单里第一个可用的；绝不回落到停用渠道（A4）。
   */
  defaultModelFor: (
    options: readonly string[],
    preferred?: string | readonly string[],
    channels?: readonly Channel[],
  ) => string
  logicalModelOf: (
    model: string,
    channels?: readonly Channel[],
  ) => string
  selectedModelOf: (kind: 'image' | 'video') => string
  fallbackModelOptionsForChannels: (
    channels: readonly Channel[],
  ) => {
    image: string[]
    video: string[]
    chat: string[]
  }
  pickModel: (model: string) => Promise<void>
  setModelKind: (
    key: 'imageModel' | 'videoModel',
    model: string,
  ) => Promise<void>
}

export function useAgentModelSelectionController(
  input: AgentModelSelectionControllerInput,
): AgentModelSelectionController {
  const queuesRef = useRef(new Map<string, Promise<void>>())
  const customModels = useSyncExternalStore(
    input.channels.subscribe,
    () => input.channels.getState().customModels,
    () => [],
  )
  const uncommonModelIds = useSyncExternalStore(
    input.channels.subscribe,
    () => input.channels.getState().uncommonModelIds,
    () => [],
  )

  const globalImageModels = useMemo(
    () =>
      input.channels
        .globalModelsOf('image')
        .map((model) => model.id),
    [
      input.channels,
      input.allChannels,
      customModels,
      uncommonModelIds,
    ],
  )
  const globalVideoModels = useMemo(
    () =>
      input.channels
        .globalModelsOf('video')
        .map((model) => model.id),
    [
      input.channels,
      input.allChannels,
      customModels,
      uncommonModelIds,
    ],
  )
  const modelOptionsByKind = useMemo(
    () => ({
      image: globalImageModels,
      video: globalVideoModels,
      chat: panelModelOptions('chat', uncommonModelIds),
    }),
    [globalImageModels, globalVideoModels, uncommonModelIds],
  )
  const mentionedModels = useMemo(
    () =>
      new Set(
        parseMentions(input.draft)
          .filter((mention) => mention.kind === 'model')
          .map((mention) => mention.id),
      ),
    [input.draft],
  )

  const defaultModelFor = useCallback(
    (
      options: readonly string[],
      preferred?: string | readonly string[],
      channels: readonly Channel[] = input.allChannels,
    ) =>
      pickSessionChatModel({
        options,
        preferred:
          typeof preferred === 'string' ? [preferred] : (preferred ?? []),
        channels,
      }),
    [input.allChannels],
  )
  const logicalModelOf = useCallback(
    (
      model: string,
      channels: readonly Channel[] = input.allChannels,
    ) => toLogicalName(channels, model),
    [input.allChannels],
  )
  const shownModel = useMemo(
    () => logicalModelOf(input.current?.model ?? ''),
    [input.current?.model, logicalModelOf],
  )
  const selectedModelOf = useCallback(
    (kind: 'image' | 'video'): string => {
      const nodes = input.getCanvasNodes()
      for (const id of input.selection) {
        const node = nodes.find((item) => item.id === id)
        if (!node) continue
        const data = node.data as { model?: unknown }
        const model =
          typeof data.model === 'string' ? data.model.trim() : ''
        if (!model) continue
        const category = capabilityOfLogical(
          input.allChannels,
          model,
        )?.category
        if (
          kind === 'video'
            ? category === 'video'
            : category !== 'video'
        ) {
          return model
        }
      }
      return ''
    },
    [input.allChannels, input.getCanvasNodes, input.selection],
  )
  const fallbackModelOptionsForChannels = useCallback(
    (channels: readonly Channel[]) => {
      const enabled = channels.filter((item) => item.enabled)
      const pick = (category: 'image' | 'video') =>
        panelModelOptions(category).filter(
          (model) =>
            channelIdForLogical(enabled, model) !== undefined,
        )
      return {
        image: pick('image'),
        video: pick('video'),
        chat: panelModelOptions('chat'),
      }
    },
    [],
  )

  const enqueueWrite = useCallback(
    (key: string, work: () => Promise<void>) => {
      const previous =
        queuesRef.current.get(key) ?? Promise.resolve()
      const queued = previous.catch(() => {}).then(work)
      queuesRef.current.set(key, queued)
      const cleanup = () => {
        if (queuesRef.current.get(key) === queued) {
          queuesRef.current.delete(key)
        }
      }
      queued.then(cleanup, cleanup)
      return queued
    },
    [],
  )

  const pickModel = useCallback(
    (model: string) => {
      const target = input.current
      if (!target) return Promise.resolve()
      input.clearChatRoute(target.id)
      return enqueueWrite(`${target.id}:model`, async () => {
        await input.patchSession(target.id, {
          model,
          channelId: '',
        })
      })
    },
    [enqueueWrite, input.clearChatRoute, input.current, input.patchSession],
  )

  const setModelKind = useCallback(
    (key: 'imageModel' | 'videoModel', model: string) => {
      const target = input.current
      if (!target) return Promise.resolve()
      return enqueueWrite(`${target.id}:${key}`, async () => {
        const updated = await input.patchSession(target.id, {
          [key]: model,
        })
        if (updated) {
          input.rememberStickyModel(
            target.id,
            key === 'videoModel' ? 'video' : 'image',
            model,
          )
        }
      })
    },
    [
      enqueueWrite,
      input.current,
      input.patchSession,
      input.rememberStickyModel,
    ],
  )

  return {
    globalImageModels,
    globalVideoModels,
    modelOptionsByKind,
    chatModelOptions: modelOptionsByKind.chat,
    mentionedModels,
    shownModel,
    defaultModelFor,
    logicalModelOf,
    selectedModelOf,
    fallbackModelOptionsForChannels,
    pickModel,
    setModelKind,
  }
}
