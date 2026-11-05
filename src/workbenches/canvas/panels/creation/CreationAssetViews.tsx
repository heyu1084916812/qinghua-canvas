/** 创作面板素材条里的缩略图 / 集合卡：只负责局部素材展示，不拥有面板状态。 */
import { useEffect } from 'react'
import { useAsset } from '../../../../features/shared/assets/index'
import { IconClose } from '../../toolbar/icons'
import type { PanelCollection, PanelThumb } from '../panelModel'
import { creationStyles as styles } from './creationStyles'

export function MentionThumb({ hash }: { hash: string | undefined }) {
  const url = useAsset(hash)
  return <span className={styles.mentionThumb}>{url ? <img src={url} alt="" /> : null}</span>
}

export function MentionThumbProbe({
  id,
  hash,
  sink,
  onLoaded,
}: {
  id: string
  hash: string | undefined
  sink: { current: Map<string, string> }
  onLoaded: () => void
}) {
  const url = useAsset(hash)
  useEffect(() => {
    if (!url || sink.current.get(id) === url) return
    sink.current.set(id, url)
    onLoaded()
  }, [id, url, sink, onLoaded])
  return null
}

export function Thumb({
  thumb,
  index,
  dragging,
  onDragStart,
  onDrop,
  onToggle,
  onRemove,
}: {
  thumb: PanelThumb
  index: number
  dragging: boolean
  onDragStart: () => void
  onDrop: () => void
  onToggle: () => void
  onRemove: () => void
}) {
  const url = useAsset(thumb.assetHash)
  return (
    <div
      className={[styles.thumb, dragging ? styles.thumbDragging : '', thumb.visible ? '' : styles.thumbHidden]
        .filter(Boolean)
        .join(' ')}
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      data-panel-thumb={thumb.id}
    >
      <span className={styles.thumbFrame}>
        {url ? (
          <img src={url} alt="" draggable={false} />
        ) : (
          <span className={styles.thumbText} title={thumb.text}>
            {thumb.text?.trim() ? thumb.text : '空提示词'}
          </span>
        )}
      </span>
      <span className={styles.badge}>{index + 1}</span>
      <button
        type="button"
        className={`${styles.eye} ${styles.eyeAtBottom}`}
        title={thumb.visible ? '本次生成包含该素材' : '本次生成跳过该素材'}
        aria-label={thumb.visible ? '跳过该素材' : '启用该素材'}
        aria-pressed={thumb.visible}
        onClick={(e) => {
          e.stopPropagation()
          onToggle()
        }}
      >
        {thumb.visible ? '👁' : '⃠'}
      </button>
      {thumb.removable && (
        <button
          type="button"
          className={styles.deleteBadge}
          data-thumb-delete={thumb.id}
          title={thumb.owner === 'upstream' ? '移除该上游素材（删除连线）' : '清除素材'}
          aria-label={thumb.owner === 'upstream' ? '移除该上游素材（删除连线）' : '清除素材'}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
        >
          <IconClose size={12} />
        </button>
      )}
    </div>
  )
}

export function CollectionCard({
  collection,
  onToggle,
}: {
  collection: PanelCollection
  onToggle: () => void
}) {
  const label = collection.kind === 'prompt' ? '提示词' : '素材'
  return (
    <div
      className={`${styles.collection} ${collection.visible ? '' : styles.thumbHidden}`}
      data-panel-collection={collection.id}
      data-panel-collection-count={collection.count}
      title={`集合：${collection.count} 个${label}`}
    >
      <span className={styles.collectionBadge}>{collection.count}</span>
      <span className={styles.collectionText}>
        集合
        <br />
        {label}
      </span>
      <button
        type="button"
        className={styles.eye}
        title={collection.visible ? '本次生成包含该集合' : '本次生成跳过该集合'}
        aria-label={collection.visible ? '跳过该集合' : '启用该集合'}
        aria-pressed={collection.visible}
        onClick={(e) => {
          e.stopPropagation()
          onToggle()
        }}
      >
        {collection.visible ? '👁' : '⃠'}
      </button>
    </div>
  )
}
