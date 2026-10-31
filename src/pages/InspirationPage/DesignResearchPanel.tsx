import { useEffect, useMemo, useRef, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import { usePlatform } from '../../app/providers/PlatformProvider'
import type { InspirationCase } from '../../domain/inspiration/cases'
import type { DesignResearchItem } from '../../domain/inspiration/designResearch'
import { isPublicHttpUrl } from '../../domain/shared/publicUrl'
import { imageMimeFromBytes } from '../../domain/shared/imageMime'
import { imageSizeFromHeader } from '../../domain/shared/imageSize'
import {
  runDesignResearch,
  type DesignResearchResult,
} from '../../features/shared/research/designResearchRunner'
import styles from './DesignResearchPanel.module.css'

const LAST_RESEARCH_KEY = 'inspiration:research:last'
const MAX_CONCURRENT_IMAGES = 3
const MAX_RESEARCH_IMAGE_PIXELS = 20_000_000
let activeImageLoads = 0
const imageLoadQueue: Array<() => void> = []

function acquireImageSlot(): Promise<() => void> {
  const release = () => {
    const next = imageLoadQueue.shift()
    if (next) next()
    else activeImageLoads = Math.max(0, activeImageLoads - 1)
  }
  if (activeImageLoads < MAX_CONCURRENT_IMAGES) {
    activeImageLoads += 1
    return Promise.resolve(release)
  }
  return new Promise((resolve) => {
    imageLoadQueue.push(() => resolve(release))
  })
}

function openExternal(url: string) {
  if (isTauri()) {
    void openUrl(url).catch(() => {})
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

function parseUrls(value: string): string[] {
  return value
    .split(/[\s,，;；]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function sourceLabel(source: DesignResearchItem['source']): string {
  if (source === 'pinterest') return 'Pinterest'
  if (source === 'behance') return 'Behance'
  if (source === 'google') return 'Google'
  return '网页'
}

function ResearchImage({ imageUrl }: { imageUrl: string }) {
  const platform = usePlatform()
  const [src, setSrc] = useState('')
  const [failed, setFailed] = useState(false)
  const [visible, setVisible] = useState(false)
  const hostRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host || typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        setVisible(entries.some((entry) => entry.isIntersecting))
      },
      { rootMargin: '240px' },
    )
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    setSrc('')
    setFailed(false)
    if (!visible || !isPublicHttpUrl(imageUrl)) {
      return
    }
    const controller = new AbortController()
    let objectUrl = ''
    let release: (() => void) | null = null
    void (async () => {
      release = await acquireImageSlot()
      if (controller.signal.aborted) {
        release()
        release = null
        return
      }
      try {
        const response = await platform.network.request(
          {
            url: imageUrl,
            method: 'GET',
            publicOnly: true,
            maxResponseBytes: 16 * 1024 * 1024,
            timeoutMs: 30_000,
          },
          controller.signal,
        )
        if (controller.signal.aborted || response.status < 200 || response.status >= 300) {
          if (!controller.signal.aborted) setFailed(true)
          return
        }
        const bytes = new Uint8Array(await response.arrayBuffer())
        if (bytes.length === 0) {
          setFailed(true)
          return
        }
        const contentType = Object.entries(response.headers).find(
          ([name]) => name.toLowerCase() === 'content-type',
        )?.[1]
        const declared = (contentType ?? '').split(';')[0]!.trim().toLowerCase()
        const detected = imageMimeFromBytes(bytes)
        if (
          !detected ||
          (declared.startsWith('image/') &&
            declared !== detected &&
            !(declared === 'image/jpg' && detected === 'image/jpeg'))
        ) {
          setFailed(true)
          return
        }
        const size = imageSizeFromHeader(bytes)
        if (
          !size ||
          size.width * size.height > MAX_RESEARCH_IMAGE_PIXELS
        ) {
          setFailed(true)
          return
        }
        const mime = detected
        if (controller.signal.aborted) return
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: mime }))
        if (!controller.signal.aborted) setSrc(objectUrl)
      } catch {
        if (!controller.signal.aborted) setFailed(true)
      } finally {
        release?.()
      }
    })()
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [imageUrl, platform.network, visible])

  return (
    <span ref={hostRef} className={styles.imageFrame}>
      {src ? (
        <img src={src} alt="" />
      ) : (
        <span className={styles.noImage}>
          {!isPublicHttpUrl(imageUrl)
            ? '无预览图'
            : failed
              ? '无法加载'
              : visible
                ? '正在加载…'
                : '待加载'}
        </span>
      )}
    </span>
  )
}

