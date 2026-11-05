/** 多选灯箱缩略图：局部读取素材元信息，不拥有画廊导航状态。 */
import { useAssetMeta } from '../../../features/shared/assets/index'
import { IconImage } from '../toolbar/icons'
import styles from './LightboxLayer.module.css'

export function GalleryThumb({
  item,
  index,
  active,
  onSelect,
}: {
  item: { assetHash: string; nodeId: string; title: string }
  index: number
  active: boolean
  onSelect: (index: number) => void
}) {
  const { url, mime } = useAssetMeta(item.assetHash)
  const video = (mime ?? '').startsWith('video/')
  return (
    <button
      type="button"
      className={active ? styles.galleryThumbOn : styles.galleryThumb}
      data-lightbox-thumbnail={index}
      data-lightbox-thumbnail-active={active ? 'true' : undefined}
      aria-label={`查看第 ${index + 1} 张：${item.title}`}
      aria-current={active ? 'true' : undefined}
      title={item.title}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        onSelect(index)
      }}
    >
      {url ? (
        video ? (
          <video src={url} muted playsInline preload="metadata" />
        ) : (
          <img src={url} alt="" draggable={false} />
        )
      ) : (
        <IconImage size={16} />
      )}
    </button>
  )
}
