import { describe, expect, it } from 'vitest'
import type { GenerationData } from '../../../../domain/canvas/model/node'
import { customSizeHintOf, deriveCreationQualityParams } from './creationQualityParams'
import { RATIO_FOLLOW_SOURCE } from '../../../../domain/canvas/layout/constants'

const base = (patch: Partial<GenerationData> = {}): GenerationData =>
  ({ mode: 'image', ...patch }) as GenerationData

describe('CreationPanel 质量参数', () => {
  it('无参考图时不展示不可用的跟随素材值', () => {
    const result = deriveCreationQualityParams({
      data: base({ ratio: RATIO_FOLLOW_SOURCE }),
      hasSourceImage: false,
      customModeOn: false,
    })
    expect(result.shownRatio).toBe('')
    expect(result.ratios).not.toContain(RATIO_FOLLOW_SOURCE)
  })

  it('有参考图时追加跟随素材，并保留仍在显示的旧值', () => {
    const result = deriveCreationQualityParams({
      data: base({ ratio: RATIO_FOLLOW_SOURCE }),
      hasSourceImage: true,
      customModeOn: false,
    })
    expect(result.ratios.at(-1)).toBe(RATIO_FOLLOW_SOURCE)
    expect(result.shownRatio).toBe(RATIO_FOLLOW_SOURCE)
  })

  it('模型未声明张数上限时固定四项全部可选', () => {
    const result = deriveCreationQualityParams({
      data: base({ count: 9 }),
      hasSourceImage: false,
      customModeOn: false,
    })
    expect(result.maxCount).toBe(9)
    expect(result.count).toBe(9)
    expect(result.countChoices).toEqual([1, 2, 4, 9])
  })

  it('视频规格按声明区间夹时长、跳过不可选的默认模式', () => {
    const result = deriveCreationQualityParams({
      data: base({ mode: 'video', durationSec: 40, videoMode: 'text' }),
      videoSpec: {
        dialect: 'agnes-tier',
        sizes: ['720p'],
        ratios: ['16:9'],
        seconds: { min: 4, max: 15, default: 5 },
        modes: ['text', 'all-purpose'],
        disabledModes: ['text'],
        counts: [1, 2],
        supportsAudio: true,
      } as never,
      hasSourceImage: false,
      customModeOn: false,
    })
    expect(result.duration).toBe(15)
    expect(result.videoModeValue).toBe('all-purpose')
    expect(result.showGenerateAudio).toBe(true)
    expect(result.sizeValue).toBe('720p')
  })

  it('自定义像素只在 openai-images 方言下成立，并给出错误提示', () => {
    const plain = deriveCreationQualityParams({
      data: base({ resolution: '1024x1536' }),
      imageSpec: { dialect: 'gemini', sizes: ['1k'], counts: [1], qualities: [], backgrounds: [], ratios: ['1:1'] } as never,
      hasSourceImage: false,
      customModeOn: false,
    })
    expect(plain.canCustomSize).toBe(false)
    expect(plain.customResolutionOn).toBe(false)

    const custom = deriveCreationQualityParams({
      data: base({ resolution: '1024x1536' }),
      imageSpec: { dialect: 'openai-images', sizes: ['1k'], counts: [1], qualities: [], backgrounds: [], ratios: ['1:1'] } as never,
      hasSourceImage: false,
      customModeOn: false,
    })
    expect(custom.canCustomSize).toBe(true)
    expect(custom.customResolutionOn).toBe(true)
    expect(custom.resolutionPillValue).toBe('自定义')
    expect(customSizeHintOf('')?.tone).toBe('muted')
    expect(customSizeHintOf('bad')?.tone).toBe('error')
  })
})