export function DesignResearchPanel({
  libraryCases,
  onClose,
  onSave,
}: {
  libraryCases: readonly InspirationCase[]
  onClose: () => void
  onSave: (item: DesignResearchItem) => Promise<{ ok: boolean; message: string }>
}) {
  const platform = usePlatform()
  const [topic, setTopic] = useState('')
  const [urls, setUrls] = useState('')
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState<DesignResearchResult | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<Record<string, string>>({})
  const [reportNotice, setReportNotice] = useState('')
  const controllerRef = useRef<AbortController | null>(null)
  const operationRef = useRef(0)

  const imageItems = useMemo(
    () =>
      (report?.items ?? []).filter(
        (item) => item.imageUrl && isPublicHttpUrl(item.imageUrl),
      ),
    [report],
  )
  const groupedItems = useMemo(() => {
    if (!report) return []
    const byId = new Map(report.items.map((item) => [item.id, item]))
    return report.moodboard.map((group) => ({
      ...group,
      items: group.itemIds
        .map((id) => byId.get(id))
        .filter((item): item is DesignResearchItem => Boolean(item)),
    }))
  }, [report])

  useEffect(() => {
    let alive = true
    const operation = ++operationRef.current
    void platform.storage
      .query('presets', { id: LAST_RESEARCH_KEY })
      .then((rows) => {
        if (!alive || operation !== operationRef.current) return
        const saved = rows[0]?.report as DesignResearchResult | undefined
        if (!saved || !Array.isArray(saved.items) || !saved.request) return
        setReport(saved)
        setTopic(saved.request.topic)
        setUrls(saved.request.urls.join('\n'))
        setSelected(new Set())
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [platform.storage])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loading) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [loading, onClose])

  useEffect(
    () => () => {
      controllerRef.current?.abort()
    },
    [],
  )

  const run = async () => {
    const normalizedTopic = topic.trim()
    if (!normalizedTopic) {
      setError('先填写这次要调研的主题。')
      return
    }
    controllerRef.current?.abort()
    const controller = new AbortController()
    const operation = ++operationRef.current
    controllerRef.current = controller
    setLoading(true)
    setError('')
    setReportNotice('')
    setSaveStatus({})
    try {
      const next = await runDesignResearch(
        {
          topic: normalizedTopic,
          urls: parseUrls(urls),
          maxResults: 24,
        },
        {
          network: platform.network,
          libraryCases,
        },
        controller.signal,
      )
      if (controller.signal.aborted || operation !== operationRef.current) return
      setReport(next)
      setSelected(
        new Set(
          next.items
            .filter((item) => item.imageUrl && isPublicHttpUrl(item.imageUrl))
            .slice(0, 8)
            .map((item) => item.id),
        ),
      )
      if (next.items.length > 0) {
        try {
          await platform.storage.put('presets', {
            id: LAST_RESEARCH_KEY,
            report: next,
            updatedAt: Date.now(),
          })
        } catch {
          if (operation === operationRef.current) {
            setReportNotice('调研结果已生成，但上次报告未能保存到本机。')
          }
        }
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const saveSelected = async () => {
    if (saving) return
    const targets = imageItems.filter((item) => selected.has(item.id))
    if (targets.length === 0) {
      setError('先选择要保存的参考图。')
      return
    }
    setSaving(true)
    setError('')
    for (const item of targets) {
      const result = await onSave(item)
      setSaveStatus((current) => ({
        ...current,
        [item.id]: result.message,
      }))
      if (result.ok) {
        setSelected((current) => {
          const next = new Set(current)
          next.delete(item.id)
          return next
        })
      }
    }
    setSaving(false)
  }

  return (
    <div
      className={styles.scrim}
      data-design-research-panel
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !loading) onClose()
      }}
    >
      <section
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="设计调研"
      >
        <header className={styles.head}>
          <div>
            <h2>设计调研</h2>
            <p>检索本地灵感库，并读取你提供的公开 Pinterest、Behance 或网页页面。</p>
          </div>
          <button type="button" className={styles.close} onClick={onClose} disabled={loading}>
            关闭
          </button>
        </header>

        <div className={styles.composer}>
          <label className={styles.topicField}>
            <span>调研主题</span>
            <input
              value={topic}
              data-design-research-topic
              disabled={loading}
              placeholder="例如：高端护肤品牌、日式咖啡包装"
              onChange={(event) => {
                operationRef.current += 1
                setTopic(event.target.value)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void run()
                }
              }}
            />
          </label>
          <label className={styles.urlField}>
            <span>公开来源 URL（可选，每行一个）</span>
            <textarea
              value={urls}
              data-design-research-urls
              disabled={loading}
              placeholder="https://www.pinterest.com/pin/..."
              onChange={(event) => {
                operationRef.current += 1
                setUrls(event.target.value)
              }}
            />
          </label>
          <div className={styles.composerFoot}>
            <p>仅读取公开页面元数据，不读取账号 Cookie 或私密 Board。</p>
            <button
              type="button"
              className={styles.primary}
              data-design-research-run
              disabled={loading}
              onClick={() => void run()}
            >
              {loading ? '调研中…' : '开始调研'}
            </button>
          </div>
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <div className={styles.body}>
          {loading ? <p className={styles.empty}>正在读取公开来源并整理参考…</p> : null}
          {!loading && !report ? (
            <p className={styles.empty}>输入主题后开始调研；也可以补充公开页面 URL 提高准确度。</p>
          ) : null}
          {!loading && report ? (
            <>
              <div className={styles.summary}>
                <div>
                  <strong>{report.totalItems}</strong>
                  <span>条参考</span>
                </div>
                <div>
                  <strong>{report.sources.length}</strong>
                  <span>个来源</span>
                </div>
                <div>
                  <strong>{report.queries.length}</strong>
                  <span>组检索词</span>
                </div>
                <button
                  type="button"
                  className={styles.save}
                  disabled={saving || selected.size === 0}
                  data-design-research-save
                  onClick={() => void saveSelected()}
                >
                  {saving ? '保存中…' : `保存所选（${selected.size}）`}
                </button>
              </div>

              {report.warnings.length > 0 ? (
                <div className={styles.warnings} data-design-research-warnings>
                  {report.warnings.map((warning) => (
                    <p key={warning}>{warning}</p>
                  ))}
                </div>
              ) : null}

              {reportNotice ? (
                <p className={styles.notice} role="status">
                  {reportNotice}
                </p>
              ) : null}

              <div className={styles.queries} aria-label="检索词">
                {report.queries.map((query) => (
                  <button
                    key={`${query.source}:${query.query}`}
                    type="button"
                    className={styles.query}
                    onClick={() => openExternal(query.url)}
                  >
                    <span>{query.source}</span>
                    {query.query}
                  </button>
                ))}
              </div>

              {report.items.length === 0 ? (
                <p className={styles.empty}>这次没有收集到可用参考。换一个主题或补充公开 URL 后重试。</p>
              ) : (
                <div className={styles.moodboard} data-design-research-results>
                  {groupedItems.map((group) => (
                    <section key={group.id} className={styles.group}>
                      <div className={styles.groupHead}>
                        <h3>{sourceLabel(group.id)}</h3>
                        <span>{group.items.length}</span>
                      </div>
                      <div className={styles.grid}>
                        {group.items.map((item) => {
                          const selectedNow = selected.has(item.id)
                          return (
                            <article
                              key={item.id}
                              className={selectedNow ? `${styles.item} ${styles.itemOn}` : styles.item}
                            >
                              <button
                                type="button"
                                className={styles.preview}
                                data-design-research-item={item.id}
                                aria-pressed={selectedNow}
                                onClick={() => toggle(item.id)}
                              >
                                {item.imageUrl ? (
                                  <ResearchImage imageUrl={item.imageUrl} />
                                ) : (
                                  <span className={styles.noImage}>无预览图</span>
                                )}
                                <span className={styles.check}>{selectedNow ? '✓' : ''}</span>
                                <span className={styles.source}>{sourceLabel(item.source)}</span>
                              </button>
                              <div className={styles.itemBody}>
                                <h3 title={item.title}>{item.title || '未命名参考'}</h3>
                                <button
                                  type="button"
                                  className={styles.open}
                                  onClick={() => openExternal(item.url)}
                                >
                                  打开原页
                                </button>
                                {saveStatus[item.id] ? (
                                  <p className={styles.saveStatus} role="status">
                                    {saveStatus[item.id]}
                                  </p>
                                ) : null}
                              </div>
                            </article>
                          )
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              )}

              <p className={styles.rights}>{report.rightsNote}</p>
            </>
          ) : null}
        </div>
      </section>
    </div>
  )
}
