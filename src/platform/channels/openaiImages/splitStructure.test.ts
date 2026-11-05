import { describe, expect, it } from 'vitest'

const MODULE_SOURCES = import.meta.glob('./*.ts', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

const FACADE_SOURCES = import.meta.glob('../openaiImages.ts', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

const countLines = (source: string | undefined): number =>
  source && source.length > 0
    ? source.replace(/\r?\n$/, '').split(/\r?\n/).length
    : 0

describe('openaiImages / split structure', () => {
  it('keeps every production module below the governance line budget', () => {
    const modules = Object.entries(MODULE_SOURCES).filter(
      ([path]) => !path.endsWith('.test.ts'),
    )
    expect(modules.length).toBeGreaterThanOrEqual(5)
    for (const [path, source] of modules) {
      expect(countLines(source), path).toBeLessThanOrEqual(450)
    }
  })

  it('keeps the legacy public facade thin', () => {
    const source = Object.values(FACADE_SOURCES)[0]
    expect(source).toBeTruthy()
    expect(countLines(source)).toBeLessThan(100)
  })
})
