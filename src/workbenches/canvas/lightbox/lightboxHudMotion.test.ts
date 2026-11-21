// @ts-expect-error -- tests read source CSS/TS without adding Node types to the app
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = fs.readFileSync(new URL('./LightboxLayer.module.css', import.meta.url), 'utf8').replaceAll('\r\n', '\n')
const tsx = fs.readFileSync(new URL('./LightboxLayer.tsx', import.meta.url), 'utf8')
const flip = fs.readFileSync(new URL('./lightboxFlipController.ts', import.meta.url), 'utf8')

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

  it('keeps the real media hidden while the FLIP clone owns the frame', () => {
    expect(css).toContain('.overlay[data-lightbox-flipping] [data-lightbox-media]')
    expect(flip).toContain("setAttribute('data-lightbox-flipping', '')")
    expect(flip).toContain("removeAttribute('data-lightbox-flipping')")
  })

  it('uses a short clip fade for gallery switches instead of replaying entry FLIP', () => {
    expect(tsx).toContain('gallerySwitchPendingRef')
    expect(tsx).toContain("clipPath: 'inset(0 0 0 8%)'")
    expect(tsx).toContain('GALLERY_SWITCH_MS')
    expect(flip).toContain('lightboxEntryMode')
  })
})

