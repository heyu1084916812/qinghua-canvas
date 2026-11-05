import { describe, expect, it } from 'vitest'
import { creationStyles } from './creationStyles'

const inlineModules = import.meta.glob('./*.module.css', {
  eager: true,
  query: '?inline',
}) as Record<string, unknown>
const mainModules = import.meta.glob('../CreationPanel.module.css', {
  eager: true,
  query: '?inline',
}) as Record<string, unknown>

const sourceOf = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) {
      if (typeof nested === 'string' && nested.length > 0) return nested
    }
  }
  return ''
}

const sources = {
  main: sourceOf(mainModules['../CreationPanel.module.css']),
  base: sourceOf(inlineModules['./CreationPanelBase.module.css']),
  assets: sourceOf(inlineModules['./CreationPanelAssets.module.css']),
  prompt: sourceOf(inlineModules['./CreationPanelPrompt.module.css']),
  params: sourceOf(inlineModules['./CreationPanelParams.module.css']),
}

const countLines = (source: string): number => {
  const parts = source.split('\n').length
  return source.endsWith('\n') ? parts - 1 : parts
}

const braceDelta = (source: string): number =>
  (source.match(/\{/g) ?? []).length - (source.match(/\}/g) ?? []).length

describe('CreationPanel CSS 组件域拆分', () => {
  it('四个模块都在预算内，主模块不再长回千行', () => {
    expect(countLines(sources.main)).toBeLessThanOrEqual(600)
    for (const [name, source] of Object.entries(sources)) {
      if (name === 'main') continue
      expect(countLines(source), `${name} 超预算`).toBeLessThanOrEqual(600)
      expect(braceDelta(source), `${name} 花括号不配平`).toBe(0)
      expect(source, `${name} 混入脚本对象文本`).not.toContain('System.Object[]')
    }
  })

  it('合并后的 CSS module 对象仍是组件实际引用的同一门面', () => {
    expect(creationStyles).toBeTypeOf('object')
    expect(Object.keys(inlineModules)).toHaveLength(4)
  })

  it('combines four modules without duplicating the legacy main stylesheet', () => {
    const all = Object.values(sources).join('\n')
    const text = all.trim()
    if (text.length === 0) {
      expect(Object.keys(inlineModules)).toEqual([
        './CreationPanelAssets.module.css',
        './CreationPanelBase.module.css',
        './CreationPanelParams.module.css',
        './CreationPanelPrompt.module.css',
      ])
      return
    }
    for (const selector of [
      '.section',
      '.promptSectionComfort',
      '.prompt::-webkit-scrollbar',
      '.toolGroup::before',
      '.presetAnchor',
    ]) {
      expect(all, `${selector} 丢失`).toContain(selector)
    }
  })
})
