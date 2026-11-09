import { useEffect, useMemo, useRef, useState } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import type { ContextKit, ContextKitVersion } from '../../domain/shared/context'
import type { ReferenceItem } from '../../domain/project/referenceLedger'
import { sendReferenceToAgent } from '../../features/canvas/agentHandoff'
import { setReferenceDragData } from '../../features/canvas/dropImport'
import { importAssetFile, IMPORT_ACCEPT } from '../../features/canvas/importAsset'
import { ensureKitCardReference } from '../../features/canvas/kitReference'
import { useAsset } from '../../features/shared/assets'
import { createContextRepository } from '../../state/shared/contextRepository'
import { createReferenceLedgerRepository } from '../../state/project/referenceLedgerRepository'
import type { CanvasStore } from '../../state/workbenches/canvas/store'
import { createId } from '../../shared/id'
import {
  IconExpand,
  IconPlus,
  IconSpinner,
} from '../../workbenches/canvas/toolbar/icons'
import { KIT_KINDS } from '../AssetsPage/contextKitDraft'
import { MasonryGrid } from '../AssetsPage/MasonryGrid'
import { ReferenceLightbox } from './ReferenceLightbox'
import {
  matchesReferenceFilters,
  ReferenceFilterButton,
  ReferenceFilterFields,
  toggledReferenceFilter,
  type ReferenceKindFilter,
  type ReferenceSourceFilter,
} from './ReferenceFilterFields'
import { ReferenceKitPanel } from './ReferenceKitPanel'
import { ReferenceMedia } from './ReferenceMedia'
import styles from './ReferenceSourcePanel.module.css'

