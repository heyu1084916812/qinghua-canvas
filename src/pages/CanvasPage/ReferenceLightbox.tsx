import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePlatform } from '../../app/providers/PlatformProvider'
import { screenToWorld } from '../../domain/canvas/geometry/coords'
import { latestUsageForItem, type ReferenceItem, type ReferenceUsage } from '../../domain/project/referenceLedger'
import { sendReferenceToAgent } from '../../features/canvas/agentHandoff'
import { dropReferenceToCanvas } from '../../features/canvas/dropImport'
import { useAsset, useAssetMeta } from '../../features/shared/assets'
import { createReferenceLedgerRepository } from '../../state/project/referenceLedgerRepository'
import type { CanvasStore } from '../../state/workbenches/canvas/store'
import {
  IconChevronLeft,
  IconChevronRight,
  IconClose,
  IconImage,
  IconPlus,
} from '../../workbenches/canvas/toolbar/icons'
import styles from './ReferenceLightbox.module.css'

interface Size {
  width: number
  height: number
}

export function ReferenceLightbox({
  projectId,
  store,
  items,
  initialItemId,
  onClose,
}: {
  projectId: string
  store: CanvasStore
  items: readonly ReferenceItem[]
  initialItemId: string
  onClose: () => void
}) {
  const platform = usePlatform()
  const repository = useMemo(
    () => createReferenceLedgerRepository(platform.storage),
    [platform.storage],
  )
  const initialIndex = Math.max(0, items.findIndex((item) => item.id === initialItemId))
  const [index, setIndex] = useState(initialIndex)
  const [usages, setUsages] = useState<ReferenceUsage[]>([])
  const [freshItem, setFreshItem] = useState<ReferenceItem | null>(null)
  const [size, setSize] = useState<Size | null>(null)
  const [mediaError, setMediaError] = useState('')
  const [actionStatus, setActionStatus] = useState('')
  const overlayRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const restoreFocusRef = useRef(true)
  const sourceItem = items[index]
  const item = freshItem?.id === sourceItem?.id ? freshItem : sourceItem
  const meta = useAssetMeta(item?.assetHash)
  const mediaUrl = meta.url ?? item?.url ?? null
  const isVideo = item?.kind === 'video' || (meta.mime ?? '').startsWith('video/')
  const usage = latestUsageForItem(usages, item?.id)
  const dimensionText = size
    ? `${formatNumber(size.width)} × ${formatNumber(size.height)}`
    : mediaUrl || item?.assetHash ? '读取尺寸…' : '尺寸未知'

  useEffect(() => {
    if (!sourceItem?.id) return
    let active = true
    setFreshItem(null)
    void repository.listItems(projectId).then((rows) => {
      if (active) {
        setFreshItem(rows.find((row) => row.id === sourceItem.id) ?? null)
      }
    }).catch(() => {
      if (active) setFreshItem(null)
    })
    return () => { active = false }
  }, [projectId, repository, sourceItem?.id])

  useEffect(() => {
    let active = true
    void repository.listUsages(projectId).then((rows) => {
      if (active) setUsages(rows)
    }).catch(() => {
      if (active) setUsages([])
    })
    return () => { active = false }
  }, [projectId, repository])

  useEffect(() => {
    setSize(null)
    setMediaError('')
    setActionStatus('')
  }, [item?.id])

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        setIndex((current) => wrap(current + (event.key === 'ArrowRight' ? 1 : -1), items.length))
        return
      }
      if (event.key !== 'Tab') return
      const focusable = [...(overlayRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])') ?? [])]
      if (focusable.length === 0) return
      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
      if (restoreFocusRef.current && previous?.isConnected) previous.focus()
    }
  }, [items.length, onClose])

  if (!item || typeof document === 'undefined') return null

  const go = (delta: number) => setIndex((current) => wrap(current + delta, items.length))
  const select = (next: number) => {
    setIndex(next)
    setActionStatus('')
  }
  const addToCanvas = async () => {
    const surface = document.querySelector<HTMLElement>('[data-canvas-surface]')
    if (!surface) {
      setActionStatus('找不到当前画布，无法添加')
      return
    }
    const rect = surface.getBoundingClientRect()
    const world = screenToWorld(
      { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      store.getViewport(),
      { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
    )
    try {
      const result = await dropReferenceToCanvas({ platform, store, projectId }, item.id, world)
      setActionStatus(result.ok ? '已添加到画布' : result.reason)
    } catch (error) {
      setActionStatus(`添加失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }
  const addToAgent = () => {
    try {
      sendReferenceToAgent(projectId, [{ id: item.id, label: item.title }])
      restoreFocusRef.current = false
      onClose()
    } catch (error) {
      setActionStatus(`添加失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  return createPortal(
    <div
      ref={overlayRef}
      className={styles.overlay}
      data-reference-lightbox
      data-reference-lightbox-item={item.id}
      role="dialog"
      aria-modal="true"
      aria-label={`参考详情：${item.title}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <button ref={closeRef} type="button" className={styles.close} data-reference-lightbox-close aria-label="关闭参考详情" title="关闭参考详情" onClick={onClose}>
        <IconClose size={18} />
      </button>
      <div className={styles.layout}>
        <div className={styles.visual}>
          <div className={styles.mediaPane}>
            <button type="button" className={styles.nav} data-reference-lightbox-prev aria-label="上一张参考" title="上一张参考" disabled={items.length < 2} onClick={() => go(-1)}>
              <IconChevronLeft size={18} />
            </button>
            <div className={styles.mediaFrame} data-reference-lightbox-media>
              {mediaUrl && !isVideo ? (
                <img
                  src={mediaUrl}
                  alt={item.title}
                  onLoad={(event) => setSize({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  })}
                  onError={() => setMediaError('图片内容不存在或无法读取')}
                />
              ) : null}
              {mediaUrl && isVideo ? (
                <video
                  src={mediaUrl}
                  controls
                  playsInline
                  preload="metadata"
                  onLoadedMetadata={(event) => setSize({
                    width: event.currentTarget.videoWidth,
                    height: event.currentTarget.videoHeight,
                  })}
                  onError={() => setMediaError('视频内容不存在或无法读取')}
                />
              ) : null}
              {!mediaUrl && !mediaError ? (
                <span className={styles.mediaLoading}>
                  {item.assetHash ? '正在读取素材…' : '这条参考没有可直接预览的媒体'}
                </span>
              ) : null}
              {mediaError ? <span className={styles.mediaError}>{mediaError}</span> : null}
            </div>
            <button type="button" className={styles.nav} data-reference-lightbox-next aria-label="下一张参考" title="下一张参考" disabled={items.length < 2} onClick={() => go(1)}>
              <IconChevronRight size={18} />
            </button>
          </div>
          <div className={styles.thumbs} data-reference-lightbox-thumbs role="group" aria-label="项目参考缩略图">
            {items.map((row, rowIndex) => (
              <LightboxThumb
                key={row.id}
                item={row}
                active={rowIndex === index}
                onClick={() => select(rowIndex)}
              />
            ))}
          </div>
        </div>
        <aside className={styles.info} data-reference-lightbox-info>
          <header>
            <h2 data-reference-lightbox-title>{item.title}</h2>
            <p>{isVideo ? '视频' : '图片'} · {dimensionText}</p>
          </header>
          <section>
            <h3>素材说明</h3>
            <p>{item.what || '还没有素材说明。'}</p>
          </section>
          <section>
            <h3>Agent 如何参考</h3>
            <p>{usage?.howToUse || '尚未生成 How to use。加入对话后，Agent 会按当前任务补充。'}</p>
          </section>
          <div className={styles.actions}>
            <button type="button" className={styles.secondary} data-reference-lightbox-add-canvas onClick={() => void addToCanvas()}>
              <IconImage size={15} />
              添加到画布
            </button>
            <button type="button" className={styles.primary} data-reference-lightbox-add-agent onClick={addToAgent}>
              <IconPlus size={15} />
              添加到对话
            </button>
          </div>
          <p className={styles.status} role="status" aria-live="polite">{actionStatus}</p>
        </aside>
      </div>
    </div>,
    document.body,
  )
}

function LightboxThumb({
  item,
  active,
  onClick,
}: {
  item: ReferenceItem
  active: boolean
  onClick: () => void
}) {
  const url = useAsset(item.assetHash ?? '')
  return (
    <button
      type="button"
      className={active ? styles.thumbOn : styles.thumb}
      data-reference-lightbox-thumb={item.id}
      aria-label={`查看参考 ${item.title}`}
      aria-pressed={active}
      title={item.title}
      onClick={onClick}
    >
      {url && item.kind === 'video' ? <video src={url} muted playsInline preload="metadata" /> : null}
      {url && item.kind !== 'video' ? <img src={url} alt="" loading="lazy" /> : null}
    </button>
  )
}

function wrap(value: number, length: number): number {
  if (length <= 0) return 0
  return (value + length) % length
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value)
}
