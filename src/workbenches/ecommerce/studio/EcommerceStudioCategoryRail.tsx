import { styles } from './studioStyles'
import {
  STUDIO_CATEGORIES,
  type StudioCategory,
} from './studioContracts'
import { CategoryGlyph } from './studioSharedViews'

export function EcommerceStudioCategoryRail({
  category,
  onSelect,
}: {
  category: StudioCategory
  onSelect: (category: StudioCategory) => void
}) {
  return (
    <aside className={styles.categoryRail} data-ecommerce-categories>
      {STUDIO_CATEGORIES.map((item) => (
        <button
          key={item.id}
          type="button"
          className={
            item.id === category
              ? `${styles.categoryButton} ${styles.categoryButtonOn}`
              : styles.categoryButton
          }
          data-ecommerce-category={item.id}
          aria-pressed={item.id === category}
          onClick={() => onSelect(item.id)}
        >
          <CategoryGlyph category={item.id} />
          <span>{item.label}</span>
        </button>
      ))}
    </aside>
  )
}
