import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { creationModelNames, creationModelOptions } from './creationModelOptions'

describe('CreationPanel 模型选项', () => {
  it('chat 走固定展示名并排除隐藏项', () => {
    const names = creationModelNames({
      wantedCategory: 'chat',
      uncommonModelIds: ['GPT-6 Luna'],
      globalModelIds: ['unused'],
    })
    expect(names).not.toContain('GPT-6 Luna')
    expect(names).toContain('GPT-6 Astra')
  })

  it('生成类别只取当前渠道类别的逻辑名', () => {
    expect(
      creationModelNames({
        wantedCategory: 'image',
        uncommonModelIds: [],
        globalModelIds: ['GPT Image 2', 'Midjourney'],
      }),
    ).toEqual(['GPT Image 2', 'Midjourney'])
  })

  it('只为有固定图标的模型附带 icon，并保持值 / 文案同名', () => {
    const options = creationModelOptions({
      wantedCategory: 'image',
      uncommonModelIds: [],
      globalModelIds: ['GPT Image 2', 'Custom'],
      iconFor: (name): ReactNode | undefined => (name === 'GPT Image 2' ? 'icon' : undefined),
    })
    expect(options).toEqual([
      { value: 'GPT Image 2', label: 'GPT Image 2', icon: 'icon' },
      { value: 'Custom', label: 'Custom' },
    ])
  })
})
