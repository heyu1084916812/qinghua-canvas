import { useState } from 'react'
import {
  DISABLED_KIT_KINDS,
  DISABLED_KIT_SOURCES,
  KIT_KIND_FILTERS,
  kitFilterGroupVisible,
  toggledReferenceFilter,
  type ReferenceKindFilter,
  type ReferenceSourceFilter,
} from './ReferenceFilterFields'
import { ReferenceFilterControl } from './ReferenceFilterControl'
import styles from './MyAssetsKitDetail.module.css'

export function useMyAssetsKitFilters(hasContent: boolean) {
  const [sourceFilters, setSourceFilters] = useState<Set<ReferenceSourceFilter>>(new Set())
  const [kindFilters, setKindFilters] = useState<Set<ReferenceKindFilter>>(new Set())
  const showImages = kitFilterGroupVisible(sourceFilters, kindFilters, 'image')
  const showColors = kitFilterGroupVisible(sourceFilters, kindFilters, 'color')
  const showFonts = kitFilterGroupVisible(sourceFilters, kindFilters, 'font')
  const filterEmpty = hasContent && !showImages && !showColors && !showFonts
  const filterControl = (
    <ReferenceFilterControl
      scope="kit"
      label="筛选套件素材"
      sourceValues={sourceFilters}
      kindValues={kindFilters}
      kindOptions={KIT_KIND_FILTERS}
      disabledSources={DISABLED_KIT_SOURCES}
      disabledKinds={DISABLED_KIT_KINDS}
      onToggleSource={(value) => {
        if (!DISABLED_KIT_SOURCES.has(value)) {
          setSourceFilters((current) => toggledReferenceFilter(current, value))
        }
      }}
      onToggleKind={(value) =>
        setKindFilters((current) => toggledReferenceFilter(current, value))}
    />
  )
  return {
    filterControl,
    showImages,
    showColors,
    showFonts,
    filterEmpty,
    clearFilters: () => {
      setSourceFilters(new Set())
      setKindFilters(new Set())
    },
  }
}

export function KitFilterEmpty({ onClear }: { onClear: () => void }) {
  return (
    <div className={styles.filteredEmpty} data-my-assets-kit-filter-empty>
      <span>没有符合筛选的套件内容</span>
      <button type="button" onClick={onClear}>
        清除筛选
      </button>
    </div>
  )
}
