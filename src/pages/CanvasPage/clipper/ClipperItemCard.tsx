import { openUrl } from '@tauri-apps/plugin-opener'
import type { ClipperItem } from '../../../domain/inspiration/clipper'
import {
  IconChat,
  IconDelete,
  IconImage,
  IconPlus,
} from '../../../workbenches/canvas/toolbar/icons'
import styles from './ClipperPanel.module.css'

export function ClipperItemCard({
  item,
  busy,
  onAgent,
  onReference,
  onCanvas,
  onRemove,
}: {
  item: ClipperItem
  busy: boolean
  onAgent: () => void
  onReference: () => void
  onCanvas: () => void
  onRemove: () => void
}) {
  return (
    <article className={styles.item} data-clipper-item={item.id}>
      <button
        type="button"
        className={styles.media}
        aria-label={`打开来源：${item.title}`}
        title={item.title}
        onClick={() => void openUrl(item.url)}
      >
        <img src={item.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
      </button>
      <div className={styles.itemBody}>
        <strong>{item.title}</strong>
        <span>{hostOf(item.url)}</span>
        <div className={styles.itemActions}>
          <button
            type="button"
            className={styles.action}
            disabled={busy}
            title="加入 Agent 对话"
            aria-label={`把 ${item.title} 加入 Agent 对话`}
            data-clipper-agent={item.id}
            onClick={onAgent}
          >
            <IconChat size={14} />
          </button>
          <button
            type="button"
            className={styles.action}
            disabled={busy}
            title="加入项目参考"
            aria-label={`把 ${item.title} 加入项目参考`}
            data-clipper-reference={item.id}
            onClick={onReference}
          >
            <IconImage size={14} />
          </button>
          <button
            type="button"
            className={styles.action}
            disabled={busy}
            title="放到当前画布"
            aria-label={`把 ${item.title} 放到当前画布`}
            data-clipper-canvas={item.id}
            onClick={onCanvas}
          >
            <IconPlus size={14} />
          </button>
          <button
            type="button"
            className={styles.action}
            disabled={busy}
            title="移除收藏"
            aria-label={`移除 ${item.title}`}
            data-clipper-remove={item.id}
            onClick={onRemove}
          >
            <IconDelete size={14} />
          </button>
        </div>
      </div>
    </article>
  )
}

function hostOf(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./i, '')
  } catch {
    return ''
  }
}
