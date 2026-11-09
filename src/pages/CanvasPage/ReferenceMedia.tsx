import { useAsset } from '../../features/shared/assets'
import styles from './MyAssetsDrawer.module.css'

export function ReferenceMedia({
  hash,
  title,
  kind,
}: {
  hash?: string
  title: string
  kind: 'image' | 'video'
}) {
  const url = useAsset(hash ?? '')
  if (!url) return <span className={styles.referenceMediaEmpty} />
  return kind === 'video'
    ? <video src={url} muted playsInline preload="metadata" aria-label={title} />
    : <img src={url} alt={title} loading="lazy" />
}
