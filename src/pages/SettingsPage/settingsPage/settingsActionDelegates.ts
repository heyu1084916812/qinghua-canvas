import type {
  ChannelActions,
  ChannelActionState,
} from './channelActionCoordinator'
import type { ModelMappingActions } from './modelMappingActionCoordinator'
import type {
  ProtocolActions,
  ProtocolActionState,
} from './protocolActionCoordinator'

export interface SettingsActionDelegateSources {
  channelActions: ChannelActions
  mappingActions: ModelMappingActions
  protocolActions: ProtocolActions
  channelState(): ChannelActionState
  protocolState(): ProtocolActionState
}

export function createSettingsActionDelegates(sources: SettingsActionDelegateSources) {
  const { channelActions, mappingActions, protocolActions } = sources
  const fromChannel = <Args extends unknown[], Result>(
    action: (state: ChannelActionState, ...args: Args) => Result,
  ) => (...args: Args) => action(sources.channelState(), ...args)
  const fromProtocol = <Args extends unknown[], Result>(
    action: (state: ProtocolActionState, ...args: Args) => Result,
  ) => (...args: Args) => action(sources.protocolState(), ...args)
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
    handleAddKeyGroup: fromChannel(channelActions.addKeyGroup),
    handleRemoveKeyGroup: fromChannel(channelActions.removeKeyGroup),
    flushModelMapping: mappingActions.flush,
    scheduleModelMapping: mappingActions.schedule,
    testModelMapping: mappingActions.test,
    handleAddGlobalModel: fromChannel(channelActions.addGlobalModel),
    handleRemoveGlobalModel: async (name: string) =>
      await channelActions.removeGlobalModel(name),
    openPanel: fromChannel(channelActions.openPanel),
    toggleDraft: fromChannel(channelActions.toggleDraft),
    applyDraft: fromChannel(channelActions.applyDraft),
    dropSelectedModel: fromChannel(channelActions.dropSelectedModel),
    dropOnChannel: fromChannel(channelActions.dropOnChannel),
    handleProtocolChange: fromProtocol(protocolActions.handleProtocolChange),
    checkImportedProtocol: fromProtocol(protocolActions.checkImportedProtocol),
    handleImportProtocolFile: async (file: File | undefined) =>
      protocolActions.importProtocolFile(file),
    handleSaveImportedProtocol: fromProtocol(protocolActions.saveImportedProtocol),
    downloadProtocolTemplate: protocolActions.downloadProtocolTemplate,
    downloadProtocol: protocolActions.downloadProtocol,
    toggleNewProtocol: fromProtocol(protocolActions.toggleNewProtocol),
    handleRemoveProtocol: fromProtocol(protocolActions.removeProtocol),
    handleRestoreBuiltinProtocols: protocolActions.restoreBuiltinProtocols,
  }
}
