import { useEffect, useState } from 'react'
import type { ProtocolCatalog } from '../../../domain/project/protocol'
import type { DeclarativeProtocolPackage } from '../../../domain/project/protocolRecipe'
import type { PlatformKit } from '../../../platform/ports'
import type { ChannelStore } from '../../../state/channel/channelStore'
import {
  createProtocolActions,
  type ProtocolActionState,
} from './protocolActionCoordinator'
import { clearTimedNotice, type TimerPorts } from './settingsInteractionLifecycle'

const draftTimerPorts: TimerPorts = {
  setTimeout: (handler, delay) => setTimeout(handler, delay),
  clearTimeout: (timer) => clearTimeout(timer),
}

export type ChannelProtocolDraftSource = {
  channels: ChannelStore
  platform: Pick<PlatformKit, 'files'>
  selectedId: string | null
  protocol: string
  baseUrl: string
  catalog: ProtocolCatalog
  setProtocol: (value: string) => void
  setBaseUrl: (value: string) => void
  setCatalogVersion: (update: (value: number) => number) => void
}

/**
 * 连接卡的**协议草稿态**（导入面板开合、导入正文 / 解析结果 / 提示与错误、模板与协议下载回执）。
 *
 * 为什么收进这里：这 7 份状态原先全挂在页面作用域上，只被「连接与鉴权」这一块读写，
 * 搬进连接卡后页面少一堆 state 与一份 2.6s 回执清理 effect；动作仍走
 * `createProtocolActions`（导出 / 删除 / 恢复的领域规则不复制一份）。
 */
export function useChannelProtocolDraft(source: ChannelProtocolDraftSource) {
  const [newProtoOpen, setNewProtoOpen] = useState(false)
  const [npImportText, setNpImportText] = useState('')
  const [npImported, setNpImported] = useState<DeclarativeProtocolPackage | null>(null)
  const [npError, setNpError] = useState('')
  const [npNotice, setNpNotice] = useState('')
  const [protoRemoveError, setProtoRemoveError] = useState('')
  const [protoManageNotice, setProtoManageNotice] = useState('')

  useEffect(
    () =>
      clearTimedNotice(
        Boolean(protoManageNotice),
        2600,
        () => setProtoManageNotice(''),
        draftTimerPorts,
      ),
    [protoManageNotice],
  )

  const actions = createProtocolActions({
    channels: source.channels,
    platform: source.platform,
    setCatalogVersion: source.setCatalogVersion,
    setProtocol: source.setProtocol,
    setBaseUrl: source.setBaseUrl,
    setNpImportText,
    setNpImported,
    setNpError,
    setNpNotice,
    setProtoRemoveError,
    setProtoManageNotice,
    setNewProtoOpen,
  })

  const state = (): ProtocolActionState => ({
    selectedId: source.selectedId,
    protocol: source.protocol,
    baseUrl: source.baseUrl,
    catalog: source.catalog,
    npImportText,
    npImported,
    newProtoOpen,
  })
  const bound = <Args extends unknown[], Result>(
    action: (state: ProtocolActionState, ...args: Args) => Result,
  ) => {
    return (...args: Args) => action(state(), ...args)
  }

  return {
    newProtoOpen,
    npImportText,
    npImported,
    npError,
    npNotice,
    protoRemoveError,
    protoManageNotice,
    setNpImportText,
    setNpImported,
    setNpError,
    actions: {
      handleProtocolChange: bound(actions.handleProtocolChange),
      checkImportedProtocol: bound(actions.checkImportedProtocol),
      handleImportProtocolFile: async (file: File | undefined) => {
        await actions.importProtocolFile(file)
      },
      handleSaveImportedProtocol: bound(actions.saveImportedProtocol),
      downloadProtocolTemplate: actions.downloadProtocolTemplate,
      downloadProtocol: actions.downloadProtocol,
      toggleNewProtocol: bound(actions.toggleNewProtocol),
      handleRemoveProtocol: bound(actions.removeProtocol),
      handleRestoreBuiltinProtocols: actions.restoreBuiltinProtocols,
    },
  }
}
