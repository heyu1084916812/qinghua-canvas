import { useEffect, useMemo, useState } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import type { ContextKit, ContextKitKind, ContextKitVersion } from '../../domain/shared/context'
import { sendReferenceToAgent } from '../../features/canvas/agentHandoff'
import { ensureKitCardReference } from '../../features/canvas/kitReference'
import { useAsset } from '../../features/shared/assets'
import { createContextRepository } from '../../state/shared/contextRepository'
import type { CanvasStore } from '../../state/workbenches/canvas/store'
import {
  IconChevronLeft,
  IconChevronRight,
  IconMore,
  IconPlus,
} from '../../workbenches/canvas/toolbar/icons'
import { KIT_KINDS } from '../AssetsPage/contextKitDraft'
import styles from './MyAssetsShelf.module.css'

export function MyAssetsShelf({
  projectId,
  store,
  kits,
  error,
  onOpenKitEditor,
}: {
  projectId: string
  store: CanvasStore
  kits: readonly ContextKit[]
  error: string
  onOpenKitEditor: () => void
}) {
  const platform = usePlatform()
  const repository = useMemo(
    () => createContextRepository(platform.storage),
    [platform.storage],
  )
  const [kind, setKind] = useState<ContextKitKind>('brand')
  const [versions, setVersions] = useState<Record<string, ContextKitVersion | null>>({})
  const [selectedKitId, setSelectedKitId] = useState<string | null>(null)
  const visibleKits = kits.filter((kit) => kit.kind === kind)
  const selectedKit = kits.find((kit) => kit.id === selectedKitId) ?? null

  useEffect(() => {
    let active = true
    void Promise.all(kits.map(async (kit) => {
      const rows = await repository.listKitVersions(kit.id)
      return [kit.id, rows.find((row) => row.version === kit.currentVersion) ?? rows.at(-1) ?? null] as const
    })).then((rows) => {
      if (active) setVersions(Object.fromEntries(rows))
    }).catch(() => {
      if (active) setVersions({})
    })
    return () => { active = false }
  }, [kits, repository])

  const addKit = async (kit: ContextKit) => {
    const version = versions[kit.id]
    if (version === undefined) {
      store.notify('正在读取套件版本，请稍后再试')
      return
    }
    if (!version) {
      store.notify('这个套件还没有保存版本', 'error')
      return
    }
    try {
      const reference = await ensureKitCardReference(platform, projectId, kit, version)
      sendReferenceToAgent(projectId, [{ id: reference.id, label: reference.title }])
    } catch (cause) {
      store.notify(`加入对话失败：${cause instanceof Error ? cause.message : '未知错误'}`, 'error')
    }
  }

  if (selectedKit) {
    return (
      <MyAssetsKitDetail
        kit={selectedKit}
        version={versions[selectedKit.id] ?? null}
        onBack={() => setSelectedKitId(null)}
        onOpenEditor={onOpenKitEditor}
        onAdd={() => void addKit(selectedKit)}
      />
    )
  }

  return (
    <div className={styles.shelf} data-my-assets-shelf>
      <div className={styles.tabs} role="tablist" aria-label="套件分类">
        {KIT_KINDS.map((item) => (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={kind === item.value}
            data-my-assets-kind={item.value}
            className={kind === item.value ? styles.tabOn : styles.tab}
            onClick={() => setKind(item.value)}
          >
            {item.label.replace('套件', '')}
          </button>
        ))}
      </div>
      <button
        type="button"
        className={styles.createKit}
        data-my-assets-create-kit
        onClick={onOpenKitEditor}
      >
        <IconPlus size={14} />
        创建{KIT_KINDS.find((item) => item.value === kind)?.label}
      </button>
      {error ? <p className={styles.notice}>{error}</p> : null}
      <div className={styles.kitList}>
        {visibleKits.map((kit) => (
          <KitShelfCard
            key={kit.id}
            kit={kit}
            version={versions[kit.id] ?? null}
            onAdd={() => void addKit(kit)}
            onOpen={() => setSelectedKitId(kit.id)}
          />
        ))}
      </div>
      {!error && visibleKits.length === 0 ? (
        <p className={styles.empty} data-my-assets-empty>
          还没有{KIT_KINDS.find((item) => item.value === kind)?.label}。
        </p>
      ) : null}
    </div>
  )
}

