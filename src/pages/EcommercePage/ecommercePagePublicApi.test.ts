import { describe, expect, it } from 'vitest'

const PAGE_SOURCE = (
  import.meta.glob('./EcommercePage.tsx', {
    eager: true, query: '?raw', import: 'default',
  }) as Record<string, string>
)['./EcommercePage.tsx']

const WORKBENCH_SOURCE = (
  import.meta.glob('./EcommerceWorkbench.tsx', {
    eager: true, query: '?raw', import: 'default',
  }) as Record<string, string>
)['./EcommerceWorkbench.tsx']

const STUDIO_SOURCE = (
  import.meta.glob('../../workbenches/ecommerce/EcommerceStudio.tsx', {
    eager: true, query: '?raw', import: 'default',
  }) as Record<string, string>
)['../../workbenches/ecommerce/EcommerceStudio.tsx']

describe('ecommerce public API snapshot', () => {
  it('keeps all three page and workbench entry exports', () => {
    expect(PAGE_SOURCE).toContain('export function EcommercePage()')
    expect(WORKBENCH_SOURCE).toContain('export function EcommerceWorkbench({')
    expect(WORKBENCH_SOURCE).toContain('export type EcommerceWorkbenchAction =')
  })

  it('keeps the studio public component, status views and prop types', () => {
    for (const name of [
      'EcommerceUpload',
      'EcommerceImageParamOptions',
      'EcommerceResultItem',
      'EcommerceLongImageTools',
      'EcommerceStudioProps',
      'export function EcommerceStudio',
    ]) {
      expect(STUDIO_SOURCE, `${name} missing`).toContain(name)
    }
    expect(STUDIO_SOURCE).toContain("from './studio/studioContracts'")
    expect(STUDIO_SOURCE).toContain('export { GenerationStageView, ResultStatusOverlay }')
  })
})
