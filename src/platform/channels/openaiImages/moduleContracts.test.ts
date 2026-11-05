import { describe, expect, it } from 'vitest'
import { openAiImageSize, sizeToDimensions } from './imageParams'
import {
  findGeminiImage,
  findInlineImage,
  geminiNoImageReason,
  imageItemsIn,
} from './responseParsing'
import {
  acceptedAfterSubmit,
  isGeminiNativeRequestRequired,
  soonStudioFailureIn,
  soonStudioUpstreamErrorIn,
  transportTextOf,
  waitFor,
} from './errorNormalization'
import { toAsset } from './generatedAssets'

describe('openaiImages / parameter module', () => {
  it('translates ratios and requested dimensions without guessing invalid sizes', () => {
    expect(openAiImageSize('1:1')).toBe('1024x1024')
    expect(openAiImageSize('16:9', '4K')).toBe('3840x2160')
    expect(openAiImageSize('22:7')).toBeNull()
    expect(sizeToDimensions('1024x1536')).toEqual({ width: 1024, height: 1536 })
    expect(sizeToDimensions(null)).toEqual({})
  })
})

describe('openaiImages / upstream response parser', () => {
  it('finds inline, URL and nested image shapes without duplicating candidates', () => {
    const inline = findGeminiImage({
      candidates: [
        { content: { parts: [{ text: 'no image' }] }, finishReason: 'STOP' },
        {
          content: {
            parts: [{ inline_data: { mime_type: 'image/webp', data: ' d2Vi ' } }],
          },
        },
      ],
    })
    expect(inline).toEqual({ kind: 'inline', data: 'd2Vi', mimeType: 'image/webp' })
    expect(findInlineImage({ candidates: inline ? [{ inlineData: inline }] : [] })).toBeNull()
    expect(
      findGeminiImage({
        candidates: [
          {
            content: {
              parts: [
                {
                  fileData: {
                    mimeType: 'image/jpeg',
                    fileUri: 'https://files.example/out.jpg',
                  },
                },
              ],
            },
          },
        ],
      }),
    ).toEqual({
      kind: 'url',
      url: 'https://files.example/out.jpg',
      mimeType: 'image/jpeg',
    })
    expect(
      findGeminiImage({
        choices: [{ message: { content: '![image](https://files.example/chat.png)' } }],
      }),
    ).toEqual({ kind: 'url', url: 'https://files.example/chat.png' })
  })

  it('preserves upstream reasons for no-image and nested error responses', () => {
    expect(
      geminiNoImageReason({
        candidates: [
          {
            content: { parts: [{ text: '参考图缺失' }] },
            finishReason: 'STOP',
          },
        ],
      }),
    ).toContain('STOP')
    expect(
      soonStudioUpstreamErrorIn({
        response: {
          body: {
            error: { code: 'model_not_allowed', message: 'not enabled' },
          },
        },
      }),
    ).toContain('not enabled')
    expect(isGeminiNativeRequestRequired('Use POST /v1beta/models/gemini:generateContent')).toBe(true)
  })

  it('collects and de-duplicates image items from wrapped upstream payloads', () => {
    const items = imageItemsIn({
      data: {
        status: 'SUCCESS',
        data: {
          url: ['https://cdn.example/a.png', 'https://cdn.example/a.png'],
          b64_json: 'YWJj',
        },
      },
    })
    expect(items).toEqual([
      {
        url: 'https://cdn.example/a.png',
        fallbackUrls: [],
        fallbackB64: 'YWJj',
      },
    ])
  })
})

describe('openaiImages / error normalization and asset projection', () => {
  it('maps submitted-task failures and transport text into stable error shapes', () => {
    const accepted = acceptedAfterSubmit('submitted')
    expect(accepted.appError).toMatchObject({ kind: 'execution', detail: 'accepted' })
    expect(
      soonStudioFailureIn({
        data: { status: 'FAILURE', fail_reason: 'upstream exhausted' },
      }),
    ).toBe('upstream exhausted')
    expect(transportTextOf({ kind: 'network', detail: 'timeout' })).toBe('network/timeout')
  })

  it('rejects an aborted wait without scheduling a second paid submission', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(waitFor(1000, controller.signal)).rejects.toMatchObject({
      appError: { kind: 'network', detail: 'aborted' },
    })
  })

  it('reads actual dimensions from bytes and keeps requested dimensions separate', () => {
    const bytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00, 0x05,
      0x08, 0x02, 0x00, 0x00, 0x00,
    ])
    const asset = toAsset('hash', 'image/png', bytes, { width: 1024, height: 1536 })
    expect(asset).toMatchObject({
      width: 3,
      height: 5,
      requestedWidth: 1024,
      requestedHeight: 1536,
    })
  })
})
