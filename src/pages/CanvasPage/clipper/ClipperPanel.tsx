import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { usePlatform } from '../../../app/providers/PlatformProvider'
import type {
  ClipperItem,
} from '../../../domain/inspiration/clipper'
import { isPublicHttpUrl } from '../../../domain/shared/publicUrl'
import { sendReferenceToAgent } from '../../../features/canvas/agentHandoff'
import { createClipperCollectionRepository } from '../../../state/shared/clipperCollectionRepository'
import { createReferenceLedgerRepository } from '../../../state/project/referenceLedgerRepository'
import type { CanvasStore } from '../../../state/workbenches/canvas/store'
import {
  IconExpand,
  IconLink,
  IconPlus,
} from '../../../workbenches/canvas/toolbar/icons'
import { ClipperBrowser } from './ClipperBrowser'
import { ClipperItemCard } from './ClipperItemCard'
import { ClipperPairing, type ClipperReceiverInfo } from './ClipperPairing'
import { captureClipperPage } from './clipperCapture'
import {
  addClipperReference,
  sendClipperToCanvas,
} from './clipperActions'
import styles from './ClipperPanel.module.css'

type Filter = 'all' | 'uncategorized'

interface PendingClip {
  id: string
  url: string
  title?: string
  receivedAt: number
}

