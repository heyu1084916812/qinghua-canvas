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
        {kindOptions.map((option) => (
          <label key={option.value}>
            <input
              type="checkbox"
              data-reference-filter-kind={option.value}
              checked={kindValues.has(option.value)}
              onChange={() => onToggleKind(option.value)}
            />
            {option.label}
          </label>
        ))}
      </fieldset>
    </div>
  )
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

export function toggledReferenceFilter<T>(current: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(current)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}
