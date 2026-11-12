import { useEffect, useRef, useState, type DragEvent } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import type { ContextKitAsset, ContextKitAssetRole } from '../../domain/shared/context'
import { fetchKitUrl } from '../../features/shared/context/kitWebImport'
import type { KitPageExtract } from '../../features/shared/context/kitWebPage'
import { ContextKitWebCandidates, type ContextKitWebCandidatesProps } from './ContextKitWebCandidates'
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
  addColors(colors: readonly { name: string; value: string }[]): void
  /** 网页 / PDF 抽出的文字：只作为生成设计指南的资料，不写进套件版本。 */
  addSourceText(source: { label: string; text: string }): void
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
  addColors,
  addSourceText,
}: ContextKitImportZoneProps) {
  const platform = usePlatform()
  const [dragging, setDragging] = useState(false)
  const [urlOpen, setUrlOpen] = useState(false)
  const [urlDraft, setUrlDraft] = useState('')
  const [webResult, setWebResult] = useState<{ url: string; page: KitPageExtract } | null>(null)
  const dropDepth = useRef(0)
  const urlAbortRef = useRef<AbortController | null>(null)

  useEffect(() => () => urlAbortRef.current?.abort(), [])

  const pickFiles = async () => {
    const picked = await platform.files.pickFile(KIT_IMAGE_ACCEPT)
    if (!picked) return
    await importFiles([new File([picked.blob], picked.name, { type: picked.mime })], 'reference')
  }

  const importUrl = async () => {
    const url = urlDraft.trim()
    if (!url || busy) return
    const controller = new AbortController()
    urlAbortRef.current?.abort()
    urlAbortRef.current = controller
    setBusy(true)
    setStatus('正在读取网址…')
    setWebResult(null)
    try {
      const result = await fetchKitUrl(platform.network, url, controller.signal)
      if (result.kind === 'image') {
        const resource = await persistImage(
          new Blob([result.bytes as BlobPart], { type: result.mime }),
          result.name,
          'reference',
        )
        addResources([resource])
        setUrlDraft('')
        setUrlOpen(false)
        setStatus('已从网址添加参考素材')
        return
      }
      setWebResult({ url: result.url, page: result.page })
      setStatus(
        `已读取网页${result.via === 'jina' ? '（经 Jina Reader）' : ''}：找到 ${result.page.candidates.length} 个图片候选、${result.page.colors.length} 个颜色`,
      )
    } catch (error) {
      if (!controller.signal.aborted) {
        setStatus(error instanceof Error ? error.message : '从网址导入失败')
      }
    } finally {
      if (urlAbortRef.current === controller) urlAbortRef.current = null
      setBusy(false)
    }
  }

  const addFromWeb = async (picked: Parameters<ContextKitWebCandidatesProps['onAdd']>[0]) => {
    setBusy(true)
    try {
      const resources: ContextKitAsset[] = []
      for (const image of picked.images) {
        resources.push(
          await persistImage(new Blob([image.bytes as BlobPart], { type: image.mime }), image.name, image.role),
        )
      }
      addResources(resources)
      if (picked.colors.length > 0) addColors(picked.colors)
      if (picked.text && webResult) addSourceText({ label: `网页 ${webResult.page.title || webResult.url}`, text: picked.text })
      setStatus(
        [
          resources.length ? `${resources.length} 张图片` : '',
          picked.colors.length ? `${picked.colors.length} 个颜色` : '',
          picked.text ? '网页文字资料' : '',
        ].filter(Boolean).join('、').replace(/^/, '已加入 '),
      )
      setWebResult(null)
      setUrlDraft('')
      setUrlOpen(false)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '加入套件失败')
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
            placeholder="图片地址或品牌官网，例如 https://example.com"
            aria-label="图片或网页地址"
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
      {webResult ? (
        <ContextKitWebCandidates
          url={webResult.url}
          page={webResult.page}
          busy={busy}
          onCancel={() => setWebResult(null)}
          onAdd={(picked) => void addFromWeb(picked)}
        />
      ) : null}
    </div>
  )
}
