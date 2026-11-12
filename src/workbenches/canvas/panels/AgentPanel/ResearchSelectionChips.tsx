import { IconClose, IconImage } from '../../toolbar/icons'
import type { ConversationResearchItem } from './conversation'
import { researchSelectionKey } from './researchSelection'
import styles from './ResearchSelectionChips.module.css'

/**
 * G-R2：调研浮层里勾选的图片，以小标签挂在 Agent 输入框里（Lovart 的「Image」标签）。
 * 只是待发送的附件：× 取消勾选；发送时才进参考台账并分析（G-R4）。
 */
export function ResearchSelectionChips({
  items,
  onRemove,
}: {
  items: readonly ConversationResearchItem[]
  onRemove(key: string): void
}) {
  if (items.length === 0) return null
  return (
    <div className={styles.row} data-agent-research-selection aria-label="已勾选的参考图片">
      {items.map((item, index) => {
        const key = researchSelectionKey(item)
        return (
          <span key={key} className={styles.chip} data-agent-research-selection-chip={item.id} title={item.title}>
            <span className={styles.thumb} aria-hidden="true">
              <IconImage size={12} />
              <img
                src={item.imageUrl}
                alt=""
                referrerPolicy="no-referrer"
                onError={(event) => { event.currentTarget.hidden = true }}
              />
            </span>
            <span className={styles.label}>图片 {index + 1}</span>
            <button
              type="button"
              className={styles.remove}
              aria-label={`移除 图片 ${index + 1}（${item.title}）`}
              data-agent-research-selection-remove={item.id}
              onClick={() => onRemove(key)}
            >
              <IconClose size={10} />
            </button>
          </span>
        )
      })}
    </div>
  )
}
