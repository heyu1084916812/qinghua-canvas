import { describe, expect, it } from 'vitest'
import * as views from './CreationAssetViews'

describe('CreationPanel 素材局部视图', () => {
  it('四个组件都从旧入口的同一职责迁出', () => {
    expect(Object.keys(views).sort()).toEqual([
      'CollectionCard',
      'MentionThumb',
      'MentionThumbProbe',
      'Thumb',
    ])
    for (const component of Object.values(views)) expect(component).toBeTypeOf('function')
  })
})
