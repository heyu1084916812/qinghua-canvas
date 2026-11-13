import { useEffect, useState } from 'react'
import type { EcommerceCanvasItem } from '../../domain/ecommerce/canvasItem'
import type {
  EcommerceDisplayResultStatus,
  EcommerceResultRecord,
  EcommerceTaskRecord,
} from '../../domain/ecommerce/tasks'
import {
  useAssetMeta,
  useAssetPreview,
} from '../../features/shared/assets/index'
import {
  Bookmark,
  Download,
  FileText,
  Hand,
  Icon,
  MousePointer2,
  Redo2,
  RefreshCw,
  RotateCw,
  Type,
  Undo2,
  Upload,
  X,
} from '../../ui/icon'
import styles from './EcommerceWorkbench.module.css'

export type WorkbenchTool = 'select' | 'hand'

export function ToolIcon({ name }: { name: WorkbenchTool | 'upload' | 'text' | 'undo' | 'redo' | 'log' | 'close' | 'download' | 'rotate' | 'save' | 'retry' }) {
  const glyph =
    name === 'select'
      ? MousePointer2
      : name === 'hand'
        ? Hand
        : name === 'upload'
          ? Upload
          : name === 'text'
            ? Type
            : name === 'undo'
              ? Undo2
              : name === 'redo'
                ? Redo2
                : name === 'log'
                  ? FileText
                  : name === 'close'
                    ? X
                    : name === 'download'
                      ? Download
                      : name === 'rotate'
                        ? RotateCw
                        : name === 'retry'
                          ? RefreshCw
                          : Bookmark
  return <Icon icon={glyph} px={17} />
}

type WorkbenchMediaSource = 'preview' | 'original'

interface DisplayedWorkbenchImage {
  hash: string
  url: string
  source: WorkbenchMediaSource
}

export function WorkbenchMedia({ item, original }: { item: EcommerceCanvasItem; original: boolean }) {
  const previewMeta = useAssetPreview(item.assetHash)
  const [previewFailedUrl, setPreviewFailedUrl] = useState<string | null>(null)
  const [originalFailedUrl, setOriginalFailedUrl] = useState<string | null>(null)
  const [displayedImage, setDisplayedImage] = useState<DisplayedWorkbenchImage | null>(null)
  const [videoLoadedUrl, setVideoLoadedUrl] = useState<string | null>(null)

  /*
   * 与画布节点一致：预览先顶住，原图只在选中或预览不可用时补读。
   * 选中时绝不先撤掉预览，否则 src 切换与原图解码之间会出现一帧空白。
   */
  const previewUrl =
    previewMeta.url && previewMeta.url !== previewFailedUrl ? previewMeta.url : null
  const needOriginal = original || !!previewFailedUrl || previewMeta.missing === true
  const originalMeta = useAssetMeta(needOriginal ? item.assetHash : undefined)
  const originalUrl =
    originalMeta.url && originalMeta.url !== originalFailedUrl ? originalMeta.url : null
  const candidateUrl = originalUrl ?? previewUrl
  const candidateSource: WorkbenchMediaSource | null =
    candidateUrl && candidateUrl === originalUrl ? 'original' : candidateUrl ? 'preview' : null
  const isVideo =
    item.kind === 'video' ||
    originalMeta.mime?.startsWith('video/') ||
    previewMeta.mime?.startsWith('video/')

  /*
   * 图片先在脱离 DOM 的 Image 里完成解码，成功后一次替换 displayedImage。
   * 这样原图到达时，页面仍显示已解码的预览；新图已经可绘制时才切过去，
   * 不会出现“原图 src 已换、但还没解码”的白帧。
   */
  useEffect(() => {
    if (isVideo || !item.assetHash || !candidateUrl || !candidateSource) return
    if (
      displayedImage?.hash === item.assetHash &&
      displayedImage.url === candidateUrl
    ) {
      return
    }
    let alive = true
    const probe = new Image()
    probe.decoding = 'async'
    probe.onload = () => {
      if (!alive) return
      setDisplayedImage({
        hash: item.assetHash!,
        url: candidateUrl,
        source: candidateSource,
      })
    }
    probe.onerror = () => {
      if (!alive) return
      if (candidateSource === 'preview') setPreviewFailedUrl(candidateUrl)
      else setOriginalFailedUrl(candidateUrl)
    }
    probe.src = candidateUrl
    return () => {
      alive = false
      probe.onload = null
      probe.onerror = null
    }
  }, [candidateSource, candidateUrl, displayedImage, isVideo, item.assetHash])

  const displayed =
    displayedImage?.hash === item.assetHash ? displayedImage : null
  const source = isVideo ? candidateSource : displayed?.source ?? null
  const loaded = isVideo ? !!candidateUrl && videoLoadedUrl === candidateUrl : !!displayed
  const previewUnavailable = !!previewFailedUrl || previewMeta.missing === true
  const originalUnavailable = !!originalFailedUrl || originalMeta.missing === true
  const missing =
    !displayed &&
    !candidateUrl &&
    needOriginal &&
    previewUnavailable &&
    originalUnavailable

  if (!item.assetHash) return <span className={styles.missing}>素材不存在</span>
  if (missing) {
    const expectedPath = originalMeta.expectedPath ?? previewMeta.expectedPath
    return (
      <span className={styles.mediaMissing} data-ecommerce-media-missing>
        <span className={styles.mediaMissingTitle}>素材缺失</span>
        {expectedPath ? (
          <span className={styles.mediaMissingPath} title={expectedPath}>
            {expectedPath}
          </span>
        ) : null}
      </span>
    )
  }

  if (isVideo) {
    return (
      <span
        className={styles.mediaStage}
        aria-busy={!loaded}
        data-ecommerce-media-state={loaded ? 'ready' : candidateUrl ? 'loading' : 'pending'}
      >
        {candidateUrl ? (
          <video
            className={loaded ? `${styles.media} ${styles.mediaReady}` : styles.media}
            src={candidateUrl}
            controls
            playsInline
            preload="metadata"
            data-ecommerce-media-source={source}
            onLoadedData={() => setVideoLoadedUrl(candidateUrl)}
            onError={() => {
              if (source === 'preview') setPreviewFailedUrl(candidateUrl)
              else if (source === 'original') setOriginalFailedUrl(candidateUrl)
              setVideoLoadedUrl(null)
            }}
            onPointerDown={(event) => event.stopPropagation()}
          />
        ) : null}
        {!loaded ? <span className={styles.mediaPending} data-ecommerce-media-loading /> : null}
        <span className={styles.srOnly} aria-live="polite">
          {loaded ? '媒体已载入' : '正在载入媒体'}
        </span>
      </span>
    )
  }

  return (
    <span
      className={styles.mediaStage}
      aria-busy={!displayed}
      data-ecommerce-media-state={displayed ? 'ready' : candidateUrl ? 'loading' : 'pending'}
    >
      {displayed ? (
        <img
          className={`${styles.media} ${styles.mediaReady}`}
          src={displayed.url}
          alt=""
          draggable={false}
          data-ecommerce-media-source={displayed.source}
        />
      ) : null}
      {!displayed ? <span className={styles.mediaPending} data-ecommerce-media-loading /> : null}
      <span className={styles.srOnly} aria-live="polite">
        {displayed ? '图片已载入' : '正在载入图片'}
      </span>
    </span>
  )
}

