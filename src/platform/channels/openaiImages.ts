import {
  customImageSize,
} from '../../domain/canvas/layout/customSize'
import {
  normalizeBaseUrl,
} from './openaiCommon'
import type { ChannelAdapter, ChannelDeps } from './types'
import type {
  OpenAiAdapterConfig,
  OpenAiImagesOptions,
} from './openaiImages/contracts'
import {
  createOpenAiImagesAdapterFromCore,
  createOpenAiImagesCore,
} from './openaiImages/createAdapter'
import {
  imageUrlFromChatContent,
  openAiImageQuality,
  openAiImageSize,
  specImageSize,
} from './openaiImages/imageParams'
import {
  findGeminiImage,
  findInlineImage,
  geminiNoImageReason,
  type GeminiImagePayload,
} from './openaiImages/responseParsing'

/** Keeps the historical import path stable while the protocol modules own these APIs. */
export { customImageSize, normalizeBaseUrl }
export type { OpenAiAdapterConfig, OpenAiImagesOptions }
export type { GeminiImagePayload }
export {
  imageUrlFromChatContent,
  openAiImageQuality,
  openAiImageSize,
  specImageSize,
  findGeminiImage,
  findInlineImage,
  geminiNoImageReason,
}

export function createOpenAiImagesAdapter(
  config: OpenAiAdapterConfig,
  deps: ChannelDeps,
  options: OpenAiImagesOptions = {},
): ChannelAdapter {
  return createOpenAiImagesAdapterFromCore(
    createOpenAiImagesCore(config, deps, options),
  )
}