export function ClipperPanel({
  projectId,
  store,
  onOpenCanvasBrowser,
}: {
  projectId: string
  store: CanvasStore
  onOpenCanvasBrowser?: (url: string) => void
}) {
  const platform = usePlatform()
  const collection = useMemo(
    () => createClipperCollectionRepository(platform.storage),
    [platform.storage],
  )
  const referenceLedger = useMemo(
    () => createReferenceLedgerRepository(platform.storage),
    [platform.storage],
  )
  const [items, setItems] = useState<ClipperItem[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [url, setUrl] = useState('')
  const [browserUrl, setBrowserUrl] = useState('')
  const [composerOpen, setComposerOpen] = useState(false)
  const [busy, setBusy] = useState('')
  const [status, setStatus] = useState('')
  const [receiver, setReceiver] = useState<ClipperReceiverInfo | null>(null)
  const [pairingOpen, setPairingOpen] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)
  const busyRef = useRef(false)
  const receivingRef = useRef(false)

  useEffect(() => {
    let active = true
    void collection.load().then((rows) => {
      if (active) setItems(rows)
    }).catch((error) => {
      if (active) setStatus(`读取网页收藏失败：${errorText(error)}`)
    })
    return () => {
      active = false
      controllerRef.current?.abort()
    }
  }, [collection])

  const visible = filter === 'uncategorized'
    ? items.filter((item) => item.category === '未分类')
    : items

  const collectTarget = useCallback(async (
    target: string,
    options: {
      closeComposer?: boolean
      background?: boolean
      statusPrefix?: string
    } = {},
  ): Promise<number> => {
    if (!options.background && busyRef.current) return 0
    if (!options.background) {
      busyRef.current = true
      setBusy('collect')
      setStatus(options.statusPrefix ?? '正在读取网页图片…')
    }
    const controller = newController()
    try {
      const result = await captureClipperPage({
        url: target,
        network: platform.network,
        collection,
        signal: controller.signal,
      })
      if (result.items.length === 0) {
        if (!options.background) {
          setStatus(result.warnings[0] ?? '这个页面没有可收藏的图片。')
        }
        return 0
      }
      setItems(result.collection)
      if (!options.background) {
        setUrl(target)
        if (options.closeComposer !== false) setComposerOpen(false)
        setStatus(
          `${options.statusPrefix ?? ''}已收藏 ${result.items.length} 张网页图片。`,
        )
      }
      return result.items.length
    } catch (error) {
      if (!controller.signal.aborted && !options.background) {
        setStatus(`网页收藏失败：${errorText(error)}`)
      }
      return 0
    } finally {
      if (!options.background) {
        busyRef.current = false
        setBusy('')
      }
    }
  }, [collection, platform.network])

  const collect = async () => {
    const target = normalizedPublicUrl(url)
    if (!target) {
      setStatus('请输入公开的 http / https 网页地址')
      return
    }
    await collectTarget(target)
  }

  const syncReceiver = useCallback(async () => {
    if (!isTauri() || receivingRef.current) return
    receivingRef.current = true
    try {
      const info = await invoke<ClipperReceiverInfo>('clipper_receiver_info')
      setReceiver(info)
      if (!info.running) return
      const pending = await invoke<PendingClip[]>('clipper_take_pending')
      if (pending.length === 0) return
      let imported = 0
      for (const clip of pending) {
        const target = normalizedPublicUrl(clip.url)
        if (!target) continue
        imported += await collectTarget(target, { background: true })
      }
      if (imported > 0) {
        setStatus(`已从浏览器扩展接收 ${imported} 张网页图片。`)
      }
    } catch (error) {
      setReceiver((current) => current ? {
        ...current,
        running: false,
        error: errorText(error),
      } : null)
    } finally {
      receivingRef.current = false
    }
  }, [collectTarget])

  useEffect(() => {
    if (!isTauri()) return
    void syncReceiver()
    const timer = window.setInterval(() => void syncReceiver(), 3_000)
    return () => window.clearInterval(timer)
  }, [syncReceiver])

  const openBrowser = () => {
    const target = normalizedPublicUrl(url)
    if (!target) {
      setStatus('请输入公开的 http / https 网页地址')
      return
    }
    setBrowserUrl(target)
  }
  const openCanvasBrowser = (value: string) => {
    const target = normalizedPublicUrl(value)
    if (!target || !onOpenCanvasBrowser) {
      setStatus('画布浏览器暂不可用')
      return
    }
    setBrowserUrl('')
    onOpenCanvasBrowser(target)
  }

  const addToReference = async (item: ClipperItem, toAgent: boolean) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(`${item.id}:${toAgent ? 'agent' : 'reference'}`)
    setStatus('正在保存网页收藏…')
    try {
      const controller = newController()
      const id = await addClipperReference({
        platform,
        ledger: referenceLedger,
        projectId,
        item,
        signal: controller.signal,
      })
      if (toAgent) {
        sendReferenceToAgent(projectId, [{ id, label: item.title }])
        setStatus('已加入 Agent 对话。')
      } else {
        store.notify('已加入当前项目的参考')
        setStatus('已加入当前项目的参考。')
      }
    } catch (error) {
      setStatus(`加入参考失败：${errorText(error)}`)
    } finally {
      busyRef.current = false
      setBusy('')
    }
  }

  const addToCanvas = async (item: ClipperItem) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(`${item.id}:canvas`)
    setStatus('正在放到画布…')
    try {
      const controller = newController()
      await sendClipperToCanvas(platform, item, controller.signal)
      setStatus('已放到当前画布。')
    } catch (error) {
      setStatus(`放到画布失败：${errorText(error)}`)
    } finally {
      busyRef.current = false
      setBusy('')
    }
  }

  const remove = async (item: ClipperItem) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(`${item.id}:remove`)
    try {
      setItems(await collection.remove(item.id))
      setStatus('已从网页收藏移除。')
    } catch (error) {
      setStatus(`移除失败：${errorText(error)}`)
    } finally {
      busyRef.current = false
      setBusy('')
    }
  }

  return (
    <div className={styles.panel} data-clipper-panel>
      <div className={styles.subhead}>
        <div className={styles.filters} role="tablist" aria-label="网页收藏筛选">
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'all'}
            className={filter === 'all' ? styles.tabOn : styles.tab}
            data-clipper-filter="all"
            onClick={() => setFilter('all')}
          >
            全部
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'uncategorized'}
            className={filter === 'uncategorized' ? styles.tabOn : styles.tab}
            data-clipper-filter="uncategorized"
            onClick={() => setFilter('uncategorized')}
          >
            未分类
          </button>
        </div>
        <div className={styles.headActions}>
          {isTauri() ? (
            <button
              type="button"
              className={styles.iconButton}
              data-clipper-pair
              aria-label="浏览器扩展配对"
              title="浏览器扩展配对"
              aria-expanded={pairingOpen}
              onClick={() => setPairingOpen((current) => !current)}
            >
              <IconLink size={16} />
            </button>
          ) : null}
          <button
            type="button"
            className={styles.iconButton}
            data-clipper-browse-canvas
            disabled={!onOpenCanvasBrowser || !url.trim()}
            aria-label="在画布中打开浏览器"
            title="在画布中打开浏览器"
            onClick={() => openCanvasBrowser(url)}
          >
            <IconExpand size={16} />
          </button>
          <button
            type="button"
            className={styles.iconButton}
            data-clipper-add
            aria-label="收藏网页"
            title="收藏网页"
            aria-expanded={composerOpen}
            onClick={() => setComposerOpen((current) => !current)}
          >
            <IconPlus size={16} />
          </button>
        </div>
      </div>

      {pairingOpen ? <ClipperPairing receiver={receiver} /> : null}

      {composerOpen ? (
        <div className={styles.composer} data-clipper-composer>
          <input
            value={url}
            data-clipper-url
            inputMode="url"
            placeholder="https://"
            aria-label="网页地址"
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void collect()
            }}
          />
          <div className={styles.composerActions}>
            <button
              type="button"
              className={styles.primary}
              data-clipper-collect
              disabled={Boolean(busy) || !url.trim()}
              onClick={() => void collect()}
            >
              {busy === 'collect' ? '读取中…' : '收藏网页'}
            </button>
            <button
              type="button"
              className={styles.iconButton}
              data-clipper-browse
              disabled={Boolean(busy) || !url.trim()}
              aria-label="在轻画浏览器打开"
              title="在轻画浏览器打开"
              onClick={openBrowser}
            >
              <IconLink size={16} />
            </button>
          </div>
        </div>
      ) : null}

      {browserUrl ? (
        <ClipperBrowser
          url={browserUrl}
          onClose={() => setBrowserUrl('')}
          onOpenCanvas={onOpenCanvasBrowser
            ? () => openCanvasBrowser(browserUrl)
            : undefined}
        />
      ) : null}

      {visible.length > 0 ? (
        <div className={styles.grid} data-clipper-items>
          {visible.map((item) => (
            <ClipperItemCard
              key={item.id}
              item={item}
              busy={Boolean(busy)}
              onAgent={() => void addToReference(item, true)}
              onReference={() => void addToReference(item, false)}
              onCanvas={() => void addToCanvas(item)}
              onRemove={() => void remove(item)}
            />
          ))}
        </div>
      ) : (
        <div className={styles.empty} data-clipper-empty>
          <IconLink size={20} />
          <span>{filter === 'uncategorized' ? '没有未分类的网页收藏' : '还没有网页收藏'}</span>
        </div>
      )}

      {status ? (
        <p className={styles.status} role="status" aria-live="polite">
          {status}
        </p>
      ) : null}
    </div>
  )

  function newController() {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    return controller
  }
}

function normalizedPublicUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed)
    return isPublicHttpUrl(url.toString()) ? url.toString() : ''
  } catch {
    return ''
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
