import { useState } from 'react'
import type { PlatformKit } from '../../platform/ports'
import type { ReferenceItem } from '../../domain/project/referenceLedger'
import type { ReferenceLedgerRepository } from '../../state/project/referenceLedgerRepository'
import { downloadAsset } from '../../features/shared/assets/downloadAsset'
import { sendReferenceToAgent } from '../../features/canvas/agentHandoff'
import { createId } from '../../shared/id'
import type { CanvasStore } from '../../state/workbenches/canvas/store'
import {
  IconChat,
  IconCopyText,
  IconDelete,
  IconDownload,
  IconDuplicate,
  IconExpand,
  IconPlus,
  IconRename,
} from '../../workbenches/canvas/toolbar/icons'
import type { ReferenceCardAction } from './ReferenceCardActionMenu'

export function useReferenceCardActions({
  projectId,
  store,
  platform,
  repository,
  setReferences,
  openReference,
  lightboxId,
  setLightboxId,
}: {
  projectId: string
  store: CanvasStore
  platform: PlatformKit
  repository: ReferenceLedgerRepository
  setReferences: (update: (current: ReferenceItem[]) => ReferenceItem[]) => void
  openReference: (item: ReferenceItem) => void
  lightboxId: string | null
  setLightboxId: (id: string | null) => void
}) {
  const [contextMenu, setContextMenu] = useState<{
    item: ReferenceItem
    x: number
    y: number
  } | null>(null)
  const [clipboard, setClipboard] = useState<{
    mode: 'copy' | 'cut'
    item: ReferenceItem
  } | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  const updateReference = async (
    item: ReferenceItem,
    patch: Partial<ReferenceItem>,
  ) => {
    const next = { ...item, ...patch, updatedAt: Date.now() }
    await repository.putItem(next)
    setReferences((current) =>
      current.map((candidate) => (candidate.id === item.id ? next : candidate)),
    )
    return next
  }
  const duplicateReference = async (item: ReferenceItem, title = item.title) => {
    const now = Date.now()
    const copy: ReferenceItem = {
      ...item,
      id: createId('ref'),
      title,
      createdAt: now,
      updatedAt: now,
    }
    await repository.putItem(copy)
    setReferences((current) => [...current, copy])
    return copy
  }
  const pasteReference = async () => {
    if (!clipboard) return
    try {
      if (clipboard.mode === 'copy') {
        await duplicateReference(clipboard.item, `${clipboard.item.title} 副本`)
      } else {
        const moved = {
          ...clipboard.item,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
        await repository.putItem(moved)
        setReferences((current) => [
          ...current.filter((item) => item.id !== moved.id),
          moved,
        ])
      }
      store.notify('已粘贴参考素材')
      setClipboard(null)
    } catch (cause) {
      store.notify(
        `粘贴失败：${cause instanceof Error ? cause.message : '未知错误'}`,
        'error',
      )
    }
  }
  const renameReference = async (item: ReferenceItem) => {
    const title = renameDraft.trim()
    if (!title || title === item.title) {
      setRenamingId(null)
      return
    }
    setRenamingId(null)
    try {
      await updateReference(item, { title })
    } catch (cause) {
      store.notify(
        `重命名失败：${cause instanceof Error ? cause.message : '未知错误'}`,
        'error',
      )
    }
  }
  const exportReference = async (item: ReferenceItem) => {
    if (!item.assetHash) {
      store.notify('这条参考没有可导出的本地图片', 'error')
      return
    }
    const result = await downloadAsset(
      { assets: platform.assets, files: platform.files },
      item.assetHash,
      item.title,
    )
    if (!result.ok) {
      store.notify(
        result.reason === 'missing' ? '参考图片已不存在' : '导出失败',
        'error',
      )
    }
  }
  const deleteReference = async (item: ReferenceItem) => {
    try {
      await repository.removeItem(projectId, item.id)
      setReferences((current) => current.filter((candidate) => candidate.id !== item.id))
      if (lightboxId === item.id) setLightboxId(null)
      if (clipboard?.item.id === item.id) setClipboard(null)
      store.notify('参考素材已删除')
    } catch (cause) {
      store.notify(
        `删除失败：${cause instanceof Error ? cause.message : '未知错误'}`,
        'error',
      )
    }
  }
  const duplicateSafely = (item: ReferenceItem) => {
    void duplicateReference(item, `${item.title} 副本`).catch((cause) => {
      store.notify(
        `创建副本失败：${cause instanceof Error ? cause.message : '未知错误'}`,
        'error',
      )
    })
  }

  const actions: ReferenceCardAction[] = contextMenu
    ? [
        ...(clipboard
          ? [{
              id: 'paste',
              label: '粘贴',
              icon: <IconPlus size={14} />,
              onSelect: () => void pasteReference(),
            }]
          : []),
        {
          id: 'copy',
          label: '复制',
          icon: <IconCopyText size={14} />,
          onSelect: () => {
            setClipboard({ mode: 'copy', item: contextMenu.item })
            store.notify('已复制参考素材')
          },
        },
        {
          id: 'cut',
          label: '剪切',
          icon: <IconDelete size={14} />,
          onSelect: () => {
            setClipboard({ mode: 'cut', item: contextMenu.item })
            store.notify('已剪切参考素材')
          },
        },
        {
          id: 'duplicate',
          label: '创建副本',
          icon: <IconDuplicate size={14} />,
          onSelect: () => duplicateSafely(contextMenu.item),
        },
        {
          id: 'open',
          label: '打开',
          icon: <IconExpand size={14} />,
          disabled: !contextMenu.item.assetHash,
          onSelect: () => openReference(contextMenu.item),
        },
        {
          id: 'add-agent',
          label: '添加到对话',
          icon: <IconChat size={14} />,
          onSelect: () =>
            sendReferenceToAgent(projectId, [
              { id: contextMenu.item.id, label: contextMenu.item.title },
            ]),
        },
        {
          id: 'rename',
          label: '重命名',
          icon: <IconRename size={14} />,
          onSelect: () => {
            setRenamingId(contextMenu.item.id)
            setRenameDraft(contextMenu.item.title)
          },
        },
        {
          id: 'export',
          label: '导出',
          icon: <IconDownload size={14} />,
          disabled: !contextMenu.item.assetHash,
          onSelect: () => void exportReference(contextMenu.item),
        },
        {
          id: 'delete',
          label: '删除',
          icon: <IconDelete size={14} />,
          danger: true,
          onSelect: () => void deleteReference(contextMenu.item),
        },
      ]
    : []

  return {
    contextMenu,
    setContextMenu,
    actions,
    renamingId,
    renameDraft,
    setRenameDraft,
    renameReference,
    cancelRename: () => setRenamingId(null),
  }
}
