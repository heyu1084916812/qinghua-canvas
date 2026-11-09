import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import { createContextRepository } from '../../state/shared/contextRepository'
import { createReferenceLedgerRepository } from '../../state/project/referenceLedgerRepository'
import type {
  ContextKit,
  ContextKitKind,
} from '../../domain/shared/context'
import type { CanvasStore } from '../../state/workbenches/canvas/store'
import { KIT_KINDS } from '../AssetsPage/contextKitDraft'
import { importAssetFile, IMPORT_ACCEPT } from '../../features/canvas/importAsset'
import { sendReferenceToAgent } from '../../features/canvas/agentHandoff'
import { createId } from '../../shared/id'
import { MasonryGrid } from '../AssetsPage/MasonryGrid'
import { IconPlus } from '../../workbenches/canvas/toolbar/icons'
import { setReferenceDragData } from '../../features/canvas/dropImport'
import { ReferenceMedia } from './ReferenceMedia'
import { ReferenceLightbox } from './ReferenceLightbox'
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
  const referenceRepo = useMemo(
    () => createReferenceLedgerRepository(platform.storage),
    [platform.storage],
  )
  const [source, setSource] = useState<Source>('assets')
  const [kits, setKits] = useState<ContextKit[]>([])
  const [references, setReferences] = useState<
    Awaited<ReturnType<typeof referenceRepo.listItems>>
  >([])
  const [kind, setKind] = useState<ContextKitKind>('brand')
  const [error, setError] = useState('')
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const referenceInputRef = useRef<HTMLInputElement | null>(null)
  const [referenceBusy, setReferenceBusy] = useState(false)
  const [referenceLightboxId, setReferenceLightboxId] = useState<string | null>(null)

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('[data-reference-lightbox]')) onClose()
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

  useEffect(() => {
    let active = true
    void referenceRepo.listItems(projectId).then((rows) => {
      if (active) setReferences(rows)
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : '读取项目参考失败')
    })
    return () => { active = false }
  }, [projectId, referenceRepo])

  const uploadReferences = async (files: FileList | null) => {
    if (!files || files.length === 0 || referenceBusy) return
    setReferenceBusy(true)
    setError('')
    try {
      const next = [...references]
      for (const file of Array.from(files)) {
        const asset = await importAssetFile({ platform, store, projectId }, file)
        if (!asset || (!asset.mime.startsWith('image/') && !asset.mime.startsWith('video/'))) continue
        const now = Date.now()
        const item = {
          id: createId('ref'),
          projectId,
          title: (asset.name ?? '参考素材').replace(/\.[^.]+$/, '').trim() || '参考素材',
          source: 'file' as const,
          kind: asset.mime.startsWith('video/') ? 'video' as const : 'image' as const,
          assetHash: asset.hash,
          what: `用户上传的${asset.mime.startsWith('video/') ? '视频' : '图片'}参考；等待后续任务分析补充 What / How to use。`,
          createdAt: now,
          updatedAt: now,
        }
        await referenceRepo.putItem(item)
        next.push(item)
      }
      setReferences(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '上传项目参考失败')
    } finally {
      setReferenceBusy(false)
      if (referenceInputRef.current) referenceInputRef.current.value = ''
    }
  }

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
                <button
                  type="button"
                  className={styles.kitAction}
                  data-my-assets-reference-upload
                  disabled={referenceBusy}
                  onClick={() => referenceInputRef.current?.click()}
                >
                  {referenceBusy ? '正在导入…' : '上传参考'}
                </button>
              </div>
              <input
                ref={referenceInputRef}
                type="file"
                accept={IMPORT_ACCEPT}
                multiple
                hidden
                data-my-assets-reference-file
                onChange={(event) => void uploadReferences(event.target.files)}
              />
              {error ? <p className={styles.notice}>{error}</p> : null}
              {!error && references.length === 0 ? (
                <p className={styles.empty} data-my-assets-reference-empty>
                  这个项目还没有参考。上传图片或视频后，它们会留在项目参考台账里，Agent 按任务或 chip 取用。
                </p>
              ) : null}
              <MasonryGrid
                minColumnWidth={132}
                gap={10}
                scope="my-assets-reference"
              >
                {references.map((item) => (
                  <article className={styles.referenceCard} data-my-assets-reference={item.id} data-my-assets-reference-drag={item.id} draggable key={item.id} onDragStart={(event) => setReferenceDragData(event.dataTransfer, item.id)}>
                    <div className={styles.referenceMedia}>
                      <button
                        type="button"
                        className={styles.referenceOpen}
                        data-my-assets-reference-open={item.id}
                        aria-label={`查看参考 ${item.title}`}
                        title="双击查看参考"
                        onDoubleClick={() => {
                          if (!item.assetHash) return
                          setReferenceLightboxId(item.id)
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' && event.key !== ' ') return
                          if (!item.assetHash) return
                          event.preventDefault()
                          setReferenceLightboxId(item.id)
                        }}
                      >
                        <ReferenceMedia
                          hash={item.assetHash}
                          title={item.title}
                          kind={item.kind === 'video' ? 'video' : 'image'}
                        />
                      </button>
                      <button
                        type="button"
                        className={styles.referenceQuickAdd}
                        data-my-assets-reference-agent={item.id}
                        aria-label={`将 ${item.title} 加入对话`}
                        title="加入对话"
                        onClick={() => sendReferenceToAgent(projectId, [{ id: item.id, label: item.title }])}
                      >
                        <IconPlus size={14} />
                      </button>
                    </div>
                    <div className={styles.referenceCopy}>
                      <strong title={item.title}>{item.title}</strong>
                      <span title={item.what}>
                        {item.what || `${item.kind === 'video' ? '视频参考' : '图片参考'} · 项目台账`}
                      </span>
                    </div>
                  </article>
                ))}
              </MasonryGrid>
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
        {referenceLightboxId ? (
          <ReferenceLightbox
            projectId={projectId}
            store={store}
            items={references}
            initialItemId={referenceLightboxId}
            onClose={() => setReferenceLightboxId(null)}
          />
        ) : null}
      </aside>
  )
}
