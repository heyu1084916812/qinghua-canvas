// @ts-expect-error -- tests read source CSS without adding Node types to the app
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = fs.readFileSync(new URL('./NodeFrame.module.css', import.meta.url), 'utf8')

describe('NodeFrame selection motion', () => {
  it('fades the selection chrome without mounting an animation on every node', () => {
    expect(css).toMatch(/\.frame::after[\s\S]*opacity: 0[\s\S]*transition: opacity 160ms/)
    expect(css).toContain('.frame.selected::after')
    expect(css).toContain('opacity: 1')
    expect(css).toContain('prefers-reduced-motion: reduce')
    expect(css).not.toContain('animation:')
  })
})
