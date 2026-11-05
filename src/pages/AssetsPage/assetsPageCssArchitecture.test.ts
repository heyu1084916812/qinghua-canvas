import { describe, expect, it } from 'vitest'
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
const parts = (names: readonly string[]) =>
  Object.fromEntries(names.map((name) => [`./${name}.module.css`, sourceOf(`./${name}.module.css`)]))

const ASSETS_PARTS = parts(['AssetsPageShell', 'AssetsPageShellDetails', 'AssetsPageCards', 'AssetsPagePreview', 'AssetsMasonry'])
const KITS_PARTS = parts(['ContextKitsShell', 'ContextKitsEditor', 'ContextKitsAssets'])
const KIT_DIALOG_SOURCE = (
  import.meta.glob('./ContextKitsDialog.tsx', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>
)['./ContextKitsDialog.tsx']

const countLines = (source: string) =>
  source.endsWith('\n') ? source.split('\n').length - 1 : source.split('\n').length

describe('素材页 CSS 模块结构护栏', () => {
  it('素材页样式拆成四份，套件弹窗拆成三份', () => {
    expect(Object.keys(ASSETS_PARTS)).toHaveLength(5)
    expect(Object.keys(KITS_PARTS)).toHaveLength(3)
    for (const [path, source] of [...Object.entries(ASSETS_PARTS), ...Object.entries(KITS_PARTS)]) {
      expect(source, path).toBeTypeOf('string')
      if (source) {
        expect(countLines(source), path).toBeLessThanOrEqual(600)
        expect(source.match(/\{/g)?.length ?? 0, path).toBe(source.match(/\}/g)?.length ?? 0)
        expect(source).not.toContain('System.Object[]')
      }
    }
    for (const name of ['ContextKitsShell', 'ContextKitsEditor', 'ContextKitsAssets']) {
      expect(KIT_DIALOG_SOURCE, name).toContain(`./${name}.module.css`)
    }
  })

  it('套件弹窗合并全部组件样式模块', () => {
    expect(Object.keys(rawModules)).toEqual(expect.arrayContaining([
      './AssetsPage.module.css',
      './ContextKitsDialog.module.css',
      './ContextKitsShell.module.css',
      './ContextKitsEditor.module.css',
      './ContextKitsAssets.module.css',
    ]))
    expect(KIT_DIALOG_SOURCE).toContain('const styles = {')
    expect(KIT_DIALOG_SOURCE).toContain('...baseStyles')
    for (const name of ['ContextKitsShell', 'ContextKitsEditor', 'ContextKitsAssets']) {
      expect(KIT_DIALOG_SOURCE, name).toContain(`${name[0].toLowerCase()}${name.slice(1)}Styles`)
    }
  })
})
