import { useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { IconLink } from '../../toolbar/icons'
import type { ConversationResearchItem } from './conversation'
import { researchHostOf } from './researchGallery'
import { openResearchSource } from './ResearchSourcesDrawer'
import styles from './ResearchSourcePreviewList.module.css'

/** G-R5：「N 个网页」展开后只列前 5 条来源，其余收进「+N 更多」（点开右侧来源面板）。 */
export const RESEARCH_SOURCE_INLINE_LIMIT = 5

export function ResearchSourcePreviewList({
  items,
  onMore,
}: {
  items: readonly ConversationResearchItem[]
  onMore(): void
}) {
  const [error, setError] = useState('')
  const desktop = isTauri()
  const shown = items.slice(0, RESEARCH_SOURCE_INLINE_LIMIT)
  const rest = items.length - shown.length
  return (
    <div className={styles.list} data-agent-research-source-preview>
      {shown.map((item) => {
        const host = researchHostOf(item.url)
        return (
          <a
            key={item.id}
            className={styles.row}
            data-agent-research-source-link={item.url}
            href={item.url}
            target="_blank"
            rel="noreferrer"
            title={item.title}
            onClick={(event) => {
              if (!desktop) return
              event.preventDefault()
              setError('')
              void openResearchSource(item.url).then((result) => {
                if (!result.ok) setError(result.message)
              })
            }}
          >
            <IconLink size={12} />
            <span className={styles.title}>{item.title}</span>
            {host ? <span className={styles.host}>{host}</span> : null}
          </a>
        )
      })}
      {rest > 0 ? (
        <button type="button" className={styles.more} data-agent-research-more onClick={onMore}>
          +{rest} 更多
        </button>
      ) : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </div>
  )
}
