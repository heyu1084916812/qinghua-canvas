import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { isTauri } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import { IconChevronRight, IconClose, IconLink } from '../../toolbar/icons'
import { agentResearchSourceLabel } from './agentResearchSourceLabel'
import type { ConversationResearchItem } from './conversation'
import { researchHostOf } from './researchGallery'
import styles from './ResearchSourcesDrawer.module.css'
import { useResearchOverlay } from './useResearchOverlay'

async function openExternal(url: string): Promise<string> {
  if (isTauri()) {
    try {
      await openUrl(url)
      return ''
    } catch {
      return '系统浏览器没有成功打开这个链接，请复制地址后重试'
    }
  }
  return window.open(url, '_blank', 'noopener,noreferrer')
    ? ''
    : '浏览器拦截了新窗口，请允许弹窗后重试'
}

export function ResearchSourcesDrawer({
  items,
  onClose,
}: {
  items: readonly ConversationResearchItem[]
  onClose: () => void
}) {
  const drawerRef = useRef<HTMLElement>(null)
  const reservedRight = useResearchOverlay(drawerRef, onClose)
  const [error, setError] = useState('')

  return createPortal(
    <div
      className={styles.layer}
      data-agent-research-sources
      style={{ right: reservedRight }}
    >
      <button
        type="button"
        className={styles.backdrop}
        aria-label="关闭网页来源"
        onClick={onClose}
      />
      <aside
        ref={drawerRef}
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-label="联网搜索网页来源"
        tabIndex={-1}
      >
        <header className={styles.head}>
          <div>
            <h2>网页来源</h2>
            <p>{items.length} 个可打开页面</p>
          </div>
          <button
            type="button"
            className={styles.close}
            aria-label="关闭网页来源"
            title="关闭"
            onClick={onClose}
          >
            <IconClose size={15} />
          </button>
        </header>
        <div className={styles.list}>
          {items.map((item) => {
            const host = researchHostOf(item.url)
            return (
              <a
                key={item.id}
                className={styles.source}
                data-agent-research-source-link={item.url}
                href={item.url}
                target="_blank"
                rel="noreferrer"
                title={item.title}
                onClick={(event) => {
                  if (!isTauri()) return
                  event.preventDefault()
                  setError('')
                  void openExternal(item.url).then(setError)
                }}
              >
                <span className={styles.sourceIcon} aria-hidden="true">
                  <IconLink size={14} />
                </span>
                <span className={styles.sourceText}>
                  <span className={styles.sourceTitle}>{item.title}</span>
                  <span className={styles.sourceMeta}>
                    {agentResearchSourceLabel(item.source, item.url)}
                    {host ? ` · ${host}` : ''}
                  </span>
                </span>
                <IconChevronRight size={14} />
              </a>
            )
          })}
        </div>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </aside>
    </div>,
    document.body,
  )
}
