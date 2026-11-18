import type { ChannelActions, ChannelActionState } from './channelActionCoordinator'
import type { ModelMappingActions } from './modelMappingActionCoordinator'

export interface SettingsActionDelegateSources {
  channelActions: ChannelActions
  mappingActions: ModelMappingActions
  channelState(): ChannelActionState
}

/**
 * 渠道 / 映射两类动作的「取当前快照再执行」委托。
 *
 * 协议动作（导入 / 导出 / 删除 / 恢复）已随连接卡搬进 `useChannelProtocolDraft`
 * （2026-11-18「从连接卡开始」）——它们的草稿态就在那张卡里，留在这里只会
 * 让页面继续持有 7 份没人读的 state。
 */
export function createSettingsActionDelegates(sources: SettingsActionDelegateSources) {
  const { channelActions, mappingActions } = sources
  const fromChannel = <Args extends unknown[], Result>(
    action: (state: ChannelActionState, ...args: Args) => Result,
  ) => (...args: Args) => action(sources.channelState(), ...args)
  return {
    handleCreate: fromChannel(channelActions.create),
    handleEnableChange: fromChannel(channelActions.setEnabled),
    handleProfileIconFile: async (file: File | undefined) =>
      await channelActions.readProfileIconFile(file),
    saveProfileDrawer: fromChannel(channelActions.saveProfileDrawer),
    persistForm: fromChannel(channelActions.persistForm),
    handleVerify: fromChannel(channelActions.verify),
    handleDetect: fromChannel(channelActions.detect),
    handleRefresh: fromChannel(channelActions.refresh),
    openChannelMenu: channelActions.openChannelMenu,
    openChannelMenuFromButton: channelActions.openChannelMenuFromButton,
    editChannel: fromChannel(channelActions.editChannel),
    handleRemove: fromChannel(channelActions.remove),
    handleConfirmRemove: fromChannel(channelActions.confirmRemove),
    handleAddKeyGroup: fromChannel(channelActions.addKeyGroup),
    handleRemoveKeyGroup: fromChannel(channelActions.removeKeyGroup),
    flushModelMapping: mappingActions.flush,
    scheduleModelMapping: mappingActions.schedule,
    testModelMapping: mappingActions.test,
    openPanel: fromChannel(channelActions.openPanel),
    toggleDraft: fromChannel(channelActions.toggleDraft),
    applyDraft: fromChannel(channelActions.applyDraft),
    dropSelectedModel: fromChannel(channelActions.dropSelectedModel),
    dropOnChannel: fromChannel(channelActions.dropOnChannel),
  }
}
