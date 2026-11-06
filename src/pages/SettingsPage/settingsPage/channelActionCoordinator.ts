import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Channel, ChannelCredentialGroup } from '../../../domain/project/channel'
import type { ProtocolCatalog } from '../../../domain/project/protocol'
import type { PresetModel, PresetVendor } from '../../../domain/project/modelPresets'
import type { ModelCapability } from '../../../domain/shared/capability'
import type { PlatformKit } from '../../../platform/ports'
import type { ChannelStore } from '../../../state/channel/channelStore'
import { isBuiltinChannelId } from '../../../domain/project/builtinChannels'
import { readChannelIconFile } from '../../../features/shared/channelIcon/readIconFile'
import { applySelection, initialChecked, removeModel } from '../../../domain/project/modelSelection'
import { measureProfileDrawerBounds } from '../settingsPageConstants'

export interface ChannelFormState {
  name: string
  protocol: string
  baseUrl: string
  enabled: boolean
}

export interface ChannelActionState {
  selectedId: string | null
  form: ChannelFormState
  selected: Channel | null
  selectedKeyGroups: ChannelCredentialGroup[]
  activeGroup: ChannelCredentialGroup | null
  activeModels: readonly ModelCapability[]
  activeModelCache: readonly ModelCapability[]
  channelList: readonly Channel[]
  catalog: ProtocolCatalog
  hiddenBuiltinProtocolIds: ReadonlySet<string>
  draftChecked: ReadonlySet<string>
  dragId: string | null
  profileNameDraft: string
  profileIconDraft: string | null
  newModelName: string
  newModelCategory: PresetModel['category']
  newModelVendor: PresetVendor
  platform: PlatformKit
}

export interface ChannelActionPorts {
  channels: ChannelStore
  getChannels(): readonly Channel[]
  setSelectedId(value: string | null): void
  setActiveGroupId(value: string | null): void
  setChannelFilter(value: 'all' | 'enabled' | 'disabled'): void
  setChannelSearch(value: string): void
  setForm(next: Partial<ChannelFormState>): void
  setBusy(value: boolean): void
  setVerifiedFor(value: { channelId: string; protocol: string; source: 'verify' | 'models' | 'detect' } | null): void
  setChannelMenu(value: { channelId: string; x: number; y: number } | null): void
  setMenuConfirmDelete(value: boolean): void
  setProfileDrawerBounds(value: ReturnType<typeof measureProfileDrawerBounds>): void
  setProfileNameDraft(value: string): void
  setProfileIconDraft(value: string | null): void
  setProfileDrawerOpen(value: boolean): void
  setProfileSaving(value: boolean): void
  profileReturnFocus(value: HTMLElement | null): void
  setPanelOpen(value: boolean): void
  setDraftChecked(update: (previous: ReadonlySet<string>) => ReadonlySet<string>): void
  setDraftCategory(value: 'all' | ModelCapability['category']): void
  setDraftKeyword(value: string): void
  setDragId(value: string | null): void
  setNewModelName(value: string): void
  setModelAddOpen(value: boolean): void
  setMapCategory(value: 'image' | 'chat' | 'video' | 'audio'): void
  alert(message: string): void
  confirm(message: string): boolean
}

export type ChannelActions = ReturnType<typeof createChannelActions>

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function rawErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function syncForm(saved: Channel, ports: ChannelActionPorts): void {
  ports.setForm({
    name: saved.name,
    protocol: saved.protocol,
    baseUrl: saved.baseUrl,
    enabled: saved.enabled,
  })
}

async function persistForm(state: ChannelActionState, ports: ChannelActionPorts): Promise<Channel> {
  const saved = await ports.channels.update(state.selectedId!, {
    name: state.form.name.trim() || '新建服务',
    protocol: state.form.protocol,
    baseUrl: state.form.baseUrl.trim(),
    enabled: state.form.enabled,
  })
  syncForm(saved, ports)
  return saved
}

