// @ts-expect-error -- tests read source files without adding Node types to the app
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = fs.readFileSync(new URL('./FlowSurface.module.css', import.meta.url), 'utf8')
const source = fs.readFileSync(new URL('./FlowSurface.tsx', import.meta.url), 'utf8')
const marker = fs.readFileSync(new URL('./KnifeCursor.tsx', import.meta.url), 'utf8')

describe('KnifeCursor native cursor', () => {
  it('uses a native SVG cursor with the hotspot at the blade tip', () => {
    expect(css).toContain('cursor: url("data:image/svg+xml,')
    expect(css).toContain('") 2 20, crosshair !important')
    expect(css).toContain('stroke-width%3D%224.5%22')
    expect(css).toContain('stroke-width%3D%222%22')
  })

  it('keeps only a hidden marker instead of a moving DOM cursor', () => {
    expect(source).toContain('<KnifeCursor active={knifeOn} />')
    expect(marker).toContain('data-knife-cursor')
    expect(marker).toContain('data-native-knife-cursor')
    expect(marker).toContain('hidden')
    expect(marker).not.toContain('pointermove')
    expect(marker).not.toContain('translate3d')
  })
})
