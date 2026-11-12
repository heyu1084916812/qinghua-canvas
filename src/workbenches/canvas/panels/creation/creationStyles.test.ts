import { describe, expect, it } from 'vitest'
import { creationStyles } from './creationStyles'
// @ts-expect-error Vitest runs this structural test in Node; the web tsconfig omits Node globals.
import { readFileSync } from 'node:fs'

const inlineModules = import.meta.glob('./*.module.css', {
  eager: true,
  query: '?inline',
}) as Record<string, unknown>

const readCss = (url: URL): string => readFileSync(url, 'utf8')

const sources = {
  main: readCss(new URL('../CreationPanel.module.css', import.meta.url)),
  base: readCss(new URL('./CreationPanelBase.module.css', import.meta.url)),
  assets: readCss(new URL('./CreationPanelAssets.module.css', import.meta.url)),
  prompt: readCss(new URL('./CreationPanelPrompt.module.css', import.meta.url)),
  params: readCss(new URL('./CreationPanelParams.module.css', import.meta.url)),
}

const countLines = (source: string): number => {
  const parts = source.split('\n').length
  return source.endsWith('\n') ? parts - 1 : parts
}

const braceDelta = (source: string): number =>
  (source.match(/\{/g) ?? []).length - (source.match(/\}/g) ?? []).length

const ruleBody = (source: string, selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return source.match(new RegExp(`${escaped}[^\\s,{]*\\s*\\{([^}]*)\\}`))?.[1] ?? ''
}

const expectFlexFill = (source: string, selector: string): void => {
  const body = ruleBody(source, selector)
  expect(body, `${selector} 未声明 flex: 1 1 0`).toMatch(
    /flex:\s*1\s+1\s+0(?:px|%)?\s*;/,
  )
  expect(body, `${selector} 未允许在固定外壳内收缩`).toMatch(
    /min-height:\s*0(?:px|%)?\s*;/,
  )
}

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

  it('固定高度链的每个中间层都使用 flex-basis: 0', () => {
    for (const [source, selector] of [
      [sources.main, '.promptSection'],
      [sources.main, '.promptSectionComfort'],
      [sources.base, '.promptSection'],
      [sources.base, '.promptSectionComfort'],
      [sources.prompt, '.promptRow'],
      [sources.prompt, '.promptBox'],
      [sources.prompt, '.promptBoxComfort'],
    ]) {
      expectFlexFill(source, selector)
    }

    const editor = ruleBody(sources.prompt, '.prompt.promptEditor')
    expect(editor).toMatch(/flex:\s*1\s+1\s+0(?:px|%)?\s*;/)
    expect(editor).toMatch(/min-height:\s*0(?:px|%)?\s*;/)
    expect(editor).toMatch(/max-height:\s*none\s*;/)
    expect(editor).toMatch(/overflow-y:\s*auto\s*;/)
  })

  it('不再使用 field-sizing 让编辑器内容反向撑高固定面板', () => {
    expect(sources.prompt).not.toContain('field-sizing')
  })

  it('组件域之间不重复导出同名 CSS 类键', () => {
    const owners = new Map<string, string[]>()
    for (const domain of ['base', 'assets', 'prompt', 'params'] as const) {
      const source = sources[domain]
      const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '')
      for (const match of withoutComments.matchAll(/\.([A-Za-z_][\w-]*)/g)) {
        const classNames = owners.get(match[1]) ?? []
        if (!classNames.includes(domain)) classNames.push(domain)
        owners.set(match[1], classNames)
      }
    }
    const duplicates = [...owners]
      .filter(([, domains]) => domains.length > 1)
      .map(([className, domains]) => `${className}: ${domains.join(', ')}`)
    expect(duplicates).toEqual([])
  })
})
