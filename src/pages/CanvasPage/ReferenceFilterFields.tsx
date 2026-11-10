import type { ReferenceKind, ReferenceSource } from '../../domain/project/referenceLedger'
import { IconSliders } from '../../workbenches/canvas/toolbar/icons'
import styles from './ReferenceFilterFields.module.css'

export type ReferenceSourceFilter =
  | 'file'
  | 'link'
  | 'asset'
  | 'connector'
export type ReferenceKindFilter =
  | 'image'
  | 'video'
  | 'document'
  | 'color'
  | 'font'
  | 'audio'

export const REFERENCE_SOURCE_FILTERS: readonly {
  value: ReferenceSourceFilter
  label: string
}[] = [
  { value: 'file', label: '文件' },
  { value: 'link', label: '链接' },
  { value: 'asset', label: '资产' },
  { value: 'connector', label: '连接器' },
]

export const REFERENCE_KIND_FILTERS: readonly {
  value: ReferenceKindFilter
  label: string
}[] = [
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'document', label: '文档' },
  { value: 'color', label: '颜色' },
  { value: 'font', label: '字体' },
  { value: 'audio', label: '音频' },
]

export const KIT_KIND_FILTERS: readonly {
  value: ReferenceKindFilter
  label: string
}[] = REFERENCE_KIND_FILTERS.filter((item) =>
  item.value === 'image' || item.value === 'color' || item.value === 'font')

export const DISABLED_KIT_SOURCES: ReadonlySet<ReferenceSourceFilter> = new Set([
  'file',
  'link',
  'connector',
])

export const DISABLED_KIT_KINDS: ReadonlySet<ReferenceKindFilter> = new Set([
  'video',
  'document',
  'audio',
])

export function ReferenceFilterButton({
  scope,
  open,
  label,
  onToggle,
}: {
  scope: 'source' | 'kit'
  open: boolean
  label: string
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className={styles.filterButton}
      data-reference-filter-trigger={scope}
      aria-label={label}
      title={label}
      aria-expanded={open}
      onClick={onToggle}
    >
      <IconSliders size={17} />
    </button>
  )
}

export function ReferenceFilterFields({
  scope,
  sourceValues,
  kindValues,
  sourceOptions = REFERENCE_SOURCE_FILTERS,
  kindOptions = REFERENCE_KIND_FILTERS,
  disabledSources = new Set(),
  disabledKinds = new Set(),
  onToggleSource,
  onToggleKind,
}: {
  scope: 'source' | 'kit'
  sourceValues: ReadonlySet<ReferenceSourceFilter>
  kindValues: ReadonlySet<ReferenceKindFilter>
  sourceOptions?: readonly {
    value: ReferenceSourceFilter
    label: string
  }[]
  kindOptions?: readonly {
    value: ReferenceKindFilter
    label: string
  }[]
  disabledSources?: ReadonlySet<ReferenceSourceFilter>
  disabledKinds?: ReadonlySet<ReferenceKindFilter>
  onToggleSource: (value: ReferenceSourceFilter) => void
  onToggleKind: (value: ReferenceKindFilter) => void
}) {
  return (
    <div
      className={styles.filters}
      data-reference-filter-panel={scope}
    >
      <fieldset>
        <legend>按来源</legend>
        {sourceOptions.map((option) => {
          const disabled = disabledSources.has(option.value)
          return (
            <label
              key={option.value}
              className={disabled ? styles.disabled : undefined}
            >
              <input
                type="checkbox"
                data-reference-filter-source={option.value}
                checked={sourceValues.has(option.value)}
                disabled={disabled}
                onChange={() => onToggleSource(option.value)}
              />
              {option.label}
            </label>
          )
        })}
      </fieldset>
      <fieldset>
        <legend>按类型</legend>
        {kindOptions.map((option) => {
          const disabled = disabledKinds.has(option.value)
          return (
            <label
              key={option.value}
              className={disabled ? styles.disabled : undefined}
            >
              <input
                type="checkbox"
                data-reference-filter-kind={option.value}
                checked={kindValues.has(option.value)}
                disabled={disabled}
                onChange={() => onToggleKind(option.value)}
              />
              {option.label}
            </label>
          )
        })}
      </fieldset>
    </div>
  )
}

export function kitFilterGroupVisible(
  sources: ReadonlySet<ReferenceSourceFilter>,
  kinds: ReadonlySet<ReferenceKindFilter>,
  kind: 'image' | 'color' | 'font',
): boolean {
  return (sources.size === 0 || sources.has('asset'))
    && (kinds.size === 0 || kinds.has(kind))
}

export function referenceSourceFilter(source: ReferenceSource): ReferenceSourceFilter {
  if (source === 'file') return 'file'
  if (source === 'link' || source === 'webFetch' || source === 'search') return 'link'
  if (source === 'asset' || source === 'kit') return 'asset'
  return 'connector'
}

export function referenceKindFilter(kind: ReferenceKind): ReferenceKindFilter {
  return kind === 'text' ? 'document' : kind
}

export function matchesReferenceFilters(
  source: ReferenceSource,
  kind: ReferenceKind,
  sources: ReadonlySet<ReferenceSourceFilter>,
  kinds: ReadonlySet<ReferenceKindFilter>,
): boolean {
  const sourceMatches =
    sources.size === 0 || sources.has(referenceSourceFilter(source))
  const kindMatches =
    kinds.size === 0 || kinds.has(referenceKindFilter(kind))
  return sourceMatches && kindMatches
}

export function toggledReferenceFilter<T>(current: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(current)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}
