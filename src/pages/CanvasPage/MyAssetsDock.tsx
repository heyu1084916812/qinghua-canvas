import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from 'react'
import { createPortal } from 'react-dom'
import type { CanvasStore } from '../../state/workbenches/canvas/store'
import type { MyAssetsDockStore } from './myAssetsDockStore'
import styles from './MyAssetsDock.module.css'

const MY_ASSETS_EXIT_MS = 200
const loadMyAssetsDrawer = () => import('./MyAssetsDrawer')
const MyAssetsDrawer = lazy(() =>
  loadMyAssetsDrawer().then((module) => ({
    default: module.MyAssetsDrawer,
  })),
)
const MyAssetsDrawerContent = memo(MyAssetsDrawer)

export function MyAssetsDockButton({
  dock,
  className,
}: {
  dock: MyAssetsDockStore
  className: string
}) {
  const open = useSyncExternalStore(dock.subscribe, dock.getSnapshot, dock.getSnapshot)
  return (
    <button
      type="button"
      className={className}
      data-canvas-my-assets
      data-canvas-context-kits
      aria-label="我的素材"
      title="我的素材"
      aria-pressed={open}
      onPointerEnter={() => void loadMyAssetsDrawer()}
      onFocus={() => void loadMyAssetsDrawer()}
      onClick={() => {
        void loadMyAssetsDrawer()
        dock.toggle()
      }}
    >
      我的素材
    </button>
  )
}

export function MyAssetsDock({
  dock,
  projectId,
  store,
  onOpenKitEditor,
}: {
  dock: MyAssetsDockStore
  projectId: string
  store: CanvasStore
  onOpenKitEditor: () => void
}) {
  const open = useSyncExternalStore(dock.subscribe, dock.getSnapshot, dock.getSnapshot)
  const [mounted, setMounted] = useState(open)
  const [hidden, setHidden] = useState(!open)
  const [animatedOpen, setAnimatedOpen] = useState(open)
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null)
  const close = useCallback(() => dock.setOpen(false), [dock])
  const openKitEditor = useCallback(() => {
    dock.setOpen(false)
    onOpenKitEditor()
  }, [dock, onOpenKitEditor])

  useEffect(() => {
    void loadMyAssetsDrawer()
  }, [])

  useLayoutEffect(() => {
    setPortalTarget(
      document.querySelector<HTMLElement>('[data-my-assets-shell-slot]'),
    )
  }, [])

  useLayoutEffect(() => {
    if (!portalTarget) return
    portalTarget.setAttribute('data-my-assets-shell-owner', projectId)
    return () => {
      if (portalTarget.getAttribute('data-my-assets-shell-owner') !== projectId) return
      portalTarget.removeAttribute('data-my-assets-shell-owner')
      portalTarget.removeAttribute('data-my-assets-shell-active')
    }
  }, [portalTarget, projectId])

  useLayoutEffect(() => {
    if (!portalTarget) return
    if (animatedOpen) portalTarget.setAttribute('data-my-assets-shell-active', 'true')
    else portalTarget.removeAttribute('data-my-assets-shell-active')
    return () => {
      if (portalTarget.getAttribute('data-my-assets-shell-owner') === projectId) {
        portalTarget.removeAttribute('data-my-assets-shell-active')
      }
    }
  }, [animatedOpen, portalTarget, projectId])

  useLayoutEffect(() => {
    if (!open) return
    setMounted(true)
    setHidden(false)
    let firstFrame = 0
    let secondFrame = 0
    let thirdFrame = 0
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        thirdFrame = window.requestAnimationFrame(() => setAnimatedOpen(true))
      })
    })
    return () => {
      window.cancelAnimationFrame(firstFrame)
      window.cancelAnimationFrame(secondFrame)
      window.cancelAnimationFrame(thirdFrame)
    }
  }, [open])

  useLayoutEffect(() => {
    if (open) return
    setAnimatedOpen(false)
    if (!mounted || hidden) return
    const timer = window.setTimeout(() => setHidden(true), MY_ASSETS_EXIT_MS)
    return () => window.clearTimeout(timer)
  }, [hidden, mounted, open])

  if (!mounted || !portalTarget) return null
  return createPortal(
    <div
      className={styles.panelFrame}
      data-my-assets-slot
      data-my-assets-open={animatedOpen ? 'true' : 'false'}
      hidden={hidden}
    >
      <Suspense
        fallback={(
          <div
            className={styles.loading}
            data-my-assets-loading
            aria-busy="true"
          />
        )}
      >
        <MyAssetsDrawerContent
          projectId={projectId}
          store={store}
          active={open}
          onClose={close}
          onOpenKitEditor={openKitEditor}
        />
      </Suspense>
    </div>,
    portalTarget,
  )
}
