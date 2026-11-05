import type { NetworkResponse, SafeChannelConfig } from '../../ports'
import type { ChannelDeps, GeneratedAsset, ImageRunRequest } from '../types'
import type { ImageParamSpec } from '../../../domain/canvas/layout/imageParams'
import type { RequestedImageDimensions } from './imageParams'

export interface OpenAiAdapterConfig extends SafeChannelConfig {
  apiKey: string | null
}

export interface OpenAiImagesOptions {
  soonStudioPollIntervalMs?: number
  soonStudioPollTimeoutMs?: number
  soonStudioMaxPolls?: number
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  now?: () => number
}

export interface ImageItem {
  b64_json?: string
  url?: string
  fallbackUrls?: readonly string[]
  fallbackB64?: string
}

export interface ImageFile {
  blob: Blob
  name: string
}

export interface InlineImage {
  mimeType: string
  data: string
}

export type SubmitNetwork = (
  label: string,
  signal: AbortSignal,
  call: () => Promise<NetworkResponse>,
) => Promise<NetworkResponse>

export interface OpenAiImagesCore {
  config: OpenAiAdapterConfig
  deps: ChannelDeps
  base: string
  modelsUrl: string
  imagesUrl: string
  editsUrl: string
  chatUrl: string
  imageResponseFormat: 'b64_json' | 'url'
  submitNetwork: SubmitNetwork
  pollInterval: number
  pollTimeout: number
  maxPolls: number
  sleepFn: (ms: number, signal: AbortSignal) => Promise<void>
  now: () => number
}

export interface AssetWriter {
  toAsset(
    hash: string,
    mime: string,
    bytes: Uint8Array,
    requested: RequestedImageDimensions,
  ): GeneratedAsset
  assetsFromItems(
    items: readonly ImageItem[],
    requested: RequestedImageDimensions,
    signal: AbortSignal,
  ): Promise<GeneratedAsset[]>
  toAssets(
    res: NetworkResponse,
    requested: RequestedImageDimensions,
    signal: AbortSignal,
  ): Promise<GeneratedAsset[]>
}

export interface SoonStudioSubmissionInput {
  request: ImageRunRequest
  count: number
  size: string | null
  quality: string | null
  background: string | null
  spec: ImageParamSpec | null
  files: readonly ImageFile[]
}
