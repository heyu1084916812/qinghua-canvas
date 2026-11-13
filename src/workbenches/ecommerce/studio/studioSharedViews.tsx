import type { ReactNode } from 'react'
import { presetOf } from '../../../domain/project/modelCatalog'
import { ModelIcon } from '../../../features/shared/modelIcon/ModelIcon'
import type { EcommerceSelectOption } from '../EcommerceSelect'
import { DETAIL_HIGHLIGHT_OPTIONS } from '../../../domain/ecommerce/modeOptions'
import { Check, Icon, Shirt, ShoppingBag, Video } from '../../../ui/icon'
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
        <Icon icon={Check} px={10} />
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
  const glyph = category === 'video' ? Video : category === 'wear' ? Shirt : ShoppingBag
  return <Icon icon={glyph} px={20} />
}
