import { useMemo, useState } from 'react'
import type { PresetModel, PresetVendor } from '../../../domain/project/modelPresets'
import type { ChannelStore } from '../../../state/channel/channelStore'

export type MapSaveNotice = {
  id: string
  tone: 'ok' | 'error'
  text: string
}

export type ChannelMappingDraftSource = {
  channels: ChannelStore
  selectedId: string | null
  activeGroupId: string | undefined
  customModels: readonly { id: string }[]
  uncommonModelIds: readonly string[]
  setMapSaveNotice(notice: MapSaveNotice | null): void
  /** 对话框端口：默认走 `window`，单测注入假实现（node 里没有 `window`） */
  alertMessage?(message: string): void
  confirmMessage?(message: string): boolean
}

/** 前端模型目录的四档（与 `ModelCapability['category']` 对齐，`unknown` 不入档） */
const CATEGORIES = ['image', 'chat', 'video', 'audio'] as const

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 模型映射卡的**本卡状态与动作**（用户 2026-11-18「继续」：按卡拆分第 3 步）。
 *
 * 搬进来的依据：这些状态与动作原先挂在页面上，但只有「模型映射」这一块读写
 * （`addGlobalModel` / `removeGlobalModel` 也只被这张卡调用）。搬走后
 * `channelActionCoordinator` 不再需要读三个表单字段、也不再持有这两个动作。
 *
 * `mapSaveNotice` 仍归页面：它在切渠道时由 `applySelectedChannelChange` 重置、
 * 还有一条 1.2s 自动消失的 effect，一并搬会让「切渠道清场」的契约断成两半。
 */
export function useChannelMappingDraft(source: ChannelMappingDraftSource) {
  const { channels, selectedId, activeGroupId, customModels, uncommonModelIds, setMapSaveNotice } =
    source
  const alertMessage = source.alertMessage ?? ((message: string) => window.alert(message))
  const confirmMessage = source.confirmMessage ?? ((message: string) => window.confirm(message))
  const [modelAddOpen, setModelAddOpenState] = useState(false)
  const [modelFormOpen, setModelFormOpen] = useState(false)
  const [newModelName, setNewModelName] = useState('')
  const [newModelCategory, setNewModelCategory] = useState<PresetModel['category']>('image')
  const [newModelVendor, setNewModelVendor] = useState<PresetVendor>('openai')
  const [showUncommonModels, setShowUncommonModels] = useState(false)
  const allGlobalModels = useMemo(
    () => CATEGORIES.flatMap((category) => channels.globalModelsOf(category, true)),
    [channels, customModels, uncommonModelIds],
  )

  const addGlobalModel = async () => {
    try {
      await channels.addGlobalModel({
        name: newModelName,
        category: newModelCategory,
        vendor: newModelVendor,
      })
      setNewModelName('')
    } catch (error) {
      alertMessage(errorMessage(error))
    }
  }

  const removeGlobalModel = async (name: string) => {
    if (!confirmMessage(`删除前端模型「${name}」？各渠道里的同名映射会保留。`)) return
    try {
      await channels.removeGlobalModel(name)
    } catch (error) {
      alertMessage(errorMessage(error))
    }
  }

  const renameGlobalModel = async (name: string, nextLabel: string) => {
    try {
      await channels.renameGlobalModel(name, nextLabel)
    } catch (error) {
      alertMessage(errorMessage(error))
    }
  }

  const bindModel = async (upstreamId: string, logicalName: string) => {
    if (!selectedId) return
    setMapSaveNotice(null)
    try {
      await channels.setModelBinding(selectedId, upstreamId, logicalName, activeGroupId)
      setMapSaveNotice({ id: logicalName, tone: 'ok', text: '已保存' })
    } catch (error) {
      setMapSaveNotice({
        id: logicalName,
        tone: 'error',
        text: error instanceof Error ? error.message : '保存失败',
      })
    }
  }

  return {
    allGlobalModels,
    modelAddOpen,
    setModelAddOpen: (open: boolean) => {
      setModelAddOpenState(open)
      if (!open) setModelFormOpen(false)
    },
    modelFormOpen,
    setModelFormOpen,
    newModelName,
    setNewModelName,
    newModelCategory,
    setNewModelCategory,
    newModelVendor,
    setNewModelVendor,
    showUncommonModels,
    setShowUncommonModels,
    addGlobalModel,
    removeGlobalModel,
    renameGlobalModel,
    bindModel,
    setModelUncommon: (id: string, uncommon: boolean) => {
      void channels.setModelUncommon(id, uncommon)
    },
  }
}
