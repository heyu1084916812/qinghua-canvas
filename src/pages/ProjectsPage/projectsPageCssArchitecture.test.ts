import { describe, expect, it } from 'vitest'
import styles from './ProjectsPage.module.css'
import shellStyles from './ProjectsPageShell.module.css'
import toolbarStyles from './ProjectsPageToolbar.module.css'
import cardsStyles from './ProjectsPageCards.module.css'
import overlaysStyles from './ProjectsPageOverlays.module.css'
import trashStyles from './ProjectsPageTrash.module.css'

const PART_NAMES = [
  'ProjectsPageShell',
  'ProjectsPageToolbar',
  'ProjectsPageCards',
  'ProjectsPageOverlays',
  'ProjectsPageTrash',
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

const COMPONENT_SOURCES = (
  import.meta.glob('./{ProjectsPage,ProjectsPageViews}.tsx', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>
)

const countLines = (source: string): number =>
  source.endsWith('\n') ? source.split('\n').length - 1 : source.split('\n').length

describe('ProjectsPage CSS 结构护栏', () => {
  it('主模块与五个组件样式模块全部进入 Vite CSS Module 图', () => {
    expect(Object.keys(rawModules)).toEqual(expect.arrayContaining([
      './ProjectsPage.module.css',
      ...PART_NAMES.map((name) => `./${name}.module.css`),
    ]))
    expect(Object.keys(PART_SOURCES)).toHaveLength(5)
    for (const [path, source] of Object.entries(PART_SOURCES)) {
      expect(source, path).toBeTypeOf('string')
      expect(source, path).not.toContain('System.Object[]')
      if (source) {
        expect(countLines(source), path).toBeLessThanOrEqual(600)
        expect(source.match(/\{/g)?.length ?? 0, path).toBe(source.match(/\}/g)?.length ?? 0)
      }
    }
  })

  it('主 CSS Module 仍导出组件使用的完整类名集合', () => {
    const required = [
      'page', 'main', 'section', 'sectionHead', 'titleGroup', 'sectionTitle',
      'kindFilter', 'kindBtn', 'kindBtnOn', 'kindCount', 'selectToggle',
      'selectToggleOn', 'tools', 'search', 'sort', 'importBtn',
      'empty', 'emptyTitle', 'emptyHint', 'grid', 'newCard', 'newPlus',
      'newLabel', 'card', 'cardSelected', 'thumb', 'cover', 'cardBody',
      'cardName', 'cardMeta', 'renameInput', 'cardActions', 'menuBtn',
      'menu', 'selectMark', 'selectMarkOn', 'menuItem', 'menuDanger',
      'confirm', 'confirmText', 'confirmYes', 'confirmNo', 'status',
      'statusRetry', 'menuBackdrop', 'newMenu', 'bulkBar', 'bulkText',
      'bulkSelectAll', 'bulkBtn', 'bulkDanger', 'dropHint', 'trashPanel',
      'trashHead', 'trashTitle', 'trashHint', 'trashEmpty', 'trashBulk',
      'trashSelectedCount', 'trashList', 'trashItem', 'trashItemSelected',
      'trashCheck', 'trashName', 'trashMeta', 'ghost', 'trashDanger',
      'templateTestBridge',
    ]
    for (const key of required) {
      expect(styles[key as keyof typeof styles], `缺少 ${key}`).toBeTruthy()
    }
  })

  it('组件域模块各自导出关键类名字符串', () => {
    expect(typeof shellStyles.page).toBe('string')
    expect(typeof toolbarStyles.kindBtn).toBe('string')
    expect(typeof cardsStyles.card).toBe('string')
    expect(typeof overlaysStyles.bulkBar).toBe('string')
    expect(typeof trashStyles.trashPanel).toBe('string')
    expect(styles.page).toBeTruthy()
  })

  it('视图与页面仍引用原公共 CSS Module', () => {
    expect(COMPONENT_SOURCES['./ProjectsPage.tsx']).toContain(
      "from './ProjectsPage.module.css'",
    )
    expect(COMPONENT_SOURCES['./ProjectsPageViews.tsx']).toContain(
      "from './ProjectsPage.module.css'",
    )
  })
})