/** 页面只传递 React 状态和平台端口；渠道写操作仍全部经 ChannelStore。 */
export function createChannelActions(ports: ChannelActionPorts) {
  return {
    create: async (state: ChannelActionState) => {
      const fallbackProtocol =
        state.catalog.all.find(
          (item) =>
            item.status === 'ready' &&
            !state.hiddenBuiltinProtocolIds.has(item.id) &&
            item.kind !== 'legacy' &&
            item.kind !== 'hidden',
        )?.id ?? 'mock'
      const channel = await ports.channels.create({
        name: '新建服务',
        protocol: fallbackProtocol,
        baseUrl: '',
      })
      ports.setChannelFilter('all')
      ports.setChannelSearch('')
      ports.setSelectedId(channel.id)
    },
    setEnabled: async (state: ChannelActionState, next: boolean) => {
      if (!state.selectedId) return
      ports.setForm({ enabled: next })
      try {
        await ports.channels.setEnabled(state.selectedId, next)
      } catch (error) {
        ports.setForm({ enabled: !next })
        ports.alert(errorMessage(error, '保存启用状态失败'))
      }
    },
    readProfileIconFile: async (file: File | undefined) => {
      if (!file) return
      try {
        ports.setProfileIconDraft(await readChannelIconFile(file))
      } catch {
        ports.alert('这张图片读不出来，换一张试试')
      }
    },
    saveProfileDrawer: async (state: ChannelActionState) => {
      if (!state.selectedId) return
      ports.setProfileSaving(true)
      try {
        const nextName = state.profileNameDraft.trim() || state.selected?.name || '未命名服务'
        const saved = await ports.channels.update(state.selectedId, {
          name: nextName,
          icon: state.profileIconDraft,
        })
        ports.setForm({ name: saved.name })
        ports.setProfileNameDraft(saved.name)
        ports.setProfileIconDraft(saved.icon)
        ports.setProfileDrawerOpen(false)
      } catch (error) {
        ports.alert(errorMessage(error, '保存失败'))
      } finally {
        ports.setProfileSaving(false)
      }
    },
    syncForm: (channel: Channel) => syncForm(channel, ports),
    persistForm: async (state: ChannelActionState) => persistForm(state, ports),
    verify: async (state: ChannelActionState) => {
      if (!state.selectedId) return
      ports.setBusy(true)
      try {
        await persistForm(state, ports)
        ports.setVerifiedFor({ channelId: state.selectedId, protocol: state.form.protocol, source: 'verify' })
        await ports.channels.verify(state.selectedId, state.activeGroup?.id)
      } finally {
        ports.setBusy(false)
      }
    },
    detect: async (state: ChannelActionState) => {
      if (!state.selectedId) return
      ports.setBusy(true)
      try {
        await persistForm(state, ports)
        ports.setVerifiedFor({ channelId: state.selectedId, protocol: state.form.protocol, source: 'detect' })
        const hit = await ports.channels.detectProtocol(state.selectedId, state.activeGroup?.id)
        if (hit) ports.setForm({ protocol: hit })
      } finally {
        ports.setBusy(false)
      }
    },
    refresh: async (state: ChannelActionState) => {
      if (!state.selectedId) return
      ports.setBusy(true)
      try {
        await persistForm(state, ports)
        ports.setVerifiedFor({ channelId: state.selectedId, protocol: state.form.protocol, source: 'models' })
        await ports.channels.refreshModels(state.selectedId, state.activeGroup?.id)
      } finally {
        ports.setBusy(false)
      }
    },
    openChannelMenu: (channelId: string, x: number, y: number) => {
      ports.setChannelMenu({ channelId, x, y })
      ports.setMenuConfirmDelete(false)
    },
    openChannelMenuFromButton: (
      event: Pick<ReactPointerEvent<HTMLButtonElement>, 'currentTarget' | 'stopPropagation'>,
      channelId: string,
    ) => {
      event.stopPropagation()
      const rect = event.currentTarget.getBoundingClientRect()
      ports.setChannelMenu({ channelId, x: rect.right - 8, y: rect.bottom + 6 })
      ports.setMenuConfirmDelete(false)
    },
    editChannel: (_state: ChannelActionState, channelId: string) => {
      const channel = ports.getChannels().find((item) => item.id === channelId)
      if (!channel) return
      ports.profileReturnFocus(
        typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null,
      )
      ports.setProfileDrawerBounds(measureProfileDrawerBounds())
      ports.setSelectedId(channelId)
      ports.setProfileNameDraft(channel.name)
      ports.setProfileIconDraft(channel.icon)
      ports.setProfileDrawerOpen(true)
      ports.setChannelMenu(null)
      ports.setMenuConfirmDelete(false)
    },
    remove: async (state: ChannelActionState, channelId: string) => {
      if (isBuiltinChannelId(channelId)) return
      ports.setBusy(true)
      try {
        await ports.channels.remove(channelId)
        if (state.selectedId === channelId) ports.setSelectedId(null)
        ports.setChannelMenu(null)
        ports.setMenuConfirmDelete(false)
      } catch (error) {
        ports.alert(errorMessage(error, '删除失败'))
        ports.setMenuConfirmDelete(false)
      } finally {
        ports.setBusy(false)
      }
    },
    addKeyGroup: async (state: ChannelActionState) => {
      if (!state.selectedId) return
      ports.setBusy(true)
      try {
        const group = await ports.channels.addCredentialGroup(state.selectedId)
        ports.setActiveGroupId(group.id)
      } finally {
        ports.setBusy(false)
      }
    },
    removeKeyGroup: async (state: ChannelActionState) => {
      if (!state.selectedId || !state.activeGroup) return
      if (!ports.confirm(`删除 Key 分组「${state.activeGroup.name}」？这会同时删除该组 Key。`)) return
      ports.setBusy(true)
      try {
        await ports.channels.removeCredentialGroup(state.selectedId, state.activeGroup.id)
        const rest = state.selectedKeyGroups.filter((group) => group.id !== state.activeGroup?.id)
        ports.setActiveGroupId(rest[0]?.id ?? null)
      } catch (error) {
        ports.alert(rawErrorMessage(error))
      } finally {
        ports.setBusy(false)
      }
    },
    addGlobalModel: async (state: ChannelActionState) => {
      try {
        const model = await ports.channels.addGlobalModel({
          name: state.newModelName,
          category: state.newModelCategory,
          vendor: state.newModelVendor,
        })
        ports.setNewModelName('')
        ports.setModelAddOpen(false)
        ports.setMapCategory(model.category as 'image' | 'chat' | 'video' | 'audio')
      } catch (error) {
        ports.alert(rawErrorMessage(error))
      }
    },
    removeGlobalModel: async (name: string) => {
      if (!ports.confirm(`删除前端模型「${name}」？各渠道里的同名映射会保留。`)) return
      try {
        await ports.channels.removeGlobalModel(name)
      } catch (error) {
        ports.alert(rawErrorMessage(error))
      }
    },
    openPanel: (state: ChannelActionState) => {
      if (!state.selected) return
      ports.setDraftChecked(() => initialChecked(state.activeModels))
      ports.setDraftCategory('all')
      ports.setDraftKeyword('')
      ports.setPanelOpen(true)
    },
    toggleDraft: (_state: ChannelActionState, modelId: string, on: boolean) => {
      ports.setDraftChecked((previous) => {
        const next = new Set(previous)
        if (on) next.add(modelId)
        else next.delete(modelId)
        return next
      })
    },
    applyDraft: async (state: ChannelActionState) => {
      if (!state.selectedId || !state.selected) return
      ports.setBusy(true)
      try {
        await ports.channels.setModels(
          state.selectedId,
          applySelection(state.activeModels, state.activeModelCache, state.draftChecked),
          state.activeGroup?.id,
        )
        ports.setPanelOpen(false)
      } finally {
        ports.setBusy(false)
      }
    },
    dropSelectedModel: async (state: ChannelActionState, modelId: string) => {
      if (!state.selectedId || !state.selected) return
      await ports.channels.setModels(
        state.selectedId,
        removeModel(state.activeModels, modelId),
        state.activeGroup?.id,
      )
    },
    dropOnChannel: async (state: ChannelActionState, targetId: string) => {
      const from = state.dragId
      ports.setDragId(null)
      if (!from || from === targetId) return
      const ids = state.channelList.map((channel) => channel.id)
      const i = ids.indexOf(from)
      const j = ids.indexOf(targetId)
      if (i < 0 || j < 0) return
      ids.splice(j, 0, ...ids.splice(i, 1))
      await ports.channels.reorder(ids)
    },
  }
}
