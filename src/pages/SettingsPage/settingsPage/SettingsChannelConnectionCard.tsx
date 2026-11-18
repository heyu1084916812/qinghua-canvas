import type { ReactNode } from 'react'
import { useChannels } from '../../../app/providers/ChannelStoreProvider'
import { usePlatform } from '../../../app/providers/PlatformProvider'
import type { Channel, ChannelCredentialGroup } from '../../../domain/project/channel'
import type { ProtocolCatalog } from '../../../domain/project/protocol'
import type { NoticeTone } from '../../../domain/ui/notice'
import {
  protocolOptionsFor,
  protocolUsageFor,
} from './settingsChannelPresentation'
import { SettingsConnectionView } from './SettingsConnectionView'
import { SettingsCredentialFieldView } from './SettingsCredentialFieldView'
import { SettingsProviderHeaderView } from './SettingsProviderHeaderView'
import { settingsPageStyles as styles } from './settingsPageStyles'
import { useChannelProtocolDraft } from './useChannelProtocolDraft'

export type SettingsChannelConnectionCardProps = {
  channel: Channel
  name: string
  protocol: string
  baseUrl: string
  enabled: boolean
  busy: boolean
  builtinSelected: boolean
  catalog: ProtocolCatalog
  hiddenBuiltinProtocolIds: readonly string[]
  referencedProtocolIds: ReadonlySet<string>
  activeGroup: ChannelCredentialGroup | null
  selectedKeyGroups: ChannelCredentialGroup[]
  statusLine: ReactNode
  statusTone: NoticeTone
  showMockNote: boolean
  setProtocol: (value: string) => void
  setBaseUrl: (value: string) => void
  setCatalogVersion: (update: (value: number) => number) => void
  onPersistForm: () => unknown
  onEnabledChange: (enabled: boolean) => void
  onEditProfile: (channelId: string) => void
  onPriorityChange: (value: number) => void
  onWeightChange: (value: number) => void
  onDetect: () => void
  onVerify: () => void
}

/**
 * 「服务资料头 + 连接与鉴权」整块（用户 2026-11-18：「从连接卡开始」拆）。
 *
 * 组件只做装配：协议草稿态由 `useChannelProtocolDraft` 管，协议下拉与 Key 槽位
 * 由目录现算；渲染树与拆分前**逐节点一致**（仍是 `form` 下的两个兄弟块），
 * 所以 `data-settings-provider-head` / `data-settings-section="connection"` 等
 * 冒烟锚点与 CSS 都按原样命中。
 */
export function SettingsChannelConnectionCard({
  channel,
  name,
  protocol,
  baseUrl,
  enabled,
  busy,
  builtinSelected,
  catalog,
  hiddenBuiltinProtocolIds,
  referencedProtocolIds,
  activeGroup,
  selectedKeyGroups,
  statusLine,
  statusTone,
  showMockNote,
  setProtocol,
  setBaseUrl,
  setCatalogVersion,
  onPersistForm,
  onEnabledChange,
  onEditProfile,
  onPriorityChange,
  onWeightChange,
  onDetect,
  onVerify,
}: SettingsChannelConnectionCardProps) {
  const channels = useChannels()
  const platform = usePlatform()
  const draft = useChannelProtocolDraft({
    channels,
    platform,
    selectedId: channel.id,
    protocol,
    baseUrl,
    catalog,
    setProtocol,
    setBaseUrl,
    setCatalogVersion,
  })
  const { credentials: credentialSlots = [], docUrl = '' } = protocolUsageFor(protocol, catalog)
  const { visible: visibleProtocolOptions, pending: pendingProtocols } = protocolOptionsFor({
    catalog,
    currentProtocol: protocol,
    hiddenBuiltinProtocolIds: new Set(hiddenBuiltinProtocolIds),
  })

  return (
    <>
      <SettingsProviderHeaderView
        channelId={channel.id}
        protocol={protocol}
        icon={channel.icon}
        name={name}
        ariaName={channel.name}
        enabled={enabled}
        priority={channel.priority}
        weight={channel.weight}
        onEditProfile={onEditProfile}
        onEnabledChange={onEnabledChange}
        onPriorityChange={onPriorityChange}
        onWeightChange={onWeightChange}
      />
      <div className={styles.settingsCard} data-settings-section="connection">
        <SettingsConnectionView
          baseUrl={baseUrl}
          busy={busy}
          protocol={protocol}
          builtinSelected={builtinSelected}
          visibleProtocolOptions={visibleProtocolOptions}
          pendingProtocols={pendingProtocols}
          referencedProtocolIds={referencedProtocolIds}
          statusLine={statusLine}
          statusTone={statusTone}
          showMockNote={showMockNote}
          credentialField={
            <SettingsCredentialFieldView
              channels={channels}
              selected={channel}
              activeGroup={activeGroup}
              selectedKeyGroups={selectedKeyGroups}
              credentialSlots={credentialSlots}
              docUrl={docUrl}
            />
          }
          newProtoOpen={draft.newProtoOpen}
          hiddenBuiltinProtocolCount={hiddenBuiltinProtocolIds.length}
          npNotice={draft.npNotice}
          protoManageNotice={draft.protoManageNotice}
          protoRemoveError={draft.protoRemoveError}
          npImportText={draft.npImportText}
          npImported={draft.npImported}
          npError={draft.npError}
          onBaseUrlChange={setBaseUrl}
          onPersistForm={onPersistForm}
          onProtocolChange={draft.actions.handleProtocolChange}
          onDownloadProtocol={draft.actions.downloadProtocol}
          onRemoveProtocol={(definition) => void draft.actions.handleRemoveProtocol(definition)}
          onDetect={onDetect}
          onVerify={onVerify}
          onToggleNewProtocol={draft.actions.toggleNewProtocol}
          onRestoreBuiltinProtocols={() => void draft.actions.handleRestoreBuiltinProtocols()}
          onDownloadProtocolTemplate={draft.actions.downloadProtocolTemplate}
          onImportProtocolFile={(file) => void draft.actions.handleImportProtocolFile(file)}
          onImportTextChange={draft.setNpImportText}
          onClearImported={() => draft.setNpImported(null)}
          onClearImportError={() => draft.setNpError('')}
          onCheckImportedProtocol={draft.actions.checkImportedProtocol}
          onSaveImportedProtocol={draft.actions.handleSaveImportedProtocol}
        />
      </div>
    </>
  )
}
