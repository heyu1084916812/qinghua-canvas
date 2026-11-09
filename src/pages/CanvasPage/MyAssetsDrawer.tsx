import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import { createContextRepository } from '../../state/shared/contextRepository'
import type {
  ContextKit,
  ContextKitKind,
} from '../../domain/shared/context'
import { KIT_KINDS } from '../AssetsPage/contextKitDraft'
import styles from './MyAssetsDrawer.module.css'

const PinterestPanel = lazy(() =>
  import('../../features/shared/pinterest/PinterestPanel').then((module) => ({
    default: module.PinterestPanel,
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
  onClose,
  onOpenKitEditor,
}: {
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
  const [kind, setKind] = useState<ContextKitKind>('brand')
  const [error, setError] = useState('')
  const closeRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
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

  const visibleKits = kits.filter((kit) => kit.kind === kind)

  return (
      <aside className={styles.drawer} aria-label="我的素材" data-my-assets-drawer>
        <header className={styles.head}>
          <h2>我的素材</h2>
          <button ref={closeRef} type="button" className={styles.close} onClick={onClose}>
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
            <div>
              <div className={styles.subhead}>
                <span>当前项目的参考台账</span>
                <span>项目隔离</span>
              </div>
              <p className={styles.notice}>
                参考卡片和按任务筛选已进入 Agent 生成上下文。参考灯箱、拖拽到画布与卡片级「添加到对话」正在接入，当前不会把未完成的动作伪装成可用按钮。
              </p>
            </div>
          ) : null}
          {source === 'assets' ? (
            <div>
              <div className={styles.subhead}>
                <span>账号级套件资料库</span>
                <button
                  type="button"
                  className={styles.kitAction}
                  data-my-assets-edit-kits
                  onClick={onOpenKitEditor}
                >
                  管理套件
                </button>
              </div>
              <div className={styles.kinds} aria-label="套件分类">
                {KIT_KINDS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className={kind === item.value ? styles.tabOn : styles.kind}
                    data-my-assets-kind={item.value}
                    aria-pressed={kind === item.value}
                    onClick={() => setKind(item.value)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {error ? <p className={styles.notice}>{error}</p> : null}
              {!error && visibleKits.length === 0 ? (
                <p className={styles.empty} data-my-assets-empty>
                  还没有{KIT_KINDS.find((item) => item.value === kind)?.label}。点击「管理套件」创建或编辑真实套件。
                </p>
              ) : null}
              <div className={styles.kitList}>
                {visibleKits.map((kit) => (
                  <article key={kit.id} className={styles.kitCard} data-my-assets-kit={kit.id}>
                    <span className={styles.kitName} title={kit.name}>{kit.name}</span>
                    <span className={styles.kitMeta}>v{kit.currentVersion}</span>
                  </article>
                ))}
              </div>
            </div>
          ) : null}
          {source === 'pinterest' ? (
            <div className={styles.embeddedPinterest} data-my-assets-pinterest>
              <Suspense fallback={<p className={styles.notice}>正在打开 Pinterest 收藏…</p>}>
                <PinterestPanel onClose={onClose} />
              </Suspense>
            </div>
          ) : null}
          {source === 'clipper' ? (
            <div>
              <div className={styles.subhead}>
                <span>网页收藏接收端</span>
                <span>待接入轻画插件</span>
              </div>
              <p className={styles.notice}>
                画布内浏览器与轻画插件尚在开发。插件上线后，网页收藏会落到这里，并与参考、我的素材、Pinterest 共用「添加到对话 / 加入参考台账 / 放到画布」三种动作。
              </p>
            </div>
          ) : null}
        </div>
      </aside>
  )
}
