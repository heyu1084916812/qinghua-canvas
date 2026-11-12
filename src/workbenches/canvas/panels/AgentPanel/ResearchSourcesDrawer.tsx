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

export const RESEARCH_SOURCE_PREVIEW_ROWS = 6

export type ResearchSourceOpenResult =
  | { ok: true }
  | { ok: false; reason: 'desktop-open-failed' | 'browser-open-failed' | 'popup-blocked'; message: string; cause?: unknown }

export type ResearchSourceOpenEnvironment = {
  desktop: boolean
  openWithDesktop: (url: string) => Promise<void>
  openWithBrowser: (url: string) => Window | null
}

const defaultOpenEnvironment = (): ResearchSourceOpenEnvironment => ({
  desktop: isTauri(),
  openWithDesktop: openUrl,
  openWithBrowser: (url) => window.open(url, '_blank', 'noopener,noreferrer'),
})

export async function openResearchSource(
  url: string,
  environment: ResearchSourceOpenEnvironment = defaultOpenEnvironment(),
): Promise<ResearchSourceOpenResult> {
  try {
    if (environment.desktop) {
      await environment.openWithDesktop(url)
      return { ok: true }
    }
    if (environment.openWithBrowser(url)) return { ok: true }
    return { ok: false, reason: 'popup-blocked', message: '浏览器阻止了新窗口，请允许弹窗后重试' }
  } catch (cause) {
    const desktop = environment.desktop
    return {
      ok: false,
      reason: desktop ? 'desktop-open-failed' : 'browser-open-failed',
      message: desktop ? '系统默认浏览器没有成功打开这个链接，请稍后重试' : '浏览器没有成功打开这个链接，请稍后重试',
      cause,
    }
  }
}

export function ResearchSourceRow({ item, desktop, onOpen }: {
  item: ConversationResearchItem; desktop: boolean; onOpen: (url: string) => void
}) {
  const host = researchHostOf(item.url)
  return (
    <a className={styles.source} data-agent-research-source-link={item.url} href={item.url}
      target="_blank" rel="noreferrer" title={item.title} onClick={(event) => {
        if (!desktop) return
        event.preventDefault()
        onOpen(item.url)
      }}>
      <span className={styles.sourceIcon} aria-hidden="true"><IconLink size={14} /></span>
      <span className={styles.sourceText}>
        <span className={styles.sourceTitle}>{item.title}</span>
        <span className={styles.sourceMeta}>{agentResearchSourceLabel(item.source, item.url)}{host ? ` · ${host}` : ''}</span>
      </span>
      <IconChevronRight size={14} />
    </a>
  )
}

export function ResearchSourcesDrawer({ items, onClose }: {
  items: readonly ConversationResearchItem[]; onClose: () => void
}) {
  const drawerRef = useRef<HTMLElement>(null)
  const bounds = useResearchOverlay(drawerRef, onClose)
  const [error, setError] = useState('')
  const desktop = isTauri()
  const handleOpen = (url: string) => {
    setError('')
    void openResearchSource(url).then((result) => {
      if (!result.ok) setError(result.message)
    })
  }

  return createPortal(
    <div
      className={styles.layer}
      data-agent-research-sources
      style={{
        left: bounds.left,
        top: bounds.top,
        right: bounds.right,
        bottom: bounds.bottom,
      }}
    >
      <button type="button" className={styles.backdrop} aria-label="关闭网页来源" onClick={onClose} />
      <aside ref={drawerRef} className={styles.drawer} role="dialog" aria-modal="true"
        aria-label="联网搜索网页来源" tabIndex={-1}>
        <header className={styles.head}>
          <div><h2>网页来源</h2><p>{items.length} 个可打开页面</p></div>
          <button type="button" className={styles.close} aria-label="关闭网页来源"
            title="关闭" onClick={onClose}>
            <IconClose size={15} />
          </button>
        </header>
        <div className={styles.list} data-agent-research-source-visible-limit={RESEARCH_SOURCE_PREVIEW_ROWS}>
          {items.map((item) => (
            <ResearchSourceRow key={item.id} item={item} desktop={desktop} onOpen={handleOpen} />
          ))}
        </div>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
      </aside>
    </div>,
    document.body,
  )
}
