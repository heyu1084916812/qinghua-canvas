import { useState } from 'react'
import { IconCheck, IconPlus, IconSpinner } from '../../toolbar/icons'
import { agentResearchSourceLabel } from './agentResearchSourceLabel'
import type { ConversationResearchItem } from './conversation'
import styles from './ResearchResultsPreview.module.css'

export function ResearchResultsPreview({
  items,
  limit,
  onAdd,
}: {
  items: readonly ConversationResearchItem[]
  limit: number
  onAdd?: (
    item: ConversationResearchItem,
  ) => Promise<{ ok: boolean; message: string }>
}) {
  const [addingId, setAddingId] = useState<string | null>(null)
  const [addedIds, setAddedIds] = useState<Set<string>>(() => new Set())
  const [message, setMessage] = useState('')
  if (items.length === 0) return null
  const add = async (item: ConversationResearchItem) => {
    if (!onAdd || addingId) return
    setAddingId(item.id)
    setMessage('')
    const result = await onAdd(item)
    setAddingId(null)
    setMessage(result.message)
    if (result.ok) {
      setAddedIds((current) => new Set([...current, item.id]))
    }
  }
  return (
    <div>
      <div
        className={styles.grid}
        data-agent-research-results
        data-agent-research-count={items.length}
      >
        {items.slice(0, limit).map((item) => (
          <div
            key={item.id}
            className={styles.card}
            data-agent-research-item={item.source}
          >
            <a
              className={styles.item}
              href={item.url}
              target="_blank"
              rel="noreferrer"
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
              <span className={styles.source}>{agentResearchSourceLabel(item.source)}</span>
            </a>
            {onAdd ? (
              <button
                type="button"
                className={styles.add}
                data-agent-research-add={item.id}
                data-added={addedIds.has(item.id) ? 'true' : 'false'}
                aria-label={addedIds.has(item.id) ? '已加入项目参考' : '加入项目参考'}
                title={addedIds.has(item.id) ? '已加入项目参考' : '加入项目参考'}
                disabled={addingId !== null}
                onClick={() => void add(item)}
              >
                {addingId === item.id ? (
                  <IconSpinner size={13} />
                ) : addedIds.has(item.id) ? (
                  <IconCheck size={13} />
                ) : (
                  <IconPlus size={13} />
                )}
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {message ? (
        <p className={styles.message} role="status">
          {message}
        </p>
      ) : null}
    </div>
  )
}
