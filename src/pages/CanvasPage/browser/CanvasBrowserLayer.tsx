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
import { canGoBack, canGoForward } from '../../../domain/canvas/browserNavigation'
import { createClipperCollectionRepository } from '../../../state/shared/clipperCollectionRepository'
import { captureClipperPage } from '../clipper/clipperCapture'
import { CanvasBrowserToolbar } from './CanvasBrowserToolbar'
import { CanvasBrowserCovered, CanvasBrowserError, CanvasBrowserStartPage } from './CanvasBrowserStates'
import { useCanvasBrowserNav } from './useCanvasBrowserNav'
import { useNativeBrowserView } from './useNativeBrowserView'
import styles from './CanvasBrowserLayer.module.css'

type GestureMode = 'move' | 'resize'

interface Gesture {
  mode: GestureMode
  startX: number
  startY: number
  start: BrowserWindowRect
}

/**
 * 画布浏览器浮层（2026-11-13 重做）：单行工具条（导航 + 地址栏 + 动作）、加载进度条、
 * 起始页（设计站点快捷入口）、错误态。`url` 为空时打开起始页。
 */
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
  const nav = useCanvasBrowserNav(url)
  const currentUrl = nav.url
  const contentRef = useRef<HTMLDivElement | null>(null)
  /** 桌面壳：系统 WebView 子视图；浏览器开发版没有这个端口 ⇒ 退回 iframe */
  const native = useNativeBrowserView({
    port: platform.browserView,
    state: nav.state,
    url: currentUrl,
    dispatch: nav.dispatch,
    contentRef,
    rootRef,
  })
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
    if (stage.width <= 0 || stage.height <= 0) return
    setRect(fitBrowserWindow(stage))
  }, [stage.height, stage.width])

  useEffect(() => {
    if (!status) return
    const timer = window.setTimeout(() => setStatus(''), 4000)
    return () => window.clearTimeout(timer)
  }, [status])

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

  const go = (target: string) => {
    nav.dispatch({ type: 'go', url: target })
    setStatus('')
  }
  const openExternal = () => {
    if (currentUrl) void openUrl(currentUrl)
  }

  const savePage = async () => {
    if (busy || !currentUrl) return
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
          data-state={nav.state.phase}
          aria-label="画布浏览器"
        >
          <CanvasBrowserToolbar
            url={currentUrl}
            loading={nav.state.phase === 'loading'}
            canBack={canGoBack(nav.state)}
            canForward={canGoForward(nav.state)}
            saving={busy}
            onNavigate={go}
            onBack={() => {
              native.markAction('back')
              nav.dispatch({ type: 'back' })
            }}
            onForward={() => {
              native.markAction('forward')
              nav.dispatch({ type: 'forward' })
            }}
            onReloadOrStop={() => {
              if (nav.state.phase === 'loading') {
                native.stop()
                nav.dispatch({ type: 'stop' })
                return
              }
              native.markAction('reload')
              nav.dispatch({ type: 'reload' })
            }}
            onSave={() => void savePage()}
            onOpenExternal={openExternal}
            onResetWindow={() => setRect(fitBrowserWindow(stage))}
            onClose={onClose}
            onAddressError={setStatus}
            onDragStart={(event) => beginGesture(event, 'move')}
            onDragKey={moveWithKeyboard}
          />
          <div
            ref={contentRef}
            className={styles.viewport}
            data-canvas-browser-content
            data-backend={native.native ? 'native' : 'iframe'}
          >
            {nav.state.phase === 'blank' ? (
              <CanvasBrowserStartPage onOpen={go} />
            ) : nav.state.phase === 'error' ? (
              <CanvasBrowserError
                message={nav.state.error}
                onRetry={() => {
                  native.markAction('reload')
                  nav.dispatch({ type: 'reload' })
                }}
                onOpenExternal={openExternal}
              />
            ) : native.native ? (
              // 原生视图叠在这块区域上方；这里只在它让位（被浮层盖住）时露出说明
              native.covered ? <CanvasBrowserCovered title={nav.state.title} /> : null
            ) : (
              <iframe
                key={nav.state.revision}
                src={currentUrl}
                title={nav.state.title || '轻画画布浏览器'}
                referrerPolicy="no-referrer"
                sandbox="allow-forms allow-popups allow-scripts"
                onLoad={() => nav.dispatch({ type: 'loaded' })}
              />
            )}
          </div>
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
      {status && rect ? (
        // 提示放在窗口外（上方，放不下就下方）：原生视图会盖住窗口内容区里的任何 DOM
        <p
          className={styles.status}
          role="status"
          aria-live="polite"
          style={statusPosition(rect, stage)}
        >
          {status}
        </p>
      ) : null}
    </div>
  )
}

const STATUS_GAP = 8
const STATUS_HEIGHT = 32

function statusPosition(rect: BrowserWindowRect, stage: BrowserWindowStage) {
  const left = rect.x + rect.width / 2
  if (rect.y >= STATUS_HEIGHT + STATUS_GAP * 2) {
    return { left, top: rect.y - STATUS_HEIGHT - STATUS_GAP }
  }
  const below = rect.y + rect.height + STATUS_GAP
  return below + STATUS_HEIGHT <= stage.height
    ? { left, top: below }
    : { left, top: rect.y + 52 }
}

function keyboardDelta(key: string, step: number) {
  if (key === 'ArrowLeft') return { x: -step, y: 0 }
  if (key === 'ArrowRight') return { x: step, y: 0 }
  if (key === 'ArrowUp') return { x: 0, y: -step }
  if (key === 'ArrowDown') return { x: 0, y: step }
  return null
}
