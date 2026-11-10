import { useAsset } from '../../features/shared/assets'
import styles from './ReferenceSourcePanel.module.css'

export function ReferenceMedia({
  hash,
  url,
  title,
  kind,
}: {
  hash?: string
  url?: string
  title: string
  kind: 'image' | 'video' | 'document'
}) {
  const assetUrl = useAsset(hash ?? '')
  const source = assetUrl ?? url
  if (!source) return <span className={styles.referenceMediaEmpty} />
  return kind === 'video'
    ? <video src={source} muted playsInline preload="metadata" aria-label={title} />
    : kind === 'document'
      ? <span className={styles.referenceLinkPreview}>{title}</span>
      : <img src={source} alt={title} loading="lazy" />
}