export function elapsedLabel(task: EcommerceTaskRecord): string {
  const ms = Math.max(0, task.updatedAt - task.createdAt)
  if (ms < 1000) return '<1s'
  return `${Math.round(ms / 1000)}s`
}

export function WorkbenchResultPlaceholder({
  result,
  status,
  errorText,
  onRetry,
  onRemove,
}: {
  result: EcommerceResultRecord
  status: EcommerceDisplayResultStatus
  errorText: string
  onRetry?: () => void
  onRemove?: () => void
}) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (status !== 'running') return
    const started = result.createdAt || Date.now()
    const timer = window.setInterval(() => {
      setSeconds(Math.max(0, Math.floor((Date.now() - started) / 1000)))
    }, 500)
    return () => window.clearInterval(timer)
  }, [result.createdAt, status])
  if (status === 'failed') {
    return (
      <div
        className={styles.resultFailure}
        data-ecommerce-result-overlay="failed"
        role="alert"
      >
        <strong>生成失败</strong>
        <small data-ecommerce-result-error>{errorText}</small>
        <div className={styles.resultFailureActions}>
          {onRetry ? (
            <button
              type="button"
              data-ecommerce-retry-failed={result.nodeId}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                onRetry()
              }}
            >
              重新生成
            </button>
          ) : null}
          {onRemove ? (
            <button
              type="button"
              data-ecommerce-remove-failed={result.nodeId}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                onRemove()
              }}
            >
              移除记录
            </button>
          ) : null}
        </div>
      </div>
    )
  }
  return (
    <div
      className={styles.resultRunning}
      data-ecommerce-result-overlay="running"
      aria-live="polite"
    >
      <span className={styles.runningOrbit} data-ecommerce-result-orbit aria-hidden />
      <span data-ecommerce-result-elapsed={seconds}>生成中 {seconds}s</span>
    </div>
  )
}
