// @ts-expect-error -- 项目刻意不引入 @types/node；CSS 源码静态取证只属于测试。
import { readFileSync } from 'node:fs'
// @ts-expect-error -- 同上：path 仅用于把源码路径锚定到仓库根。
import { dirname, resolve } from 'node:path'
// @ts-expect-error -- 同上：url 用于把测试文件 URL 转成源码根路径。
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const readSource = (file: string) => readFileSync(resolve(repoRoot, file), 'utf8')
const PART_NAMES = [
  'SettingsChannelList',
  'SettingsChannelListDetails',
  'SettingsRoutePolicy',
  'SettingsChannelForm',
  'SettingsChannelWorkspace',
  'SettingsModelBinding',
  'SettingsGlobalModelManager',
  'SettingsModelMapping',
  'SettingsModelCategory',
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

  it('组件样式拆成九份且每份不超过预算', () => {
    expect(Object.keys(PART_SOURCES)).toHaveLength(10)
    for (const [path, source] of Object.entries(PART_SOURCES)) {
      expect(source, path).toBeTypeOf('string')
      if (source) {
        expect(countLines(source), path).toBeLessThanOrEqual(600)
        expect(source.match(/\{/g)?.length ?? 0).toBe(source.match(/\}/g)?.length ?? 0)
        expect(source).not.toContain('System.Object[]')
      }
    }
  })

  it('映射行区跟内容走、只在过长时封顶滚动，且不许拦滚轮', () => {
    /* CSS 模块在 vitest 里是映射对象，`?inline` / `?raw` 都拿不到原文；直接读磁盘 */
    const source = readSource('src/pages/SettingsPage/SettingsModelBinding.module.css')
    const block = source.match(/\.mappingRows\s*\{([\s\S]*?)\}/)?.[1] ?? ''
    expect(block, '缺少 .mappingRows 规则').toBeTruthy()
    /* 用户 2026-11-18 三轮口径：1 行的分类不许拖着 384px 的空白 → 跟内容走，只封顶 */
    expect(block).toMatch(/(^|\s)max-height:\s*min\(/)
    expect(block).not.toMatch(/(^|\s)height:\s*clamp\(/)
    /* 超长分类在自己的滚动区里滚 */
    expect(block).toContain('overflow-y: auto')
    /* ★ `overscroll-behavior: contain` 会把滚轮拦在行区里 —— 鼠标停在映射区整页滚不动（用户 2026-11-19 报的 bug） */
    expect(block).not.toContain('overscroll-behavior: contain')
  })

  it('样式门面继续合并全部组件样式模块', () => {
    for (const name of PART_NAMES) {
      expect(STYLE_FACADE, name).toContain(`../${name}.module.css`)
      expect(STYLE_FACADE, name).toContain(`${name[0].toLowerCase()}${name.slice(1)}Styles`)
    }
  })

  it('uses global color and control-radius tokens', () => {
    for (const [path, source] of Object.entries(PART_SOURCES)) {
      const declarations = source.replace(/\/\*[\s\S]*?\*\//g, '')
      expect(declarations, path).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i)
      expect(declarations, path).not.toMatch(/border-radius:\s*\d+px\b/)
    }
  })
})
