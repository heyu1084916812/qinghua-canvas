import type {
  ContextKit, ContextKitAsset, ContextKitColor, ContextKitFact,
  ContextKitFont, ContextKitKind, ContextKitVersion,
} from '../../domain/shared/context'

export const KIT_KINDS: { value: ContextKitKind; label: string }[] = [
  { value: 'brand', label: '品牌套件' },
  { value: 'product', label: '产品套件' },
  { value: 'role', label: '角色套件' },
  { value: 'custom', label: '自定义套件' },
]

export const KIT_COPY: Record<
  ContextKitKind,
  {
    namePlaceholder: string
    guideLabel: string
    guidePlaceholder: string
    primaryAssetLabel: string
    primaryAssetHint: string
  }
> = {
  brand: {
    namePlaceholder: '未命名品牌套件',
    guideLabel: '品牌设计指南',
    guidePlaceholder: '写下品牌语气、版式原则、使用场景和明确的禁区。',
    primaryAssetLabel: 'Logo',
    primaryAssetHint: '添加品牌标志或字标',
  },
  product: {
    namePlaceholder: '未命名产品套件',
    guideLabel: '产品资料',
    guidePlaceholder: '写下产品结构、材质、外观特征和不可改变的关键细节。',
    primaryAssetLabel: '产品标志',
    primaryAssetHint: '添加产品标志或关键识别图',
  },
  role: {
    namePlaceholder: '未命名角色套件',
    guideLabel: '角色设定',
    guidePlaceholder: '写下身份、外观、服装、体型和跨画面必须保持一致的细节。',
    primaryAssetLabel: '角色主图',
    primaryAssetHint: '添加角色定妆图或身份基准图',
  },
  custom: {
    namePlaceholder: '未命名自定义套件',
    guideLabel: '套件指南',
    guidePlaceholder: '写下这套内容需要长期保持的规范、事实和视觉约束。',
    primaryAssetLabel: '主素材',
    primaryAssetHint: '添加这套内容的主参考图',
  },
}

export const MAX_ASSET_BYTES = 20 * 1024 * 1024
export const COLOR_FACT_PREFIX = '颜色/'
export const FONT_FACT_PREFIX = '字体/'

export interface Draft {
  name: string
  description: string
  guide: string
  hiddenFacts: ContextKitFact[]
  resources: ContextKitAsset[]
  colors: ContextKitColor[]
  fonts: ContextKitFont[]
}

export const EMPTY_DRAFT: Draft = {
  name: '',
  description: '',
  guide: '',
  hiddenFacts: [],
  resources: [],
  colors: [],
  fonts: [],
}

export function legacyColors(facts: readonly ContextKitFact[]): ContextKitColor[] {
  return facts
    .filter((fact) => fact.key.startsWith(COLOR_FACT_PREFIX))
    .flatMap((fact, index) => {
      if (!/^#[0-9a-f]{6}$/i.test(fact.value.trim())) return []
      return [
        {
          id: `legacy-color-${index}`,
          name: fact.key.slice(COLOR_FACT_PREFIX.length) || '品牌颜色',
          value: fact.value.trim().toLowerCase(),
        },
      ]
    })
}

export function legacyFonts(facts: readonly ContextKitFact[]): ContextKitFont[] {
  return facts
    .filter((fact) => fact.key.startsWith(FONT_FACT_PREFIX))
    .map((fact, index) => ({
      id: `legacy-font-${index}`,
      name: fact.key.slice(FONT_FACT_PREFIX.length) || '品牌字体',
      detail: fact.value,
    }))
}

export function draftFromVersion(kit: ContextKit, version: ContextKitVersion | null): Draft {
  const facts = version?.facts ?? []
  const importedColors = version?.colors.length
    ? version.colors
    : legacyColors(facts)
  const importedFonts = version?.fonts.length ? version.fonts : legacyFonts(facts)
  const managedFacts = new Set([
    ...importedColors.map((color) => `${COLOR_FACT_PREFIX}${color.name}`),
    ...importedFonts.map((font) => `${FONT_FACT_PREFIX}${font.name}`),
  ])
  return {
    name: kit.name,
    description: kit.description,
    guide: version?.guide ?? '',
    hiddenFacts: facts.filter((fact) => !managedFacts.has(fact.key)),
    resources: version?.resources ?? [],
    colors: importedColors,
    fonts: importedFonts,
  }
}

export function factsForDraft(draft: Draft): ContextKitFact[] {
  return [...draft.hiddenFacts]
}

export function versionLabel(version: ContextKitVersion | null): string {
  if (!version) return '尚未保存'
  const parts = [
    version.guide.trim() ? '设计指南' : '',
    version.colors.length ? `${version.colors.length} 色` : '',
    version.fonts.length ? `${version.fonts.length} 字体` : '',
    version.resources.length ? `${version.resources.length} 素材` : '',
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : '空套件'
}
