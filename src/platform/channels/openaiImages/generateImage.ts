import { imageParamsFor } from '../../../domain/canvas/layout/imageParams'
import { classifyError } from '../openaiCommon'
import { ChannelError, type GeneratedAsset, type ImageRunRequest } from '../types'
import type { AssetWriter, OpenAiImagesCore, SoonStudioSubmissionInput } from './contracts'
import { generateChatImage } from './chatImageProtocol'
import {
  acceptedAfterSubmit,
  readNetworkDetail,
} from './errorNormalization'
import {
  generateGeminiNativeImage,
} from './geminiImageProtocol'
import {
  geminiImageSize,
  geminiRequestOptions,
  postEdits,
  postGenerations,
  postSpecGenerations,
  prepareImageRequest,
  readImageFiles,
  toDataUris,
} from './requestConstruction'
import { sizeToDimensions } from './imageParams'
import { generateSoonStudioImage } from './soonStudioPolling'

export async function generateImage(
  core: OpenAiImagesCore,
  assets: AssetWriter,
  request: ImageRunRequest,
  signal: AbortSignal,
): Promise<GeneratedAsset[]> {
  const spec = imageParamsFor(request.model)
  if (spec?.dialect === 'gemini') {
    const options = geminiRequestOptions(spec, request)
    if (core.config.protocol === 'soonstudio') {
      const files = await readImageFiles(core, request)
      const count = Math.min(
        Math.max(...spec.counts),
        Math.max(1, typeof request.params.count === 'number' ? request.params.count : 1),
      )
      const input: SoonStudioSubmissionInput = {
        request,
        count,
        size: geminiImageSize(spec, request),
        quality: options.quality,
        background: options.background,
        spec,
        files,
      }
      return generateSoonStudioImage(
        core,
        assets,
        {
          nativeGeminiFallback: (nextRequest, nextSpec, nextSignal) =>
            generateGeminiNativeImage(core, assets, nextRequest, nextSpec, nextSignal),
        },
        input,
        signal,
      )
    }
    const nativeAssets = await generateGeminiNativeImage(core, assets, request, spec, signal)
    if (nativeAssets) return nativeAssets
  }

  if (spec?.dialect === 'chat' || spec?.dialect === 'gemini') {
    return generateChatImage(core, assets, request, signal)
  }

  const prepared = await prepareImageRequest(core, request, true)
  if (core.config.protocol === 'soonstudio' && prepared.files.length === 0) {
    return generateSoonStudioImage(
      core,
      assets,
      {
        nativeGeminiFallback: (nextRequest, nextSpec, nextSignal) =>
          generateGeminiNativeImage(core, assets, nextRequest, nextSpec, nextSignal),
      },
      {
        request: prepared.request,
        count: prepared.count,
        size: prepared.size,
        quality: prepared.quality,
        background: prepared.background,
        spec: prepared.spec,
        files: prepared.files,
      } satisfies SoonStudioSubmissionInput,
      signal,
    )
  }
  const res = await core.submitNetwork('生图提交', signal, async () =>
    !prepared.openAiStyle && prepared.specSize
      ? postSpecGenerations(
          core,
          request,
          prepared.specSize,
          prepared.spec!,
          await toDataUris(core, request),
          signal,
        )
      : prepared.files.length > 0
        ? postEdits(
            core,
            prepared.request,
            prepared.count,
            prepared.size,
            prepared.quality,
            prepared.background,
            prepared.files,
            signal,
          )
        : postGenerations(
            core,
            prepared.request,
            prepared.count,
            prepared.size,
            prepared.quality,
            prepared.background,
            signal,
          ),
  )
  if (res.status < 200 || res.status >= 300) {
    const detail = await readNetworkDetail(res)
    if (res.status === 408 || res.status === 429 || res.status >= 500) {
      throw acceptedAfterSubmit(`生图提交结果未知：HTTP ${res.status} ${detail}`)
    }
    const { error } = classifyError(null, res.status, detail)
    throw new ChannelError(error)
  }
  return assets.toAssets(res, sizeToDimensions(prepared.size), signal)
}