export function ReferenceSourcePanel({
  projectId,
  store,
  kits,
}: {
  projectId: string
  store: CanvasStore
  kits: readonly ContextKit[]
}) {
  const platform = usePlatform()
  const referenceRepo = useMemo(
    () => createReferenceLedgerRepository(platform.storage),
    [platform.storage],
  )
  const contextRepo = useMemo(
    () => createContextRepository(platform.storage),
    [platform.storage],
  )
  const inputRef = useRef<HTMLInputElement | null>(null)
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [references, setReferences] = useState<ReferenceItem[]>([])
  const [versions, setVersions] = useState<Record<string, ContextKitVersion | null>>({})
  const [lightboxId, setLightboxId] = useState<string | null>(null)
  const [selectedKitId, setSelectedKitId] = useState<string | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const [sourceFilters, setSourceFilters] = useState<Set<ReferenceSourceFilter>>(new Set())
  const [kindFilters, setKindFilters] = useState<Set<ReferenceKindFilter>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void referenceRepo.listItems(projectId).then((rows) => {
      if (active) setReferences(rows)
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : '读取项目参考失败')
    })
    return () => { active = false }
  }, [projectId, referenceRepo])

  useEffect(() => () => {
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
  }, [])

  useEffect(() => {
    let active = true
    void Promise.all(kits.map(async (kit) => {
      return [kit.id, await contextRepo.currentKitVersion(kit)] as const
    })).then((rows) => {
      if (active) setVersions(Object.fromEntries(rows))
    }).catch(() => {
      if (active) setVersions({})
    })
    return () => { active = false }
  }, [contextRepo, kits])

  const addKit = async (kit: ContextKit) => {
    const version = versions[kit.id] !== undefined
      ? versions[kit.id]
      : await contextRepo.currentKitVersion(kit)
    if (versions[kit.id] === undefined) {
      setVersions((current) => ({ ...current, [kit.id]: version }))
    }
    if (!version) {
      store.notify('这个套件还没有保存版本', 'error')
      return
    }
    try {
      const reference = await ensureKitCardReference(platform, projectId, kit, version)
      sendReferenceToAgent(projectId, [{ id: reference.id, label: reference.title }])
    } catch (cause) {
      store.notify(
        `加入对话失败：${cause instanceof Error ? cause.message : '未知错误'}`,
        'error',
      )
    }
  }

  const uploadReferences = async (files: FileList | null) => {
    if (!files || files.length === 0 || busy) return
    setBusy(true)
    setError('')
    try {
      const next = [...references]
      for (const file of Array.from(files)) {
        const asset = await importAssetFile({ platform, store, projectId }, file)
        if (!asset || (!asset.mime.startsWith('image/') && !asset.mime.startsWith('video/'))) continue
        const now = Date.now()
        const item: ReferenceItem = {
          id: createId('ref'),
          projectId,
          title: (asset.name ?? '参考素材').replace(/\.[^.]+$/, '').trim() || '参考素材',
          source: 'file',
          kind: asset.mime.startsWith('video/') ? 'video' : 'image',
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
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const selectedKit = kits.find((kit) => kit.id === selectedKitId) ?? null
  const visibleReferences = references.filter((item) =>
    matchesReferenceFilters(item.source, item.kind, sourceFilters, kindFilters),
  )
  const visibleKits = (sourceFilters.size === 0 || sourceFilters.has('asset')) && kindFilters.size === 0
    ? kits
    : []
  if (selectedKit) {
    return (
      <ReferenceKitPanel
        projectId={projectId}
        store={store}
        kit={selectedKit}
        version={versions[selectedKit.id] ?? null}
        onBack={() => setSelectedKitId(null)}
      />
    )
  }

  const toggleSource = (value: ReferenceSourceFilter) => {
    setSourceFilters((current) => toggledReferenceFilter(current, value))
  }
  const toggleKind = (value: ReferenceKindFilter) => {
    setKindFilters((current) => toggledReferenceFilter(current, value))
  }
  const addReference = (item: ReferenceItem) => {
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null
      sendReferenceToAgent(projectId, [{ id: item.id, label: item.title }])
    }, 220)
  }
  const openReference = (item: ReferenceItem) => {
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
    clickTimerRef.current = null
    setLightboxId(item.id)
  }

  return (
    <div
      className={styles.panel}
      data-reference-source-panel
      onKeyDown={(event) => {
        if (event.key === 'Escape' && filterOpen) {
          event.stopPropagation()
          setFilterOpen(false)
        }
      }}
    >
      <div className={styles.subhead}>
        <span>当前项目的参考</span>
        <ReferenceFilterButton
          scope="source"
          open={filterOpen}
          label="筛选和排序参考素材"
          onToggle={() => setFilterOpen((current) => !current)}
        />
      </div>
      {filterOpen ? (
        <ReferenceFilterFields
          scope="source"
          sourceValues={sourceFilters}
          kindValues={kindFilters}
          onToggleSource={toggleSource}
          onToggleKind={toggleKind}
        />
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept={IMPORT_ACCEPT}
        multiple
        hidden
        data-my-assets-reference-file
        onChange={(event) => void uploadReferences(event.target.files)}
      />
      {error ? <p className={styles.notice}>{error}</p> : null}
      <MasonryGrid minColumnWidth={132} gap={10} scope="my-assets-reference">
        <button
          type="button"
          className={styles.uploadTile}
          data-my-assets-reference-upload
          aria-label="上传项目参考"
          title="上传项目参考"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? <IconSpinner size={24} /> : <IconPlus size={30} />}
        </button>
        {visibleReferences.map((item) => (
          <article
            className={styles.referenceCard}
            data-my-assets-reference={item.id}
            data-my-assets-reference-drag={item.id}
            draggable
            key={item.id}
            onDragStart={(event) => setReferenceDragData(event.dataTransfer, item.id)}
          >
            <div className={styles.referenceMedia}>
              <button
                type="button"
                className={styles.referenceOpen}
                data-my-assets-reference-open={item.id}
                aria-label={`查看参考 ${item.title}`}
                onClick={() => addReference(item)}
                onDoubleClick={() => item.assetHash && openReference(item)}
              >
                <ReferenceMedia
                  hash={item.assetHash}
                  title={item.title}
                  kind={item.kind === 'video' ? 'video' : 'image'}
                />
              </button>
              <button
                type="button"
                className={styles.referenceExpand}
                data-my-assets-reference-expand={item.id}
                aria-label={`放大查看 ${item.title}`}
                title="放大查看"
                onClick={() => openReference(item)}
              >
                <IconExpand size={14} />
              </button>
            </div>
            <div className={styles.referenceCopy}>
              <span title={item.what || item.title}>{item.what || item.title}</span>
            </div>
          </article>
        ))}
        {visibleKits.map((kit) => (
          <KitFolder
            key={kit.id}
            kit={kit}
            version={versions[kit.id] ?? null}
            onAdd={() => void addKit(kit)}
            onOpen={() => setSelectedKitId(kit.id)}
          />
        ))}
      </MasonryGrid>
      {lightboxId ? (
        <ReferenceLightbox
          projectId={projectId}
          store={store}
          items={references}
          initialItemId={lightboxId}
          onClose={() => setLightboxId(null)}
        />
      ) : null}
    </div>
  )
}

function KitFolder({
  kit,
  version,
  onAdd,
  onOpen,
}: {
  kit: ContextKit
  version: ContextKitVersion | null
  onAdd: () => void
  onOpen: () => void
}) {
  const preview = version?.resources.find((item) => item.role === 'logo') ?? version?.resources[0]
  const url = useAsset(preview?.hash ?? '')
  const typeLabel = KIT_KINDS.find((item) => item.value === kit.kind)?.label ?? '套件'
  return (
    <article
      className={styles.kitFolderCard}
      data-my-assets-kit-folder={kit.id}
      onClick={onAdd}
    >
      <button
        type="button"
        className={styles.kitFolderButton}
        data-my-assets-kit-folder-add={kit.id}
        aria-label={`将套件 ${kit.name} 加入对话`}
        onClick={(event) => {
          event.stopPropagation()
          onAdd()
        }}
      >
        <span className={styles.kitFolderStack}>
          <span className={styles.kitFolderLayerBack} />
          <span className={styles.kitFolderLayerFront} />
          <span className={styles.kitFolderFace}>
            {url ? <img src={url} alt="" /> : <span>{kit.name.slice(0, 1)}</span>}
          </span>
        </span>
        <span className={styles.kitFolderCopy}>{kit.name}</span>
      </button>
      <button
        type="button"
        className={styles.kitFolderOpen}
        data-my-assets-kit-folder-open={kit.id}
        aria-label={`打开套件 ${kit.name}`}
        title="打开套件"
        onClick={(event) => {
          event.stopPropagation()
          onOpen()
        }}
      >
        打开
      </button>
      <span className={styles.srOnly}>{typeLabel}</span>
    </article>
  )
}
