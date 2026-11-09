import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import { createContextRepository } from '../../state/shared/contextRepository'
import type { ContextKit } from '../../domain/shared/context'
import type { CanvasStore } from '../../state/workbenches/canvas/store'
import { MyAssetsShelf } from './MyAssetsShelf'
import { ReferenceSourcePanel } from './ReferenceSourcePanel'
import styles from './MyAssetsDrawer.module.css'

const PinterestPanel = lazy(() =>
  import('../../features/shared/pinterest/PinterestPanel').then((module) => ({
    default: module.PinterestPanel,
  })),
)
const ClipperPanel = lazy(() =>
  import('./clipper/ClipperPanel').then((module) => ({
    default: module.ClipperPanel,
  })),
)

type Source = 'reference' | 'assets' | 'pinterest' | 'clipper'

const SOURCES: readonly { id: Source; label: string }[] = [
  { id: 'reference', label: '参考' },
  { id: 'assets', label: '我的素材' },
  { id: 'pinterest', label: 'Pinterest' },
  { id: 'clipper', label: '轻画插件' },
]

export function MyAssetsDrawer({
  projectId,
  store,
  onClose,
  onOpenKitEditor,
}: {
  projectId: string
  store: CanvasStore
  onClose: () => void
  onOpenKitEditor: () => void
}) {
  const platform = usePlatform()
  const contextRepo = useMemo(
    () => createContextRepository(platform.storage),
    [platform.storage],
  )
  const [source, setSource] = useState<Source>('assets')
  const [kits, setKits] = useState<ContextKit[]>([])
  const [error, setError] = useState('')
  const closeRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('[data-reference-lightbox], [data-reference-kit-panel]')) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let active = true
    void contextRepo.listKits().then((rows) => {
      if (active) setKits(rows)
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : '读取套件失败')
    })
    return () => { active = false }
  }, [contextRepo])

  return (
      <aside className={styles.drawer} aria-label="我的素材" data-my-assets-drawer>
        <header className={styles.head}>
          <h2>我的素材</h2>
          <button ref={closeRef} type="button" className={styles.close} data-my-assets-close onClick={onClose}>
            关闭
          </button>
        </header>
        <nav className={styles.tabs} aria-label="素材来源">
          {SOURCES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={source === item.id}
              data-my-assets-source={item.id}
              className={source === item.id ? styles.tabOn : styles.tab}
              onClick={() => setSource(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className={styles.body} data-my-assets-body={source}>
          {source === 'reference' ? (
            <ReferenceSourcePanel projectId={projectId} store={store} kits={kits} />
          ) : null}
          {source === 'assets' ? (
            <MyAssetsShelf
              projectId={projectId}
              store={store}
              kits={kits}
              error={error}
              onOpenKitEditor={onOpenKitEditor}
            />
          ) : null}
          {source === 'pinterest' ? (
            <div className={styles.embeddedPinterest} data-my-assets-pinterest>
              <Suspense fallback={<p className={styles.notice}>正在打开 Pinterest 收藏…</p>}>
                <PinterestPanel onClose={onClose} />
              </Suspense>
            </div>
          ) : null}
          {source === 'clipper' ? (
            <Suspense fallback={<p className={styles.notice}>正在打开网页收藏…</p>}>
              <ClipperPanel projectId={projectId} store={store} />
            </Suspense>
          ) : null}
        </div>
      </aside>
  )
}
