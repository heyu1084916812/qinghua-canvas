import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = fs.readFileSync(new URL('./LightboxLayer.module.css', import.meta.url), 'utf8')
const tsx = fs.readFileSync(new URL('./LightboxLayer.tsx', import.meta.url), 'utf8')

describe('lightbox HUD mode motion', () => {
  it('remounts HUD content when the mode or comparison view changes', () => {
    expect(tsx).toContain('key={`${mode}-${view}`}')
    expect(tsx).toContain('data-lightbox-hud')
  })

  it('uses a short centered entrance and disables it for reduced motion', () => {
    expect(css).toContain('animation: hudContentIn 180ms var(--ease-panel);')
    expect(css).toContain('@keyframes hudContentIn')
    expect(css).toContain('transform: translate(-50%, -4px);')
    expect(css).toContain('  .hud {\n    animation: none;')
  })
})
