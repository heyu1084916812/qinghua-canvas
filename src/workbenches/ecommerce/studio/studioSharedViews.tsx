import type { ReactNode } from 'react'
import { presetOf } from '../../../domain/project/modelCatalog'
import { ModelIcon } from '../../../features/shared/modelIcon/ModelIcon'
import type { EcommerceSelectOption } from '../EcommerceSelect'
import { DETAIL_HIGHLIGHT_OPTIONS } from '../../../domain/ecommerce/modeOptions'
import { styles } from './studioStyles'
import type { StudioCategory } from './studioContracts'

export function OptionContent({ option }: { option: (typeof DETAIL_HIGHLIGHT_OPTIONS)[number] }) {
  return (
    <span className={styles.optionText}>
      <span className={styles.optionLabel}>{option.label}</span>
      {option.hint ? (
        <span className={styles.optionHint} data-ecommerce-option-hint>
          {option.hint}
        </span>
      ) : null}
    </span>
  )
}

export function modelIconFor(label: string): ReactNode {
  const logicalName = label.split(' · ').at(-1)?.trim() ?? label.trim()
  const preset = presetOf(logicalName)
  return preset ? <ModelIcon vendor={preset.vendor} size={19} /> : undefined
}

export function OptionCheck({ checked }: { checked: boolean }) {
  return (
    <span className={styles.optionMark} aria-hidden="true">
      {checked ? (
        <svg
          width="10"
          height="10"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m3.2 8.2 3.1 3.1 6.5-6.6" />
        </svg>
      ) : null}
    </span>
  )
}

export function textOptions(
  items: readonly { id: string; label: string }[],
): EcommerceSelectOption[] {
  return items.map((item) => ({ value: item.id, label: item.label }))
}

export function CategoryGlyph({ category }: { category: StudioCategory }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  if (category === 'video') {
    return (
      <svg {...common} width={20} height={20} viewBox="0 0 24 24">
        <rect x="3.5" y="5" width="13" height="14" rx="2" />
        <path d="m16.5 9 4-2v10l-4-2Z" />
        <path d="m8 9 4 3-4 3Z" />
      </svg>
    )
  }
  if (category === 'wear') {
    return (
      <svg {...common} width={20} height={20} viewBox="0 0 24 24">
        <path d="M9 4.5 5 7l2 5 1.5-.7V20h7V11.3L17 12l2-5-4-2.5a3 3 0 0 1-6 0Z" />
      </svg>
    )
  }
  return (
    <svg {...common} width={20} height={20} viewBox="0 0 24 24">
      <path d="M5 8.5h14l-1 11H6Z" />
      <path d="M9 8.5V7a3 3 0 0 1 6 0v1.5" />
    </svg>
  )
}
