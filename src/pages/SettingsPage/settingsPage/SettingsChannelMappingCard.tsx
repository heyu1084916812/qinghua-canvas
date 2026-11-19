import { useChannels } from '../../../app/providers/ChannelStoreProvider'
import type { Channel, ChannelCredentialGroup } from '../../../domain/project/channel'
import type { ModelCapability } from '../../../domain/shared/capability'
import { SettingsChannelRouteView } from './SettingsChannelRouteView'
import { settingsPageStyles as styles } from './settingsPageStyles'
import {
  useChannelMappingDraft,
  type MapSaveNotice,
} from './useChannelMappingDraft'

export type SettingsChannelMappingCardProps = {
  channel: Channel
  activeGroup: ChannelCredentialGroup | null
  activeModels: readonly ModelCapability[]
  customModels: readonly { id: string }[]
  uncommonModelIds: readonly string[]
  modelMap: Record<string, string>
  mapSaveNotice: MapSaveNotice | null
  setMapSaveNotice: (notice: MapSaveNotice | null) => void
}

/**
 * 「模型映射」那张卡（用户 2026-11-18「继续」：按卡拆分第 3 步）。
 *
 * 卡片自带前端模型目录的增删改查与映射绑定（`useChannelMappingDraft`），
 * 页面只留 `mapSaveNotice` 这一份「切渠道要清场」的状态。
 * `mappingWorkspaceCard` 这层壳与 `data-settings-section="mapping"` 原地不动。
 */
export function SettingsChannelMappingCard({
  channel,
  activeGroup,
  activeModels,
  customModels,
  uncommonModelIds,
  modelMap,
  mapSaveNotice,
  setMapSaveNotice,
}: SettingsChannelMappingCardProps) {
  const channels = useChannels()
  const draft = useChannelMappingDraft({
    channels,
    selectedId: channel.id,
    activeGroupId: activeGroup?.id,
    customModels,
    uncommonModelIds,
    setMapSaveNotice,
  })

  return (
    <div className={styles.mappingWorkspaceCard} data-settings-section="mapping">
      <SettingsChannelRouteView
        scrollScope={channel.id}
        allGlobalModels={draft.allGlobalModels}
        customModels={customModels}
        uncommonModelIds={uncommonModelIds}
        activeModels={activeModels}
        modelAddOpen={draft.modelAddOpen}
        newModelName={draft.newModelName}
        newModelCategory={draft.newModelCategory}
        newModelVendor={draft.newModelVendor}
        showUncommonModels={draft.showUncommonModels}
        modelMap={modelMap}
        mapSaveNotice={mapSaveNotice}
        onModelAddOpenChange={draft.setModelAddOpen}
        onNewModelNameChange={draft.setNewModelName}
        onNewModelCategoryChange={draft.setNewModelCategory}
        onNewModelVendorChange={draft.setNewModelVendor}
        onAddGlobalModel={() => void draft.addGlobalModel()}
        onShowUncommonModelsChange={draft.setShowUncommonModels}
        onBindModel={(upstreamId, logicalName) => void draft.bindModel(upstreamId, logicalName)}
        onModelUncommonChange={draft.setModelUncommon}
        onRemoveGlobalModel={(id) => void draft.removeGlobalModel(id)}
      />
    </div>
  )
}
