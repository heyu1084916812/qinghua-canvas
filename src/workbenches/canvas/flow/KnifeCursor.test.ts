// @ts-expect-error -- tests read source files without adding Node types to the app
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { knifeCursorTransform } from './KnifeCursor'

const source = fs.readFileSync(new URL('./KnifeCursor.tsx', import.meta.url), 'utf8')

describe('KnifeCursor pointer tracking', () => {
  it('aligns the visible blade tip with the pointer hotspot', () => {
    expect(knifeCursorTransform(100, 80)).toBe('translate3d(98px, 63px, 0)')
    expect(knifeCursorTransform(140, 130)).toBe('translate3d(138px, 113px, 0)')
  })

  it('follows standard pointer updates without raw-event lead or rAF lag', () => {
    expect(source).toContain("addEventListener('pointermove'")
    expect(source).toContain('capture: true')
    expect(source).not.toContain("addEventListener('pointerrawupdate'")
    expect(source).not.toContain('requestAnimationFrame')
  })
})
