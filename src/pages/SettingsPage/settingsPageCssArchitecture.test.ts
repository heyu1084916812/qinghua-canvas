import { describe, expect, it } from 'vitest'
const PART_NAMES = [
  'SettingsChannelList',
  'SettingsChannelListDetails',
  'SettingsRoutePolicy',
  'SettingsChannelForm',
  'SettingsModelMapping',
  'SettingsAppearanceSystem',
] as const
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
const PART_SOURCES = Object.fromEntries(
  PART_NAMES.map((name) => [`./${name}.module.css`, sourceOf(`./${name}.module.css`)]),
)
const STYLE_FACADE = (
  import.meta.glob('./settingsPage/settingsPageStyles.ts', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>
)['./settingsPage/settingsPageStyles.ts']

const countLines = (source: string) =>
  source.endsWith('\n') ? source.split('\n').length - 1 : source.split('\n').length

describe('SettingsPage CSS 模块结构护栏', () => {
  it('渠道行主类保留 facade 组合，不被后展开的 Details 模块覆盖', () => {
    const FACADE = (sourceOf('./SettingsPage.module.css') as string)
    expect(STYLE_FACADE).toMatch(
      /\.\.\.settingsChannelListDetailsStyles,\s*[\s\S]*?item:\s*baseStyles\.item/,
    )
    expect(FACADE).toBeTypeOf('string')
  })

  it('主模块只保留类名组合门面', () => {
    for (const source of Object.values(PART_SOURCES)) {
      expect(source).not.toContain('System.Object[]')
    }
  })

  it('组件样式拆成五份且每份不超过预算', () => {
    expect(Object.keys(PART_SOURCES)).toHaveLength(6)
    for (const [path, source] of Object.entries(PART_SOURCES)) {
      expect(source, path).toBeTypeOf('string')
      if (source) {
        expect(countLines(source), path).toBeLessThanOrEqual(600)
        expect(source.match(/\{/g)?.length ?? 0).toBe(source.match(/\}/g)?.length ?? 0)
        expect(source).not.toContain('System.Object[]')
      }
    }
  })

  it('样式门面继续合并全部组件样式模块', () => {
    for (const name of PART_NAMES) {
      expect(STYLE_FACADE, name).toContain(`../${name}.module.css`)
      expect(STYLE_FACADE, name).toContain(`${name[0].toLowerCase()}${name.slice(1)}Styles`)
    }
  })
})
