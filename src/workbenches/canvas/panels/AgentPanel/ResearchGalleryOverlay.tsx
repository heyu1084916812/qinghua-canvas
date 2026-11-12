import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { noticeA11y } from '../../../../domain/ui/notice'
import { IconCheck, IconClose, IconDownload, IconSpinner, IconZoomIn } from '../../toolbar/icons'
import { agentResearchSourceLabel } from './agentResearchSourceLabel'
import type { ConversationResearchItem } from './conversation'
import { researchImageItems, researchHostOf } from './researchGallery'
import { researchSelectionKey } from './researchSelection'
import styles from './ResearchGalleryOverlay.module.css'
import { useResearchGalleryActions } from './useResearchGalleryActions'
import { containResearchTabFocus, useResearchOverlay } from './useResearchOverlay'

interface ActionResult {
  ok: boolean
  message: string
}

/**
 * G-R2：点图 = 勾选（可多选），勾选只挂到输入框；发送时才进参考台账并分析（G-R4）。
 * 发送过的图不再显示勾选框，悬停给「发送至对话 / 添加到参考」。
 */
export interface ResearchGallerySelection {
  selectedKeys: ReadonlySet<string>
  sentKeys: ReadonlySet<string>
  onToggle(item: ConversationResearchItem): void
  onStage(item: ConversationResearchItem): void
}

export function ResearchGalleryOverlay({
  items,
  onClose,
  onAdd,
  onDownload,
  selection,
}: {
  items: readonly ConversationResearchItem[]
  onClose: () => void
  onAdd?: (item: ConversationResearchItem, signal?: AbortSignal) => Promise<ActionResult>
  onDownload?: (item: ConversationResearchItem, signal?: AbortSignal) => Promise<ActionResult>
  selection?: ResearchGallerySelection
}) {
  const images = researchImageItems(items)
  const [preview, setPreview] = useState<ConversationResearchItem | null>(null)
  const [addedIds, setAddedIds] = useState<Set<string>>(() => new Set())
  const actions = useResearchGalleryActions()
  const { busy, status, statusTone } = actions
  const surfaceRef = useRef<HTMLElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const zoomButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  const closePreview = useCallback(() => {
    const itemId = preview?.id
    setPreview(null)
    if (itemId) window.requestAnimationFrame(() => zoomButtonRefs.current.get(itemId)?.focus())
  }, [preview])
  const requestClose = useCallback(() => {
    if (preview) closePreview()
    else {
      actions.abort()
      onClose()
    }
  }, [actions, closePreview, onClose, preview])
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
    undefined,
    '添加到参考失败',
  )
  const download = (item: ConversationResearchItem) =>
    void actions.run(item, 'download', onDownload, undefined, undefined, '下载失败')
  const selectedCount = selection
    ? images.filter((item) => selection.selectedKeys.has(researchSelectionKey(item))).length
    : 0
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
            <p data-agent-research-gallery-hint>
              {images.length} 张图片 · {selectedCount > 0
                ? `已选 ${selectedCount} 张，发送消息时一起分析`
                : '点击图片勾选，可多选'}
            </p>
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
              const key = researchSelectionKey(item)
              const selected = selection?.selectedKeys.has(key) === true
              const sent = selection?.sentKeys.has(key) === true
              const added = addedIds.has(item.id)
              const addBusy = busy?.id === item.id && busy.action === 'add'
              return (
                <figure
                  key={item.id}
                  className={styles.tile}
                  data-agent-research-gallery-image={item.id}
                  data-selected={selected ? 'true' : 'false'}
                  data-sent={sent ? 'true' : 'false'}
                >
                  <button
                    type="button"
                    className={styles.imageButton}
                    data-agent-research-gallery-toggle={item.id}
                    aria-pressed={sent ? undefined : selected}
                    aria-label={sent
                      ? `${item.title}（已发送到对话）`
                      : `${selected ? '取消勾选' : '勾选'} ${item.title}`}
                    disabled={!selection || sent}
                    onClick={() => { if (selection && !sent) selection.onToggle(item) }}
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
                  {selection && !sent ? (
                    <span
                      className={styles.check}
                      data-agent-research-gallery-check={item.id}
                      data-checked={selected ? 'true' : 'false'}
                      aria-hidden="true"
                    >
                      {selected ? <IconCheck size={13} /> : null}
                    </span>
                  ) : null}
                  <button
                    ref={(element) => {
                      if (element) zoomButtonRefs.current.set(item.id, element)
                      else zoomButtonRefs.current.delete(item.id)
                    }}
                    type="button"
                    className={styles.zoom}
                    data-agent-research-gallery-zoom={item.id}
                    aria-label={`查看大图 ${item.title}`}
                    title="查看大图"
                    onClick={() => setPreview(item)}
                  >
                    <IconZoomIn size={15} />
                  </button>
                  {sent && selection ? (
                    <div className={styles.hoverActions} data-agent-research-gallery-sent-actions>
                      <button
                        type="button"
                        data-agent-research-gallery-stage={item.id}
                        disabled={selected}
                        onClick={() => selection.onStage(item)}
                      >
                        {selected ? '已在输入框' : '发送至对话'}
                      </button>
                      {onAdd ? (
                        <button
                          type="button"
                          data-agent-research-gallery-add={item.id}
                          aria-busy={addBusy}
                          disabled={busy !== null || added}
                          onClick={() => add(item)}
                        >
                          {addBusy ? (
                            <><IconSpinner size={13} className={styles.busySpinner} />添加中</>
                          ) : added ? '已添加到参考' : '添加到参考'}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
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
                <button type="button" data-agent-research-gallery-preview-download
                  aria-busy={busy?.id === preview.id && busy.action === 'download'}
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
