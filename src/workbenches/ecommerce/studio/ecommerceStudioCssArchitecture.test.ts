import { describe, expect, it } from 'vitest'
import baseStyles from '../EcommerceStudio.module.css'
import formStyles from './EcommerceStudioForms.module.css'
import intentStyles from './EcommerceStudioFormsIntent.module.css'
import planStyles from './EcommerceStudioFormsPlan.module.css'
import personStyles from './EcommerceStudioFormsPerson.module.css'
import statusStyles from './EcommerceStudioStatus.module.css'
import resultsStyles from './EcommerceStudioResults.module.css'
import overlaysStyles from './EcommerceStudioOverlays.module.css'

const styles = {
  ...baseStyles,
  ...formStyles,
  ...intentStyles,
  ...planStyles,
  ...personStyles,
  ...statusStyles,
  ...resultsStyles,
  ...overlaysStyles,
} as Record<string, string>

const CSS_MODULE_GLOB = import.meta.glob(
  '../EcommerceStudio.module.css',
  { eager: true, query: '?inline', import: 'default' },
) as Record<string, string>

const PART_GLOB = import.meta.glob(
  './EcommerceStudio{Forms,FormsIntent,FormsPlan,FormsPerson,Status,Results,Overlays}.module.css',
  { eager: true, query: '?inline', import: 'default' },
) as Record<string, string>

const STUDIO_SOURCE = (
  import.meta.glob('../EcommerceStudio.tsx', {
    eager: true, query: '?raw', import: 'default',
  }) as Record<string, string>
)['../EcommerceStudio.tsx']

const sourceText = (value: unknown) =>
  typeof value === 'string' ? value : (value as { default?: string } | undefined)?.default ?? ''

const SOURCE_TEXTS = [...Object.values(CSS_MODULE_GLOB), ...Object.values(PART_GLOB)].map(sourceText)

const countLines = (source: string) =>
  source.endsWith('\n') ? source.split('\n').length - 1 : source.split('\n').length

describe('ecommerce studio CSS architecture', () => {
  it('keeps the eight CSS modules inside their line budgets when source text is available', () => {
    expect(Object.keys(CSS_MODULE_GLOB)).toHaveLength(1)
    expect(Object.keys(PART_GLOB)).toHaveLength(7)
    for (const source of SOURCE_TEXTS) {
      expect(source).toBeTypeOf('string')
      if (!source) continue
      expect(countLines(source)).toBeLessThanOrEqual(600)
      expect((source.match(/{/g) ?? []).length - (source.match(/}/g) ?? []).length).toBe(0)
    }
  })

  it('merges base and component class names without changing JSX class references', () => {
    expect(styles).toBeTypeOf('object')
    expect(Object.keys(CSS_MODULE_GLOB)).toHaveLength(1)
    expect(Object.keys(PART_GLOB)).toHaveLength(7)
    expect(STUDIO_SOURCE).toContain("from './studio/studioStyles'")
    expect(STUDIO_SOURCE).not.toContain('styles.block =')
  })

  it('keeps every module free of script extraction artifacts', () => {
    for (const source of SOURCE_TEXTS) {
      expect(baseStyles).toBeTypeOf('object')
      expect(source).not.toContain('System.Object[]')
    }
  })
})
