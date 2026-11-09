import type { ConversationResearchItem } from './conversation'
import styles from './ResearchResultsPreview.module.css'

export function ResearchResultsPreview({
  items,
  limit,
}: {
  items: readonly ConversationResearchItem[]
  limit: number
}) {
  if (items.length === 0) return null
  return (
    <div
      className={styles.grid}
      data-agent-research-results
      data-agent-research-count={items.length}
    >
      {items.slice(0, limit).map((item) => (
        <a
          key={item.id}
          className={styles.item}
          href={item.url}
          target="_blank"
          rel="noreferrer"
          data-agent-research-item={item.source}
          title={item.description || item.title}
        >
          {item.imageUrl ? (
            <img
              src={item.imageUrl}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className={styles.textPreview}>
              {item.description || item.title}
            </span>
          )}
          <span className={styles.source}>{item.source}</span>
        </a>
      ))}
    </div>
  )
}
