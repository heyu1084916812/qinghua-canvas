import { describe, expect, it } from 'vitest'

const sources = import.meta.glob(
  './*.{ts,tsx}',
  { eager: true, query: '?raw', import: 'default' },
) as Record<string, string>

const countLines = (source: string) =>
  source.endsWith('\n') ? source.split('\n').length - 1 : source.split('\n').length

describe('ecommerce page and workbench architecture', () => {
  it('keeps all new implementation modules under the line budget', () => {
    for (const [path, source] of Object.entries(sources)) {
      if (path.endsWith('.test.ts') || path.endsWith('EcommercePage.tsx') || path.endsWith('EcommerceWorkbench.tsx')) continue
      expect(source, `${path} missing`).toBeTypeOf('string')
      expect(countLines(source), `${path} over budget`).toBeLessThanOrEqual(450)
    }
  })

  it('keeps the unique active task and result-row ownership in the page entry', () => {
    const page = sources['./EcommercePage.tsx']
    expect(page).toContain('const [activeTask, setActiveTask]')
    expect(page).toContain('const [resultRows, setResultRows]')
    expect(page).toContain('from \'./ecommercePageSupport\'')
    for (const other of Object.keys(sources).filter((path) => path !== './EcommercePage.tsx')) {
      expect(sources[other], `${other} owns task state`).not.toContain('const [activeTask, setActiveTask]')
      expect(sources[other], `${other} owns result rows`).not.toContain('const [resultRows, setResultRows]')
    }
  })

  it('keeps the canvas edit entry, batch id, refresh recovery and concurrent run semantics', () => {
    const page = sources['./EcommercePage.tsx']
    expect(page).toContain('onEditResult={editResult}')
    expect(page).toContain('const batchId = ecommerceBatchId()')
    expect(page).toContain('reconcileFromRunRecords(projectId)')
    expect(page).toContain('void exec')
    expect(page).toContain('setGenerationStage({ phase: \'failed\'')
  })

  it('keeps the workbench viewport, gestures and result-task projection', () => {
    const workbench = sources['./EcommerceWorkbench.tsx']
    expect(workbench).toContain("from './workbenchGeometry'")
    expect(workbench).toContain("from './EcommerceWorkbenchViews'")
    expect(workbench).toContain('workbenchMinimapModel')
    expect(workbench).toContain('workbenchBlankInteraction')
    expect(workbench).toContain('latestResultById')
    expect(workbench).toContain('data-ecommerce-workbench')
    expect(sources['./workbenchGeometry.ts']?.length).toBeGreaterThan(0)
  })
})
