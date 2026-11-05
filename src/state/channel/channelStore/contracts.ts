import type { PlatformKit, StreamChunk } from '../../../platform/ports'
import type {
  Channel,
  ChannelCredentialGroup,
  CreateChannelInput,
  CredentialSlot,
} from '../../../domain/project/channel'
import type {
  CustomProtocolInput,
  CustomProtocolValidation,
  ProtocolCatalog,
  ProtocolDefinition,
} from '../../../domain/project/protocol'
import type { RouteStrategy } from '../../../domain/project/modelRouting'
import { normalizeRoutePolicy, type RoutePlanResult, type RoutePolicy } from '../../../domain/project/routePlan'
import type { PresetModel, PresetVendor } from '../../../domain/project/modelPresets'
import type { ModelCapability } from '../../../domain/shared/capability'
import type { ChatMessage, NodeInput, ToolDeclaration } from '../../../domain/shared/execution/types'
import type {
  GeneratedAsset,
  SpeechRunRequest,
  TextResult,
  VideoRunRequest,
} from '../../../platform/channels/types'
import type { DirectRunRouteCandidate, DirectRunTraceInput } from '../../shared/directRun'

export type MiniStore<T> = {
  getState: () => T
  setState: (partial: Partial<T> | ((prev: T) => Partial<T>)) => void
  subscribe: (listener: () => void) => () => void
}

export type StoreFactory = <T>(init: () => T) => MiniStore<T>

import type { ChannelStoreActions, ChannelStoreState } from '../channelStore'

export type ChannelStore = MiniStore<ChannelStoreState> & ChannelStoreActions

export type ChannelStorePlatform = PlatformKit
export type {
  Channel,
  CreateChannelInput,
  CredentialSlot,
  ProtocolCatalog,
  ProtocolDefinition,
  CustomProtocolInput,
  CustomProtocolValidation,
  RouteStrategy,
  RoutePlanResult,
  RoutePolicy,
  PresetModel,
  PresetVendor,
  ModelCapability,
  PlatformKit,
  StreamChunk,
  ChannelCredentialGroup,
  ChatMessage,
  NodeInput,
  ToolDeclaration,
  GeneratedAsset,
  SpeechRunRequest,
  TextResult,
  VideoRunRequest,
  DirectRunRouteCandidate,
  DirectRunTraceInput,
}

export function initialChannelStoreState(): ChannelStoreState {
  return {
    channels: [],
    routeStrategy: 'priority',
    routingPolicy: normalizeRoutePolicy(undefined),
    recipeMemory: true,
    customProtocols: [],
    hiddenBuiltinProtocolIds: [],
    customModels: [],
    uncommonModelIds: [],
    loaded: false,
    verify: { status: 'idle' },
    models: { status: 'idle' },
    detect: { status: 'idle', protocol: null },
  }
}

export function timeoutSignal(ms: number): AbortSignal {
  return typeof AbortSignal !== 'undefined' &&
    typeof (AbortSignal as { timeout?: unknown }).timeout === 'function'
    ? AbortSignal.timeout(ms)
    : new AbortController().signal
}
