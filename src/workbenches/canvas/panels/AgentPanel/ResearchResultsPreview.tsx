import { useState } from 'react'
import { IconChevronRight, IconImage, IconLink } from '../../toolbar/icons'
import { agentResearchSourceLabel } from './agentResearchSourceLabel'
import type { ConversationResearchItem } from './conversation'
import type { ResearchMode } from '../../../../domain/inspiration/designResearch'
import { ResearchGalleryOverlay } from './ResearchGalleryOverlay'
import { researchHostOf, researchImageItems, researchPreviewItems, researchWebItems } from './researchGallery'
import { ResearchSourcesDrawer } from './ResearchSourcesDrawer'
import styles from './ResearchResultsPreview.module.css'

interface ActionResult {
  ok: boolean
  message: string
}

export function ResearchResultsPreview({
  items,
  researchMode,
  onAdd,
  onDownload,
  onSendToChat,
}: {
  items: readonly ConversationResearchItem[]
  /** 旧会话没有模式时按 mixed 处理，保留原有网页来源入口。 */
  researchMode?: ResearchMode
  onAdd?: (item: ConversationResearchItem) => Promise<ActionResult>
  onDownload?: (item: ConversationResearchItem) => Promise<ActionResult>
  onSendToChat?: (item: ConversationResearchItem) => Promise<ActionResult>
}) {
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const images = researchImageItems(items)
  const webItems = researchWebItems(items)
  const previewItems = researchPreviewItems(items)
  const firstSource = webItems[0]
  const mode = researchMode ?? 'mixed'
  const showWebSources = mode !== 'image' && webItems.length > 0

  if (items.length === 0) return null

  return (
    <div
      className={styles.wrap}
      data-agent-research-results
      data-agent-research-count={items.length}
      data-agent-research-mode={mode}
    >
      {showWebSources ? (
        <button
          type="button"
          className={styles.webRow}
          data-agent-research-sources-open
          onClick={() => setSourcesOpen(true)}
        >
          <span className={styles.webIcon} aria-hidden="true">
            <IconLink size={14} />
          </span>
          <span className={styles.webText}>
            <strong>{webItems.length} 个网页</strong>
            <small>
              {firstSource
                ? `${agentResearchSourceLabel(firstSource.source, firstSource.url)} 等来源`
                : '查看网页来源'}
            </small>
          </span>
          <IconChevronRight size={14} />
        </button>
      ) : null}

      {images.length > 0 ? (
        <button
          type="button"
          className={styles.galleryEntry}
          data-agent-research-gallery-open
          onClick={() => setGalleryOpen(true)}
        >
          <span className={styles.thumbs} aria-hidden="true">
            {previewItems.map((item) => (
              <span key={item.id} className={styles.thumb}>
                <IconImage size={14} />
                <img
                  src={item.imageUrl}
                  alt=""
                  loading="eager"
                  decoding="sync"
                  referrerPolicy="no-referrer"
                  onError={(event) => {
                    event.currentTarget.hidden = true
                  }}
                />
              </span>
            ))}
          </span>
          <span className={styles.entryText}>
            <strong>查看图片搜索结果</strong>
            <small>
              {images.length} 张图片
              {showWebSources ? ` · ${webItems.length} 个网页` : ''}
            </small>
          </span>
          <IconChevronRight size={15} />
        </button>
      ) : null}

      {images.length === 0 && showWebSources ? (
        <div className={styles.hosts}>
          {[...new Set(webItems.map((item) => researchHostOf(item.url)).filter(Boolean))]
            .slice(0, 4)
            .join(' · ')}
        </div>
      ) : null}

      {showWebSources && sourcesOpen ? (
        <ResearchSourcesDrawer
          items={webItems}
          onClose={() => setSourcesOpen(false)}
        />
      ) : null}
      {galleryOpen ? (
        <ResearchGalleryOverlay
          items={items}
          onClose={() => setGalleryOpen(false)}
          onAdd={onAdd}
          onDownload={onDownload}
          onSendToChat={onSendToChat}
        />
      ) : null}
    </div>
  )
}
