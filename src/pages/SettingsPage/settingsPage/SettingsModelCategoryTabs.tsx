import { useRef, type KeyboardEvent } from 'react'
import type { PresetModel } from '../../../domain/project/modelPresets'
import { settingsPageStyles as styles } from './settingsPageStyles'

export type ModelCategoryTab = {
  category: PresetModel['category']
  label: string
  count: number
}

const MODEL_CATEGORY_PANEL_ID = 'settings-model-category-panel'

export function SettingsModelCategoryTabs({
  tabs,
  activeCategory,
  onChange,
}: {
  tabs: readonly ModelCategoryTab[]
  activeCategory: PresetModel['category'] | null
  onChange: (category: PresetModel['category']) => void
}) {
  const listRef = useRef<HTMLDivElement | null>(null)

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
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
        ?.querySelector<HTMLButtonElement>(`[data-route-map-filter="${category}"]`)
        ?.focus()
    })
  }

  return (
    <div
      ref={listRef}
      className={styles.mappingFilters}
      role="tablist"
      aria-label="模型分类"
      data-route-map-filters
    >
      {tabs.map((tab, index) => {
        const selected = tab.category === activeCategory
        return (
          <button
            key={tab.category}
            type="button"
            id={`settings-model-category-tab-${tab.category}`}
            role="tab"
            aria-selected={selected}
            aria-controls={MODEL_CATEGORY_PANEL_ID}
            tabIndex={selected ? 0 : -1}
            className={selected ? `${styles.mappingFilter} ${styles.mappingFilterOn}` : styles.mappingFilter}
            data-route-map-filter={tab.category}
            onClick={() => onChange(tab.category)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <span>{tab.label}</span>
            <span className={styles.mappingFilterCount}>{tab.count}</span>
          </button>
        )
      })}
    </div>
  )
}
