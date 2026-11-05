import { describe, expect, it } from 'vitest'
import {
  ecommerceBatchId,
  ecommerceVisualInputsOf,
  legacyAssetHashesOfNode,
} from './ecommercePageSupport'
import {
  itemScreenRect,
  workbenchMinimapModel,
} from './workbenchGeometry'
import {
  ToolIcon,
  WorkbenchResultPlaceholder,
  elapsedLabel,
} from './EcommerceWorkbenchViews'

const SOURCES = import.meta.glob(
  './*.{ts,tsx}',
  { eager: true, query: '?raw', import: 'default' },
) as Record<string, string>

const countLines = (source: string) =>
  source.endsWith('\n') ? source.split('\n').length - 1 : source.split('\n').length

describe('ecommerce page module coverage', () => {
  it('keeps every new implementation module within its budget', () => {
    for (const [path, source] of Object.entries(SOURCES)) {
      if (path.endsWith('.test.ts')) continue
      if (path.includes('EcommercePage.tsx') || path.includes('EcommerceWorkbench.tsx') || path.includes('LongImagePanel')) continue
      expect(countLines(source), `${path} over budget`).toBeLessThanOrEqual(450)
    }
  })

  it('exports the page support, geometry and result-view assembly points', () => {
    expect(legacyAssetHashesOfNode({ id: 'a', data: { assetHash: 'h' } })).toEqual(['h'])
    expect(ecommerceVisualInputsOf).toBeTypeOf('function')
    expect(ecommerceBatchId()).toMatch(/^ecb_/)
    expect(itemScreenRect).toBeTypeOf('function')
    expect(workbenchMinimapModel).toBeTypeOf('function')
    expect(ToolIcon).toBeTypeOf('function')
    expect(WorkbenchResultPlaceholder).toBeTypeOf('function')
    expect(elapsedLabel({ createdAt: 0, updatedAt: 500 } as never)).toBe('<1s')
  })
})
