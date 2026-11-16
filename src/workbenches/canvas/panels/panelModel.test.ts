import { describe, expect, it } from 'vitest'
import { promptReferenceThumb } from './panelModel'

describe('创作面板上游提示词图标', () => {
  it('复用上游缩略图的编号 / 隐藏 / 删连线语义，并标记为 prompt', () => {
    expect(
      promptReferenceThumb({
        id: 'prompt-1',
        text: '一只猫',
        edgeId: 'edge-1',
        visible: false,
      }),
    ).toEqual({
      owner: 'upstream',
      id: 'prompt-1',
      kind: 'prompt',
      text: '一只猫',
      visible: false,
      removable: true,
      edgeId: 'edge-1',
    })
  })
})
