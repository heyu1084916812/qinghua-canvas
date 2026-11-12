import { useRef, useState, type DragEvent } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import type { ContextKitAsset, ContextKitAssetRole } from '../../domain/shared/context'
import baseStyles from './ContextKitsDialog.module.css'
import contextKitsAssetsStyles from './ContextKitsAssets.module.css'

const styles = { ...baseStyles, ...contextKitsAssetsStyles } as Record<string, string>

export const KIT_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml'

export interface ContextKitImportZoneProps {
  busy: boolean
  setBusy(next: boolean): void
  setStatus(next: string): void
  persistImage(blob: Blob, name: string, role: ContextKitAssetRole): Promise<ContextKitAsset>
  addResources(next: readonly ContextKitAsset[]): void
  importFiles(files: readonly File[], role: ContextKitAssetRole): Promise<void>
}

/**
 * 套件弹窗顶部的「拖拽 / 选择本机文件 / 导入 URL」区（从 ContextKitsDialog 拆出，2026-11-12）。
 * 只负责把外部来源变成套件素材；保存版本、绑定项目仍归弹窗本体。
 */
export function ContextKitImportZone({
  busy,
  setBusy,
  setStatus,
  persistImage,
  addResources,
  importFiles,
}: ContextKitImportZoneProps) {
  const platform = usePlatform()
  const [dragging, setDragging] = useState(false)
  const [urlOpen, setUrlOpen] = useState(false)
  const [urlDraft, setUrlDraft] = useState('')
  const dropDepth = useRef(0)

  const pickFiles = async () => {
    const picked = await platform.files.pickFile(KIT_IMAGE_ACCEPT)
    if (!picked) return
    await importFiles([new File([picked.blob], picked.name, { type: picked.mime })], 'reference')
  }

  const importUrl = async () => {
    const url = urlDraft.trim()
    if (!url || busy) return
    let parsed: URL
    try {
      parsed = new URL(url)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error()
    } catch {
      setStatus('请输入完整的 http 或 https 图片地址')
      return
    }
    setBusy(true)
    setStatus('')
    try {
      const response = await platform.network.request(
        { url, method: 'GET', timeoutMs: 30_000 },
        new AbortController().signal,
      )
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`图片地址返回 HTTP ${response.status}`)
      }
      const mime = Object.entries(response.headers).find(
        ([name]) => name.toLowerCase() === 'content-type',
      )?.[1]?.split(';')[0]?.trim() ?? 'image/png'
      if (!mime.startsWith('image/')) throw new Error('这个地址返回的不是图片')
      const bytes = new Uint8Array(await response.arrayBuffer())
      const name = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() ?? '网页图片')
      const resource = await persistImage(new Blob([bytes], { type: mime }), name, 'reference')
      addResources([resource])
      setUrlDraft('')
      setUrlOpen(false)
      setStatus('已从网址添加参考素材')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '从网址导入失败')
    } finally {
      setBusy(false)
    }
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    dropDepth.current = 0
    setDragging(false)
    const files = [...event.dataTransfer.files]
    if (files.length > 0) void importFiles(files, 'reference')
  }

  return (
    <div
      className={dragging ? styles.dropzoneOn : styles.dropzone}
      data-context-asset-dropzone
      onDragEnter={(event) => {
        event.preventDefault()
        dropDepth.current += 1
        setDragging(true)
      }}
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(event) => {
        event.preventDefault()
        dropDepth.current = Math.max(0, dropDepth.current - 1)
        if (dropDepth.current === 0) setDragging(false)
      }}
      onDrop={onDrop}
    >
      <div className={styles.uploadIcon} aria-hidden>
        <span />
      </div>
      <div className={styles.dropCopy}>
        <strong>拖拽或上传图片</strong>
        <span>PNG、JPG、WebP，最大 20MB</span>
      </div>
      <div className={styles.dropActions}>
        <button
          type="button"
          className={styles.smallButton}
          disabled={busy}
          onClick={() => void pickFiles()}
        >
          选择本机图片
        </button>
        <button
          type="button"
          className={styles.smallButton}
          aria-expanded={urlOpen}
          data-context-url-toggle
          onClick={() => setUrlOpen((current) => !current)}
        >
          导入 URL
        </button>
      </div>
      {urlOpen ? (
        <div className={styles.urlRow}>
          <input
            value={urlDraft}
            placeholder="https://example.com/reference.jpg"
            aria-label="图片网址"
            data-context-url-input
            onChange={(event) => setUrlDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void importUrl()
            }}
          />
          <button
            type="button"
            className={styles.urlConfirm}
            disabled={busy || !urlDraft.trim()}
            data-context-url-import
            onClick={() => void importUrl()}
          >
            导入
          </button>
        </div>
      ) : null}
    </div>
  )
}