function KitShelfCard({
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
  return (
    <article className={styles.kitCard} data-my-assets-kit-card={kit.id}>
      <button
        type="button"
        className={styles.kitCardMain}
        data-my-assets-kit-add={kit.id}
        aria-label={`将套件 ${kit.name} 加入对话`}
        onClick={onAdd}
      >
        <span className={styles.kitCardTitle}>{kit.name}</span>
        <span className={styles.kitThumbs}>
          {Array.from({ length: 4 }, (_, index) => {
            const resource = version?.resources[index]
            return resource
              ? <KitThumb hash={resource.hash} name={resource.name} key={resource.hash} />
              : <span className={styles.thumb} key={`empty-${index}`} aria-hidden="true" />
          })}
        </span>
      </button>
      <button
        type="button"
        className={styles.kitOpen}
        data-my-assets-kit-open={kit.id}
        aria-label={`打开套件 ${kit.name} 设置`}
        title="打开套件设置"
        onClick={onOpen}
      >
        <IconChevronRight size={16} />
      </button>
    </article>
  )
}

function MyAssetsKitDetail({
  kit,
  version,
  onBack,
  onOpenEditor,
  onAdd,
}: {
  kit: ContextKit
  version: ContextKitVersion | null
  onBack: () => void
  onOpenEditor: () => void
  onAdd: () => void
}) {
  const logo = version?.resources.filter((item) => item.role === 'logo') ?? []
  const photos = version?.resources.filter((item) => item.role !== 'logo') ?? []
  return (
    <section className={styles.detail} data-my-assets-kit-detail={kit.id}>
      <header className={styles.detailHead}>
        <button type="button" className={styles.iconButton} data-my-assets-kit-back aria-label="返回套件列表" title="返回套件列表" onClick={onBack}>
          <IconChevronLeft size={18} />
        </button>
        <h2>{kit.name}</h2>
        <button type="button" className={styles.iconButton} aria-label="管理套件" title="管理套件" onClick={onOpenEditor}>
          <IconMore size={18} />
        </button>
      </header>
      <section className={styles.detailSection}>
        <h3>描述</h3>
        <div className={styles.description}>{version?.guide || kit.description || '暂无描述'}</div>
      </section>
      <DetailAssets title="Logo" items={logo} onAdd={onOpenEditor} />
      <section className={styles.detailSection}>
        <h3>颜色 <button type="button" onClick={onOpenEditor}>+ 添加</button></h3>
        <div className={styles.colorList}>
          {(version?.colors ?? []).map((color) => (
            <span className={styles.colorItem} key={color.id}>
              <span style={{ background: color.value }} />
              <small>{color.name || color.value}</small>
            </span>
          ))}
        </div>
      </section>
      <section className={styles.detailSection}>
        <h3>字体 <button type="button" onClick={onOpenEditor}>+ 添加</button></h3>
        <div className={styles.fontList}>
          {(version?.fonts ?? []).map((font) => (
            <span className={styles.fontItem} key={font.id}>
              <strong>Aa</strong>
              <small>{font.name}</small>
            </span>
          ))}
        </div>
      </section>
      <DetailAssets title="照片" items={photos} onAdd={onOpenEditor} />
      <button type="button" className={styles.addAgent} data-my-assets-kit-detail-add onClick={onAdd} disabled={!version}>
        添加到对话
      </button>
    </section>
  )
}

function DetailAssets({
  title,
  items,
  onAdd,
}: {
  title: string
  items: readonly { hash: string; name: string }[]
  onAdd: () => void
}) {
  return (
    <section className={styles.detailSection}>
      <h3>{title} <button type="button" onClick={onAdd}>+ 添加</button></h3>
      <div className={styles.detailMedia}>
        {items.map((item) => (
          <span className={styles.detailMediaItem} key={item.hash}>
            <KitThumb hash={item.hash} name={item.name} />
            <small>{item.name || '套件素材'}</small>
          </span>
        ))}
      </div>
    </section>
  )
}

function KitThumb({ hash, name }: { hash: string; name: string }) {
  const url = useAsset(hash)
  return (
    <span className={styles.thumb}>
      {url ? <img src={url} alt={name} loading="lazy" /> : null}
    </span>
  )
}
