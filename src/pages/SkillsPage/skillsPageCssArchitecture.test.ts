import { describe, expect, it } from 'vitest'
// @ts-expect-error -- 项目刻意不引入 @types/node；CSS 源码静态取证只属于测试。
import { readFileSync } from 'node:fs'
const rawModules = import.meta.glob('./*.module.css', {
  eager: true,
  query: '?inline',
}) as Record<string, unknown>
const sourceOf = (path: string): string => {
  const value = rawModules[path]
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) {
      if (typeof nested === 'string') return nested
    }
  }
  return ''
}
const PART_NAMES = [
  'SkillsPageShell',
  'SkillsPageSharedControls',
  'SkillsPageCards',
  'SkillsDetailEditor',
] as const
const PART_SOURCES = Object.fromEntries(
  PART_NAMES.map((name) => [`./${name}.module.css`, sourceOf(`./${name}.module.css`)]),
)
const countLines = (source: string) =>
  source.endsWith('\n') ? source.split('\n').length - 1 : source.split('\n').length

describe('技能页 CSS 模块结构护栏', () => {
  it('主模块保留组合门面且不超过预算', () => {
    for (const [path, source] of Object.entries(PART_SOURCES)) {
      expect(source, path).toBeTypeOf('string')
      expect(source, path).not.toContain('System.Object[]')
    }
  })

  it('四份组件样式均不超过预算且括号配平', () => {
    expect(Object.keys(PART_SOURCES)).toHaveLength(4)
    for (const [path, source] of Object.entries(PART_SOURCES)) {
      expect(source, path).toBeTypeOf('string')
      if (source) {
        expect(countLines(source), path).toBeLessThanOrEqual(600)
        expect(source.match(/\{/g)?.length ?? 0, path).toBe(source.match(/\}/g)?.length ?? 0)
        expect(source).not.toContain('System.Object[]')
      }
    }
  })

  it('组件样式模块保留页面、卡片和详情编辑类名', () => {
    expect(Object.keys(rawModules)).toEqual(expect.arrayContaining([
      './SkillsPage.module.css',
      ...PART_NAMES.map((name) => `./${name}.module.css`),
    ]))
  })

  it('卡片正文不拦截 hover 操作按钮的命中', () => {
    const shell = readFileSync(
      new URL('./SkillsPageShell.module.css', import.meta.url),
      'utf8',
    )
    expect(shell).toMatch(/\.cardBody\s*\{[\s\S]*?pointer-events:\s*none;/)
    expect(shell).toMatch(/\.cardShot\s*\{[\s\S]*?pointer-events:\s*none;/)
    expect(shell).toMatch(/\.card:hover \.cardActions,[\s\S]*?pointer-events:\s*auto;/)
  })
})
