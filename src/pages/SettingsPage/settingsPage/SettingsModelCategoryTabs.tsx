import { useRef, type KeyboardEvent } from 'react'
import type { PresetModel } from '../../../domain/project/modelPresets'
import { FolderTabMorphLayer, FolderTabShape } from './FolderTabShape'
import { useFolderTabMorph } from './useFolderTabMorph'
import { settingsPageStyles as styles } from './settingsPageStyles'

export type ModelCategoryTab = {
  category: PresetModel['category']
  label: string
  count: number
}

const MODEL_CATEGORY_PANEL_ID = 'settings-model-category-panel'

/**
 * 模型映射的分类标签：和 Key 分组同一套文件夹标签（SVG 斜边 + 弹簧形变 + 文字上抬），
 * 只是每枚标签后面多一个数量徽章（数量常显，不是选中态专属）。
 */
export function SettingsModelCategoryTabs({
  tabs,
  activeCategory,
  onChange,
}: {
  tabs: readonly ModelCategoryTab[]
  activeCategory: PresetModel['category'] | null
  onChange: (category: PresetModel['category']) => void
}) {
  const { tabRefs, tabsHostRef, morphSvgRef, morphPathRef, tabSizes } = useFolderTabMorph(
    activeCategory ?? null,
  )
  const listRef = useRef<HTMLDivElement | null>(null)

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number) => {
    let next: number | null = null
    if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = tabs.length - 1
    if (next === null) return
    event.preventDefault()
    const category = tabs[next]?.category
    if (!category) return
    onChange(category)
    requestAnimationFrame(() => {
      listRef.current
        ?.querySelector<HTMLElement>(`[data-route-map-filter="${category}"]`)
        ?.focus({ preventScroll: true })
    })
  }

  return (
    <div
      ref={(element) => {
        listRef.current = element
        tabsHostRef.current = element
      }}
      className={styles.keyGroupTabs}
      role="tablist"
      aria-label="模型分类"
      data-route-map-filters
    >
      {tabs.map((tab, index) => {
        const selected = tab.category === activeCategory
        const size = tabSizes[tab.category]
        return (
          <div
            key={tab.category}
            id={`settings-model-category-tab-${tab.category}`}
            ref={(element) => {
              if (element) tabRefs.current.set(tab.category, element)
              else tabRefs.current.delete(tab.category)
            }}
            role="tab"
            aria-selected={selected}
            aria-controls={MODEL_CATEGORY_PANEL_ID}
            tabIndex={selected ? 0 : -1}
            className={
              selected ? `${styles.keyGroupTab} ${styles.keyGroupTabOn}` : styles.keyGroupTab
            }
            data-route-map-filter={tab.category}
            onClick={() => onChange(tab.category)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <FolderTabShape width={size?.w ?? 120} height={size?.h ?? 40} first={index === 0} />
            <span className={styles.keyGroupTabInner}>
              <span>{tab.label}</span>
              <span className={styles.mappingFilterCount}>{tab.count}</span>
            </span>
          </div>
        )
      })}
      <FolderTabMorphLayer svgRef={morphSvgRef} pathRef={morphPathRef} />
    </div>
  )
}
