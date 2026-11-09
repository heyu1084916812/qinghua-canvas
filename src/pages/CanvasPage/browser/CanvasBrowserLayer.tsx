import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { usePlatform } from '../../../app/providers/PlatformProvider'
import {
  fitBrowserWindow,
  moveBrowserWindow,
  resizeBrowserWindow,
  type BrowserWindowRect,
  type BrowserWindowStage,
} from '../../../domain/canvas/browserWindow'
import { isPublicHttpUrl } from '../../../domain/shared/publicUrl'
import { createClipperCollectionRepository } from '../../../state/shared/clipperCollectionRepository'
import {
  IconClose,
  IconExpand,
  IconImage,
  IconLink,
} from '../../../workbenches/canvas/toolbar/icons'
import { captureClipperPage } from '../clipper/clipperCapture'
import styles from './CanvasBrowserLayer.module.css'

type GestureMode = 'move' | 'resize'

interface Gesture {
  mode: GestureMode
  startX: number
  startY: number
  start: BrowserWindowRect
}

export function CanvasBrowserLayer({
  url,
  onClose,
}: {
  url: string
  onClose: () => void
}) {
  const platform = usePlatform()
  const collection = useMemo(
    () => createClipperCollectionRepository(platform.storage),
    [platform.storage],
  )
  const rootRef = useRef<HTMLDivElement | null>(null)
  const gestureRef = useRef<Gesture | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const [stage, setStage] = useState<BrowserWindowStage>({ width: 0, height: 0 })
  const [rect, setRect] = useState<BrowserWindowRect | null>(null)
  const [currentUrl, setCurrentUrl] = useState(url)
  const [draftUrl, setDraftUrl] = useState(url)
  const [browserKey, setBrowserKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const measure = () => {
      const bounds = root.getBoundingClientRect()
      setStage({ width: bounds.width, height: bounds.height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    setCurrentUrl(url)
    setDraftUrl(url)
    setBrowserKey((value) => value + 1)
    setStatus('')
  }, [url])

  useEffect(() => {
    if (stage.width <= 0 || stage.height <= 0) return
    setRect(fitBrowserWindow(stage))
  }, [stage.height, stage.width, url])

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const gesture = gestureRef.current
      if (!gesture) return
      const dx = event.clientX - gesture.startX
      const dy = event.clientY - gesture.startY
      setRect(
        gesture.mode === 'move'
          ? moveBrowserWindow(gesture.start, dx, dy, stage)
          : resizeBrowserWindow(gesture.start, dx, dy, stage),
      )
    }
    const end = () => {
      gestureRef.current = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [stage])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => () => controllerRef.current?.abort(), [])

  const beginGesture = (
    event: React.PointerEvent,
    mode: GestureMode,
  ) => {
    if (!rect || event.button !== 0) return
    if (
      mode === 'move'
      && (event.target as HTMLElement).closest('button, input, form')
    ) {
      return
    }
    event.preventDefault()
    gestureRef.current = {
      mode,
      startX: event.clientX,
      startY: event.clientY,
      start: rect,
    }
  }

  const moveWithKeyboard = (event: React.KeyboardEvent) => {
    if (!rect) return
    const step = event.shiftKey ? 48 : 16
    const delta = keyboardDelta(event.key, step)
    if (!delta) return
    event.preventDefault()
    setRect(moveBrowserWindow(rect, delta.x, delta.y, stage))
  }

  const resizeWithKeyboard = (event: React.KeyboardEvent) => {
    if (!rect) return
    const step = event.shiftKey ? 48 : 16
    const delta = keyboardDelta(event.key, step)
    if (!delta) return
    event.preventDefault()
    setRect(resizeBrowserWindow(rect, delta.x, delta.y, stage))
  }

  const navigate = () => {
    const target = normalizeUrl(draftUrl)
    if (!target) {
      setStatus('请输入公开的 http / https 网页地址')
      return
    }
    setCurrentUrl(target)
    setDraftUrl(target)
    setBrowserKey((value) => value + 1)
    setStatus('')
  }

  const savePage = async () => {
    if (busy) return
    setBusy(true)
    setStatus('正在读取当前网页…')
    const controller = new AbortController()
    controllerRef.current?.abort()
    controllerRef.current = controller
    try {
      const result = await captureClipperPage({
        url: currentUrl,
        network: platform.network,
        collection,
        signal: controller.signal,
      })
      setStatus(
        result.items.length > 0
          ? `已收藏 ${result.items.length} 张网页图片。`
          : result.warnings[0] ?? '这个页面没有可收藏的图片。',
      )
    } catch (error) {
      setStatus(
        `网页收藏失败：${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null
        setBusy(false)
      }
    }
  }

  return (
    <div
      ref={rootRef}
      className={styles.layer}
      data-canvas-browser-layer
    >
      {rect ? (
        <section
          className={styles.window}
          style={{
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
          }}
          data-canvas-browser
          aria-label="画布浏览器"
        >
          <header
            className={styles.dragBar}
            data-canvas-browser-drag
            tabIndex={0}
            aria-label="画布浏览器标题栏，可用方向键移动"
            onPointerDown={(event) => beginGesture(event, 'move')}
            onKeyDown={moveWithKeyboard}
          >
            <span>轻画浏览器</span>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.iconButton}
                data-canvas-browser-save
                aria-label="收藏当前网页"
                title="收藏当前网页"
                disabled={busy}
                onClick={() => void savePage()}
              >
                <IconImage size={15} />
              </button>
              <button
                type="button"
                className={styles.iconButton}
                aria-label="重置浏览器窗口"
                title="重置浏览器窗口"
                onClick={() => setRect(fitBrowserWindow(stage))}
              >
                <IconExpand size={15} />
              </button>
              <button
                type="button"
                className={styles.iconButton}
                aria-label="在系统浏览器打开"
                title="在系统浏览器打开"
                onClick={() => void openUrl(currentUrl)}
              >
                <IconLink size={15} />
              </button>
              <button
                type="button"
                className={styles.iconButton}
                data-canvas-browser-close
                aria-label="关闭画布浏览器"
                title="关闭画布浏览器"
                onClick={onClose}
              >
                <IconClose size={15} />
              </button>
            </div>
          </header>
          <form
            className={styles.address}
            onSubmit={(event) => {
              event.preventDefault()
              navigate()
            }}
          >
            <input
              value={draftUrl}
              data-canvas-browser-url
              inputMode="url"
              aria-label="画布浏览器地址"
              onChange={(event) => setDraftUrl(event.target.value)}
            />
            <button type="submit">打开</button>
          </form>
          <div className={styles.viewport}>
            <iframe
              key={browserKey}
              src={currentUrl}
              title="轻画画布浏览器"
              referrerPolicy="no-referrer"
              sandbox="allow-forms allow-popups allow-scripts"
            />
          </div>
          {status ? (
            <p className={styles.status} role="status" aria-live="polite">
              {status}
            </p>
          ) : null}
          <button
            type="button"
            className={styles.resizeHandle}
            data-canvas-browser-resize
            aria-label="调整浏览器窗口大小，可用方向键缩放"
            title="拖动调整窗口大小"
            onPointerDown={(event) => beginGesture(event, 'resize')}
            onKeyDown={resizeWithKeyboard}
          />
        </section>
      ) : null}
    </div>
  )
}

function normalizeUrl(value: string): string {
  try {
    const url = new URL(value.trim())
    return isPublicHttpUrl(url.toString()) ? url.toString() : ''
  } catch {
    return ''
  }
}

function keyboardDelta(key: string, step: number) {
  if (key === 'ArrowLeft') return { x: -step, y: 0 }
  if (key === 'ArrowRight') return { x: step, y: 0 }
  if (key === 'ArrowUp') return { x: 0, y: -step }
  if (key === 'ArrowDown') return { x: 0, y: step }
  return null
}
