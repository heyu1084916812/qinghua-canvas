import { describe, expect, it } from 'vitest'
import * as CreationPanel from '../CreationPanel'
import * as catalog from './creationCatalog'
import * as geometry from './creationPanelGeometry'
import * as modelOptions from './creationModelOptions'
import * as qualityParams from './creationQualityParams'

describe('CreationPanel 公共导出快照', () => {
  it('旧入口保留所有运行时导出与类型入口', () => {
    expect(Object.keys(CreationPanel).sort()).toEqual([
      'COUNT_OPTIONS',
      'CreationPanel',
      'RATIO_FOLLOW_SOURCE',
      'RATIO_OPTIONS',
      'RESOLUTION_CUSTOM',
      'promptNeedsExpand',
      'ratiosOf',
      'resolutionsOf',
      'withFollowRatio',
    ])
    expect(CreationPanel.CreationPanel).toBeTypeOf('function')
  })

  it('拆分前的纯函数仍从旧入口以同一实现导出', () => {
    expect(CreationPanel.COUNT_OPTIONS).toBe(catalog.COUNT_OPTIONS)
    expect(CreationPanel.RATIO_OPTIONS).toBe(catalog.RATIO_OPTIONS)
    expect(CreationPanel.RESOLUTION_CUSTOM).toBe(catalog.RESOLUTION_CUSTOM)
    expect(CreationPanel.resolutionsOf).toBe(catalog.resolutionsOf)
    expect(CreationPanel.ratiosOf).toBe(catalog.ratiosOf)
    expect(CreationPanel.withFollowRatio).toBe(catalog.withFollowRatio)
    expect(CreationPanel.promptNeedsExpand).toBe(catalog.promptNeedsExpand)
  })

  it('子模块只暴露各自的公共 API', () => {
    expect(Object.keys(geometry)).toContain('panelGeometryFor')
    expect(Object.keys(modelOptions).sort()).toEqual([
      'creationModelNames',
      'creationModelOptions',
    ])
    expect(Object.keys(qualityParams).sort()).toEqual([
      'customSizeHintOf',
      'deriveCreationQualityParams',
    ])
  })
})
