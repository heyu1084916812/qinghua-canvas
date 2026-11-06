import type { GenerationData } from '../../../../domain/canvas/model/node'
import type { PanelModel } from '../panelModel'
import { CATEGORY_OPTIONS } from './creationCatalog'
import { creationStyles as styles } from './creationStyles'
import { CollectionCard, Thumb } from './CreationAssetViews'

type CategoryMode = 'image' | 'video'

interface CreationAssetsViewProps {
  assetsEmpty: boolean
  emptyHint: string
  collections: PanelModel['collections']
  thumbs: PanelModel['thumbs']
  dragIndex: number | null
  mode: GenerationData['mode']
  showCategoryToggle?: boolean
  onDragStart: (index: number) => void
  onDrop: (index: number) => void
  onToggleCollection: (id: string) => void
  onToggleThumb: (owner: PanelModel['thumbs'][number]['owner'], id: string) => void
  onRemoveThumb: (owner: PanelModel['thumbs'][number]['owner'], id: string) => void
  onModeChange: (mode: CategoryMode) => void
}

export function CreationAssetsView({
  assetsEmpty,
  emptyHint,
  collections,
  thumbs,
  dragIndex,
  mode,
  showCategoryToggle,
  onDragStart,
  onDrop,
  onToggleCollection,
  onToggleThumb,
  onRemoveThumb,
  onModeChange,
}: CreationAssetsViewProps) {
  return (
    <section className={`${styles.section} ${styles.assetsSection}`} data-panel-part="assets">
      <div className={styles.assetsHead} data-panel-assets-head>
        {assetsEmpty ? (
          <div className={styles.assetEmpty} data-panel-asset-empty>
            {emptyHint}
          </div>
        ) : (
          <div className={styles.thumbs}>
            {collections.map((collection) => (
              <CollectionCard
                key={`collection:${collection.id}`}
                collection={collection}
                onToggle={() => onToggleCollection(collection.id)}
              />
            ))}
            {thumbs.map((thumb, index) => (
              <Thumb
                key={`${thumb.owner}:${thumb.id}`}
                thumb={thumb}
                index={index}
                dragging={dragIndex === index}
                onDragStart={() => onDragStart(index)}
                onDrop={() => onDrop(index)}
                onToggle={() => onToggleThumb(thumb.owner, thumb.id)}
                onRemove={() => onRemoveThumb(thumb.owner, thumb.id)}
              />
            ))}
          </div>
        )}
        {showCategoryToggle && (
          <div className={styles.category} role="group" aria-label="功能类别">
            {CATEGORY_OPTIONS.map((category) => (
              <button
                key={category.value}
                type="button"
                className={
                  mode === category.value
                    ? `${styles.catBtn} ${styles.catOn}`
                    : styles.catBtn
                }
                data-param-mode={category.value}
                aria-pressed={mode === category.value}
                title={`切换为${category.label}生成`}
                onClick={() => onModeChange(category.value)}
              >
                {category.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
