import { openUrl } from '@tauri-apps/plugin-opener'
import type { ClipperItem } from '../../../domain/inspiration/clipper'
import {
  IconChat,
  IconCheck,
  IconDelete,
  IconImage,
  IconPlus,
} from '../../../workbenches/canvas/toolbar/icons'
import styles from './ClipperItemCard.module.css'

export function ClipperItemCard({
  item,
  busy,
  selectable = false,
  selected = false,
  onToggleSelect,
  onAgent,
  onReference,
  onCanvas,
  onRemove,
}: {
  item: ClipperItem
  busy: boolean
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: () => void
  onAgent: () => void
  onReference: () => void
  onCanvas: () => void
  onRemove: () => void
}) {
  return (
    <article
      className={styles.item}
      data-clipper-item={item.id}
      data-clipper-selected={selected ? 'true' : 'false'}
      data-selected={selected ? 'true' : 'false'}
    >
      <button
        type="button"
        className={styles.media}
        aria-label={selectable ? `选择 ${item.title}` : `打开来源：${item.title}`}
        aria-pressed={selectable ? selected : undefined}
        title={selectable ? undefined : item.title}
        onClick={() => {
          if (selectable) onToggleSelect?.()
          else void openUrl(item.url)
        }}
      >
        <img src={item.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
        {selectable && selected ? (
          <span className={styles.selectCheck} data-clipper-select-check>
            <IconCheck size={14} />
          </span>
        ) : null}
      </button>
      <div className={styles.itemBody}>
        <strong>{item.title}</strong>
        <span>{selectable ? item.category : hostOf(item.url)}</span>
        {selectable ? null : <div className={styles.itemActions}>
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
        </div>}
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
