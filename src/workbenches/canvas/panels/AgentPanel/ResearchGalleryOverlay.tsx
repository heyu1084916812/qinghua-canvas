import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { noticeA11y } from '../../../../domain/ui/notice'
import { IconCheck, IconClose, IconDownload, IconPlus, IconSpinner } from '../../toolbar/icons'
import { agentResearchSourceLabel } from './agentResearchSourceLabel'
import type { ConversationResearchItem } from './conversation'
import { researchImageItems, researchHostOf } from './researchGallery'
import styles from './ResearchGalleryOverlay.module.css'
import { useResearchGalleryActions } from './useResearchGalleryActions'
import { containResearchTabFocus, useResearchOverlay } from './useResearchOverlay'

interface ActionResult {
  ok: boolean
  message: string
}

export function ResearchGalleryOverlay({
  items,
  onClose,
  onAdd,
  onDownload,
  onSendToChat,
}: {
  items: readonly ConversationResearchItem[]
  onClose: () => void
  onAdd?: (item: ConversationResearchItem, signal?: AbortSignal) => Promise<ActionResult>
  onDownload?: (item: ConversationResearchItem, signal?: AbortSignal) => Promise<ActionResult>
  onSendToChat?: (item: ConversationResearchItem, signal?: AbortSignal) => Promise<ActionResult>
}) {
  const images = researchImageItems(items)
  const [preview, setPreview] = useState<ConversationResearchItem | null>(null)
  const [pendingAddId, setPendingAddId] = useState<string | null>(null)
  const [addedIds, setAddedIds] = useState<Set<string>>(() => new Set())
  const [sentId, setSentId] = useState<string | null>(null)
  const actions = useResearchGalleryActions()
  const { busy, status, statusTone } = actions
  const surfaceRef = useRef<HTMLElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const addButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  const imageButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  const restoreButtonFocus = useCallback(
    (buttons: { current: Map<string, HTMLButtonElement> }, itemId: string) => {
      window.requestAnimationFrame(() => buttons.current.get(itemId)?.focus())
    },
    [],
  )
  const closePendingAdd = useCallback(() => {
    const itemId = pendingAddId
    setPendingAddId(null)
    if (itemId) restoreButtonFocus(addButtonRefs, itemId)
  }, [pendingAddId, restoreButtonFocus])
  const closePreview = useCallback(() => {
    const itemId = preview?.id
    setPreview(null)
    if (itemId) restoreButtonFocus(imageButtonRefs, itemId)
  }, [preview, restoreButtonFocus])
  const requestClose = useCallback(() => {
    if (preview) closePreview()
    else if (actions.abort()) {
      setPendingAddId(null)
      onClose()
    }
    else if (pendingAddId) closePendingAdd()
    else onClose()
  }, [actions, closePendingAdd, closePreview, onClose, pendingAddId, preview])
  const overlayBounds = useResearchOverlay(surfaceRef, requestClose)
  useEffect(() => {
    if (preview) {
      previewRef.current?.querySelector<HTMLElement>(
        '[data-agent-research-gallery-preview-close]',
      )?.focus()
    }
  }, [preview])
  const add = (item: ConversationResearchItem) => void actions.run(
    item, 'add', onAdd,
    (result) => { if (result.ok) setAddedIds((current) => new Set([...current, item.id])) },
    () => { setPendingAddId(null); restoreButtonFocus(addButtonRefs, item.id) },
    '加入失败',
  )
  const download = (item: ConversationResearchItem) =>
    void actions.run(item, 'download', onDownload, undefined, undefined, '下载失败')
  const send = (item: ConversationResearchItem) => void actions.run(
    item, 'send', onSendToChat,
    (result) => { if (result.ok) setSentId(item.id) },
    undefined,
    '发送到对话失败',
  )
  return createPortal(
    <div
      className={styles.layer}
      data-agent-research-gallery
      style={overlayBounds}
    >
      <section
        ref={surfaceRef}
        className={styles.surface}
        role="dialog"
        aria-modal="true"
        aria-label="查看图片搜索结果"
        tabIndex={-1}
      >
        <header className={styles.head}>
          <div className={styles.heading}>
            <h2>查看图片搜索结果</h2>
            <p>{images.length} 张图片 · 双击图片放大</p>
          </div>
          <button
            type="button"
            className={styles.close}
            aria-label="关闭图片搜索结果"
            title="关闭"
            onClick={requestClose}
          >
            <IconClose size={17} />
          </button>
        </header>
        {images.length > 0 ? (
          <div className={styles.gallery} data-agent-research-gallery-scroll>
            <div className={styles.masonry} data-agent-research-gallery-grid>
              {images.map((item) => {
              const host = researchHostOf(item.url)
              return (
                <figure
                  key={item.id}
                  className={styles.tile}
                  data-agent-research-gallery-image={item.id}
                  onKeyDown={(event) => {
                    const confirm =
                      pendingAddId === item.id
                        ? event.currentTarget.querySelector<HTMLElement>('[role="dialog"]')
                        : null
                    if (confirm) containResearchTabFocus(confirm, event)
                  }}
                >
                  <button
                    ref={(element) => {
                      if (element) imageButtonRefs.current.set(item.id, element)
                      else imageButtonRefs.current.delete(item.id)
                    }}
                    type="button"
                    className={styles.imageButton}
                    aria-label={`放大查看 ${item.title}`}
                    title="双击放大"
                    onDoubleClick={() => setPreview(item)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return
                      event.preventDefault()
                      setPreview(item)
                    }}
                  >
                    <img
                      src={item.imageUrl}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  </button>
                  <figcaption className={styles.caption}>
                    <span>{item.title}</span>
                    <small>
                      {agentResearchSourceLabel(item.source, item.url)}
                      {host ? ` · ${host}` : ''}
                    </small>
                  </figcaption>
                  {onAdd ? (
                    <button
                      ref={(element) => { if (element) addButtonRefs.current.set(item.id, element); else addButtonRefs.current.delete(item.id) }}
                      type="button" className={styles.add}
                      data-agent-research-gallery-add={item.id}
                      data-added={addedIds.has(item.id) ? 'true' : 'false'}
                      data-busy={busy?.id === item.id && busy.action === 'add' ? 'true' : 'false'}
                      aria-label={addedIds.has(item.id) ? '已加入项目参考' : '加入项目参考'}
                      aria-busy={busy?.id === item.id && busy.action === 'add'}
                      title={addedIds.has(item.id) ? '已加入项目参考' : '加入项目参考'}
                      disabled={busy !== null}
                      onClick={() => pendingAddId === item.id ? closePendingAdd() : setPendingAddId(item.id)}
                    >
                      {busy?.id === item.id && busy.action === 'add' ? <IconSpinner size={14} className={styles.busySpinner} />
                        : addedIds.has(item.id) ? <IconCheck size={14} /> : <IconPlus size={14} />}
                    </button>
                  ) : null}
                  {pendingAddId === item.id ? (
                    <div className={styles.addConfirm} role="dialog" aria-label="加入项目参考">
                      <span>加入项目参考？</span>
                      <div>
                        <button type="button" autoFocus
                          aria-busy={busy?.id === item.id && busy.action === 'add'}
                          disabled={busy !== null} onClick={() => add(item)}>
                          {busy?.id === item.id && busy.action === 'add' ? (
                            <><IconSpinner size={12} className={styles.busySpinner} />加入中</>
                          ) : '加入'}
                        </button>
                        <button type="button" disabled={busy !== null} onClick={closePendingAdd}>取消</button>
                      </div>
                    </div>
                  ) : null}
                  <div className={styles.hoverActions}>
                    {onSendToChat ? (
                      <button
                        type="button" data-agent-research-gallery-send={item.id}
                        aria-busy={busy?.id === item.id && busy.action === 'send'}
                        disabled={busy !== null} onClick={() => send(item)}
                      >
                        {busy?.id === item.id && busy.action === 'send' ? (
                          <><IconSpinner size={13} className={styles.busySpinner} />发送中</>
                        ) : sentId === item.id ? '已发送到对话' : '发送到对话'}
                      </button>
                    ) : null}
                    {onDownload ? (
                      <button
                        type="button" className={styles.download}
                        data-agent-research-gallery-download={item.id} aria-label={`下载 ${item.title}`}
                        aria-busy={busy?.id === item.id && busy.action === 'download'}
                        title="下载图片" disabled={busy !== null} onClick={() => download(item)}
                      >
                        {busy?.id === item.id && busy.action === 'download'
                          ? <IconSpinner size={15} className={styles.busySpinner} /> : <IconDownload size={15} />}
                      </button>
                    ) : null}
                  </div>
                </figure>
              )
              })}
            </div>
          </div>
        ) : (
          <p className={styles.empty}>这次没有可展示的图片结果。</p>
        )}
        {status ? (
          <p className={styles.status} data-agent-research-gallery-status {...noticeA11y(statusTone)}>{status}</p>
        ) : null}
        {preview ? (
          <div ref={previewRef} className={styles.preview} data-agent-research-gallery-preview
            onKeyDown={(event) => containResearchTabFocus(event.currentTarget, event)}>
            <button type="button" className={styles.previewBackdrop} aria-label="关闭大图" onClick={closePreview} />
            <img src={preview.imageUrl} alt={preview.title} referrerPolicy="no-referrer" />
            <div className={styles.previewBar}>
              <span>{preview.title}</span>
              {onDownload ? (
                <button type="button" aria-busy={busy?.id === preview.id && busy.action === 'download'}
                  disabled={busy !== null} onClick={() => download(preview)}>
                  {busy?.id === preview.id && busy.action === 'download'
                    ? <IconSpinner size={15} className={styles.busySpinner} /> : <IconDownload size={15} />}
                  {busy?.id === preview.id && busy.action === 'download' ? '下载中' : '下载'}
                </button>
              ) : null}
              <button type="button" data-agent-research-gallery-preview-close autoFocus onClick={closePreview}>
                <IconClose size={15} />关闭
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>,
    document.body,
  )
}
