// @ts-expect-error -- tests read source files without adding Node types to the app
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { knifeCursorTransform } from './KnifeCursor'

const source = fs.readFileSync(new URL('./KnifeCursor.tsx', import.meta.url), 'utf8')

describe('KnifeCursor pointer tracking', () => {
  it('keeps one CSS pixel of pointer travel as one CSS pixel of blade travel', () => {
    expect(knifeCursorTransform(100, 80)).toBe('translate3d(98px, 78px, 0)')
    expect(knifeCursorTransform(140, 130)).toBe('translate3d(138px, 128px, 0)')
  })

  it('paints raw pointer updates without rAF coalescing', () => {
    expect(source).toContain("'pointerrawupdate'")
    expect(source).toContain("'pointermove'")
    expect(source).toContain('capture: true')
    expect(source).not.toContain('requestAnimationFrame')
  })
})
