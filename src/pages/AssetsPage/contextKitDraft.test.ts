import { describe, expect, it } from 'vitest'
import {
  EMPTY_DRAFT,
  COLOR_FACT_PREFIX,
  FONT_FACT_PREFIX,
  draftFromVersion,
  factsForDraft,
  legacyColors,
  legacyFonts,
  versionLabel,
} from './contextKitDraft'
import type { ContextKit, ContextKitVersion } from '../../domain/shared/context'

const kit = { name: '品牌', description: '说明' } as ContextKit
const version = (overrides: Partial<ContextKitVersion> = {}) =>
  ({
    guide: '指南',
    facts: [],
    colors: [],
    fonts: [],
    resources: [],
    ...overrides,
  }) as ContextKitVersion

describe('上下文套件草稿规则', () => {
  it('旧事实只在缺少新版颜色 / 字体时迁移', () => {
    const facts = [
      { key: `${COLOR_FACT_PREFIX}主色`, value: '#AABBCC' },
      { key: `${FONT_FACT_PREFIX}标题`, value: '粗体' },
      { key: '其它', value: '保留' },
    ]
    expect(legacyColors(facts)[0]).toMatchObject({ name: '主色', value: '#aabbcc' })
    expect(legacyFonts(facts)[0]).toMatchObject({ name: '标题', detail: '粗体' })
    const draft = draftFromVersion(kit, version({ facts }))
    expect(draft.hiddenFacts).toEqual([{ key: '其它', value: '保留' }])
    expect(draft.colors).toHaveLength(1)
    expect(draft.fonts).toHaveLength(1)
    expect(factsForDraft(draft)).toEqual(draft.hiddenFacts)
  })

  it('版本摘要如实区分空套件与有内容的套件', () => {
    expect(versionLabel(null)).toBe('尚未保存')
    expect(versionLabel(version({ guide: '' }))).toBe('空套件')
    expect(versionLabel(version({ guide: '指南', colors: [{ id: 'c', name: '主色', value: '#aabbcc' }] }))).toContain('设计指南 · 1 色')
  })

  it('空草稿不携带任何编辑态', () => {
    expect(EMPTY_DRAFT).toMatchObject({ name: '', description: '', guide: '' })
    expect(EMPTY_DRAFT.resources).toEqual([])
  })
})
