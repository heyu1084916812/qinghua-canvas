import type { Channel, ChannelCredentialGroup } from '../../../domain/project/channel'
import type { CategoryFilter } from '../../../domain/project/modelSelection'
import type { ModelCapability } from '../../../domain/shared/capability'
import {
  draftModelsFor,
  selectedModelGroupsFor,
} from './settingsChannelPresentation'
import { SettingsKeyGroupView } from './SettingsKeyGroupView'
import { SettingsModelsView } from './SettingsModelsView'
import { settingsPageStyles as styles } from './settingsPageStyles'

export type SettingsChannelGroupWorkspaceCardProps = {
  channel: Channel
  activeGroup: ChannelCredentialGroup | null
  selectedKeyGroups: ChannelCredentialGroup[]
  busy: boolean
  activeModelCache: readonly ModelCapability[]
  panelOpen: boolean
  draftCategory: CategoryFilter
  draftChecked: ReadonlySet<string>
  onAddKeyGroup: () => Promise<void>
  onRemoveKeyGroup: (groupId: string) => Promise<void>
  onActiveGroupChange: (groupId: string) => void
  onRenameKeyGroup: (groupId: string, name: string) => void
  onSetKeyGroupPriority: (groupId: string, priority: number) => void
  onRefresh: () => void
  onOpenPanel: () => void
  onClosePanel: () => void
  onDraftCategoryChange: (category: CategoryFilter) => void
  onToggleDraft: (modelId: string, checked: boolean) => void
  onModelCategoryChange: (modelId: string, category: ModelCapability['category']) => void
  onDropSelectedModel: (modelId: string) => void
  onApplyDraft: () => void
}

/**
 * 「Key 分组 + 模型列表」那张卡（用户 2026-11-18「继续」：按卡拆分第 2 步）。
 *
 * 与连接卡同一条规矩：`groupWorkspaceCard` 这层壳留在组件里，DOM 与拆分前一致，
 * `data-settings-group-workspace` / `data-key-groups` / `data-settings-models` 都不动。
 *
 * 草稿态（`panelOpen` / `draftChecked` / `draftCategory`）**故意不搬进来**：
 * 它们由 `channelActions` 的 `openPanel / toggleDraft / applyDraft` 驱动、
 * 并在切换渠道时被 `applySelectedChannelChange` 重置，属于页面级状态。
 * 这里只搬「由这几个状态推导出来」的两个列表与卡片装配。
 */
export function SettingsChannelGroupWorkspaceCard({
  channel,
  activeGroup,
  selectedKeyGroups,
  busy,
  activeModelCache,
  panelOpen,
  draftCategory,
  draftChecked,
  onAddKeyGroup,
  onRemoveKeyGroup,
  onActiveGroupChange,
  onRenameKeyGroup,
  onSetKeyGroupPriority,
  onRefresh,
  onOpenPanel,
  onClosePanel,
  onDraftCategoryChange,
  onToggleDraft,
  onModelCategoryChange,
  onDropSelectedModel,
  onApplyDraft,
}: SettingsChannelGroupWorkspaceCardProps) {
  const draftList = draftModelsFor(channel, activeModelCache, draftCategory, '')
  const selectedGroups = selectedModelGroupsFor(activeGroup?.models ?? channel.models ?? [])

  return (
    <div className={styles.groupWorkspaceCard} data-settings-group-workspace>
      <SettingsKeyGroupView
        activeGroup={activeGroup}
        selectedKeyGroups={selectedKeyGroups}
        busy={busy}
        onAddKeyGroup={onAddKeyGroup}
        onRemoveKeyGroup={onRemoveKeyGroup}
        onActiveGroupChange={onActiveGroupChange}
        onRenameKeyGroup={onRenameKeyGroup}
        onSetKeyGroupPriority={onSetKeyGroupPriority}
      />

      <SettingsModelsView
        busy={busy}
        activeGroup={activeGroup}
        activeModelCache={activeModelCache}
        selectedGroups={selectedGroups}
        panelOpen={panelOpen}
        draftCategory={draftCategory}
        draftChecked={draftChecked}
        draftList={draftList}
        onRefresh={onRefresh}
        onOpenPanel={onOpenPanel}
        onClosePanel={onClosePanel}
        onDraftCategoryChange={onDraftCategoryChange}
        onToggleDraft={onToggleDraft}
        onModelCategoryChange={onModelCategoryChange}
        onDropSelectedModel={onDropSelectedModel}
        onApplyDraft={onApplyDraft}
      />
    </div>
  )
}
