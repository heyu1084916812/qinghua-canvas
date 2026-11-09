import { useEffect, useMemo, useRef, useState } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { usePlatform } from '../../../app/providers/PlatformProvider'
import type {
  ClipperItem,
} from '../../../domain/inspiration/clipper'
import type { DesignResearchItem } from '../../../domain/inspiration/designResearch'
import { isPublicHttpUrl } from '../../../domain/shared/publicUrl'
import { sendReferenceToAgent } from '../../../features/canvas/agentHandoff'
import { sendAssetToActiveCanvas } from '../../../features/assets/sendToActiveCanvas'
import { runDesignResearch } from '../../../features/shared/research/designResearchRunner'
import { saveDesignResearchItem } from '../../../features/shared/research/saveResearchItem'
import { createClipperCollectionRepository } from '../../../state/shared/clipperCollectionRepository'
import { createReferenceLedgerRepository } from '../../../state/project/referenceLedgerRepository'
import type { CanvasStore } from '../../../state/workbenches/canvas/store'
import {
  IconChat,
  IconClose,
  IconDelete,
  IconImage,
  IconLink,
  IconPlus,
} from '../../../workbenches/canvas/toolbar/icons'
import styles from './ClipperPanel.module.css'

type Filter = 'all' | 'uncategorized'

export function ClipperPanel({
  projectId,
  store,
}: {
  projectId: string
  store: CanvasStore
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
  const controllerRef = useRef<AbortController | null>(null)

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

  const collect = async () => {
    if (busy) return
    const target = normalizedPublicUrl(url)
    if (!target) {
      setStatus('请输入公开的 http / https 网页地址')
      return
    }
    const controller = newController()
    setBusy('collect')
    setStatus('正在读取网页图片…')
    try {
      const result = await runDesignResearch(
        {
          topic: target,
          urls: [target],
          maxResults: 24,
          includeOpenSearch: false,
        },
        { network: platform.network, libraryCases: [] },
        controller.signal,
      )
      const now = Date.now()
      const collected = result.items
        .filter((item) => isPublicHttpUrl(item.url) && isPublicHttpUrl(item.imageUrl))
        .map((item, index): ClipperItem => ({
          ...item,
          source: 'web',
          collectedAt: now + index,
          category: '未分类',
        }))
      if (collected.length === 0) {
        setStatus(result.warnings[0] ?? '这个页面没有可收藏的图片。')
        return
      }
      const next = await collection.upsert(collected)
      setItems(next)
      setUrl(target)
      setComposerOpen(false)
      setStatus(`已收藏 ${collected.length} 张网页图片。`)
    } catch (error) {
      if (!controller.signal.aborted) setStatus(`网页收藏失败：${errorText(error)}`)
    } finally {
      setBusy('')
    }
  }

  const openBrowser = () => {
    const target = normalizedPublicUrl(url)
    if (!target) {
      setStatus('请输入公开的 http / https 网页地址')
      return
    }
    setBrowserUrl(target)
  }

  const saveAsset = async (item: DesignResearchItem) => {
    const controller = newController()
    const saved = await saveDesignResearchItem(
      item,
      { network: platform.network, storage: platform.storage },
      controller.signal,
    )
    if (!saved.ok || !saved.asset) throw new Error(saved.message)
    return saved.asset
  }

  const addToReference = async (item: ClipperItem, toAgent: boolean) => {
    if (busy) return
    setBusy(`${item.id}:${toAgent ? 'agent' : 'reference'}`)
    setStatus('正在保存网页收藏…')
    try {
      const asset = await saveAsset(item)
      const now = Date.now()
      const id = `ref_clipper_${asset.hash.slice(0, 12)}`
      await referenceLedger.putItem({
        id,
        projectId,
        title: item.title,
        source: 'clipper',
        kind: 'image',
        assetHash: asset.hash,
        url: item.url,
        what: item.description?.trim() || `网页收藏「${item.title}」，来源 ${item.url}。`,
        createdAt: now,
        updatedAt: now,
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
      setBusy('')
    }
  }

  const addToCanvas = async (item: ClipperItem) => {
    if (busy) return
    setBusy(`${item.id}:canvas`)
    setStatus('正在放到画布…')
    try {
      const asset = await saveAsset(item)
      await sendAssetToActiveCanvas(platform, asset)
      setStatus('已放到当前画布。')
    } catch (error) {
      setStatus(`放到画布失败：${errorText(error)}`)
    } finally {
      setBusy('')
    }
  }

  const remove = async (item: ClipperItem) => {
    if (busy) return
    setBusy(`${item.id}:remove`)
    try {
      setItems(await collection.remove(item.id))
      setStatus('已从网页收藏移除。')
    } catch (error) {
      setStatus(`移除失败：${errorText(error)}`)
    } finally {
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
        <section className={styles.browser} data-clipper-browser>
          <header>
            <span title={browserUrl}>{browserUrl}</span>
            <div>
              <button
                type="button"
                className={styles.iconButton}
                aria-label="在系统浏览器打开"
                title="在系统浏览器打开"
                onClick={() => void openUrl(browserUrl)}
              >
                <IconLink size={15} />
              </button>
              <button
                type="button"
                className={styles.iconButton}
                aria-label="关闭轻画浏览器"
                title="关闭轻画浏览器"
                onClick={() => setBrowserUrl('')}
              >
                <IconClose size={15} />
              </button>
            </div>
          </header>
          <iframe
            src={browserUrl}
            title="轻画浏览器"
            referrerPolicy="no-referrer"
            sandbox="allow-forms allow-popups allow-scripts"
          />
        </section>
      ) : null}

      {visible.length > 0 ? (
        <div className={styles.grid} data-clipper-items>
          {visible.map((item) => (
            <article className={styles.item} key={item.id} data-clipper-item={item.id}>
              <button
                type="button"
                className={styles.media}
                aria-label={`打开来源：${item.title}`}
                title={item.title}
                onClick={() => void openUrl(item.url)}
              >
                <img src={item.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
              </button>
              <div className={styles.itemBody}>
                <strong>{item.title}</strong>
                <span>{hostOf(item.url)}</span>
                <div className={styles.itemActions}>
                  <button
                    type="button"
                    className={styles.action}
                    disabled={Boolean(busy)}
                    title="加入 Agent 对话"
                    aria-label={`把 ${item.title} 加入 Agent 对话`}
                    data-clipper-agent={item.id}
                    onClick={() => void addToReference(item, true)}
                  >
                    <IconChat size={14} />
                  </button>
                  <button
                    type="button"
                    className={styles.action}
                    disabled={Boolean(busy)}
                    title="加入项目参考"
                    aria-label={`把 ${item.title} 加入项目参考`}
                    data-clipper-reference={item.id}
                    onClick={() => void addToReference(item, false)}
                  >
                    <IconImage size={14} />
                  </button>
                  <button
                    type="button"
                    className={styles.action}
                    disabled={Boolean(busy)}
                    title="放到当前画布"
                    aria-label={`把 ${item.title} 放到当前画布`}
                    data-clipper-canvas={item.id}
                    onClick={() => void addToCanvas(item)}
                  >
                    <IconPlus size={14} />
                  </button>
                  <button
                    type="button"
                    className={styles.action}
                    disabled={Boolean(busy)}
                    title="移除收藏"
                    aria-label={`移除 ${item.title}`}
                    data-clipper-remove={item.id}
                    onClick={() => void remove(item)}
                  >
                    <IconDelete size={14} />
                  </button>
                </div>
              </div>
            </article>
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

function hostOf(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./i, '')
  } catch {
    return ''
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
