// @ts-expect-error -- tests read source CSS without adding Node types to the app
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./CreationPanelAssets.module.css', import.meta.url), 'utf8')

describe('创作面板素材卡动效', () => {
  it('素材缩略图与集合卡使用统一的轻微缩放入场，并支持 reduced-motion', () => {
    expect(css).toContain('@keyframes assetCardIn')
    expect(css).toMatch(/\.thumb[\s\S]*animation: assetCardIn 180ms/)
    expect(css).toMatch(/\.collection[\s\S]*animation: assetCardIn 180ms/)
    expect(css).toContain('prefers-reduced-motion: reduce')
    expect(css).toMatch(/\.thumb,\s*\.collection \{\s*animation: none;/)
  })
})
