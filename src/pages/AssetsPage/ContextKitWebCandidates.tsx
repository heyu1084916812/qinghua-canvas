import { useEffect, useState } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import type { ContextKitAssetRole } from '../../domain/shared/context'
import { readableTextColor } from '../../features/shared/colorPicker/colorMath'
import { downloadKitImage } from '../../features/shared/context/kitWebImport'
import type { KitPageCandidate, KitPageExtract } from '../../features/shared/context/kitWebPage'
import importStyles from './ContextKitsImport.module.css'

const styles = importStyles as Record<string, string>

export interface PickedWebImage {
  bytes: Uint8Array
  mime: string
  name: string
  role: ContextKitAssetRole
}

export interface ContextKitWebCandidatesProps {
  url: string
  page: KitPageExtract
  busy: boolean
  onCancel(): void
  onAdd(picked: {
    images: PickedWebImage[]
    colors: { name: string; value: string }[]
    text: string
  }): void
}

type Preview =
  | { state: 'loading' }
  | { state: 'ok'; bytes: Uint8Array; mime: string; name: string; src: string }
  | { state: 'failed'; reason: string }

const PREVIEW_CONCURRENCY = 3

export function roleOfCandidate(candidate: KitPageCandidate): ContextKitAssetRole {
  return candidate.source === 'logo-img' || candidate.source === 'touch-icon' || candidate.source === 'icon'
    ? 'logo'
    : 'reference'
}

/**
 * 网页导入的候选面板：Logo / 图片候选（先下载校验、用本地 blob 预览）、主题色、正文资料，
 * 用户勾选后才写进套件；什么都不勾就什么都不加。
 */
export function ContextKitWebCandidates({ url, page, busy, onCancel, onAdd }: ContextKitWebCandidatesProps) {
  const platform = usePlatform()
  const [previews, setPreviews] = useState<Record<string, Preview>>({})
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [colors, setColors] = useState<Set<string>>(() => new Set(page.colors.map((color) => color.hex)))
  const [useText, setUseText] = useState(page.text.trim().length > 0)

  useEffect(() => {
    const controller = new AbortController()
    const urls = [...new Set(page.candidates.map((candidate) => candidate.url))]
    const created: string[] = []
    setPreviews(Object.fromEntries(urls.map((item) => [item, { state: 'loading' } as Preview])))
    let cursor = 0
    const worker = async () => {
      while (cursor < urls.length && !controller.signal.aborted) {
        const target = urls[cursor++]!
        try {
          const image = await downloadKitImage(platform.network, target, controller.signal)
          if (controller.signal.aborted) return
          const src = URL.createObjectURL(new Blob([image.bytes as BlobPart], { type: image.mime }))
          created.push(src)
          setPreviews((current) => ({ ...current, [target]: { state: 'ok', ...image, src } }))
        } catch (error) {
          if (controller.signal.aborted) return
          const reason = error instanceof Error ? error.message : '下载失败'
          setPreviews((current) => ({ ...current, [target]: { state: 'failed', reason } }))
        }
      }
    }
    void Promise.all(Array.from({ length: PREVIEW_CONCURRENCY }, worker))
    return () => {
      controller.abort()
      for (const src of created) URL.revokeObjectURL(src)
    }
  }, [page, platform])

  const toggle = (set: Set<string>, key: string) => {
    const next = new Set(set)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  }

  const add = () => {
    const images = page.candidates.flatMap((candidate) => {
      const preview = previews[candidate.url]
      if (!picked.has(candidate.url) || preview?.state !== 'ok') return []
      return [{ bytes: preview.bytes, mime: preview.mime, name: preview.name, role: roleOfCandidate(candidate) }]
    })
    onAdd({
      images,
      colors: page.colors
        .filter((color) => colors.has(color.hex))
        .map((color) => ({ name: color.label, value: color.hex.toLowerCase() })),
      text: useText ? page.text : '',
    })
  }

  const total = picked.size + colors.size + (useText ? 1 : 0)
  return (
    <div className={styles.webPanel} data-context-web-candidates>
      <div className={styles.webHead}>
        <strong title={url}>{page.title || url}</strong>
        <span>勾选要加入套件的内容</span>
      </div>
      {page.candidates.length > 0 ? (
        <div className={styles.webGrid}>
          {page.candidates.map((candidate) => {
            const preview = previews[candidate.url] ?? { state: 'loading' }
            const on = picked.has(candidate.url)
            return (
              <button
                key={candidate.url}
                type="button"
                className={on ? styles.webTileOn : styles.webTile}
                aria-pressed={on}
                title={preview.state === 'failed' ? preview.reason : candidate.url}
                disabled={preview.state !== 'ok'}
                data-context-web-candidate={candidate.source}
                onClick={() => setPicked((current) => toggle(current, candidate.url))}
              >
                <span className={styles.webThumb}>
                  {preview.state === 'ok' ? (
                    <img src={preview.src} alt={candidate.label} />
                  ) : (
                    <small>{preview.state === 'loading' ? '读取中…' : '不可用'}</small>
                  )}
                </span>
                <span className={styles.webTileLabel}>
                  {candidate.label.includes('Logo')
                    ? candidate.label
                    : `${candidate.label} · ${roleOfCandidate(candidate) === 'logo' ? 'Logo' : '参考'}`}
                </span>
              </button>
            )
          })}
        </div>
      ) : (
        <p className={styles.webEmpty}>页面里没有找到 Logo 或图片候选</p>
      )}
      {page.colors.length > 0 ? (
        <div className={styles.webColors}>
          {page.colors.map((color) => {
            const on = colors.has(color.hex)
            return (
              <button
                key={color.hex}
                type="button"
                className={on ? styles.webColorOn : styles.webColor}
                aria-pressed={on}
                style={{ background: color.hex, color: readableTextColor(color.hex) }}
                title={color.label}
                data-context-web-color={color.hex}
                onClick={() => setColors((current) => toggle(current, color.hex))}
              >
                {color.hex}
              </button>
            )
          })}
        </div>
      ) : null}
      {page.text.trim() ? (
        <label className={styles.webText}>
          <input type="checkbox" checked={useText} onChange={(event) => setUseText(event.target.checked)} />
          <span>把网页文字（{page.text.length} 字）作为生成设计指南的资料</span>
        </label>
      ) : null}
      <div className={styles.webActions}>
        <button type="button" className={styles.guideNoticeQuiet} onClick={onCancel}>
          取消
        </button>
        <button
          type="button"
          className={styles.guideNoticeAction}
          disabled={busy || total === 0}
          data-context-web-add
          onClick={add}
        >
          加入套件
        </button>
      </div>
    </div>
  )
}
