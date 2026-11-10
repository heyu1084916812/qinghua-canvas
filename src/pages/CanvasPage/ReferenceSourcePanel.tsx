import { useEffect, useMemo, useRef, useState } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import type { ContextKit, ContextKitVersion } from '../../domain/shared/context'
import type { ReferenceItem } from '../../domain/project/referenceLedger'
import type { LibraryAsset } from '../../domain/shared/assetLibrary'
import { sendReferenceToAgent } from '../../features/canvas/agentHandoff'
import { importAssetFile, IMPORT_ACCEPT } from '../../features/canvas/importAsset'
import { ensureKitCardReference } from '../../features/canvas/kitReference'
import { createContextRepository } from '../../state/shared/contextRepository'
import { createAssetLibraryRepository } from '../../state/project/assetLibraryRepository'
import { createReferenceLedgerRepository } from '../../state/project/referenceLedgerRepository'
import type { CanvasStore } from '../../state/workbenches/canvas/store'
import { createId } from '../../shared/id'
import {
  IconPlus,
  IconSpinner,
} from '../../workbenches/canvas/toolbar/icons'
import { MasonryGrid } from '../AssetsPage/MasonryGrid'
import { ReferenceLightbox } from './ReferenceLightbox'
import {
  matchesReferenceFilters,
  toggledReferenceFilter,
  type ReferenceKindFilter,
  type ReferenceSourceFilter,
} from './ReferenceFilterFields'
import { ReferenceFilterControl } from './ReferenceFilterControl'
import { ReferenceKitPanel } from './ReferenceKitPanel'
import { ReferenceCardActionMenu } from './ReferenceCardActionMenu'
import { ReferenceEmptyState } from './ReferenceEmptyState'
import { addReferenceAsset, addReferenceLink } from './referenceSourceAdd'
import { KitFolder, ReferenceCard } from './ReferenceGridCards'
import { useReferenceCardActions } from './useReferenceCardActions'
import styles from './ReferenceSourcePanel.module.css'

export function ReferenceSourcePanel({
  projectId,
  store,
  kits,
  onOpenSource,
}: {
  projectId: string
  store: CanvasStore
  kits: readonly ContextKit[]
  onOpenSource: (source: 'pinterest' | 'clipper') => void
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
  const assetLibraryRepo = useMemo(
    () => createAssetLibraryRepository(platform.storage),
    [platform.storage],
  )
  const inputRef = useRef<HTMLInputElement | null>(null)
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [references, setReferences] = useState<ReferenceItem[]>([])
  const [versions, setVersions] = useState<Record<string, ContextKitVersion | null>>({})
  const [lightboxId, setLightboxId] = useState<string | null>(null)
  const [selectedKitId, setSelectedKitId] = useState<string | null>(null)
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

  const putReference = async (item: ReferenceItem) => {
    await referenceRepo.putItem(item)
    setReferences((current) => [...current, item])
  }

  const addLinkReference = (raw: string) =>
    addReferenceLink(putReference, projectId, raw)

  const addAssetReference = (asset: LibraryAsset) =>
    addReferenceAsset(putReference, projectId, asset)

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
        await putReference(item)
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
  const selectedKit = kits.find((kit) => kit.id === selectedKitId) ?? null
  const {
    contextMenu,
    setContextMenu,
    actions: contextActions,
    renamingId,
    renameDraft,
    setRenameDraft,
    renameReference,
    cancelRename,
  } = useReferenceCardActions({
    projectId,
    store,
    platform,
    repository: referenceRepo,
    setReferences,
    openReference,
    lightboxId,
    setLightboxId,
  })
  const kitReferenceIdOf = (kitId: string) => `ref_kit_${kitId}`
  const kitReferences = references.filter(
    (item) =>
      item.source === 'kit' &&
      Boolean(item.kitId) &&
      item.id === kitReferenceIdOf(item.kitId!),
  )
  const kitReferenceByKitId = new Map(
    kitReferences.map((item) => [item.kitId!, item]),
  )
  const regularReferences = references.filter(
    (item) =>
      !(
        item.source === 'kit' &&
        Boolean(item.kitId) &&
        item.id === kitReferenceIdOf(item.kitId!)
      ),
  )
  const visibleReferences = regularReferences.filter((item) =>
    matchesReferenceFilters(item.source, item.kind, sourceFilters, kindFilters),
  )
  const visibleKits = (sourceFilters.size === 0 || sourceFilters.has('asset')) && kindFilters.size === 0
    ? kits.filter((kit) => kitReferenceByKitId.has(kit.id))
    : []
  const hasReferenceContent = regularReferences.length > 0 || kitReferences.length > 0
  const filteredEmpty =
    hasReferenceContent && visibleReferences.length === 0 && visibleKits.length === 0
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
  return (
    <div className={styles.panel} data-reference-source-panel>
      <div className={styles.filterAnchor}>
        <div className={styles.subhead}>
          <span>当前项目的参考</span>
          <ReferenceFilterControl
            scope="source"
            label="筛选和排序参考素材"
            sourceValues={sourceFilters}
            kindValues={kindFilters}
            onToggleSource={toggleSource}
            onToggleKind={toggleKind}
          />
        </div>
      </div>
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
      {!hasReferenceContent ? (
        <ReferenceEmptyState
          busy={busy}
          onUpload={() => inputRef.current?.click()}
          onAddLink={addLinkReference}
          onAddAsset={addAssetReference}
          onLoadAssets={() => assetLibraryRepo.list()}
          onOpenSource={onOpenSource}
        />
      ) : filteredEmpty ? (
        <div className={styles.filteredEmpty}>
          <span>没有符合筛选的参考</span>
          <button
            type="button"
            onClick={() => {
              setSourceFilters(new Set())
              setKindFilters(new Set())
            }}
          >
            清除筛选
          </button>
        </div>
      ) : (
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
          <ReferenceCard
            key={item.id}
            item={item}
            renaming={renamingId === item.id}
            renameDraft={renameDraft}
            onRenameDraft={setRenameDraft}
            onRename={(target) => void renameReference(target)}
            onCancelRename={cancelRename}
            onAdd={addReference}
            onOpen={openReference}
            onContextMenu={(target, x, y) => setContextMenu({ item: target, x, y })}
          />
        ))}
        {visibleKits.map((kit) => (
          <KitFolder
            key={kit.id}
            kit={kit}
            version={versions[kit.id] ?? null}
            onAdd={() => void addKit(kit)}
            onOpen={() => setSelectedKitId(kit.id)}
            onContextMenu={(x, y) => {
              const item = kitReferenceByKitId.get(kit.id)
              if (item) setContextMenu({ item, x, y })
            }}
          />
        ))}
      </MasonryGrid>
      )}
      {contextMenu ? (
        <ReferenceCardActionMenu
          x={contextMenu.x}
          y={contextMenu.y}
          actions={contextActions}
          onClose={() => setContextMenu(null)}
        />
      ) : null}
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
