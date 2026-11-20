// @ts-expect-error -- tests read source CSS without adding Node types to the app
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const gridCss = fs.readFileSync(new URL('./ReferenceGridCards.module.css', import.meta.url), 'utf8')
const kitCss = fs.readFileSync(new URL('./ReferenceKitItems.module.css', import.meta.url), 'utf8')

describe('参考与套件卡列表动效', () => {
  it('参考卡、套件文件夹和套件条目统一轻微入场并支持 reduced-motion', () => {
    expect(gridCss).toContain('@keyframes referenceCardIn')
    expect(gridCss).toMatch(/\.referenceCard,\s*\.kitFolderCard[\s\S]*animation: referenceCardIn 180ms/)
    expect(gridCss).toContain('prefers-reduced-motion: reduce')
    expect(kitCss).toContain('@keyframes referenceKitItemIn')
    expect(kitCss).toMatch(/\.item,\s*\.imageItem[\s\S]*animation: referenceKitItemIn 180ms/)
    expect(kitCss).toContain('prefers-reduced-motion: reduce')
  })
})
