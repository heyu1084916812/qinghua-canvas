import { describe, expect, it } from 'vitest'

const SOURCES = import.meta.glob('../**/*.ts', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

const countLines = (source: string | undefined): number =>
  source && source.length > 0
    ? source.replace(/\r?\n$/, '').split(/\r?\n/).length
    : 0

describe('storyboard video execution / split structure', () => {
  it('keeps every extracted production module below the governance line budget', () => {
    const modules = Object.entries(SOURCES).filter(
      ([path]) => path.startsWith('./') && !path.endsWith('.test.ts'),
    )
    expect(modules.length).toBeGreaterThanOrEqual(2)
    for (const [path, source] of modules) {
      expect(countLines(source), path).toBeLessThanOrEqual(450)
    }
  })

  it('keeps the stable controller below its former 1028 lines', () => {
    const controller = import.meta.glob(
      '../useStoryboardVideoExecutionController.ts',
      { eager: true, query: '?raw', import: 'default' },
    ) as Record<string, string>
    const source = Object.values(controller)[0]
    expect(source).toBeTruthy()
    expect(countLines(source)).toBeLessThan(300)
  })
})
