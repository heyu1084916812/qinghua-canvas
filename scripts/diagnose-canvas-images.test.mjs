import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const source = fs.readFileSync(
  path.resolve(import.meta.dirname, 'diagnose-canvas-images.mjs'),
  'utf8',
)

describe('canvas image diagnosis probe', () => {
  it('keeps every real image and records isolation as diagnosis only', () => {
    expect(source).toContain("'baseline'")
    expect(source).toContain('images visibility hidden')
    expect(source).toContain('images display none')
    expect(source).toContain('diagnosis only')
    expect(source).toContain('decoded')
    expect(source).not.toContain('MAX_P95_MS')
  })
})
