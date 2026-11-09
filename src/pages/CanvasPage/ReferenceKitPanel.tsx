import { useState } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import type {
  ContextKit,
  ContextKitVersion,
} from '../../domain/shared/context'
import type { ReferenceItem } from '../../domain/project/referenceLedger'
import { sendReferenceToAgent } from '../../features/canvas/agentHandoff'
import { ensureKitAssetReference } from '../../features/canvas/kitReference'
import type { CanvasStore } from '../../state/workbenches/canvas/store'
import {
  IconChevronLeft,
  IconSliders,
} from '../../workbenches/canvas/toolbar/icons'
import { ReferenceLightbox } from './ReferenceLightbox'
import {
  kitItemsOf,
  ReferenceKitFilters,
  ReferenceKitItems,
  type ItemKind,
  type KitImageItem,
} from './ReferenceKitItems'
import styles from './ReferenceKitPanel.module.css'

export function ReferenceKitPanel({
  projectId,
  store,
  kit,
  version,
  onBack,
}: {
  projectId: string
  store: CanvasStore
  kit: ContextKit
  version: ContextKitVersion | null
  onBack: () => void
}) {
  const platform = usePlatform()
  const items = kitItemsOf(version)
  const imageItems = items.filter(
    (item): item is KitImageItem => item.kind === 'image',
  )
  const [enabled, setEnabled] = useState<Record<ItemKind, boolean>>({
    image: true,
    color: true,
    font: true,
  })
  const [filterOpen, setFilterOpen] = useState(false)
  const [lightbox, setLightbox] = useState<{
    items: ReferenceItem[]
    initialItemId: string
  } | null>(null)
  const visible = items.filter((item) => enabled[item.kind])
  const toggle = (kind: ItemKind) => {
    setEnabled((current) => ({ ...current, [kind]: !current[kind] }))
  }
  const addImage = async (item: KitImageItem) => {
    if (!version) return
    try {
      const reference = await ensureKitAssetReference(
        platform,
        projectId,
        kit,
        version,
        { hash: item.hash, role: item.role, name: item.title },
      )
      sendReferenceToAgent(projectId, [
        { id: reference.id, label: reference.title },
      ])
    } catch (error) {
      store.notify(
        `加入对话失败：${error instanceof Error ? error.message : '未知错误'}`,
        'error',
      )
    }
  }
  const openImage = async (item: KitImageItem) => {
    if (!version) return
    try {
      const references = await Promise.all(
        imageItems.map((image) =>
          ensureKitAssetReference(
            platform,
            projectId,
            kit,
            version,
            { hash: image.hash, role: image.role, name: image.title },
          ),
        ),
      )
      const current = references.find(
        (reference) => reference.assetHash === item.hash,
      )
      if (current) setLightbox({ items: references, initialItemId: current.id })
    } catch (error) {
      store.notify(
        `打开灯箱失败：${error instanceof Error ? error.message : '未知错误'}`,
        'error',
      )
    }
  }

  return (
    <>
      <section
        className={styles.panel}
        data-reference-kit-panel={kit.id}
        aria-label={`套件 ${kit.name}`}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.stopPropagation()
          if (filterOpen) setFilterOpen(false)
          else onBack()
        }}
      >
        <header className={styles.head}>
          <button
            type="button"
            className={styles.iconButton}
            data-reference-kit-back
            aria-label="返回参考面板"
            title="返回参考面板"
            onClick={onBack}
          >
            <IconChevronLeft size={18} />
          </button>
          <h2>{kit.name}</h2>
          <button
            type="button"
            className={styles.iconButton}
            data-reference-kit-filter
            aria-label="筛选套件内容"
            title="筛选套件内容"
            aria-expanded={filterOpen}
            onClick={() => setFilterOpen((current) => !current)}
          >
            <IconSliders size={17} />
          </button>
        </header>
        {filterOpen ? <ReferenceKitFilters enabled={enabled} toggle={toggle} /> : null}
        {!version ? (
          <p className={styles.empty}>这个套件还没有保存版本。</p>
        ) : visible.length === 0 ? (
          <p className={styles.empty}>当前筛选下没有套件内容。</p>
        ) : (
          <ReferenceKitItems items={visible} onAdd={addImage} onOpen={openImage} />
        )}
      </section>
      {lightbox ? (
        <ReferenceLightbox
          projectId={projectId}
          store={store}
          items={lightbox.items}
          initialItemId={lightbox.initialItemId}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </>
  )
}
