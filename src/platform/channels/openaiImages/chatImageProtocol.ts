import { fingerprintBytes } from '../../../domain/shared/hash'
import { authHeader, classifyError, IMAGE_GENERATE_TIMEOUT_MS } from '../openaiCommon'
import { ChannelError, type GeneratedAsset, type ImageRunRequest } from '../types'
import type { AssetWriter, OpenAiImagesCore } from './contracts'
import { acceptedAfterSubmit, readNetworkDetail } from './errorNormalization'
import { imageUrlFromChatContent } from './imageParams'
import { toDataUris } from './requestConstruction'

export async function generateChatImage(
  core: OpenAiImagesCore,
  assets: AssetWriter,
  request: ImageRunRequest,
  signal: AbortSignal,
): Promise<GeneratedAsset[]> {
  const dataUris = await toDataUris(core, request)
  const content =
    dataUris.length > 0
      ? [
          { type: 'text', text: request.prompt },
          ...dataUris.map((url) => ({ type: 'image_url', image_url: { url } })),
        ]
      : request.prompt
  const res = await core.submitNetwork('chat 生图提交', signal, () =>
    core.deps.network.request(
      {
        url: core.chatUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeader(core.config.apiKey),
        },
        body: {
          model: request.model,
          messages: [{ role: 'user', content }],
        },
        timeoutMs: IMAGE_GENERATE_TIMEOUT_MS,
      },
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
  const body = await res.json<{ choices?: { message?: { content?: unknown } }[] }>()
  const url = imageUrlFromChatContent(body.choices?.[0]?.message?.content)
  if (!url) {
    throw new ChannelError({
      kind: 'parse',
      raw:
        '模型回复里没有图片地址：' +
        (typeof body.choices?.[0]?.message?.content === 'string'
          ? body.choices[0]!.message!.content!.slice(0, 200)
          : '（正文不是字符串）'),
    })
  }
  const dl = await core.deps.network.request(
    { url, method: 'GET', headers: {} },
    signal,
  )
  const bytes = new Uint8Array(await dl.arrayBuffer())
  const hash = await fingerprintBytes(bytes)
  const mime = /\.jpe?g(\?|$)/i.test(url) ? 'image/jpeg' : 'image/png'
  return [assets.toAsset(hash, mime, bytes, {})]
}
